/**
 * The changes of the variants of 14.2 that more than one test file applies. The `static` variant turns forms off;
 * the `route` set of `planted.test.ts` starts from the same change.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as Cloudflare from '../../src/hosts/cloudflare.ts';
import type * as OptionsModule from '../../src/options.ts';
import type * as RegistryModule from '../../src/registry.ts';
import { base, edit, kitModule, read, write } from './harness.ts';

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

/** Reads `astro-kit.json` of a case, lets `change` edit it, and writes it back. */
function changeSettings(
  dir: string,
  change: (value: Record<string, unknown> & { features: Record<string, boolean> }) => void,
): void {
  const value = JSON.parse(read(dir, 'astro-kit.json')) as Record<string, unknown> & {
    features: Record<string, boolean>;
  };
  change(value);
  write(dir, { 'astro-kit.json': `${JSON.stringify(value, null, 2)}\n` });
}

/** The page of the `islands` variant that holds the island `MoreLinks`. */
export const ISLAND_PAGE = '/zimmer/';

/** The class that `MoreLinks` adds only in the browser: no built page holds it (`css-unused`, 7.8). */
export const ISLAND_CLASS = 'more-links--open';

/**
 * The Solid island of the `islands` variant: a list of links to other pages of the hotel. Its server markup shows
 * every link, so the page works without JavaScript (`a11y-no-js`). After hydration it adds the modifier
 * `more-links--open`, a class that only the browser sees. Its pragma `@jsxImportSource solid-js` gives `astro check`
 * the JSX types of Solid, because the TS preset of the kit names no JSX source (12.2).
 */
const MORE_LINKS = `/**
 * More links to the pages of the hotel, as a Solid island. The server markup shows every link. In the browser the
 * island marks its root as open, a class that no built page holds.
 *
 * @jsxImportSource solid-js
 */
import { For, onMount } from 'solid-js';
import '../styles/components/more-links.css';

interface Link {
  href: string;
  text: string;
}

interface Props {
  label: string;
  links: readonly Link[];
}

export default function MoreLinks(props: Props) {
  let root: HTMLDivElement | undefined;
  onMount(() => root?.classList.add('${ISLAND_CLASS}'));
  return (
    <div
      class="more-links stack"
      ref={(element) => {
        root = element;
      }}
    >
      <p>{props.label}</p>
      <ul class="more-links__list">
        <For each={props.links}>
          {(link) => (
            <li>
              <a class="more-links__link" href={link.href}>
                {link.text}
              </a>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
`;

/** The CSS file of `MoreLinks`: its root, two parts and the modifier that the island adds. */
const MORE_LINKS_CSS = `@layer components {
  .more-links {
    --stack-gap: var(--space-2);

    .more-links__list {
      display: flex;
      flex-wrap: wrap;
      column-gap: var(--space-4);
      padding-inline-start: 0;
      list-style-type: none;
    }

    /* Each link stands alone, so it is a target of 44 px. */
    .more-links__link {
      display: inline-flex;
      align-items: center;
      min-inline-size: var(--size-target);
      min-block-size: var(--size-target);
    }

    /* The island adds the modifier after hydration. */
    &.${ISLAND_CLASS} .more-links__list {
      column-gap: var(--space-5);
    }
  }
}
`;

/**
 * The `islands` variant of 14.2: `features.islands` on, and the Solid island `src/components/MoreLinks.tsx` with its
 * CSS file on the German rooms page, hydrated with `client:visible`. Its links lead to pages that the main navigation
 * links too, so the page links no page that its translations do not (`content-stale`). The ESLint shim
 * `eslint.config.mjs` comes from the templates of the packed kit, as `init --shims` writes it once that command
 * exists (a later part of M9), so that `check` passes its comparison and runs ESLint (14.2, Variants).
 */
export function toIslands(dir: string): void {
  changeSettings(dir, (value) => {
    value.features.islands = true;
  });
  const shim = join(base(), 'node_modules/@raess/astro-kit/templates/features/islands/eslint.config.mjs');
  write(dir, {
    'eslint.config.mjs': readFileSync(shim, 'utf8'),
    'src/components/MoreLinks.tsx': MORE_LINKS,
    'src/styles/components/more-links.css': MORE_LINKS_CSS,
  });
  const page = 'src/pages/zimmer.astro';
  edit(
    dir,
    page,
    "import FeatureCard from '../components/FeatureCard.astro';\n",
    "import FeatureCard from '../components/FeatureCard.astro';\nimport MoreLinks from '../components/MoreLinks.tsx';\n",
  );
  edit(
    dir,
    page,
    "import { linkTo } from '../data/routes.ts';\n",
    "import { linkTo } from '../data/routes.ts';\nimport { UI } from '../data/ui.ts';\n",
  );
  // The markup in the form of the Biome preset of the kit, so that `check` passes.
  const links = ['restaurant', 'gettingHere', 'contact']
    .map((key) => `        { href: linkTo('${key}', locale), text: UI[locale].pages.${key} },\n`)
    .join('');
  edit(
    dir,
    page,
    /\n {2}<\/TextSection>\n<\/Page>/,
    `\n    <MoreLinks\n      client:visible\n      label="Mehr über das Hotel"\n      links={[\n${links}      ]}\n    />\n  </TextSection>\n</Page>`,
  );
  edit(
    dir,
    'docs/design.md',
    '| `.page-index .page-index__link` | `min-block-size` | `--size-target` |\n',
    '| `.page-index .page-index__link` | `min-block-size` | `--size-target` |\n| `.more-links .more-links__link` | `min-block-size` | `--size-target` |\n',
  );
}

