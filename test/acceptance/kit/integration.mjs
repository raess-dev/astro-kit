/**
 * A small stand-in for the kit integration. The spikes of `test/acceptance/spikes.test.ts` use it to prove platform
 * facts without the kit (specification, 13.2). It follows section 6.1 of the specification: the locked config, the
 * global CSS through `injectScript('page-ssr')`, the CSP, and the two inserts in `astro:build:done`.
 * It is test code. It is not the kit, and no site imports it.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = (name) => fileURLToPath(new URL(name, import.meta.url));

export const sha256 = (text) => `sha256-${createHash('sha256').update(text).digest('base64')}`;

/** The speculation rules of 6.2, compact, with the key order of the specification. */
export const SPECULATION_JSON = readFileSync(here('./speculation.json'), 'utf8').trim();
export const SPECULATION_HASH = sha256(SPECULATION_JSON);

const MODE_ORDER = ['auto', 'light', 'dark', 'contrast'];

/** The enabled options in the order of 7.12, and the default mode `D`. */
export function modes(setting = { auto: true }) {
  const enabled = MODE_ORDER.filter((option) => setting[option] === true);
  return { enabled, D: setting.auto === true ? 'auto' : setting.default };
}

/** The mode script of 9.3: the lines of the specification, joined with `\n`, with no final newline. */
export function modeScript(setting) {
  const { enabled, D } = modes(setting);
  return readFileSync(here('./mode-script.txt'), 'utf8')
    .trimEnd()
    .replace(/\$\{MODES\}/, JSON.stringify(enabled))
    .replace(/\$\{DEFAULT\}/, JSON.stringify(D));
}

const host = (origin) => `https://${origin.host}`;
const hosts = (origins, directive) =>
  origins
    .filter((origin) => origin.directives.includes(directive))
    .map(host)
    .sort();

/** The meta CSP of 6.2 for the settings, declared origins included (9.4). */
export function cspConfig(options, scriptHashes) {
  const origins = options.origins ?? [];
  const frames = hosts(origins, 'frame');
  const scripts = ["'self'", ...(options.wasm ? ["'wasm-unsafe-eval'"] : []), ...hosts(origins, 'script')];
  return {
    algorithm: 'SHA-256',
    directives: [
      "default-src 'self'",
      "img-src 'self'",
      "font-src 'self'",
      ["connect-src 'self'", ...hosts(origins, 'connect')].join(' '),
      "media-src 'self'",
      "manifest-src 'self'",
      options.workers ? "worker-src 'self'" : "worker-src 'none'",
      frames.length > 0 ? `frame-src ${frames.join(' ')}` : "frame-src 'none'",
      ["form-action 'self'", ...hosts(origins, 'form')].join(' '),
      "base-uri 'self'",
      "object-src 'none'",
    ],
    scriptDirective: { resources: scripts, hashes: scriptHashes },
    styleDirective: { resources: ["'self'"] },
  };
}

/** The header CSP of 6.2. Trusted Types is on unless scripts, islands or a `script` origin is on. */
export function headerCsp(options) {
  const origins = options.origins ?? [];
  const policy = [
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    ["form-action 'self'", ...hosts(origins, 'form')].join(' '),
  ];
  const trusted = !options.scripts && !options.islands && hosts(origins, 'script').length === 0;
  if (trusted) policy.push("require-trusted-types-for 'script'", "trusted-types 'none'");
  return policy.join('; ');
}

function htmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(path));
    else if (entry.name.endsWith('.html')) out.push(path);
  }
  return out;
}

const CSP_META = /<meta\b[^>]*http-equiv="?content-security-policy"?[^>]*>/i;

/**
 * Options: `site`, `locales` (codes), `defaultLocale`, `modes`, `speculation` (default true), `css` (the global
 * files to inject, default the four of 6.1 step 9), `csp` (default true), `origins`, `scripts`, `islands`, `wasm`,
 * `workers`, `adapter` and `integrations` (added from `updateConfig`, as 6.1 steps 6 and 7 do), `config` (merged
 * last, for a spike that needs one more locked value).
 */
export default function kit(options = {}) {
  const site = options.site ?? 'https://example.ch';
  const locales = options.locales ?? ['de'];
  const { enabled } = modes(options.modes);
  const withMode = enabled.length >= 2;
  const withSpeculation = options.speculation !== false;
  let root = '';
  return {
    name: 'spike-kit',
    hooks: {
      'astro:config:setup': ({ config, updateConfig, injectScript }) => {
        root = fileURLToPath(config.root);
        const scriptHashes = [
          ...(options.scriptHashes ?? []),
          ...(withSpeculation ? [SPECULATION_HASH] : []),
          ...(withMode ? [sha256(modeScript(options.modes))] : []),
        ];
        const css =
          options.css ??
          [here('./base.css'), 'src/styles/fonts.css', 'src/styles/tokens.css', 'src/styles/elements.css'].map(
            (file) => (file.startsWith('/') ? file : join(root, file)),
          );
        if (css.length > 0) {
          injectScript('page-ssr', css.map((file) => `import ${JSON.stringify(file)};`).join('\n'));
        }
        updateConfig({
          site,
          output: 'static',
          trailingSlash: 'always',
          prerenderConflictBehavior: 'error',
          compressHTML: true,
          build: { format: 'directory', inlineStylesheets: 'always' },
          i18n: {
            defaultLocale: options.defaultLocale ?? locales[0],
            locales,
            routing: { prefixDefaultLocale: false, redirectToDefaultLocale: false, fallbackType: 'redirect' },
          },
          image: {
            layout: 'constrained',
            responsiveStyles: true,
            breakpoints: [640, 960, 1280, 1920],
            domains: [],
            remotePatterns: [],
          },
          security:
            options.csp === false
              ? { checkOrigin: true }
              : { checkOrigin: true, csp: cspConfig(options, scriptHashes) },
          prefetch: false,
          // Without it, `@astrojs/cloudflare` enables Astro sessions and adds the KV binding `SESSION` (S14).
          session: false,
          markdown: { syntaxHighlight: false },
          vite: { build: { cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5'] } },
          ...(options.adapter ? { adapter: options.adapter } : {}),
          ...(options.integrations || options.adapter
            ? { integrations: [...(options.integrations ?? []), ...(options.adapter ? [options.adapter] : [])] }
            : {}),
          ...(options.config ?? {}),
        });
      },
      'astro:routes:resolved': ({ routes }) => {
        if (options.onRoutes) options.onRoutes(routes, root);
      },
      'astro:build:done': ({ dir, assets }) => {
        const out = fileURLToPath(dir);
        if (options.onDone) options.onDone({ dir: out, assets, root });
        const inserts =
          (withMode ? `<script>${modeScript(options.modes)}</script>` : '') +
          (withSpeculation ? `<script type="speculationrules">${SPECULATION_JSON}</script>` : '');
        if (inserts === '' || options.csp === false) return;
        for (const file of htmlFiles(out)) {
          const html = readFileSync(file, 'utf8');
          const meta = CSP_META.exec(html);
          if (!meta) throw new Error(`spike-kit: ${file} has no CSP meta`);
          const at = meta.index + meta[0].length;
          writeFileSync(file, html.slice(0, at) + inserts + html.slice(at));
        }
      },
    },
  };
}
