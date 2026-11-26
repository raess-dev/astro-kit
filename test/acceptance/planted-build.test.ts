/**
 * The `build` set of the planted violations at milestone M5 (specification, 14.2, "Planted-violation sets"). One copy
 * of the test site gets every plant of the list, and one `build` run must report exactly the ids of the set, and no
 * passed line. The ids of the forms rules joined at M7; `legal-origins` and `origins-third-party` join at M8, and
 * `legal-approved` at M9, each with its rule.
 *
 * Each plant is the smallest violation of its rule, on a page or a file that no other plant needs, so that one plant
 * gives one id and no other plant gives it. A plant on the shared layout or the header names the one page where it
 * acts. No plant depends on the order of the rules or on the date.
 *
 * `KIT_PLANTED_DROP=<id>` runs the set without the plant of that id, and expects the list without that id. The review
 * runs it once for each id, to prove that each plant gives its id alone. CI does not set it.
 *
 * Run: node --test test/acceptance/planted-build.test.ts
 */
import assert from 'node:assert/strict';
import { renameSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { edit, passedLine, read, run, siteCase, write } from './harness.ts';

/** The ids of the set at M5, with `edge-private` of M6 and the forms rules of M7, sorted. */
const BUILD_IDS = [
  'content-copied',
  'content-glossary',
  'content-language',
  'content-nfc',
  'content-stale',
  'edge-private',
  'facts-value',
  'forms-declared',
  'forms-fields',
  'forms-safety',
  'head-canonical',
  'head-description',
  'head-icons',
  'head-jsonld',
  'head-lang',
  'head-og',
  'head-title',
  'headings-h1',
  'headings-order',
  'hreflang-reciprocal',
  'hreflang-x-default',
  'html-shell',
  'html-validate',
  'images-attrs',
  'images-format',
  'images-priority',
  'images-src',
  'indexing-noindex',
  'legal-pages',
  'legal-statement',
  'links-depth',
  'links-generic',
  'links-resolve',
  'links-same-name',
  'links-target-blank',
  'media-captions',
  'media-pdf',
  'modes-switch',
  'routes-404',
  'routes-slug',
  'routes-translation',
  'svg-name',
];

const PAGE = 'src/layouts/Page.astro';
const HEADER = 'src/components/SiteHeader.astro';
const ROUTES = 'src/data/routes.ts';

/** Puts `markup` on a line of its own right after `anchor` in a file of the case. */
const after = (dir: string, file: string, anchor: string, markup: string): void =>
  edit(dir, file, anchor, `${anchor}\n    ${markup}`);

/** Changes the `legal` block of `astro-kit.json` in the case. */
function legal(dir: string, change: (block: Record<string, Record<string, string>>) => void): void {
  const settings = JSON.parse(read(dir, 'astro-kit.json')) as { legal: Record<string, Record<string, string>> };
  change(settings.legal);
  write(dir, { 'astro-kit.json': `${JSON.stringify(settings, null, 2)}\n` });
}

/** Moves a file of the case. */
const move = (dir: string, from: string, to: string): void => renameSync(join(dir, from), join(dir, to));

/**
 * A plain page of the site with one text section. `up` leads from the route file to `src/`. The route table needs a
 * row for `key` with the path of the file. Astro does not type-check, so the type `PageKey` stays as it is.
 */
const plainPage = (page: {
  up: string;
  locale: string;
  key: string;
  title: string;
  description: string;
  text: string;
}) =>
  `---
import TextSection from '${page.up}components/TextSection.astro';
import Page from '${page.up}layouts/Page.astro';
---

<Page locale="${page.locale}" page="${page.key}" title="${page.title}" description="${page.description}">
  <TextSection>
    <h1>${page.title}</h1>
    <p>${page.text}</p>
  </TextSection>
</Page>
`;

interface Plant {
  id: string;
  plant(dir: string): void;
}

const PLANTS: readonly Plant[] = [
  {
    // The French rooms page takes the meta description of its German sibling, word for word.
    id: 'content-copied',
    plant: (dir) =>
      edit(
        dir,
        'src/pages/fr/chambres.astro',
        /description="Chambres simples[^"]*"/,
        'description="Einzel-, Doppel- und Familienzimmer aus Arvenholz, alle mit Balkon und Frühstück. Hier stehen die Preise pro Nacht, für Ihren Hund und für die Garage."',
      ),
  },
  {
    // `Fahrrad` is a banned variant of the German list of `glossary.json` (it asks for `Velo`).
    id: 'content-glossary',
    plant: (dir) =>
      after(
        dir,
        'src/pages/anreise.astro',
        '<h1>Anreise</h1>',
        '<p>Ein Fahrrad leihen Sie bei uns an der Rezeption.</p>',
      ),
  },
  {
    // An English paragraph of 12 words or more, with no `lang`, on a German page.
    id: 'content-language',
    plant: (dir) =>
      after(
        dir,
        'src/pages/sitemap.astro',
        '<h1>Sitemap</h1>',
        '<p>This page lists every page of the website, and you can find the rooms and the restaurant here.</p>',
      ),
  },
  {
    // `e` and the combining acute accent U+0301 in place of `é`: a text node that is not in NFC.
    id: 'content-nfc',
    plant: (dir) =>
      after(
        dir,
        'src/pages/en/index.astro',
        '<h2>A house with a history</h2>',
        '<p>Our Cafe\u0301 by the lake opens at noon.</p>',
      ),
  },
  {
    // One more h2 on the French getting-here page than on its German sibling.
    id: 'content-stale',
    plant: (dir) =>
      edit(
        dir,
        'src/pages/fr/acces.astro',
        '<h2>En voiture</h2>',
        '<h2>À vélo</h2>\n    <p>Le col de la Maloja se monte aussi à vélo.</p>\n\n    <h2>En voiture</h2>',
      ),
  },
  {
    // A negation in `.assetsignore` undoes the platform lines, so Cloudflare would serve `_headers`, `_redirects`
    // and `.assetsignore` (13.1 item 66).
    id: 'edge-private',
    plant: (dir) => write(dir, { 'public/.assetsignore': '!*\n' }),
  },
  {
    // A phone number that is not in `site.json`, on the 404 page, which has no translation to compare.
    id: 'facts-value',
    plant: (dir) =>
      after(dir, 'src/pages/404.astro', '<p class="lede">{text.notFoundText}</p>', '<p>Notfall: +41 81 555 99 99</p>'),
  },
  {
    // A form of the kit that posts to an undeclared id, on the German contact page, which has `#sent` and
    // `#not-sent`. It has no field, and it links the privacy page, so no other forms rule reads it.
    id: 'forms-declared',
    plant: (dir) =>
      edit(
        dir,
        'src/pages/kontakt.astro',
        '<h2>Tisch im Restaurant</h2>',
        '<form action="/api/forms/newsletter/" method="post"><p>Den Newsletter senden wir nach der <a href="/datenschutz/">Erklärung zum Datenschutz</a>.</p><button type="submit">Newsletter bestellen</button></form>\n    <h2>Tisch im Restaurant</h2>',
      ),
  },
  {
    // A text field outside any form whose label lacks the optional word of French (`facultatif`).
    id: 'forms-fields',
    plant: (dir) =>
      after(
        dir,
        'src/pages/fr/acces.astro',
        '<h1>Accès</h1>',
        '<label>Votre gare de départ <input type="text" name="depart" autocomplete="off"></label>',
      ),
  },
  {
    // A checkbox that is checked before the visitor chooses. Its label has the optional word, so it is a valid field.
    id: 'forms-safety',
    plant: (dir) =>
      after(
        dir,
        'src/pages/en/rooms.astro',
        '<h1>Rooms and prices</h1>',
        '<label><input type="checkbox" name="news" checked> Send me the winter news (optional)</label>',
      ),
  },
  {
    // The canonical of the English sitemap page uses http: it no longer equals `${site}${path}`.
    id: 'head-canonical',
    plant: (dir) =>
      edit(
        dir,
        PAGE,
        '<link rel="canonical" href={canonical} />',
        "<link rel=\"canonical\" href={Astro.url.pathname === '/en/sitemap/' ? canonical.replace('https:', 'http:') : canonical} />",
      ),
  },
  {
    // A description of 27 code points on the English sitemap page: the floor is 50.
    id: 'head-description',
    plant: (dir) =>
      edit(
        dir,
        'src/pages/en/sitemap.astro',
        /description="Every page of[^"]*"/,
        'description="Every page of this website."',
      ),
  },
  {
    // The German getting-here page does not link the apple touch icon.
    id: 'head-icons',
    plant: (dir) =>
      edit(
        dir,
        PAGE,
        '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
        '{Astro.url.pathname !== \'/anreise/\' && <link rel="apple-touch-icon" href="/apple-touch-icon.png">}',
      ),
  },
  {
    // A `Review` node in the JSON-LD of the German restaurant page: a banned type.
    id: 'head-jsonld',
    plant: (dir) =>
      edit(
        dir,
        PAGE,
        'const graph: Record<string, unknown>[] = [organizationNode()];',
        "const graph: Record<string, unknown>[] = [organizationNode()];\nif (Astro.url.pathname === '/restaurant/') graph.push({ '@type': 'Review', name: 'Ein Gast' });",
      ),
  },
  {
    // `lang="fr"` on the French contact page, where the tag of the locale is `fr-CH`.
    id: 'head-lang',
    plant: (dir) =>
      edit(dir, PAGE, '<html lang={tag}>', "<html lang={Astro.url.pathname === '/fr/contact/' ? 'fr' : tag}>"),
  },
  {
    // The German rooms page has no `og:locale`.
    id: 'head-og',
    plant: (dir) =>
      edit(
        dir,
        PAGE,
        "<meta property=\"og:locale\" content={tag.replace('-', '_')} />",
        "{Astro.url.pathname !== '/zimmer/' && <meta property=\"og:locale\" content={tag.replace('-', '_')} />}",
      ),
  },
  {
    // A title of 5 code points on the English rooms page: the floor is 15.
    id: 'head-title',
    plant: (dir) =>
      edit(dir, 'src/pages/en/rooms.astro', 'title="Rooms and prices – Hotel Lärchenwald in Sils"', 'title="Rooms"'),
  },
  {
    // A second h1 on the German contact page.
    id: 'headings-h1',
    plant: (dir) => after(dir, 'src/pages/kontakt.astro', '<h1>Kontakt</h1>', '<h1>Anfrage</h1>'),
  },
  {
    // An h3 right after the h1 of the English contact page: it skips the h2.
    id: 'headings-order',
    plant: (dir) => after(dir, 'src/pages/en/contact.astro', '<h1>Contact</h1>', '<h3>At a glance</h3>'),
  },
  {
    // An alternate with the tag `it-CH`, which names no configured locale, on the English restaurant page.
    id: 'hreflang-reciprocal',
    plant: (dir) =>
      edit(
        dir,
        PAGE,
        '{fallback !== undefined && <link rel="alternate" hreflang="x-default"',
        '{Astro.url.pathname === \'/en/restaurant/\' && <link rel="alternate" hreflang="it-CH" href={canonical} />}\n    {fallback !== undefined && <link rel="alternate" hreflang="x-default"',
      ),
  },
  {
    // The x-default of the French restaurant page names the French page, not its German alternate.
    id: 'hreflang-x-default',
    plant: (dir) =>
      edit(
        dir,
        PAGE,
        'alternate.locale === DEFAULT_LOCALE);',
        "alternate.locale === (Astro.url.pathname === '/fr/restaurant/' ? 'fr' : DEFAULT_LOCALE));",
      ),
  },
  {
    // A link before the skip link on the German contact page: the first focusable element is no skip link.
    id: 'html-shell',
    plant: (dir) =>
      edit(
        dir,
        PAGE,
        '<SkipLink target={MAIN_ID}',
        '{Astro.url.pathname === \'/kontakt/\' && <a href="/">Hotel Lärchenwald</a>}\n    <SkipLink target={MAIN_ID}',
      ),
  },
  {
    // `role="list"` on a `ul` of the German jobs page: a redundant role (html-validate `no-redundant-role`).
    id: 'html-validate',
    plant: (dir) => edit(dir, 'src/pages/jobs.astro', '    <ul>\n', '    <ul role="list">\n'),
  },
  {
    // An `img` without `width` and `height` on the German rooms page.
    id: 'images-attrs',
    plant: (dir) => after(dir, 'src/pages/zimmer.astro', '<h1>Zimmer und Preise</h1>', '<img src="/icon.svg" alt="">'),
  },
  {
    // A `picture` without an AVIF `source` on the French contact page.
    id: 'images-format',
    plant: (dir) =>
      after(
        dir,
        'src/pages/fr/contact.astro',
        '<h1>Contact</h1>',
        '<picture><img src="/icon.svg" width="32" height="32" alt=""></picture>',
      ),
  },
  {
    // A second `fetchpriority="high"` image on the French home page, beside the hero photo.
    id: 'images-priority',
    plant: (dir) =>
      after(
        dir,
        'src/pages/fr/index.astro',
        '<h2>Accès et contact</h2>',
        '<img src="/icon.svg" width="32" height="32" alt="" fetchpriority="high">',
      ),
  },
  {
    // An `img` whose file is not in dist, on the French restaurant page.
    id: 'images-src',
    plant: (dir) =>
      after(
        dir,
        'src/pages/fr/restaurant.astro',
        '<h1>Restaurant</h1>',
        '<img src="/_astro/missing.webp" width="32" height="32" alt="">',
      ),
  },
  {
    // `noindex` on the French jobs page.
    id: 'indexing-noindex',
    plant: (dir) =>
      edit(
        dir,
        PAGE,
        '<meta name="description" content={description}>',
        '<meta name="description" content={description}>\n    {Astro.url.pathname === \'/fr/emplois/\' && <meta name="robots" content="noindex" />}',
      ),
  },
  {
    // A declared French accessibility page that is not built.
    id: 'legal-pages',
    plant: (dir) =>
      legal(dir, (block) => {
        block.accessibility = { ...block.accessibility, fr: '/fr/accessibilite/' };
      }),
  },
  {
    // The legal note is declared as the German accessibility page and claims conformance, and `site.json` has no
    // `accessibilityAudit`.
    id: 'legal-statement',
    plant: (dir) => {
      legal(dir, (block) => {
        block.accessibility = { ...block.accessibility, de: '/impressum/' };
      });
      after(dir, 'src/pages/impressum.astro', '<h1>Impressum</h1>', '<p>Diese Website ist konform.</p>');
    },
  },
  {
    // A German page and its French translation that no page links: they are not within 3 clicks of a home.
    id: 'links-depth',
    plant: (dir) => {
      edit(
        dir,
        ROUTES,
        "  rooms: { de: '/zimmer/', fr: '/fr/chambres/', en: '/en/rooms/' },\n",
        "  rooms: { de: '/zimmer/', fr: '/fr/chambres/', en: '/en/rooms/' },\n  deep: { de: '/tief/', fr: '/fr/profond/' },\n",
      );
      write(dir, {
        'src/pages/tief.astro': plainPage({
          up: '../',
          locale: 'de',
          key: 'deep',
          title: 'Unsere Lieblingswege im Fextal',
          description:
            'Drei Wanderungen ab dem Hotel ins Fextal, mit der Zeit, den Höhenmetern und der besten Einkehr am Weg, für jedes Wetter und jede Jahreszeit.',
          text: 'Der Weg nach Fex Crasta beginnt hinter dem Hotel.',
        }),
        'src/pages/fr/profond.astro': plainPage({
          up: '../../',
          locale: 'fr',
          key: 'deep',
          title: 'Nos sentiers préférés dans le val Fex',
          description:
            'Trois randonnées au départ de l’hôtel dans le val Fex, avec la durée, le dénivelé et la meilleure halte en chemin, par tous les temps.',
          text: 'Le chemin de Fex Crasta commence derrière l’hôtel.',
        }),
      });
    },
  },
  {
    // A link named `hier` on the German restaurant page, to the home page that the page links anyway.
    id: 'links-generic',
    plant: (dir) => after(dir, 'src/pages/restaurant.astro', '<h1>Restaurant</h1>', '<p><a href="/">hier</a></p>'),
  },
  {
    // `/zimmer` without its slash on the 404 page: no built page and no file has this path.
    id: 'links-resolve',
    plant: (dir) =>
      after(dir, 'src/pages/404.astro', '<h1>{text.notFoundTitle}</h1>', '<p><a href="/zimmer">Unsere Zimmer</a></p>'),
  },
  {
    // Two links named `Mehr dazu` with two targets on the German jobs page. Both targets are linked there anyway.
    id: 'links-same-name',
    plant: (dir) =>
      after(
        dir,
        'src/pages/jobs.astro',
        '<h1>Arbeiten im Hotel Lärchenwald</h1>',
        '<p><a href="/">Mehr dazu</a> <a href="/datenschutz/">Mehr dazu</a></p>',
      ),
  },
  {
    // `target="_blank"` on a link of the German sitemap page.
    id: 'links-target-blank',
    plant: (dir) =>
      after(
        dir,
        'src/pages/sitemap.astro',
        '<PageIndex locale={locale} page="sitemap" />',
        '<p><a href="/" target="_blank">Zur Startseite</a></p>',
      ),
  },
  {
    // A `video` without a captions track on the English restaurant page.
    id: 'media-captions',
    plant: (dir) =>
      after(
        dir,
        'src/pages/en/restaurant.astro',
        '<h1>Restaurant</h1>',
        '<video src="/icon.svg" width="32" height="32"></video>',
      ),
  },
  {
    // A PDF in `public/` that `site.json` `documents` does not map.
    id: 'media-pdf',
    plant: (dir) => write(dir, { 'public/preisliste.pdf': '%PDF-1.7\n%%EOF\n' }),
  },
  {
    // The English contact page has no mode switch.
    id: 'modes-switch',
    plant: (dir) =>
      edit(
        dir,
        HEADER,
        '<ModeSwitch locale={locale} />',
        "{Astro.url.pathname !== '/en/contact/' && <ModeSwitch locale={locale} />}",
      ),
  },
  {
    // The French sitemap page moves to `src/pages/fr/404.astro`, so it is built at /fr/404/. The page stays complete,
    // with its row in the route table, so that only its 404 segment is wrong.
    id: 'routes-404',
    plant: (dir) => {
      edit(dir, ROUTES, "fr: '/fr/plan-du-site/'", "fr: '/fr/404/'");
      move(dir, 'src/pages/fr/plan-du-site.astro', 'src/pages/fr/404.astro');
    },
  },
  {
    // The English getting-here page moves to /en/getting_here/: an underscore in a segment.
    id: 'routes-slug',
    plant: (dir) => {
      edit(dir, ROUTES, "en: '/en/getting-here/'", "en: '/en/getting_here/'");
      move(dir, 'src/pages/en/getting-here.astro', 'src/pages/en/getting_here.astro');
    },
  },
  {
    // A German page without its French translation, linked from the German home page. French is a full locale.
    id: 'routes-translation',
    plant: (dir) => {
      edit(
        dir,
        ROUTES,
        "  jobs: { de: '/jobs/', fr: '/fr/emplois/' },\n",
        "  jobs: { de: '/jobs/', fr: '/fr/emplois/' },\n  events: { de: '/veranstaltungen/' },\n",
      );
      write(dir, {
        'src/pages/veranstaltungen.astro': plainPage({
          up: '../',
          locale: 'de',
          key: 'events',
          title: 'Konzerte und Lesungen im Winter',
          description:
            'Im Winter laden wir jeden Donnerstag zu Hausmusik oder einer Lesung in die Arvenstube ein. Hotelgäste und Gäste aus dem Dorf sind willkommen.',
          text: 'Die Abende beginnen um halb neun in der Arvenstube.',
        }),
      });
      after(
        dir,
        'src/pages/index.astro',
        '<p><a class="standalone" href={linkTo(\'gettingHere\', locale)}>Die Anreise mit Bahn, Bus und Auto</a></p>',
        '<p><a href="/veranstaltungen/">Konzerte und Lesungen im Winter</a></p>',
      );
    },
  },
  {
    // An inline `svg` that is neither hidden nor named, on the French jobs page.
    id: 'svg-name',
    plant: (dir) =>
      after(
        dir,
        'src/pages/fr/emplois.astro',
        '<h1>Travailler à l’Hotel Lärchenwald</h1>',
        '<svg viewBox="0 0 2 2" width="2" height="2"><path d="M0 0h2v2H0z"></path></svg>',
      ),
  },
];

/** The last part of a command's output, for the message of a failed assertion. */
const tail = (output: string): string => output.slice(-4000);

test('every id of the build set has one plant', () => {
  assert.deepEqual(
    PLANTS.map((plant) => plant.id),
    BUILD_IDS,
  );
});

test('M5 planted: the build set gives exactly its ids', () => {
  const drop = process.env.KIT_PLANTED_DROP;
  if (drop !== undefined && !BUILD_IDS.includes(drop)) throw new Error(`KIT_PLANTED_DROP: ${drop} is no id of the set`);
  const dir = siteCase(drop === undefined ? 'planted-build' : `planted-build-without-${drop}`, (folder) => {
    for (const plant of PLANTS) if (plant.id !== drop) plant.plant(folder);
  });
  const result = run(dir, 'build');
  assert.deepEqual(
    result.ids,
    BUILD_IDS.filter((id) => id !== drop),
    tail(result.output),
  );
  assert.equal(result.status, 1);
  assert.deepEqual(passedLine(result), { last: false, count: 0 }, tail(result.output));
});
