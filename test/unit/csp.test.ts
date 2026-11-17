import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type CspConfig,
  cspConfig,
  FORBIDDEN_SOURCES,
  headerCsp,
  headerDirectives,
  isForbiddenSource,
  metaDirectives,
  originSources,
  prefetchGateScript,
  type Sha256,
  SPECULATION_HASH,
  SPECULATION_JSON,
  SPECULATION_RULES,
  scriptResources,
  sha256,
  trustedTypes,
} from '../../src/csp.ts';
import type { Options } from '../../src/options.ts';
import { EXAMPLE, optionsOf, origin } from './fixtures.ts';
import { specBlock, variable } from './spec.ts';

// The settings of a case

type Features = Partial<Options['features']>;

/** The example of 5.1 with some features and its own origins. */
const settings = (features: Features = {}, origins: readonly unknown[] = []): Options =>
  optionsOf({ ...EXAMPLE, features: { ...EXAMPLE.features, ...features }, origins });

// Hashes and the speculation rules

test('sha256 is sha256- and the base64 of the SHA-256 of the UTF-8 text', () => {
  assert.equal(sha256(''), 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
  assert.equal(sha256('abc'), 'sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
  assert.equal(sha256('ä'), 'sha256-M+bXP+6CkEyNevt43hFU0ejcKg7bCBIOY99bk4XC2cw=');
});

test('the speculation JSON is the compact text of 6.2, and its hash is the one of 6.2', () => {
  assert.equal(SPECULATION_JSON, specBlock('- **Speculation JSON**', 'json'));
  assert.equal(SPECULATION_JSON, JSON.stringify(SPECULATION_RULES));
  assert.equal(SPECULATION_HASH, 'sha256-4255RGsO6JUC8vuukcO69AaAmBKnnolynaWf9b0Q6og=');
  assert.equal(SPECULATION_HASH, sha256(SPECULATION_JSON));
});

// The meta policy

/** The eleven directives of 6.2 with no origin, no wasm and no workers. */
const PLAIN_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "manifest-src 'self'",
  "worker-src 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
];

/** The plain directives with some of them replaced, by the name of the directive. */
const directivesWith = (changed: Readonly<Record<string, string>>): string[] =>
  PLAIN_DIRECTIVES.map((directive) => {
    const name = directive.slice(0, directive.indexOf(' '));
    return Object.hasOwn(changed, name) ? `${name} ${changed[name]}` : directive;
  });

const HASHES: readonly Sha256[] = ['sha256-AAAA', SPECULATION_HASH, 'sha256-BBBB'];

test('cspConfig gives the meta policy of 6.2 for a site with no origin', () => {
  const expected: CspConfig = {
    algorithm: 'SHA-256',
    directives: [
      "default-src 'self'",
      "img-src 'self'",
      "font-src 'self'",
      "connect-src 'self'",
      "media-src 'self'",
      "manifest-src 'self'",
      "worker-src 'none'",
      "frame-src 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ],
    scriptDirective: { resources: ["'self'"], hashes: ['sha256-AAAA', SPECULATION_HASH, 'sha256-BBBB'] },
    styleDirective: { resources: ["'self'"] },
  };
  assert.deepEqual(cspConfig(settings(), HASHES), expected);
});

test('cspConfig copies the script hashes in their order, and with none the list is empty', () => {
  const config = cspConfig(settings(), HASHES);
  assert.notEqual(config.scriptDirective.hashes, HASHES);
  assert.deepEqual(config.scriptDirective.hashes, HASHES);
  assert.deepEqual(cspConfig(settings(), []).scriptDirective.hashes, []);
});

test('wasm adds wasm-unsafe-eval after self, and workers sets worker-src self (9.5)', () => {
  const plain = settings({ scripts: true });
  const wasm = settings({ scripts: true, wasm: true });
  const workers = settings({ scripts: true, workers: true });
  const both = settings({ scripts: true, wasm: true, workers: true }, [origin('js.pay.example', ['script'])]);
  assert.deepEqual(
    [plain, wasm, workers, both].map((options) => [scriptResources(options), metaDirectives(options)]),
    [
      [["'self'"], directivesWith({})],
      [["'self'", "'wasm-unsafe-eval'"], directivesWith({})],
      [["'self'"], directivesWith({ 'worker-src': "'self'" })],
      [["'self'", "'wasm-unsafe-eval'", 'https://js.pay.example'], directivesWith({ 'worker-src': "'self'" })],
    ],
  );
});

// The five origin cases of 9.4

/** The header policy of 6.2 without Trusted Types, as every case of 9.4 has it. */
const HEADER_PLAIN = "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'";

/** One case of 9.4: the origins, the changed meta directives, the script resources and the header policy. */
interface OriginCase {
  name: string;
  origins: unknown[];
  changed: Record<string, string>;
  scripts: string[];
  header: string;
}

/** Each case is the example of 5.1 with `features.scripts` true and its own origins. */
const ORIGIN_CASES: readonly OriginCase[] = [
  { name: '1: none', origins: [], changed: {}, scripts: ["'self'"], header: HEADER_PLAIN },
  {
    name: '2: a frame, on a gesture',
    origins: [origin('maps.example.org', ['frame'], { load: 'gesture' })],
    changed: { 'frame-src': 'https://maps.example.org' },
    scripts: ["'self'"],
    header: HEADER_PLAIN,
  },
  {
    name: '3: a script and a frame with payment, and a connect host',
    origins: [
      origin('js.pay.example', ['script', 'frame'], { load: 'gesture', allow: ['payment'] }),
      origin('api.pay.example', ['connect']),
    ],
    changed: { 'frame-src': 'https://js.pay.example', 'connect-src': "'self' https://api.pay.example" },
    scripts: ["'self'", 'https://js.pay.example'],
    header: HEADER_PLAIN,
  },
  {
    name: '4: a connect host, on page load',
    origins: [origin('stats.example.net', ['connect'], { load: 'page' })],
    changed: { 'connect-src': "'self' https://stats.example.net" },
    scripts: ["'self'"],
    header: HEADER_PLAIN,
  },
  {
    name: '5: a form host',
    origins: [origin('news.example.com', ['form'])],
    changed: { 'form-action': "'self' https://news.example.com" },
    scripts: ["'self'"],
    header: "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self' https://news.example.com",
  },
];

test('the five origin cases of 9.4 give their meta directives, script resources and header policy', () => {
  const seen = ORIGIN_CASES.map(({ name, origins }) => {
    const options = settings({ scripts: true }, origins);
    const config = cspConfig(options, [SPECULATION_HASH]);
    return {
      name,
      directives: config.directives,
      scripts: config.scriptDirective.resources,
      styles: config.styleDirective.resources,
      hashes: config.scriptDirective.hashes,
      header: headerCsp(options),
    };
  });
  const expected = ORIGIN_CASES.map(({ name, changed, scripts, header }) => ({
    name,
    directives: directivesWith(changed),
    scripts,
    styles: ["'self'"],
    hashes: [SPECULATION_HASH],
    header,
  }));
  assert.deepEqual(seen, expected);
});

test('the sources of the origins are sorted by host in every directive', () => {
  const options = settings({ scripts: true }, [
    origin('z.example.org', ['connect', 'frame', 'script', 'form']),
    origin('a.example.org', ['connect', 'frame', 'script', 'form']),
    origin('m.example.org', ['connect']),
  ]);
  const two = 'https://a.example.org https://z.example.org';
  assert.deepEqual(originSources(options, 'connect'), [
    'https://a.example.org',
    'https://m.example.org',
    'https://z.example.org',
  ]);
  assert.deepEqual(
    metaDirectives(options),
    directivesWith({
      'connect-src': "'self' https://a.example.org https://m.example.org https://z.example.org",
      'frame-src': two,
      'form-action': `'self' ${two}`,
    }),
  );
  assert.deepEqual(scriptResources(options), ["'self'", 'https://a.example.org', 'https://z.example.org']);
  assert.equal(
    headerCsp(options),
    `frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self' ${two}`,
  );
});

// The header policy

const TRUSTED = "; require-trusted-types-for 'script'; trusted-types 'none'";

/** The header policy of a site with no origin and no script feature. */
const TRUSTED_PLAIN = `${HEADER_PLAIN}${TRUSTED}`;

const PAGE = { load: 'page' };

test('the header policy has Trusted Types unless scripts, islands or a script origin is on', () => {
  const cases: [name: string, options: Options, trusted: boolean, header: string][] = [
    ['no feature', settings(), true, `${HEADER_PLAIN}${TRUSTED}`],
    ['scripts', settings({ scripts: true }), false, HEADER_PLAIN],
    ['islands', settings({ islands: true }), false, HEADER_PLAIN],
    [
      'a form origin',
      settings({}, [origin('news.example.com', ['form'])]),
      true,
      `${HEADER_PLAIN} https://news.example.com${TRUSTED}`,
    ],
    ['a frame origin on page load', settings({}, [origin('maps.example.org', ['frame'], PAGE)]), true, TRUSTED_PLAIN],
    ['a script origin on page load', settings({}, [origin('js.example.org', ['script'], PAGE)]), false, HEADER_PLAIN],
    [
      'a connect origin on page load',
      settings({}, [origin('api.example.org', ['connect'], PAGE)]),
      true,
      TRUSTED_PLAIN,
    ],
  ];
  assert.deepEqual(
    cases.map(([name, options]) => [name, trustedTypes(options), headerCsp(options)]),
    cases.map(([name, , trusted, header]) => [name, trusted, header]),
  );
});

test('the header policy with no origin is the exact text of 6.2', () => {
  assert.equal(
    headerCsp(settings()),
    "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'; require-trusted-types-for 'script'; trusted-types 'none'",
  );
  assert.deepEqual(headerDirectives(settings({ scripts: true })), [
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
  ]);
});

// Forbidden sources

test('the forbidden sources are those of 6.2', () => {
  assert.deepEqual(FORBIDDEN_SOURCES, [
    "'unsafe-inline'",
    "'unsafe-eval'",
    "'unsafe-hashes'",
    "'strict-dynamic'",
    'data:',
    'blob:',
    'http:',
  ]);
});

test('a source is forbidden when 6.2 lists it, holds a star, or is a host that is no declared origin', () => {
  const options = settings({ scripts: true }, [origin('maps.example.org', ['frame'])]);
  const cases: [string, boolean][] = [
    ["'self'", false],
    ["'none'", false],
    ["'wasm-unsafe-eval'", false],
    ["'sha256-4255RGsO6JUC8vuukcO69AaAmBKnnolynaWf9b0Q6og='", false],
    ['https://maps.example.org', false],
    ["'unsafe-inline'", true],
    ["'UNSAFE-INLINE'", true],
    ["'unsafe-eval'", true],
    ["'unsafe-hashes'", true],
    ["'strict-dynamic'", true],
    ['data:', true],
    ['blob:', true],
    ['http:', true],
    ['*', true],
    ['https://*.example.org', true],
    ['https://other.example.org', true],
    ['http://maps.example.org', true],
    ['maps.example.org', true],
    ['https://maps.example.org/embed', true],
    ['https://maps.example.org:8443', true],
  ];
  assert.deepEqual(
    cases.map(([source]) => [source, isForbiddenSource(source, options)]),
    cases,
  );
  assert.equal(isForbiddenSource('https://maps.example.org', settings()), true, 'the origin is not declared');
});

// The prefetch gate

const GATE_VARIABLE = variable("speculationRules ? 'true' : 'false'");

test('the prefetch gate is the exact source of 6.2, with the setting of the speculation rules', () => {
  const block = specBlock('- **Prefetch gate.**', 'js');
  const on = settings();
  const off: Options = { ...on, prefetch: { speculationRules: false, astroPrefetch: true } };
  assert.equal(block.split(GATE_VARIABLE).length, 2, 'the block of 6.2 holds the variable once');
  assert.equal(prefetchGateScript(on), block.replace(GATE_VARIABLE, 'true'));
  assert.equal(prefetchGateScript(off), block.replace(GATE_VARIABLE, 'false'));
  assert.equal(
    prefetchGateScript(on).startsWith("import { prefetch } from 'astro:prefetch';\nconst sr = true && "),
    true,
  );
  assert.equal(prefetchGateScript(on).endsWith('\n}'), true, 'no final newline');
});
