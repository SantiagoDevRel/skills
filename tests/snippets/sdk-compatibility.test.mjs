import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {repositoryRoot} from '../../scripts/build-plugin.mjs';
import {supportedSdkVersion} from '../../scripts/sdk-version-range.mjs';
import {checkSdkCompatibility,compatibilityExitCode,latestSdkMetadata} from '../../scripts/check-sdk-compatibility.mjs';

const range='>=0.8.1 <0.9';
const metadata=version=>new Response(JSON.stringify({name:'@arkiv-network/sdk',version}),{status:200});
for(const [version,expected]of [['0.8.0',false],['0.8.1',true],['0.8.999',true],['0.8.1000',true],['0.9.0',false],['1.0.0',false],['0.8.2-rc.1',false],['0.8.1+build.7',true]]) {
  test('canonical supported range: '+version,()=>assert.equal(supportedSdkVersion(version,range),expected));
}
test('invalid versions and ranges fail instead of coercion',()=>{
  for(const version of ['0.8','not-a-version','0.8.1 garbage',null])assert.throws(()=>supportedSdkVersion(version,range));
  assert.throws(()=>supportedSdkVersion('0.8.1','not-a-range'));
});
test('the hard gate accepts inside range and fails outside range',async()=>{
  for(const [version,expected,exit]of [['0.8.1','PASS',0],['0.8.1000','PASS',0],['0.9.0','FAIL',1]]) {
    let calls=0;
    const report=await checkSdkCompatibility({request:async(url,options)=>{
      calls++;assert.equal(url,latestSdkMetadata);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
      assert.deepEqual(options.headers,{Accept:'application/json'});assert.ok(options.signal instanceof AbortSignal);return metadata(version);
    }});
    assert.equal(report.result,expected);assert.equal(compatibilityExitCode(report),exit);assert.equal(calls,1);
    assert.equal(report.kind,undefined,'Compatibility is not an eighth health producer');
  }
});
test('unavailable registry is a nonzero operational result without a fabricated incompatibility',async()=>{
  for(const status of [429,503]){
    let calls=0;const report=await checkSdkCompatibility({request:async()=>{calls++;return new Response('',{status});}});
    assert.equal(report.result,'UNAVAILABLE');assert.equal(report.operational,true);assert.equal(report.supported,undefined);
    assert.equal(compatibilityExitCode(report),2);assert.equal(calls,1);
  }
});
test('wrong package, malformed version and invalid JSON cannot pass',async()=>{
  for(const value of [{name:'other',version:'0.8.1'},{name:'@arkiv-network/sdk',version:'0.8'},'invalid-json']) {
    const report=await checkSdkCompatibility({request:async()=>new Response(typeof value==='string'?value:JSON.stringify(value))});
    assert.equal(report.result,'UNAVAILABLE');assert.equal(compatibilityExitCode(report),2);
  }
});
test('oversized metadata stops at the streaming bound',async()=>{
  let cancelled=false;let produced=0;
  const body=new ReadableStream({pull(controller){produced++;controller.enqueue(new Uint8Array(32768));},cancel(){cancelled=true;}});
  const report=await checkSdkCompatibility({request:async()=>new Response(body)});
  assert.equal(report.result,'UNAVAILABLE');assert.match(report.reason,/byte limit/);assert.ok(cancelled);assert.ok(produced<=4);
});
test('request failure gets no retry and no incompatible-version claim',async()=>{
  let calls=0;const report=await checkSdkCompatibility({request:async()=>{calls++;throw Error('Controlled provider failure');}});
  assert.equal(calls,1);assert.equal(report.result,'UNAVAILABLE');assert.equal(report.supported,undefined);
});
test('the canonical parser is portable through the declared snippet dependency',async()=>{
  assert.equal(supportedSdkVersion('0.8.1000',range,{root:repositoryRoot}),true);
});

test('CLI saves its diagnostic when the evidence directory does not exist',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'arkiv-sdk-cli-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const output=path.join(directory,'new','evidence','sdk-compatibility.json');
  const bootstrap='data:text/javascript,'+encodeURIComponent(
    'globalThis.fetch=async()=>new Response(JSON.stringify({name:"@arkiv-network/sdk",version:"0.8.1"}),{status:200});');
  const stdout=execFileSync(process.execPath,['--import',bootstrap,
    path.join(repositoryRoot,'scripts/check-sdk-compatibility.mjs'),output],
    {cwd:repositoryRoot,encoding:'utf8',timeout:10000});
  assert.equal(JSON.parse(stdout).result,'PASS');
  const report=JSON.parse(await readFile(output,'utf8'));
  assert.equal(report.result,'PASS');
  assert.equal(report.latest,'0.8.1');
});
