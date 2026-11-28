/**
 * The forms text of `wrangler.jsonc` (specification, 10.4, "Exact text of a forms site") and the rule
 * `forms-binding` (8), on temp folders written from strings.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkFormsBinding,
  checkWrangler,
  destinations,
  FORM_RATE_LIMITS,
  parseJsonc,
  renderWrangler,
  WRANGLER_FILE,
} from '../../src/hosts/cloudflare.ts';
import type { Options } from '../../src/options.ts';
import { getRule, Report } from '../../src/registry.ts';
import { type Files, inTemp, optionsOf } from './fixtures.ts';
import { HOST, SETTINGS, SITE_FORMS, WITH_PROBE } from './forms-fixtures.ts';
import { specBlock } from './spec.ts';

const BLOCK = specBlock('**Exact text of a forms site.**', 'jsonc');

/** The block of 10.4 with its three variables filled in: each address on a line of its own (10.4). */
const formsText = (worker: string, host: string, addresses: readonly string[]): string =>
  `${BLOCK.replaceAll('<worker>', worker)
    .replaceAll('<the host of site>', host)
    .replace('<destinations>', addresses.map((address) => `"${address}"`).join(',\n        '))}\n`;

/** The test site with its own recipient for the booking form. */
const OWN_TO: Options = optionsOf({
  ...SITE_FORMS,
  contact: { ...SITE_FORMS.contact, probe: `probe@${HOST}` },
  forms: { ...SITE_FORMS.forms, booking: { ...SITE_FORMS.forms.booking, to: `booking@${HOST}` } },
});

test('renderWrangler gives the exact forms text of 10.4', () => {
  assert.equal(BLOCK.split('<worker>').length, 3, 'the block names the worker twice');
  assert.equal(renderWrangler(SETTINGS), formsText('laerchenwald-example', HOST, [`info@${HOST}`]));
  assert.equal(renderWrangler(WITH_PROBE), formsText('laerchenwald-example', HOST, [`info@${HOST}`, `probe@${HOST}`]));
  assert.equal(
    renderWrangler(OWN_TO),
    formsText('laerchenwald-example', HOST, [`booking@${HOST}`, `info@${HOST}`, `probe@${HOST}`]),
    'sorted, each address once',
  );
  const www = optionsOf({ ...SITE_FORMS, site: `https://www.${HOST}` });
  assert.equal(renderWrangler(www), formsText('laerchenwald-example', `www.${HOST}`, [`info@${HOST}`]));
});

test('the destination set: contact.to, each form recipient and contact.probe, sorted, each once', () => {
  assert.deepEqual(destinations(SETTINGS), [`info@${HOST}`]);
  assert.deepEqual(destinations(OWN_TO), [`booking@${HOST}`, `info@${HOST}`, `probe@${HOST}`]);
  const same = optionsOf({ ...SITE_FORMS, contact: { ...SITE_FORMS.contact, probe: `info@${HOST}` } });
  assert.deepEqual(destinations(same), [`info@${HOST}`]);
});

test('the forms text has full-line // comments only and no trailing commas: without them it is JSON', () => {
  const text = renderWrangler(OWN_TO);
  assert.equal(text.split('\n').filter((line) => line.includes('//')).length, 3, 'the three comment lines');
  const parsed = parseJsonc(text);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value, {
    $schema: 'node_modules/wrangler/config-schema.json',
    name: 'laerchenwald-example',
    compatibility_date: '2026-11-01',
    assets: {
      directory: './dist/client',
      not_found_handling: '404-page',
      html_handling: 'auto-trailing-slash',
      run_worker_first: ['/api/forms/*'],
    },
    workers_dev: false,
    preview_urls: false,
    routes: [{ pattern: HOST, custom_domain: true }],
    send_email: [
      { name: 'EMAIL', allowed_destination_addresses: [`booking@${HOST}`, `info@${HOST}`, `probe@${HOST}`] },
    ],
    ratelimits: [
      { name: 'FORM_RATE_LIMIT', namespace_id: '1001', simple: { limit: 3, period: 60 } },
      { name: 'FORM_RATE_LIMIT_ALL', namespace_id: '1002', simple: { limit: 20, period: 60 } },
    ],
    observability: { enabled: true },
    env: { preview: { name: 'laerchenwald-example-preview', routes: [], workers_dev: true, preview_urls: true } },
  });
});

test('an address with a quote or a backslash stays one JSON string', () => {
  // The schema of 5.2 lets `"` and `\` stand in an address; the rendering must not let one change the file.
  const odd = optionsOf({ ...SITE_FORMS, contact: { ...SITE_FORMS.contact, probe: 'a"],"x":["b\\c@example.ch' } });
  const parsed = parseJsonc(renderWrangler(odd));
  assert.ok(parsed.ok);
  assert.deepEqual(
    Object.keys(parsed.value as object),
    Object.keys(
      parseJsonc(renderWrangler(SETTINGS)).ok ? (parseJsonc(renderWrangler(SETTINGS)) as { value: object }).value : {},
    ),
  );
  assert.ok(renderWrangler(odd).includes('"a\\"],\\"x\\":[\\"b\\\\c@example.ch"'));
});

