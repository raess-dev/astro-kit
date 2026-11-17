import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../../src/csp.ts';
import { ISLANDS_MISSING, SOLID_SERVER, solidHydrationHash } from '../../src/islands.ts';
import { type Files, inTempAsync, json, resolvedFrom } from './fixtures.ts';
import { SPEC } from './spec.ts';

const KIT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** 13.1, item 11: the versions of `solid-js` that the specification names, and the hash of their script. */
const ITEM_11 = /With solid-js ([\d.]+) and ([\d.]+) its hash is `(sha256-[^`]+)`/.exec(SPEC);

/** A stand-in for an installed `solid-js`: only the file that 6.2 reads, with the given module text. */
const fakeSolid = (server: string): Files => ({
  'package.json': json({ name: 'site', private: true }),
  'node_modules/solid-js/package.json': json({ name: 'solid-js', version: '0.0.0', type: 'module' }),
  [`node_modules/${SOLID_SERVER}`]: server,
});

/** What `solidHydrationHash` gives for a project: the hash, or the message of what it threw. */
async function outcomeOf(root: string): Promise<string> {
  try {
    return await solidHydrationHash(root);
  } catch (error) {
    return error instanceof Error ? `threw: ${error.message}` : 'threw no error';
  }
}

test('the hash of the installed solid-js is the value of 13.1, item 11', async () => {
  const installed: unknown = JSON.parse(readFileSync(join(KIT_ROOT, 'node_modules/solid-js/package.json'), 'utf8'));
  const version =
    typeof installed === 'object' && installed !== null && 'version' in installed ? installed.version : '';
  assert.ok([ITEM_11?.[1], ITEM_11?.[2]].includes(String(version)), `item 11 names the installed solid-js ${version}`);

  // 14.1, Feature packages: the project resolves `solid-js` through a link to the kit's own copy.
  const hash = await inTempAsync({ 'package.json': json({ name: 'site', private: true }) }, (root) => {
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(join(KIT_ROOT, 'node_modules/solid-js'), join(root, 'node_modules/solid-js'), 'dir');
    return outcomeOf(root);
  });
  assert.equal(hash, ITEM_11?.[3]);
});

test('the hash is that of the text of the first script, without the tags and without what follows', async () => {
  const output = '<script>window.fake||(window.fake=1);</script><!--xs--><script>second</script>';
  const server = `export function generateHydrationScript() { return ${JSON.stringify(output)}; }\n`;
  assert.equal(await inTempAsync(fakeSolid(server), outcomeOf), sha256('window.fake||(window.fake=1);'));

  const attributes = '<script nonce="n">a<b</script><!--xs-->';
  const withAttributes = `export function generateHydrationScript() { return ${JSON.stringify(attributes)}; }\n`;
  assert.equal(await inTempAsync(fakeSolid(withAttributes), outcomeOf), sha256('a<b'));
});

test('a project without solid-js throws the message of 6.2', async () => {
  const start = SPEC.indexOf('  - A missing package throws ');
  assert.equal(/`([^`]+)`/.exec(SPEC.slice(start))?.[1], ISLANDS_MISSING, 'the message is the text of 6.2');
  // Node looks for solid-js in every folder above the temp folder too. `above` names one that holds it.
  const seen = await inTempAsync({ 'package.json': json({ name: 'site', private: true }) }, async (root) => ({
    above: resolvedFrom(root, SOLID_SERVER),
    outcome: await outcomeOf(root),
  }));
  assert.deepEqual(seen, { above: undefined, outcome: `threw: ${ISLANDS_MISSING}` });
});

test('a solid-js that gives no hydration script throws a message that says so', async () => {
  const noScript =
    'threw: astro-kit: generateHydrationScript() of solid-js returned no <script>; the CSP hash cannot be computed.';
  const cases: [name: string, server: string, outcome: string][] = [
    ['no <script> in the output', "export function generateHydrationScript() { return '<!--xs-->'; }\n", noScript],
    [
      'a <script> that is not first',
      "export function generateHydrationScript() { return '<!--xs--><script>x</script>'; }\n",
      noScript,
    ],
    ['the output is no text', 'export function generateHydrationScript() { return 1; }\n', noScript],
    [
      'no function generateHydrationScript',
      'export const generateHydrationScript = 1;\n',
      'threw: astro-kit: solid-js/web/dist/server.js exports no generateHydrationScript(); the CSP hash cannot be computed.',
    ],
  ];
  for (const [name, server, outcome] of cases)
    assert.equal(await inTempAsync(fakeSolid(server), outcomeOf), outcome, name);
});
