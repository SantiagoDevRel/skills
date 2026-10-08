import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { repositoryRoot } from './build-plugin.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function markdownFiles(root, directory = 'skills') {
  const files = [];
  for (const entry of (await readdir(path.join(root, directory), {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Snippet source must not be a symlink: ${relative}`);
    if (entry.isDirectory()) files.push(...await markdownFiles(root, relative));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(relative);
  }
  return files;
}

export function fencedSnippets(text, file, {languages = ['ts', 'typescript', 'tsx']} = {}) {
  const blocks = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let active;
  let ordinal = 0;
  for (let index = 0; index < lines.length; index++) {
    if (!active) {
      const opening = /^ {0,3}(`{3,}|~{3,})([^`]*)$/.exec(lines[index]);
      if (!opening) continue;
      const language = opening[2].trim().split(/\s+/)[0].toLowerCase();
      active = {marker: opening[1][0], length: opening[1].length, language, line: index + 2, lines: []};
      continue;
    }
    const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[index]);
    if (closing && closing[1][0] === active.marker && closing[1].length >= active.length) {
      if (languages.includes(active.language)) {
        const source = active.lines.join('\n') + '\n';
        const skip = /^\s*\/\/ arkiv-snippet: skip\s*[—-]\s*(.+)$/m.exec(source);
        blocks.push({id: `${file}#${++ordinal}`, file, line: active.line, language: active.language,
          source, sha256: sha256(source), ...(skip ? {skipReason: skip[1].trim()} : {})});
      }
      active = undefined;
    } else active.lines.push(lines[index]);
  }
  if (active && languages.includes(active.language)) throw new Error(`Unclosed executable fence: ${file}:${active.line - 1}`);
  return blocks;
}

export async function readSnippets(root = repositoryRoot, options = {}) {
  const snippets = [];
  const files = [];
  for (const file of await markdownFiles(root)) {
    const bytes = await readFile(path.join(root, file));
    const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    files.push({file, sha256: sha256(bytes)});
    snippets.push(...fencedSnippets(text, file, options));
  }
  return {files, snippets};
}

export function noSnippetCases(files, snippets) {
  return files.filter(file => /^skills\/[^/]+\/SKILL\.md$/.test(file.file))
    .map(file => file.file.split('/')[1]).filter(skill => !snippets.some(snippet => snippet.file.startsWith(`skills/${skill}/`)))
    .map(skill => ({id: 'no-typescript-fences', skill, status: 'PASS', evidence: {typescriptFenceCount: 0,
      reason: 'All Markdown files in this skill were scanned; TypeScript execution does not apply.'}}));
}

export function withScaffold(snippet, scaffolds = {}) {
  const scaffold = scaffolds[snippet.id];
  if (!scaffold) return {...snippet, compiledSource: snippet.source, prefixLines: 0};
  if (!scaffold.reason?.trim() || scaffold.sha256 !== snippet.sha256 || typeof scaffold.prefix !== 'string' || typeof scaffold.suffix !== 'string') {
    throw new Error(`Scaffold needs a reason, matching snippet hash, prefix and suffix: ${snippet.id}`);
  }
  if (snippet.skipReason) throw new Error(`A skipped snippet must not also have a scaffold: ${snippet.id}`);
  const prefix = scaffold.prefix ? scaffold.prefix.replace(/\r\n/g, '\n').replace(/\n?$/, '\n') : '';
  return {...snippet, compiledSource: prefix + snippet.source + scaffold.suffix, prefixLines: prefix.split('\n').length - 1, scaffoldReason: scaffold.reason};
}

export async function extractSnippets({root = repositoryRoot, output, scaffolds = {}}) {
  if (!output || !path.isAbsolute(output)) throw new Error('Pass an absolute output directory');
  const {files, snippets} = await readSnippets(root);
  for (const id of Object.keys(scaffolds)) if (!snippets.some(snippet => snippet.id === id)) throw new Error(`Scaffold points to a missing snippet: ${id}`);
  await mkdir(output, {recursive: true});
  const manifest = {version: 1, checkedAt: new Date().toISOString(), sourceFiles: files, snippets: [], skipped: []};
  for (const snippet of snippets) {
    const adapted = withScaffold(snippet, scaffolds);
    const {source, compiledSource, ...entry} = adapted;
    if (snippet.skipReason) { manifest.skipped.push(entry); continue; }
    const filename = snippet.id.replace(/[^a-zA-Z0-9_-]+/g, '_') + (snippet.language === 'tsx' ? '.tsx' : '.mts');
    await writeFile(path.join(output, filename), compiledSource, {flag: 'wx'});
    manifest.snippets.push({...entry, generatedFile: filename, compiledSha256: sha256(compiledSource)});
  }
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1) throw new Error('Usage: node scripts/extract-snippets.mjs /absolute/output/directory');
    const scaffolds = JSON.parse(await readFile(path.join(repositoryRoot, 'tests/snippets/scaffolds.json'), 'utf8'));
    const manifest = await extractSnippets({output: path.resolve(args[0]), scaffolds});
    console.log(JSON.stringify({extracted: manifest.snippets.length, skipped: manifest.skipped, output: path.resolve(args[0])}));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