test('parseJsonc drops full-line comments only, and never throws', () => {
  assert.deepEqual(parseJsonc('// a\n{ "a": 1 }\r\n  // b\n'), { ok: true, value: { a: 1 } });
  assert.deepEqual(parseJsonc('{ "a": 1 } // c'), { ok: false });
  assert.deepEqual(parseJsonc('{ "a": 1, }'), { ok: false });
  assert.deepEqual(parseJsonc(''), { ok: false });
  assert.deepEqual(parseJsonc('{ "a": "//b" }'), { ok: true, value: { a: '//b' } });
});

// forms-binding

const RULE = 'forms-binding';
const RENDERED = renderWrangler(WITH_PROBE);

/** One case: the files of the root, the settings, and each finding as `<where>: <detail>`. */
type BindingCase = readonly [name: string, files: Files, options: Options, findings: readonly string[]];

const EMAIL_SET = `wrangler.jsonc: send_email: allowed_destination_addresses of EMAIL must be exactly info@${HOST}, probe@${HOST}`;
const ONE_EMAIL = 'wrangler.jsonc: send_email: needs exactly one binding named EMAIL';
const IP_LIMIT = 'wrangler.jsonc: ratelimits: needs one binding FORM_RATE_LIMIT with simple {limit: 3, period: 60}';
const ALL_LIMIT =
  'wrangler.jsonc: ratelimits: needs one binding FORM_RATE_LIMIT_ALL with simple {limit: 20, period: 60}';

/** The rendered text as JSON with one change. */
const changed = (change: (config: Record<string, unknown>) => void): string => {
  const parsed = parseJsonc(RENDERED);
  if (!parsed.ok) throw new Error('the rendering is not JSON');
  const config = parsed.value as Record<string, unknown>;
  change(config);
  return JSON.stringify(config, null, 2);
};

