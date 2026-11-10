/** The integration's hooks and the project checks that run before a build. */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import astroKit from '../../src/index.ts';
import type { KitOptions } from '../../src/options.ts';
import { loadOptions } from '../../src/options.ts';
import { preflight } from '../../src/preflight.ts';
import { checkPublic, checkWrangler } from '../../src/project.ts';
import { loadRedirects } from '../../src/redirects.ts';
import { FindingError, Report } from '../../src/registry.ts';

const GOOD = fileURLToPath(new URL('../fixtures/good/', import.meta.url));

/** A copy of the good fixture's source files in a temp dir. */
function copy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kit-core-'));
  cpSync(GOOD, dir, { recursive: true, filter: (src) => !/[\\/](dist|\.astro|node_modules)$/.test(src) });
  return dir;
}

const ids = (report: Report) => [...report.ids()].sort();

async function thrown(fn: () => unknown): Promise<string[]> {
  try {
    await fn();
  } catch (error) {
    assert.ok(error instanceof FindingError, String(error));
    return [...new Set(error.findings.map((f) => f.rule))].sort();
  }
  assert.fail('expected a FindingError');
}

test('preflight passes on the good fixture', () => {
  const report = new Report();
  assert.ok(preflight(GOOD, report));
  assert.deepEqual(ids(report), []);
});

test('config-options: an invalid astro-kit.json stops before any other check', () => {
  const dir = copy();
  writeFileSync(join(dir, 'astro-kit.json'), '{ "site": "http://example.ch" }\n');
  const report = new Report();
  assert.equal(loadOptions(dir, report), undefined);
  assert.equal(preflight(dir, new Report()), undefined);
  assert.deepEqual(ids(report), ['config-options']);
  rmSync(dir, { recursive: true, force: true });
});

test('config-adapter and config-i18n: config:setup fails a build on a project-set adapter or i18n', async () => {
  const hook = astroKit().hooks['astro:config:setup'];
  assert.ok(hook);
  const params = {
    config: {
      root: pathToFileURL(GOOD),
      adapter: { name: 'some-adapter' },
      i18n: { defaultLocale: 'de' },
      experimental: {},
    },
    command: 'build',
    updateConfig: () => ({}),
    addWatchFile: () => undefined,
    injectScript: () => undefined,
    logger: { warn: () => undefined },
  };
  assert.deepEqual(await thrown(() => hook(params as never)), ['config-adapter', 'config-i18n']);
});

test('config-locked: config:done fails when a locked value changed after the kit set it', async () => {
  const hook = astroKit().hooks['astro:config:done'];
  assert.ok(hook);
  const config = {
    output: 'server',
    trailingSlash: 'always',
    compressHTML: true,
    build: { format: 'file', inlineStylesheets: 'always' },
    image: { layout: 'constrained' },
    security: { csp: {} },
  };
  assert.deepEqual(await thrown(() => hook({ config } as never)), ['config-locked']);
});

test('routes-redirects: a chain, a query string and a missing target are reported', () => {
  const dir = copy();
  writeFileSync(
    join(dir, 'src/content/redirects.json'),
    JSON.stringify([
      { from: '/a/', to: '/b/' },
      { from: '/b/', to: '/' },
      { from: '/c/?x=1', to: '/' },
      { from: '/d/' },
    ]),
  );
  const report = new Report();
  loadRedirects(dir, report);
  assert.deepEqual(ids(report), ['routes-redirects']);
  assert.ok(report.findings.length >= 3, JSON.stringify(report.findings));
  rmSync(dir, { recursive: true, force: true });
});

test('forms-binding: features.forms needs the mail binding and both rate limits', () => {
  const options = { ...loadOptions(GOOD, new Report()), features: { forms: true, islands: false, scripts: false } };
  options.contact = { to: 'info@example.ch', from: 'form@example.ch' };
  const report = new Report();
  checkWrangler(GOOD, options as KitOptions, report);
  const forms = report.findings.filter((f) => f.rule === 'forms-binding').map((f) => f.detail ?? '');
  assert.equal(forms.length, 3, forms.join(' | '));
  assert.ok(forms.some((d) => d.includes('send_email')));
  assert.ok(forms.some((d) => d.includes('FORM_RATE_LIMIT_ALL')));
});

test('media-pdf: a PDF in public/ needs an HTML page', () => {
  const dir = copy();
  writeFileSync(join(dir, 'public/brochure.pdf'), '%PDF-1.7\n');
  const report = new Report();
  checkPublic(dir, report);
  assert.deepEqual(ids(report), ['media-pdf']);
  rmSync(dir, { recursive: true, force: true });
});

test('config-wrangler: wrangler.jsonc stays readable by the deploy step (full-line comments, no trailing commas)', () => {
  const dir = copy();
  const options = loadOptions(dir, new Report()) as KitOptions;
  const wrangler = (edit: (text: string) => string) => {
    const file = join(dir, 'wrangler.jsonc');
    writeFileSync(file, edit(readFileSync(join(GOOD, 'wrangler.jsonc'), 'utf8')));
    const report = new Report();
    checkWrangler(dir, options, report);
    return ids(report);
  };
  assert.deepEqual(
    wrangler((t) => t),
    [],
  );
  assert.deepEqual(
    wrangler((t) => t.replace('"workers_dev": false,', '"workers_dev": false, // off in production')),
    ['config-wrangler'],
  );
  assert.deepEqual(
    wrangler((t) => t.replace(/"preview_urls": true\n/, '"preview_urls": true,\n')),
    ['config-wrangler'],
  );
  rmSync(dir, { recursive: true, force: true });
});
