import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {checkSkillReferences} from '../../scripts/check-skill-references.mjs';

async function check(files) {
  const directory = await mkdtemp(path.join(tmpdir(), 'arkiv-reference-test-'));
  try {
    for (const [file, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(directory, file)), {recursive: true});
      await writeFile(path.join(directory, file), text);
    }
    return await checkSkillReferences(directory);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('arkiv-reference-test-'));
    await rm(directory, {recursive: true, force: true});
  }
}

test('direct and transitive nested references are reachable', async () => {
  const result = await check({'skills/one/SKILL.md': '[Start](references/first.md)',
    'skills/one/references/first.md': '[Next](nested/second.md#details)',
    'skills/one/references/nested/second.md': '# Details'});
  assert.equal(result.passed, true); assert.equal(result.reachableReferences, 2);
});

test('disconnected references and a disconnected cycle remain orphans', async () => {
  const result = await check({'skills/one/SKILL.md': '# One',
    'skills/one/references/lone.md': '# Lone',
    'skills/one/references/a.md': '[B](b.md)', 'skills/one/references/b.md': '[A](a.md)'});
  assert.equal(result.passed, false);
  assert.deepEqual(result.failures.map(item => item.file), [
    'skills/one/references/a.md', 'skills/one/references/b.md', 'skills/one/references/lone.md']);
  assert.ok(result.failures.every(item => item.rule === 'orphan-reference'));
});

test('a connected cycle terminates and preserves all reachable references', async () => {
  const result = await check({'skills/one/SKILL.md': '[A](references/a.md)',
    'skills/one/references/a.md': '[B](b.md)', 'skills/one/references/b.md': '[A](a.md)'});
  assert.equal(result.passed, true); assert.equal(result.reachableReferences, 2);
});

test('cross-skill links can reach another skill reference', async () => {
  const result = await check({'skills/one/SKILL.md': '[Shared](../two/references/shared.md)',
    'skills/two/SKILL.md': '# Two', 'skills/two/references/shared.md': '# Shared'});
  assert.equal(result.passed, true); assert.equal(result.skills, 2);
});

test('non-reference Markdown and non-Markdown resources are not orphan findings', async () => {
  const result = await check({'skills/one/SKILL.md': '# One', 'skills/one/notes.md': '# Notes',
    'skills/one/references/diagram.svg': '<svg/>', 'skills/one/scripts/runner.js': '// Test'});
  assert.equal(result.passed, true); assert.equal(result.references, 0);
});

test('fenced and inline example links do not make an orphan reachable', async () => {
  const result = await check({'skills/one/SKILL.md': [
    '````markdown', '[First](references/first.md)', '```', '````',
    '~~~text', '[Second](references/second.md)', '~~~',
    '`[Third](references/third.md)`'].join('\n'),
    'skills/one/references/first.md': '# First', 'skills/one/references/second.md': '# Second',
    'skills/one/references/third.md': '# Third'});
  assert.equal(result.passed, false); assert.equal(result.failures.length, 3);
  assert.ok(result.failures.every(item => item.rule === 'orphan-reference'));
});

test('reference-style links resolve labels but unused definitions do not imply reachability', async () => {
  const result = await check({'skills/one/SKILL.md': [
    '[Read][First Reference]', '[Second][]', '[Third]',
    '[first reference]: references/first.md "First"', '[second]: <references/second.md>',
    '[third]: references/third.md', '[unused]: references/unused.md'].join('\n'),
    'skills/one/references/first.md': '# First', 'skills/one/references/second.md': '# Second',
    'skills/one/references/third.md': '# Third', 'skills/one/references/unused.md': '# Unused'});
  assert.equal(result.reachableReferences, 3);
  assert.deepEqual(result.failures.map(item => item.file), ['skills/one/references/unused.md']);
});

test('encoded targets and anchors resolve while external links are ignored', async () => {
  const result = await check({'skills/one/SKILL.md': [
    '[Space](<references/a%20b.md#details>)', '[External](https://example.invalid/missing.md)',
    '[Mail](mailto:person@example.invalid)', '[CDN](//example.invalid/a.md)', '[Local](#one)'].join('\n'),
    'skills/one/references/a b.md': '# Details'});
  assert.equal(result.passed, true); assert.equal(result.reachableReferences, 1);
});

test('missing skill Markdown targets fail instead of hiding stale links', async () => {
  const result = await check({'skills/one/SKILL.md': '[Missing](references/missing.md)'});
  assert.equal(result.passed, false); assert.equal(result.failures[0].rule, 'relative-link');
  assert.equal(result.failures[0].message, 'Missing skill Markdown target');
});

test('repository escapes and invalid URL encoding fail with a concrete diagnostic', async () => {
  const result = await check({'skills/one/SKILL.md': '[Escape](../../../outside.md)\n[Malformed](references/%zz.md)'});
  assert.equal(result.passed, false);
  assert.deepEqual(result.failures.map(item => item.message), ['Local target escapes the repository', 'Invalid URL encoding']);
});