const BINDING_CASES: readonly BindingCase[] = [
  ['the rendering of the kit', { [WRANGLER_FILE]: RENDERED }, WITH_PROBE, []],
  ['the same bindings in another layout', { [WRANGLER_FILE]: changed(() => undefined) }, WITH_PROBE, []],
  [
    'the addresses in another order, one twice',
    {
      [WRANGLER_FILE]: RENDERED.replace(
        `"info@${HOST}",\n        "probe@${HOST}"`,
        `"probe@${HOST}", "info@${HOST}", "probe@${HOST}"`,
      ),
    },
    WITH_PROBE,
    [],
  ],
  ['no file: left to config-wrangler', {}, WITH_PROBE, []],
  ['a folder: left to config-wrangler', { 'wrangler.jsonc/x': '' }, WITH_PROBE, []],
  [
    'the static text',
    {
      [WRANGLER_FILE]: renderWrangler(
        optionsOf({
          ...SITE_FORMS,
          features: { forms: false },
          contact: undefined,
          forms: undefined,
          processing: ['cdn', 'previews'],
        }),
      ),
    },
    WITH_PROBE,
    [ONE_EMAIL, IP_LIMIT, ALL_LIMIT],
  ],
  [
    'the probe inbox is missing',
    { [WRANGLER_FILE]: RENDERED.replace(`,\n        "probe@${HOST}"`, '') },
    WITH_PROBE,
    [EMAIL_SET],
  ],
  [
    'one more address',
    { [WRANGLER_FILE]: RENDERED.replace(`"probe@${HOST}"`, `"probe@${HOST}", "x@${HOST}"`) },
    WITH_PROBE,
    [EMAIL_SET],
  ],
  [
    'the addresses are not a list',
    {
      [WRANGLER_FILE]: changed((config) => {
        config.send_email = [{ name: 'EMAIL', allowed_destination_addresses: `info@${HOST}` }];
      }),
    },
    WITH_PROBE,
    [EMAIL_SET],
  ],
  [
    'an address that is not a text',
    {
      [WRANGLER_FILE]: changed((config) => {
        config.send_email = [{ name: 'EMAIL', allowed_destination_addresses: [`info@${HOST}`, 7] }];
      }),
    },
    WITH_PROBE,
    [EMAIL_SET],
  ],
  [
    'no list of addresses: EMAIL may send to every verified address',
    {
      [WRANGLER_FILE]: changed((config) => {
        config.send_email = [{ name: 'EMAIL' }];
      }),
    },
    WITH_PROBE,
    [EMAIL_SET],
  ],
  [
    'two EMAIL bindings',
    {
      [WRANGLER_FILE]: changed((config) => {
        config.send_email = [
          { name: 'EMAIL', allowed_destination_addresses: [`info@${HOST}`, `probe@${HOST}`] },
          { name: 'EMAIL', allowed_destination_addresses: [] },
        ];
      }),
    },
    WITH_PROBE,
    [ONE_EMAIL],
  ],
  [
    'the mail binding has another name',
    { [WRANGLER_FILE]: RENDERED.replace('"name": "EMAIL"', '"name": "MAIL"') },
    WITH_PROBE,
    [ONE_EMAIL],
  ],
  [
    'a limit of 30 per IP address',
    { [WRANGLER_FILE]: RENDERED.replace('"limit": 3,', '"limit": 30,') },
    WITH_PROBE,
    [IP_LIMIT],
  ],
  [
    'a period of 10 s for the form',
    { [WRANGLER_FILE]: RENDERED.replace('"limit": 20, "period": 60', '"limit": 20, "period": 10') },
    WITH_PROBE,
    [ALL_LIMIT],
  ],
  [
    'the limit as a text',
    { [WRANGLER_FILE]: RENDERED.replace('"limit": 3,', '"limit": "3",') },
    WITH_PROBE,
    [IP_LIMIT],
  ],
  [
    'no ratelimits',
    {
      [WRANGLER_FILE]: changed((config) => {
        delete config.ratelimits;
      }),
    },
    WITH_PROBE,
    [IP_LIMIT, ALL_LIMIT],
  ],
  [
    'ratelimits is an object',
    {
      [WRANGLER_FILE]: changed((config) => {
        config.ratelimits = { FORM_RATE_LIMIT: { limit: 3, period: 60 } };
      }),
    },
    WITH_PROBE,
    [IP_LIMIT, ALL_LIMIT],
  ],
  [
    'a limit that only a prototype holds',
    {
      [WRANGLER_FILE]: changed((config) => {
        config.ratelimits = [
          { name: 'FORM_RATE_LIMIT', simple: JSON.parse('{"__proto__": {"limit": 3, "period": 60}}') },
          { name: 'FORM_RATE_LIMIT_ALL', simple: { limit: 20, period: 60 } },
        ];
      }),
    },
    WITH_PROBE,
    [IP_LIMIT],
  ],
  [
    'a trailing comma',
    { [WRANGLER_FILE]: RENDERED.replace('"enabled": true }', '"enabled": true, }') },
    WITH_PROBE,
    ['wrangler.jsonc: the file is not JSON with full-line // comments'],
  ],
  ['a JSON value that is not an object', { [WRANGLER_FILE]: '[]\n' }, WITH_PROBE, [ONE_EMAIL, IP_LIMIT, ALL_LIMIT]],
  [
    'a static site: no check',
    { [WRANGLER_FILE]: '{}\n' },
    optionsOf({
      ...SITE_FORMS,
      features: { forms: false },
      contact: undefined,
      forms: undefined,
      processing: ['cdn', 'previews'],
    }),
    [],
  ],
];

test('forms-binding: EMAIL with exactly the destination set, and the two rate limits', () => {
  assert.deepEqual(
    [...FORM_RATE_LIMITS],
    [
      ['FORM_RATE_LIMIT', { limit: 3, period: 60 }],
      ['FORM_RATE_LIMIT_ALL', { limit: 20, period: 60 }],
    ],
  );
  const seen = BINDING_CASES.map(([name, files, options]) => {
    const report = new Report();
    inTemp(files, (root) => checkFormsBinding(root, options, report));
    return {
      name,
      findings: report.findings.map((finding) => `${finding.where}: ${finding.detail}`),
      ids: [...report.ids()],
    };
  });
  assert.deepEqual(
    seen,
    BINDING_CASES.map(([name, , , findings]) => ({ name, findings, ids: findings.length === 0 ? [] : [RULE] })),
  );
});

test('forms-binding is a config rule of the forms group, and not waivable', () => {
  const rule = getRule(RULE);
  assert.deepEqual([rule.group, rule.stage, rule.level, rule.waivable], ['forms', 'config', 'error', false]);
});

test('config-wrangler compares a forms site with the forms text', () => {
  const findings = (text: string): string[] => {
    const report = new Report();
    inTemp({ [WRANGLER_FILE]: text }, (root) => checkWrangler(root, WITH_PROBE, report));
    return report.findings.map((finding) => `${finding.where}: ${finding.detail}`);
  };
  assert.deepEqual(findings(RENDERED), []);
  assert.deepEqual(findings(RENDERED.replace(`,\n        "probe@${HOST}"`, '')), [
    `wrangler.jsonc:25: the kit renders \`        "info@${HOST}",\` here`,
  ]);
  assert.deepEqual(findings(RENDERED.replace('    // Bindings are not inherited: a preview never sends mail.\n', '')), [
    'wrangler.jsonc:36: the kit renders `    // Bindings are not inherited: a preview never sends mail.` here',
  ]);
});