/** The map of the `origins` variant: the embed of OpenStreetMap around Sils. The `origins` set plants it too. */
export const MAP_URL = 'https://www.openstreetmap.org/export/embed.html?bbox=9.74%2C46.41%2C9.80%2C46.44&layer=mapnik';

/** The one origin of the `origins` variant (14.2). */
export const MAP_ORIGIN = {
  host: 'www.openstreetmap.org',
  directives: ['frame'],
  load: 'gesture',
  purpose: 'Map on the getting-here page',
  processor: 'OpenStreetMap Foundation',
} as const;

/** The getting-here page of each locale, with the text of the map button and of its notice. */
const MAP_PAGES = [
  {
    file: 'src/pages/anreise.astro',
    button: 'Karte zeigen (lädt Daten von OpenStreetMap)',
    title: 'Karte von Sils',
    notice: 'Die Karte lädt erst nach einem Klick Daten von OpenStreetMap. Mehr dazu sagt unsere',
    privacy: 'Datenschutzerklärung',
  },
  {
    file: 'src/pages/fr/acces.astro',
    button: 'Afficher la carte (charge des données d’OpenStreetMap)',
    title: 'Carte de Sils',
    notice: 'La carte ne charge des données d’OpenStreetMap qu’après un clic. Pour en savoir plus, lisez notre',
    privacy: 'déclaration de protection des données',
  },
  {
    file: 'src/pages/en/getting-here.astro',
    button: 'Show map (loads data from OpenStreetMap)',
    title: 'Map of Sils',
    notice: 'The map loads data from OpenStreetMap only after a click. To learn more, read our',
    privacy: 'privacy policy',
  },
] as const;

/**
 * The sentence about the map for the privacy page of each locale: it names the processor (`legal-origins`). Each
 * text is a list of lines in the form that the Biome preset of the kit gives them, so that `check` passes.
 */
const PRIVACY_TEXTS = [
  {
    file: 'src/pages/datenschutz.astro',
    before: '    <h2>Ihre Rechte</h2>',
    lines: [
      'Auf der Anreiseseite zeigt eine Karte den Weg zum Hotel. Sie lädt ihre Daten erst nach einem Klick von der',
      '<span lang="en">OpenStreetMap Foundation</span>, die dabei Ihre IP-Adresse erhält.',
    ],
  },
  {
    file: 'src/pages/fr/protection-des-donnees.astro',
    before: '    <h2>Vos droits</h2>',
    lines: [
      'Sur la page d’accès, une carte montre le chemin de l’hôtel. Elle ne charge ses données qu’après un clic. Elle les',
      'charge auprès de la <span lang="en">OpenStreetMap Foundation</span>, qui reçoit alors votre adresse IP.',
    ],
  },
  {
    file: 'src/pages/en/privacy.astro',
    before: '    <h2>Your rights</h2>',
    lines: [
      'On the getting-here page, a map shows the way to the hotel. It loads its data from the OpenStreetMap Foundation',
      'only after a click, and the foundation then receives your IP address.',
    ],
  },
] as const;

/**
 * The bundled script of the map: a click on the button puts the map frame in its place. Until the click the page
 * holds no frame, so nothing goes to OpenStreetMap (9.4, `load: "gesture"`).
 */
const MAP_SCRIPT = `<script>
  const button = document.querySelector<HTMLButtonElement>('[data-map-button]');
  button?.addEventListener('click', () => {
    const frame = document.createElement('iframe');
    frame.title = button.dataset.mapTitle ?? '';
    frame.width = '600';
    frame.height = '400';
    frame.src = '${MAP_URL}';
    button.replaceWith(frame);
  });
</script>
`;

/**
 * The `origins` variant of 14.2: `features.scripts` on and the one origin `MAP_ORIGIN` with `load: "gesture"`; on
 * the three getting-here pages, a button that says what it loads, a notice that links the privacy page, and a
 * bundled script that adds the map frame on a click; the processor named on the three privacy pages. `legal --write`
 * joins from M9 (14.2, Variants).
 */
export function toOrigins(dir: string): void {
  changeSettings(dir, (value) => {
    value.features.scripts = true;
    value.origins = [MAP_ORIGIN];
  });
  for (const page of MAP_PAGES) {
    // The markup in the form of the Biome preset of the kit, so that `check` passes.
    const markup =
      `    <p>\n      <button type="button" data-map-button data-map-title="${page.title}">\n        ${page.button}\n      </button>\n    </p>\n` +
      `    <p>\n      ${page.notice}\n      <a href={linkTo('privacy', locale)}>${page.privacy}</a>.\n    </p>\n`;
    edit(
      dir,
      page.file,
      /\n {2}<\/TextSection>\n<\/Page>\s*$/,
      `\n${markup}  </TextSection>\n</Page>\n\n${MAP_SCRIPT}`,
    );
  }
  for (const privacy of PRIVACY_TEXTS) {
    const text = privacy.lines.map((line) => `      ${line}\n`).join('');
    edit(dir, privacy.file, privacy.before, `    <p>\n${text}    </p>\n\n${privacy.before}`);
  }
}
