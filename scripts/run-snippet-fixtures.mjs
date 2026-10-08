import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
import { repositoryRoot } from './build-plugin.mjs';
import { readSnippets, noSnippetCases } from './extract-snippets.mjs';
import { installedPackage, parseWorkspaceArgs } from './check-snippets.mjs';

export async function runFixtures({root = repositoryRoot, workspace = path.join(root, 'tests/snippets')} = {}) {
  const sdk = (await installedPackage(workspace, '@arkiv-network/sdk')).metadata.version;
  if (sdk !== '0.8.1') throw new Error(`Fixture baseline requires SDK 0.8.1; got ${sdk}`);
  const output = path.join(workspace, '.generated', 'runtime-' + new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(output, {recursive: true});
  for (const file of ['rpc-fixture.mjs', 'runtime-fixtures.mjs']) await copyFile(path.join(root, 'tests/snippets', file), path.join(output, file));
  const {files, snippets} = await readSnippets(root, {languages: ['ts', 'typescript', 'tsx', 'js', 'javascript']});
  const modules = new Map();
  const load = async id => {
    if (modules.has(id)) return modules.get(id);
    const snippet = snippets.find(snippet => snippet.id === id);
    if (!snippet || snippet.skipReason) throw new Error(`Missing or skipped runtime snippet: ${id}`);
    if (snippet.language === 'tsx') throw new Error(`TSX needs a documented browser fixture: ${id}`);
    const file = path.join(output, id.replace(/[^a-zA-Z0-9_-]+/g, '_') + '.mjs');
    const source = ['js', 'javascript'].includes(snippet.language) ? snippet.source : stripTypeScriptTypes(snippet.source);
    await writeFile(file, source, {flag: 'wx'});
    const loaded = await import(pathToFileURL(file).href);
    modules.set(id, loaded);
    return loaded;
  };
  const previousFetch = globalThis.fetch;
  let attemptedNetworkCalls = 0;
  globalThis.fetch = () => { attemptedNetworkCalls++; throw new Error('Network is blocked in deterministic snippet fixtures'); };
  let cases;
  try {
    const fixtures = await import(pathToFileURL(path.join(output, 'runtime-fixtures.mjs')).href);
    cases = await fixtures.run({load, snippets});
  } finally { globalThis.fetch = previousFetch; }
  const outcomeIds = new Set(cases.filter(test => test.kind === 'outcome' && test.status === 'PASS').flatMap(test => test.snippets));
  const report = {version: 1, checkedAt: new Date().toISOString(), sdk, chain: {name: 'synthetic', id: 7738577},
    kind: 'runtime', result: cases.every(test => test.status === 'PASS') && attemptedNetworkCalls === 0 ? 'PASS' : 'FAIL',
    sourceFiles: files, cases: [...cases, ...noSnippetCases(files, snippets)], attemptedNetworkCalls, realBroadcasts: 0, fundsSpent: '0', output,
    sourceHashes: Object.fromEntries(snippets.map(snippet => [snippet.id, snippet.sha256])),
    moduleOnly: snippets.filter(snippet => !snippet.skipReason && !outcomeIds.has(snippet.id)).map(snippet => snippet.id),
    skipped: snippets.filter(snippet => snippet.skipReason).map(({id, skipReason}) => ({id, reason: skipReason})),
    limits: ['Real SDK encoding/decoding and application helper behavior use deterministic RPC state, not a real chain.',
      'Module import proves runtime exports load; moduleOnly entries have no outcome assertion in this suite.',
      'Funded CRUD, consensus authorization, expiration eviction, live reads and wallet/browser compatibility need separate evidence.']};
  await writeFile(path.join(output, 'runtime.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const report = await runFixtures(parseWorkspaceArgs(process.argv.slice(2)));
    console.log(JSON.stringify({result: report.result, cases: report.cases.length, failures: report.cases.filter(test => test.status !== 'PASS'), moduleOnly: report.moduleOnly, report: path.join(report.output, 'runtime.json')}));
    if (report.result !== 'PASS') process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
