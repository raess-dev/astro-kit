/**
 * A minimal Astro project for a spike (specification, 13.2). The suite writes it from strings into an empty case
 * folder. It uses the stand-in integration of `test/kit/`, never the kit.
 */
import { caseDir, type Files } from '../harness.ts';

/** A 1×1 PNG, for a spike that needs an image in `src/assets/`. */
export const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

/** The `Permissions-Policy` of the `/*` rule of 6.3, for a site whose origins name no `allow` (9.4). */
export const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=(self)',
  'bluetooth=()',
  'browsing-topics=()',
  'camera=()',
  'display-capture=()',
  'fullscreen=(self)',
  'geolocation=()',
  'gyroscope=()',
  'hid=()',
  'idle-detection=()',
  'local-fonts=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'publickey-credentials-get=()',
  'screen-wake-lock=()',
  'serial=()',
  'usb=()',
  'xr-spatial-tracking=()',
].join(', ');

/** The smallest global CSS files that 6.1 step 9 injects. A spike replaces the ones it tests. */
export const STYLES: Files = {
  'src/styles/fonts.css': '',
  'src/styles/tokens.css': '@layer tokens {\n  :root {\n    --color-text: #222222;\n    --space-2: 0.5rem;\n  }\n}\n',
  'src/styles/elements.css': '@layer elements {\n  body {\n    color: var(--color-text);\n  }\n}\n',
};

/** A page with a head that the CSP meta can follow. `body` is Astro markup. */
export const page = (title: string, body: string, frontmatter = ''): string =>
  `---\n${frontmatter}\n---\n<html lang="de"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>\n`;

/**
 * Writes the case folder `<base>/cases/<name>/` with an `astro.config.mjs` that uses the stand-in integration.
 * `options` is JavaScript source for the options object of `kit()`, so that it can hold expressions.
 */
export function project(name: string, files: Files, options = '{}', imports = ''): string {
  return caseDir(name, {
    'astro.config.mjs': `import { defineConfig } from 'astro/config';\nimport kit from './kit/integration.mjs';\n${imports}\nexport default defineConfig({ integrations: [kit(${options})] });\n`,
    ...STYLES,
    ...files,
  });
}
