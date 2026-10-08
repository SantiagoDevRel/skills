import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { generate, repositoryRoot, validateConfig } from './build-plugin.mjs';

const decoder = new TextDecoder('utf-8', {fatal: true});
const scalar = value => value.replace(/^(["'])(.*)\1$/, '$2');
const lineAt = (text, offset) => text.slice(0, offset).split('\n').length;

export function frontmatter(text) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!block) throw new Error('Missing YAML frontmatter');
  const result = {metadata: {}};
  let metadata = false;
  let metadataSeen = false;
  for (const line of block[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const entry = /^( {0,2})([a-z][a-z0-9-]*):[ \t]*(.*)$/.exec(line);
    if (!entry || entry[1].length === 1) throw new Error('Unsupported frontmatter shape; use plain scalar fields and two-space metadata');
    const [, indent, key, raw] = entry;
    if (!indent) {
      metadata = key === 'metadata';
      if (!['name', 'description', 'license', 'metadata'].includes(key)) throw new Error(`Unexpected frontmatter field: ${key}`);
      if (metadata) {
        if (metadataSeen) throw new Error('Duplicate frontmatter field: metadata');
        metadataSeen = true;
        if (raw) throw new Error('Metadata must use nested scalar fields');
        continue;
      }
      if (key in result) throw new Error(`Duplicate frontmatter field: ${key}`);
      if (!raw || /^(?:[>|]|[\[\{])/.test(raw)) throw new Error(`Use a scalar ${key}`);
      result[key] = scalar(raw);
    } else {
      if (!metadata || !raw || key in result.metadata) throw new Error('Invalid or duplicate metadata field');
      result.metadata[key] = scalar(raw);
    }
  }
  return result;
}

export function contentFindings(text) {
  const findings = [];
  const add = (rule, offset) => findings.push({rule, line: lineAt(text, offset)});
  // Inline API identifiers, quoted diagnostics and fenced code are not marketing claims.
  const prose = text.replace(/```[^\n]*\n[\s\S]*?```/g, match => match.replace(/[^\n]/g, ' ')).replace(/`[^`\n]+`/g, match => ' '.repeat(match.length));
  const hardWords = /\b(?:TTL|BTL|time-to-live|API keys?|on Ethereum|records)\b/gi;
  for (const match of prose.matchAll(hardWords)) add('brand-vocabulary', match.index);
  for (const match of prose.matchAll(/\b(?:decentralized|trustless|permanent)\b/gi)) {
    if (prose[match.index + match[0].length] === '(') continue;
    const line = prose.split('\n')[lineAt(prose, match.index) - 1];
    if (!/\b(?:no|not|never|cannot|do not|don't|without|unqualified|rather than)\b/i.test(line)) add('unqualified-guarantee', match.index);
  }
  for (const match of text.matchAll(/\b(?:Braga|Kaolin|Mendoza)\b|@dev\b|\bdev\.3\b|indexer\.tiramisu|(?:arkivmcp|arkiv-mcp-gateway|arkiv-mcp)\.vercel\.app|llms\.txt/gi)) add('retired-source', match.index);
  for (const match of text.matchAll(/(?:PRIVATE_KEY|privateKey|signingKey)\s*(?:=|:)\s*["'](?:0x)?[a-f\d]{64}["']|\bgh[pousr]_[A-Za-z\d]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g)) add('credential-literal', match.index);
  for (const fence of text.matchAll(/```(?:ts|typescript|tsx|javascript|js|bash|sh|json)\b[^\n]*\n([\s\S]*?)```/g)) {
    const code = fence[1];
    const offset = fence.index + fence[0].indexOf('\n') + 1;
    const guards = [
      ['legacy-api', /\.(?:updateEntity|mutateEntities|subscribeEntityEvents|orderBy|buildQuery|includeData)\s*\(|\b(?:expiresIn|resultsPerPage|annotations)\s*:/g],
      ['timestamp-i32', /\bi32\s*\(\s*Date\.now\s*\(/g],
      ['public-key-env', /\bNEXT_PUBLIC_[A-Z\d_]*(?:KEY|RPC)[A-Z\d_]*/g],
      ['array-rpc-url', /\bhttp\s*\(\s*tiramisu\.rpcUrls\.default\.http\s*\)/g],
      ['untyped-system-filter', /\b(?:eq|gt|gte|lt|lte)\s*\(\s*["'](?:key|owner|creator|expiresAt)["']/g],
      ['legacy-package', /(?:from\s*|require\s*\(\s*)["'](?:arkiv-sdk|golem-base-sdk)["']|(?:npm\s+(?:i|install)|pnpm\s+add|bun\s+add)\s+(?:arkiv-sdk|golem-base-sdk)\b/g],
      ['legacy-sdk-install', /@arkiv-network\/sdk@(?:\^|~)?0\.[67]\./g]
    ];
    for (const [rule, pattern] of guards) for (const match of code.matchAll(pattern)) add(rule, offset + match.index);
    for (const create of code.matchAll(/\.createEntity\s*\(\s*\{([\s\S]*?)\}\s*(?:,|\))/g)) {
      const match = /\bcreationFlags\s*:/.exec(create[1]);
      if (match) add('creation-flags-input', offset + create.index + create[0].indexOf(create[1]) + match.index);
    }
    for (const attrs of code.matchAll(/\b(?:attributes|set)\s*:\s*\[([\s\S]*?)\]/g)) for (const match of attrs[1].matchAll(/\bkey\s*:\s*["']([a-zA-Z\d_$.-]+)["']/g)) {
      if (!/^[a-z][a-z\d_]*$/.test(match[1])) add('attribute-name', offset + attrs.index + attrs[0].indexOf(attrs[1]) + match.index);
    }
    if (/^bash|^sh/.test(fence[0].slice(3))) {
      let manager;
      for (const line of code.split('\n')) {
        const label = /^\s*#\s*(npm|pnpm|bun)\s*$/.exec(line);
        if (label) { manager = label[1]; continue; }
        const command = /^\s*(npm|npx|pnpm|bun)\b/.exec(line);
        if (manager && command && (command[1] === 'npx' ? 'npm' : command[1]) !== manager) add('install-label', offset + code.indexOf(line));
      }
    }
  }
  return findings;
}

async function filesUnder(root, relative) {
  let entries;
  try { entries = await readdir(path.join(root, relative), {withFileTypes: true}); }
  catch(error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries) {
    const name = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not supported: ${name}`);
    if (entry.isDirectory()) files.push(...await filesUnder(root, name));
    else if (entry.isFile()) files.push(name);
  }
  return files;
}

export async function checkStatic(root = repositoryRoot) {
  const failures = [];
  const add = (file, rule, message, line = 1) => failures.push({file, line, rule, message});
  let config;
  try { config = validateConfig(JSON.parse(await readFile(path.join(root, 'plugin.config.json'), 'utf8'))); }
  catch(error) { return {passed: false, failures: [{file: 'plugin.config.json', rule: 'config', message: error.message}], skills: 0}; }
  try { await generate(root, true); } catch(error) { add('plugin.config.json', 'generated-freshness', error.message); }
  const allSkillFiles = await filesUnder(root, 'skills');
  const entrypoints = allSkillFiles.filter(file => /^skills\/[^/]+\/SKILL\.md$/.test(file));
  if (!entrypoints.length) add('skills', 'skill-catalog', 'No skill entrypoints found');
  const deprecated = new Set();
  const texts = new Map();
  const publicFiles = [...new Set([
    'README.md','LICENSE','plugin.config.json','plugin.json','mcp.json','.mcp.json',
    ...allSkillFiles,
    ...await filesUnder(root, '.claude-plugin'), ...await filesUnder(root, '.agents/plugins'),
    ...await filesUnder(root, '.cursor-plugin'), ...await filesUnder(root, 'hooks'),
    ...await filesUnder(root, 'cursor/rules'), ...await filesUnder(root, 'source'),
    ...await filesUnder(root, 'templates'), ...await filesUnder(root, 'scripts')
  ])];
  for (const file of publicFiles) {
    try {
      const text = decoder.decode(await readFile(path.join(root, file)));
      if (text.includes('\uFFFD')) add(file, 'utf8', 'Replacement character found');
      texts.set(file, text);
    } catch(error) { add(file, 'readable-utf8', error.message); }
  }
  for (const file of entrypoints) {
    const text = texts.get(file);
    if (!text) continue;
    try {
      const meta = frontmatter(text);
      const name = file.split('/')[1];
      if (meta.name !== name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) add(file, 'skill-name', 'Name must match the kebab-case folder');
      if (!meta.description || meta.description.length > 1024) add(file, 'description', 'Description is required and at most 1024 characters');
      if (meta.license !== config.license || meta.metadata['arkiv-sdk'] !== config.sdkRange || meta.metadata.network !== config.network) add(file, 'skill-metadata', 'License, SDK range and network must match plugin configuration');
      const date = meta.metadata.verified;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) add(file, 'verified-date', 'Expected a valid ISO date');
      if (meta.metadata.deprecated === 'true') {
        deprecated.add(name);
        if (meta.metadata['replaced-by'] !== config.name) add(file, 'deprecation', 'Deprecated entrypoint must point to the router');
      }
      const limit = meta.metadata.deprecated === 'true' ? 20 : name === config.name ? 150 : 250;
      if (text.trim().split(/\r?\n/).length > limit) add(file, 'skill-size', `Entrypoint exceeds ${limit} lines; move detail into references`);
    } catch(error) { add(file, 'frontmatter', error.message); }
  }
  let links = 0;
  for (const [file, text] of texts) {
    const parts = file.split('/');
    if (file.endsWith('.md') || file.endsWith('.mdc')) {
      for (const match of text.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
        const target = match[1].replace(/^<|>$/g, '').split(/\s+["']/)[0];
        if (/^(?:https?:|mailto:|#)/.test(target)) continue;
        const local = target.split('#')[0];
        if (!local) continue;
        const resolved = path.resolve(root, path.dirname(file), decodeURIComponent(local));
        if (resolved !== path.resolve(root) && !resolved.startsWith(path.resolve(root) + path.sep)) { add(file, 'relative-link', 'Local link escapes the repository', lineAt(text, match.index)); continue; }
        try { await stat(resolved); links++; } catch { add(file, 'relative-link', `Missing local target: ${local}`, lineAt(text, match.index)); }
      }
    }
    if (/\.(?:md|mdc)$/.test(file)) for (const finding of contentFindings(text)) add(file, finding.rule, 'Disallowed vocabulary, source or example', finding.line);
    if (parts[0] === 'skills' && parts.length > 3 && (parts[2] !== 'references' || parts.length !== 4 || !file.endsWith('.md'))) add(file, 'reference-depth', 'Supporting Markdown references must be one level deep');
    if (/migration-guide\.md|Braga/.test(file)) add(file, 'retired-file', 'Retired migration file found');
    if (parts[0] === 'skills' && !deprecated.has(parts[1]) && /arkiv-best-practices/.test(text)) add(file, 'incoming-deprecated-link', 'Active skills must not reference the deprecated entrypoint');
  }
  const readme = texts.get('README.md') ?? '';
  const index = readme.split('## Available skills')[1]?.split('## Installation')[0] ?? '';
  const targets = [...index.matchAll(/\]\((skills\/[^)]+\/SKILL\.md)\)/g)].map(match => match[1]);
  if (targets.length !== entrypoints.length || new Set(targets).size !== entrypoints.length || entrypoints.some(file => !targets.includes(file))) add('README.md', 'readme-index', 'Index must contain every entrypoint exactly once');
  if (!texts.get('LICENSE')?.includes('Permission is hereby granted, free of charge')) add('LICENSE', 'license', 'Expected the MIT license text');
  return {passed: failures.length === 0, skills: entrypoints.length, activeSkills: entrypoints.length - deprecated.size, relativeLinks: links, filesChecked: publicFiles.length, failures};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length > 2) throw new Error('Usage: node scripts/check-static.mjs');
    const result = await checkStatic();
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  } catch(error) { console.error(error.message); process.exitCode = 1; }
}
