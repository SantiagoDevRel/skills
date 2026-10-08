import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

function proseOnly(text) {
  let fence;
  return text.split(/\r?\n/).map(line => {
    const delimiter = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (delimiter?.[0] === fence[0] && delimiter.length >= fence.length &&
          new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(line)) fence = undefined;
      return '';
    }
    if (delimiter) {fence = delimiter; return '';}
    return line.replace(/(`+)([^`]|(?!\1)`)*?\1/g, '');
  }).join('\n');
}

function markdownTargets(text) {
  const prose = proseOnly(text), definitions = new Map(), targets = [];
  const normalize = label => label.trim().replace(/\s+/g, ' ').toLowerCase();
  for (const match of prose.matchAll(/^ {0,3}\[([^\]\n]+)\]:\s*(<[^>\n]+>|\S+)/gm)) {
    definitions.set(normalize(match[1]), match[2].replace(/^<|>$/g, ''));
  }
  const body = prose.replace(/^ {0,3}\[[^\]\n]+\]:[^\n]*$/gm, '');
  for (const match of body.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^\s)]+)(?:\s+[^)]*)?\)/g)) {
    targets.push(match[1].replace(/^<|>$/g, ''));
  }
  for (const match of body.matchAll(/!?\[([^\]\n]+)\](?:\[([^\]\n]*)\])?(?!\()/g)) {
    const target = definitions.get(normalize(match[2] || match[1]));
    if (target) targets.push(target);
  }
  return targets;
}

async function markdownFiles(root, relative = 'skills') {
  const entries = await readdir(path.join(root, relative), {withFileTypes: true});
  const result = [];
  for (const entry of entries) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Skill resource symlink is unsupported: ${name}`);
    if (entry.isDirectory()) result.push(...await markdownFiles(root, name));
    else if (entry.isFile() && /\.md$/i.test(entry.name)) result.push(name);
  }
  return result.sort();
}

export async function checkSkillReferences(root) {
  const absolute = path.resolve(root), files = await markdownFiles(absolute), known = new Set(files);
  const entrypoints = files.filter(file => /^skills\/[^/]+\/SKILL\.md$/.test(file));
  const resources = files.filter(file => /^skills\/[^/]+\/references\/.+\.md$/i.test(file));
  const edges = new Map(), failures = [];
  for (const file of files) {
    const links = new Set();
    for (const target of markdownTargets(await readFile(path.join(absolute, file), 'utf8'))) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) continue;
      let local;
      try {local = decodeURIComponent(target.split('#')[0].split('?')[0]);}
      catch {failures.push({file, rule: 'relative-link', target, message: 'Invalid URL encoding'}); continue;}
      if (!local) continue;
      const resolved = path.resolve(absolute, path.dirname(file), local);
      if (resolved !== absolute && !resolved.startsWith(absolute + path.sep)) {
        failures.push({file, rule: 'relative-link', target, message: 'Local target escapes the repository'}); continue;
      }
      if (!/\.md$/i.test(local)) continue;
      const relative = path.relative(absolute, resolved).split(path.sep).join('/');
      if (known.has(relative)) links.add(relative);
      // This checker follows skill resources; the repository's link checker owns targets elsewhere.
      else if (relative.startsWith('skills/')) failures.push({file, rule: 'relative-link', target, message: 'Missing skill Markdown target'});
    }
    edges.set(file, links);
  }
  if (!entrypoints.length) failures.push({file: 'skills', rule: 'skill-catalog', message: 'No skill entrypoints found'});
  const reachable = new Set(entrypoints), queue = [...entrypoints];
  for (let index = 0; index < queue.length; index++) {
    for (const target of edges.get(queue[index]) ?? []) if (!reachable.has(target)) {reachable.add(target); queue.push(target);}
  }
  for (const file of resources) if (!reachable.has(file)) failures.push({file, rule: 'orphan-reference', message: 'Reference is unreachable from every SKILL.md entrypoint'});
  return {passed: failures.length === 0, skills: entrypoints.length, references: resources.length,
    reachableReferences: resources.filter(file => reachable.has(file)).length, failures};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length > 2) throw new Error('Usage: node scripts/check-skill-references.mjs');
    const result = await checkSkillReferences(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
