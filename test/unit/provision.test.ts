import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { offValue, runProvision, ZONE_REWRITERS } from '../../src/provision.ts';

function project(site = 'https://example.ch'): string {
  const root = mkdtempSync(join(tmpdir(), 'kit-provision-'));
  const options = {
    site,
    locales: [{ code: 'de', tag: 'de-CH', name: 'Deutsch' }],
    defaultLocale: 'de',
    securityContact: 'mailto:security@example.ch',
  };
  writeFileSync(join(root, 'astro-kit.json'), JSON.stringify(options));
  return root;
}

const GOOD: Record<string, unknown> = {
  min_tls_version: '1.2',
  tls_1_3: 'zrt',
  always_use_https: 'on',
  http3: 'on',
  rocket_loader: 'off',
  email_obfuscation: 'off',
  speed_brain: 'off',
  nel: { enabled: false },
  rum: 'off',
  pre_render: 'off',
  webmcp_enabled: false,
  content_converter: 'off',
};

interface Zone {
  settings: Record<string, unknown>;
  bots: Record<string, unknown>;
  /** Settings whose PATCH the API refuses. */
  locked?: string[];
}

/** A fake Cloudflare API over one zone; it records every call. */
function fakeApi(zone: Zone, calls: string[]): typeof fetch {
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    calls.push(`${method} ${url.pathname}${url.search}`);
    assert.equal((init.headers as Record<string, string>).authorization, 'Bearer token');
    const path = url.pathname.replace('/client/v4', '');
    if (path === '/zones')
      return json({
        success: true,
        result: url.searchParams.get('name') === 'example.ch' ? [{ id: 'z1', name: 'example.ch' }] : [],
      });
    if (path === '/zones/z1/bot_management') return json({ success: true, result: zone.bots });
    const id = /^\/zones\/z1\/settings\/(\w+)$/.exec(path)?.[1];
    if (!id || !(id in zone.settings))
      return json({ success: false, errors: [{ code: 1003, message: 'Invalid setting' }] }, 404);
    if (method === 'PATCH') {
      if (zone.locked?.includes(id))
        return json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, 403);
      zone.settings[id] = (JSON.parse(String(init.body)) as { value: unknown }).value;
    }
    return json({ success: true, result: { id, value: zone.settings[id] } });
  }) as typeof fetch;
}

const run = (args: string[], zone: Zone, calls: string[], root = project()) =>
  runProvision(args, {
    fetch: fakeApi(zone, calls),
    env: { CLOUDFLARE_API_TOKEN: 'token' },
    root,
    log: () => undefined,
  });

const drifted = (): Zone => ({
  settings: {
    ...GOOD,
    min_tls_version: '1.0',
    http3: 'off',
    rocket_loader: 'on',
    nel: { enabled: true },
    pre_render: 'on',
    webmcp_enabled: true,
  },
  bots: { ai_bots_protection: 'block', is_robots_txt_managed: true },
});

test('a zone that matches the kit passes --check, with read calls only', async () => {
  const calls: string[] = [];
  const report = await run(
    ['zone', '--check'],
    { settings: { ...GOOD }, bots: { ai_bots_protection: 'disabled', is_robots_txt_managed: false } },
    calls,
  );
  assert.deepEqual(report.findings, []);
  assert.ok(calls.every((c) => c.startsWith('GET ')));
  assert.ok(calls.includes('GET /client/v4/zones?name=example.ch'));
});

test('--check reports each drifted setting and patches nothing', async () => {
  const calls: string[] = [];
  const zone = drifted();
  const report = await run(['zone', '--check'], zone, calls);
  const by = (rule: string) => report.findings.filter((f) => f.rule === rule).map((f) => f.where);
  assert.deepEqual(by('zone-settings'), [
    'example.ch: min_tls_version',
    'example.ch: http3',
    'example.ch: rocket_loader',
    'example.ch: nel',
  ]);
  assert.deepEqual(by('zone-rewriters'), ['example.ch: pre_render', 'example.ch: webmcp_enabled']);
  assert.deepEqual(by('zone-bots'), ['example.ch: ai_bots_protection', 'example.ch: is_robots_txt_managed']);
  assert.ok(calls.every((c) => c.startsWith('GET ')));
  assert.equal(zone.settings.http3, 'off');
});

test('--apply patches only what differs, keeps value shapes, and reports what the API refuses', async () => {
  const calls: string[] = [];
  const zone = { ...drifted(), locked: ['webmcp_enabled'] };
  const report = await run(['zone', '--apply'], zone, calls);
  const patches = calls.filter((c) => c.startsWith('PATCH ')).map((c) => c.split('/').pop());
  assert.deepEqual(patches, ['min_tls_version', 'http3', 'rocket_loader', 'nel', 'pre_render', 'webmcp_enabled']);
  assert.ok(!calls.some((c) => c.startsWith('DELETE ')));
  assert.deepEqual(zone.settings.min_tls_version, '1.2');
  assert.deepEqual(zone.settings.nel, { enabled: false });
  assert.equal(zone.settings.pre_render, 'off');
  assert.equal(zone.settings.webmcp_enabled, true);
  // The refused rewriter and the read-only bot settings remain.
  assert.deepEqual(
    report.findings.map((f) => `${f.rule} ${f.where}`),
    [
      'zone-rewriters example.ch: webmcp_enabled',
      'zone-bots example.ch: ai_bots_protection',
      'zone-bots example.ch: is_robots_txt_managed',
    ],
  );
});

test('the zone is found from a www site through its parent domain', async () => {
  const calls: string[] = [];
  const report = await run(
    ['zone', '--check'],
    { settings: { ...GOOD }, bots: {} },
    calls,
    project('https://www.example.ch'),
  );
  assert.deepEqual(report.findings, []);
  assert.deepEqual(calls.slice(0, 2), [
    'GET /client/v4/zones?name=www.example.ch',
    'GET /client/v4/zones?name=example.ch',
  ]);
});

test('an unknown zone and an unreadable setting are findings', async () => {
  const none = await run(['zone', '--check'], { settings: { ...GOOD }, bots: {} }, [], project('https://other.ch'));
  assert.deepEqual([...none.ids()], ['zone-settings']);
  const settings: Record<string, unknown> = { ...GOOD };
  delete settings.http3;
  const unreadable = await run(['zone', '--check'], { settings, bots: {} }, []);
  assert.deepEqual(
    unreadable.findings.map((f) => f.where),
    ['example.ch: http3'],
  );
});

test('bad usage and a missing token throw before any request', async () => {
  await assert.rejects(runProvision(['zone'], { env: { CLOUDFLARE_API_TOKEN: 't' } }), /usage/);
  await assert.rejects(runProvision(['zone', '--check', '--apply'], { env: { CLOUDFLARE_API_TOKEN: 't' } }), /usage/);
  await assert.rejects(runProvision(['zone', '--check'], { env: {} }), /CLOUDFLARE_API_TOKEN/);
});

test('off values keep the shape of the current value', () => {
  assert.equal(offValue('on'), 'off');
  assert.equal(offValue(true), false);
  assert.deepEqual(offValue({ enabled: true, mode: 'x' }), { enabled: false, mode: 'x' });
  assert.deepEqual(ZONE_REWRITERS, ['pre_render', 'webmcp_enabled', 'content_converter', 'search_for_agents']);
});
