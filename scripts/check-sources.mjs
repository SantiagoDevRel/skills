import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repositoryRoot } from './build-plugin.mjs';
import { readSnippets, sha256 } from './extract-snippets.mjs';
import { supportedSdkVersion } from './sdk-version-range.mjs';

export function semanticPage(text) {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(text)?.[1];
  if (!main) throw new Error('Documentation main content unavailable');
  return main.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|#160);/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(?:x([a-f\d]+)|(\d+));/gi, (_, hex, decimal) => String.fromCodePoint(parseInt(hex || decimal, hex ? 16 : 10)))
    .replace(/\s+/g, ' ').trim();
}
export function namedExports(text) {
  if (/\bexport\s*(?:type\s+)?\*\s*/.test(text)) throw new Error('Star-export declaration needs explicit resolution');
  const exports = new Set();
  for (const match of text.matchAll(/\bexport\s*(?:type\s+)?\{([^}]+)\}/g)) {
    for (const binding of match[1].split(',')) {
      const name = binding.trim().replace(/^type\s+/, '').split(/\s+as\s+/).at(-1);
      if (/^[A-Za-z_$][\w$]*$/.test(name)) exports.add(name);
    }
  }
  for (const match of text.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:function|class|interface|type|const|enum)\s+([A-Za-z_$][\w$]*)/g)) exports.add(match[1]);
  if (!exports.size) throw new Error('No named declaration exports found');
  return exports;
}
export function usedSdkExports(snippets) {
  const used = new Map();
  for (const snippet of snippets) for (const match of snippet.source.matchAll(/\bimport\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["'](@arkiv-network\/sdk(?:\/[^"']+)?)['"]/g)) {
    for (const binding of match[1].split(',')) {
      const name = binding.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0];
      if (!name) continue; // A trailing comma is valid TypeScript.
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error(`Unsupported SDK import binding: ${snippet.id}`);
      const id = `${match[2]}:${name}`;
      const entry = used.get(id) ?? {specifier: match[2], name, skills: []};
      entry.skills = [...new Set([...entry.skills, snippet.file.split('/')[1]])]; used.set(id, entry);
    }
  }
  return [...used.values()];
}
async function get(url, request) {
  const response = await request(url, {signal: AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error(`Primary source unavailable: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 2 * 1024 * 1024) throw new Error('Primary source exceeds byte limit');
  return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
}
export async function documentationSources(root = repositoryRoot) {
  const {files} = await readSnippets(root); const sources = new Map();
  for (const source of files.filter(file => !file.file.includes('/arkiv-best-practices/'))) {
    const text = await readFile(path.join(root, source.file), 'utf8');
    for (const match of text.matchAll(/https:\/\/docs\.arkiv\.network[^)\s]+/g)) {
      const url = match[0]; const skill = source.file.split('/')[1];
      sources.set(url, [...new Set([...(sources.get(url) ?? []), skill])]);
    }
  }
  return [...sources].map(([url, skills]) => ({url, skills}));
}
export async function recordBaseline({root = repositoryRoot, request = fetch} = {}) {
  const config = JSON.parse(await readFile(path.join(root, 'plugin.config.json'), 'utf8'));
  const release = JSON.parse(await get(`https://registry.npmjs.org/@arkiv-network%2Fsdk/${config.sdkVersion}`, request));
  if (release.version !== config.sdkVersion || !release.dist?.integrity) throw new Error('SDK release metadata incomplete');
  const docs = [];
  for (const source of await documentationSources(root)) docs.push({...source, sha256: sha256(semanticPage(await get(source.url, request)))});
  return {version: 1, checkedAt: new Date().toISOString(), sdk: {package: '@arkiv-network/sdk', version: release.version, integrity: release.dist.integrity}, docs};
}
export async function checkSources({root = repositoryRoot, request = fetch} = {}) {
  const config = JSON.parse(await readFile(path.join(root, 'plugin.config.json'), 'utf8'));
  const {files, snippets} = await readSnippets(root); const skills = files.filter(file => /^skills\/[^/]+\/SKILL\.md$/.test(file.file)).map(file => file.file.split('/')[1]);
  const baseline = JSON.parse(await readFile(path.join(root, 'tests/snippets/source-baseline.json'), 'utf8'));
  const changed = new Set(), unavailable = [], evidence = [];
  let latest; const exportCases = []; const missingExports = [];
  try {
    const release = JSON.parse(await get('https://registry.npmjs.org/@arkiv-network%2Fsdk/latest', request)); latest = release.version;
    if (latest !== baseline.sdk.version || release.dist?.integrity !== baseline.sdk.integrity) for (const skill of skills) changed.add(skill);
    evidence.push({url: 'https://registry.npmjs.org/@arkiv-network%2Fsdk/latest', version: latest, integrity: release.dist?.integrity});
    const supported = supportedSdkVersion(latest, config.sdkRange, {root});
    if (supported) {
      const metadata = JSON.parse(await get(`https://unpkg.com/@arkiv-network/sdk@${latest}/package.json`, request));
      const imports = usedSdkExports(snippets);
      for (const specifier of new Set(imports.map(binding => binding.specifier))) {
        const subpath = specifier.slice('@arkiv-network/sdk'.length).replace(/^\//, '');
        const declaration = subpath ? metadata.typesVersions?.['*']?.[subpath]?.[0] : metadata.types;
        if (!/^\.\/dist\/[\w/.-]+\.d\.(?:ts|cts|mts)$/.test(declaration ?? '') || declaration.includes('..')) throw new Error('Published declaration path requires review');
        const url = `https://unpkg.com/@arkiv-network/sdk@${latest}/${declaration.slice(2)}`;
        const content = await get(url, request); const exported = namedExports(content);
        evidence.push({url, sha256: sha256(content), exportSurfaceHash: sha256(JSON.stringify([...exported].sort()))});
        for (const binding of imports.filter(binding => binding.specifier === specifier)) {
          const missing = !exported.has(binding.name); if (missing) missingExports.push(binding);
          exportCases.push({id: `export:${specifier}:${binding.name}`, skills: binding.skills, status: missing ? 'FAIL' : 'PASS', evidence: {url, sourceHash: sha256(content)}});
        }
      }
    }
  } catch (error) { unavailable.push({source: 'npm latest', reason: error.message}); }
  const currentDocs = await documentationSources(root);
  for (const source of currentDocs) {
    const prior = baseline.docs.find(item => item.url === source.url);
    if (!prior) { for (const skill of source.skills) changed.add(skill); continue; }
    try {
      const hash = sha256(semanticPage(await get(source.url, request))); evidence.push({url: source.url, sha256: hash});
      if (hash !== prior.sha256) for (const skill of source.skills) changed.add(skill);
    } catch (error) { unavailable.push({source: source.url, skills: source.skills, reason: error.message}); }
  }
  return {version: 1, checkedAt: new Date().toISOString(), sdk: config.sdkVersion, chain: {name: 'synthetic', id: null}, kind: 'sources',
    result: missingExports.length ? 'FAIL' : unavailable.length ? 'SKIPPED' : 'PASS', ...(unavailable.length && !missingExports.length ? {reason: 'Some primary sources are unavailable', operational: true} : {}),
    latest, changedSkills: [...changed], missingExports, unavailable, evidence, sourceFiles: files,
    cases: [...skills.map(skill => ({id: 'published-package-and-cited-docs', skill, status: unavailable.some(source => !source.skills || source.skills.includes(skill)) ? 'SKIPPED' : 'PASS'})), ...exportCases]};
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [output] = process.argv.slice(2); if (!output || process.argv.length !== 3) throw new Error('Usage: node scripts/check-sources.mjs /output/sources.json');
    const report = await checkSources(); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({result: report.result, latest: report.latest, changedSkills: report.changedSkills, unavailable: report.unavailable.length}));
    if (report.result === 'FAIL') process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
