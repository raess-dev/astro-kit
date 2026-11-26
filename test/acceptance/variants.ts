/**
 * The changes of the variants of 14.2 that more than one test file applies. The `static` variant turns forms off;
 * the `route` set of `planted.test.ts` starts from the same change.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as Cloudflare from '../../src/hosts/cloudflare.ts';
import type * as OptionsModule from '../../src/options.ts';
import type * as RegistryModule from '../../src/registry.ts';
import { edit, kitModule, read, write } from './harness.ts';

/** The three contact pages: each holds the two forms and the two notes. */
const CONTACT_PAGES = ['src/pages/kontakt.astro', 'src/pages/fr/contact.astro', 'src/pages/en/contact.astro'];

/** The files that only the forms use: the feature shim, the two components, their CSS files and the form texts. */
const FORM_FILES = [
  'src/pages/api/forms/[form].ts',
  'src/components/RequestForm.astro',
  'src/components/FormStatus.astro',
  'src/styles/components/request-form.css',
  'src/styles/components/form-status.css',
  'src/data/forms.ts',
];

/** The rows of `docs/design.md` `## Components` that only the forms use. */
const FORM_ROWS = [
  '| `.request-form` | `max-inline-size` | `--size-measure` |\n',
  '| `.form-status` | `border-radius` | `--radius-m` |\n',
];

/**
 * The `static` variant of 14.2 in a case folder: `features.forms` false; `contact`, `forms` and the processing keys
 * `forms` and `server` removed; `@astrojs/cloudflare` removed from `package.json`; the feature shim and the form
 * markup removed, with every component, CSS file and `## Components` row that only the forms use. `wrangler.jsonc`
 * becomes the static rendering of 10.4, written with `renderWrangler` (14.2, Rendered files: before M9). The element
 * rules of the controls stay in `elements.css`: `css-element-coverage` asks for a rule only for an element that a page
 * holds, and `css-unused` reads classes only.
 */
export async function toStatic(dir: string): Promise<void> {
  const settings = JSON.parse(read(dir, 'astro-kit.json')) as Record<string, unknown> & {
    features: Record<string, boolean>;
    processing: string[];
  };
  settings.features.forms = false;
  delete settings.contact;
  delete settings.forms;
  settings.processing = settings.processing.filter((key) => key !== 'forms' && key !== 'server');
  write(dir, { 'astro-kit.json': `${JSON.stringify(settings, null, 2)}\n` });

  const manifest = JSON.parse(read(dir, 'package.json')) as { dependencies: Record<string, string> };
  delete manifest.dependencies['@astrojs/cloudflare'];
  write(dir, { 'package.json': `${JSON.stringify(manifest, null, 2)}\n` });

  for (const file of FORM_FILES) rmSync(join(dir, file));
  for (const page of CONTACT_PAGES) {
    const path = join(dir, page);
    const kept = readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => !/RequestForm|FormStatus/.test(line))
      .join('\n');
    writeFileSync(path, kept);
  }
  for (const row of FORM_ROWS) edit(dir, 'docs/design.md', row, '');

  const { loadOptions } = await kitModule<typeof OptionsModule>('options');
  const { Report } = await kitModule<typeof RegistryModule>('registry');
  const { renderWrangler } = await kitModule<typeof Cloudflare>('hosts/cloudflare');
  const report = new Report();
  const options = loadOptions(dir, report);
  if (options === undefined) throw new Error(`toStatic: astro-kit.json is not valid:\n${report.format()}`);
  write(dir, { 'wrangler.jsonc': renderWrangler(options) });
}
