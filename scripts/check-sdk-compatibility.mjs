import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {repositoryRoot} from './build-plugin.mjs';
import {sha256} from './extract-snippets.mjs';
import {supportedSdkVersion} from './sdk-version-range.mjs';

export const latestSdkMetadata='https://registry.npmjs.org/@arkiv-network%2Fsdk/latest';
const maximumMetadataBytes=65536;
async function boundedBody(response) {
  if(!response.body?.getReader) throw new Error('Registry response has no readable body');
  const reader=response.body.getReader();const chunks=[];let length=0;
  try {
    while(true) {
      const item=await reader.read();if(item.done)break;
      length+=item.value.byteLength;
      if(length>maximumMetadataBytes) throw new Error('Registry metadata exceeds the byte limit');
      chunks.push(Buffer.from(item.value));
    }
  } catch(error) {await reader.cancel().catch(()=>{});throw error;}
  finally {reader.releaseLock();}
  return Buffer.concat(chunks,length);
}
export function compatibilityExitCode(report) {
  return report.result==='PASS'?0:report.result==='FAIL'?1:2;
}
export async function checkSdkCompatibility({root=repositoryRoot,request=fetch}={}) {
  const report={version:1,checkedAt:new Date().toISOString(),purpose:'ci-sdk-range-contract',result:'UNAVAILABLE',
    scope:'Published version range only; not snippet, funded, export or service certification',registryUrl:latestSdkMetadata};
  try {
    const config=JSON.parse(await readFile(path.join(root,'plugin.config.json'),'utf8'));
    report.range=config.sdkRange;
    // Check the local parser/range before any external request.
    supportedSdkVersion(config.sdkVersion,config.sdkRange,{root});
    const response=await request(latestSdkMetadata,{signal:AbortSignal.timeout(15000),redirect:'error',credentials:'omit',headers:{Accept:'application/json'}});
    report.httpStatus=response.status;
    if(!response.ok)throw new Error('Registry metadata unavailable: HTTP '+response.status);
    const bytes=await boundedBody(response);
    const metadata=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));
    if(metadata.name!=='@arkiv-network/sdk')throw new Error('Unexpected registry package identity');
    report.latest=metadata.version;report.metadataSha256=sha256(bytes);report.metadataBytes=bytes.length;
    report.supported=supportedSdkVersion(metadata.version,config.sdkRange,{root});
    report.result=report.supported?'PASS':'FAIL';
    report.reason=report.supported?'Published latest is inside the supported range':'Published latest is outside the supported range';
  } catch(error) {
    report.result='UNAVAILABLE';report.operational=true;
    report.reason=error instanceof Error?error.message:'Compatibility verification unavailable';
  }
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [output]=process.argv.slice(2);
    if(!output||!path.isAbsolute(output)||process.argv.length!==3)throw new Error('Pass an absolute compatibility diagnostic output path');
    const report=await checkSdkCompatibility();
    await mkdir(path.dirname(output),{recursive:true});
    await writeFile(output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({result:report.result,latest:report.latest,range:report.range,reason:report.reason}));
    process.exitCode=compatibilityExitCode(report);
  } catch(error) {console.error(error.message);process.exitCode=2;}
}
