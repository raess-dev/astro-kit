import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { accessibleName, auditSite, dominantLanguage, extractFacts } from '../../src/audit/site.ts';
import { parseHtml } from '../../src/build.ts';
import type { BuildContext, BuiltPage, RedirectRow } from '../../src/context.ts';
import type { SiteFacts } from '../../src/facts.ts';
import type { PageRecord } from '../../src/manifest.ts';
import { effectiveLimits, type KitOptions } from '../../src/options.ts';
import { type Finding, formatFindings, Report } from '../../src/registry.ts';

// ── a small two-locale site that passes every site rule ─────────────────────

const SITE = 'https://example.ch';
type Locale = 'de' | 'fr';
const TAG: Record<Locale, string> = { de: 'de-CH', fr: 'fr-CH' };
const OPTIONS: KitOptions = {
  site: SITE,
  locales: [
    { code: 'de', tag: 'de-CH', name: 'Deutsch' },
    { code: 'fr', tag: 'fr-CH', name: 'Français' },
  ],
  defaultLocale: 'de',
  nav: [],
  features: { forms: false, islands: false, scripts: false },
  prefetch: { speculationRules: true, astroPrefetch: false },
  securityContact: 'mailto:security@example.ch',
  dependencies: [],
  limits: {},
};
const FACTS: SiteFacts = {
  type: 'ProfessionalService',
  name: 'Muster',
  legalName: 'Muster AG',
  email: 'hallo@example.ch',
  phone: '+41440000000',
  uid: 'CHE-123.456.789',
  iban: 'CH93 0076 2011 6238 5295 7',
  prices: [{ id: 'first', amount: 12900, currency: 'CHF' }],
  sameAs: [],
  documents: {},
};
const PAGES: Record<string, Record<Locale, [string, string]>> = {
  home: { de: ['', 'Startseite'], fr: ['', 'Accueil'] },
  services: { de: ['leistungen', 'Leistungen'], fr: ['prestations', 'Prestations'] },
  contact: { de: ['kontakt', 'Kontakt'], fr: ['contact', 'Contact'] },
  imprint: { de: ['impressum', 'Impressum'], fr: ['mentions-legales', 'Mentions légales'] },
  privacy: { de: ['datenschutz', 'Datenschutz'], fr: ['protection-des-donnees', 'Protection des données'] },
  sitemap: { de: ['sitemap', 'Sitemap'], fr: ['plan-du-site', 'Plan du site'] },
  accessibility: { de: ['barrierefreiheit', 'Barrierefreiheit'], fr: ['accessibilite', 'Accessibilité'] },
};
const COPY: Record<Locale, Record<string, string>> = {
  de: {
    skip: 'Zum Inhalt springen',
    h2: 'Unser Angebot',
    p: 'Wir begleiten kleine und mittlere Unternehmen in Zürich von der Strategie über die Planung bis zur Umsetzung.',
    price: 'Erstgespräch ab',
    description: 'Muster berät kleine und mittlere Unternehmen in Zürich:',
  },
  fr: {
    skip: 'Aller au contenu',
    h2: 'Notre offre',
    p: 'Nous accompagnons les petites et moyennes entreprises à Zurich de la stratégie à la planification et à la réalisation.',
    price: 'Premier entretien dès',
    description: 'Muster conseille les petites et moyennes entreprises à Zurich :',
  },
};
const IDS = ['home', 'services', 'contact', 'imprint', 'privacy', 'sitemap'];
const label = (r: PageRecord) => PAGES[r.id]?.[r.locale as Locale]?.[1] ?? r.id;

function records(ids: string[]): PageRecord[] {
  return ids.flatMap((id) =>
    (['de', 'fr'] as const).map((locale): PageRecord => {
      const [slug, name] = PAGES[id]?.[locale] ?? [id, id];
      const prefix = locale === 'de' ? '/' : '/fr/';
      return {
        id,
        locale,
        entryId: `${locale}/${id}`,
        file: `src/content/pages/${locale}/${id}.md`,
        slug,
        path: slug ? `${prefix}${slug}/` : prefix,
        title: `${name} – Muster Beratung`,
        description: `${COPY[locale].description} ${name}.`,
        draft: false,
        missing: [],
        ...(id === 'privacy' ? { processing: ['cdn', 'previews'] } : {}),
      };
    }),
  );
}

function html(rec: PageRecord, all: PageRecord[]): string {
  const locale = rec.locale as Locale;
  const copy = COPY[locale];
  const siblings = all.filter((r) => r.id === rec.id);
  const main = siblings.find((r) => r.locale === 'de');
  const alts = siblings
    .map((r) => `<link rel="alternate" hreflang="${TAG[r.locale as Locale]}" href="${SITE}${r.path}">`)
    .join('');
  const xd = main ? `<link rel="alternate" hreflang="x-default" href="${SITE}${main.path}">` : '';
  const nav = all
    .filter((r) => r.locale === locale && r.id !== 'sitemap')
    .map((r) => `<li><a href="${r.path}">${label(r)}</a></li>`);
  const other = siblings.find((r) => r.locale !== locale);
  const switcher = other
    ? `<a href="${other.path}" hreflang="${TAG[other.locale as Locale]}" lang="${TAG[other.locale as Locale]}">${other.locale === 'de' ? 'Deutsch' : 'Français'}</a>`
    : '';
  const sitemap = all.find((r) => r.id === 'sitemap' && r.locale === locale);
  const price = new Intl.NumberFormat(TAG[locale], { style: 'currency', currency: 'CHF' }).format(129);
  return `<!DOCTYPE html><html lang="${TAG[locale]}"><head><meta charset="utf-8"><title>${rec.title}</title><meta name="description" content="${rec.description}">${alts}${xd}</head><body><a href="#main">${copy.skip}</a><header><nav><ul>${nav.join('')}</ul></nav>${switcher}</header><main id="main"><h1>${rec.title}</h1><h2>${copy.h2}</h2><p>${copy.p}</p><p>${copy.price} ${price}</p></main><footer><p><a href="mailto:hallo@example.ch">hallo@example.ch</a> <a href="tel:+41440000000">044 000 00 00</a></p>${sitemap ? `<a href="${sitemap.path}">${label(sitemap)}</a>` : ''}</footer></body></html>`;
}

const NOT_FOUND =
  '<!DOCTYPE html><html lang="de-CH"><head><meta name="robots" content="noindex"><title>Seite nicht gefunden</title></head><body><main id="main"><h1>Seite nicht gefunden</h1><a href="/">Zur Startseite</a></main></body></html>';

type Edit = (html: string, path: string) => string;
interface Setup {
  ids?: string[];
  edits?: Edit[];
  records?: (records: PageRecord[]) => void;
  site?: Partial<SiteFacts>;
  options?: Partial<KitOptions>;
  extra?: { path: string; html: string }[];
  files?: string[];
  redirects?: RedirectRow[];
  root?: string;
  clickDepth?: number;
}

function built(path: string, text: string, record?: PageRecord): BuiltPage {
  const page: BuiltPage = {
    file: `/dist${path}index.html`,
    path,
    html: text,
    doc: parseHtml(text),
    locale: record?.locale ?? 'de',
    is404: path === '/404.html',
  };
  if (record) page.record = record;
  return page;
}

function context(setup: Setup = {}): BuildContext {
  const recs = records(setup.ids ?? IDS);
  setup.records?.(recs);
  const byId: Record<string, Record<string, PageRecord>> = {};
  for (const r of recs) byId[r.id] = { ...byId[r.id], [r.locale]: r };
  const options: KitOptions = { ...OPTIONS, ...setup.options };
  const pages = recs.map((r) =>
    built(
      r.path,
      (setup.edits ?? []).reduce((text, edit) => edit(text, r.path), html(r, recs)),
      r,
    ),
  );
  pages.push(built('/404.html', NOT_FOUND));
  for (const x of setup.extra ?? []) pages.push(built(x.path, x.html));
  const limits = effectiveLimits(options);
  if (setup.clickDepth !== undefined) Object.assign(limits, { clickDepth: setup.clickDepth });
  return {
    root: setup.root ?? join(tmpdir(), 'astro-kit-no-root'),
    dist: '/dist',
    options,
    limits,
    manifest: { pages: recs, byId, drafts: false },
    site: { ...FACTS, ...setup.site },
    schedule: { openingHours: [], closures: [] },
    messages: {},
    pages,
    css: [],
    files: ['favicon.ico', ...(setup.files ?? [])],
    redirects: setup.redirects ?? [],
    wrangler: undefined,
    report: new Report(),
    env: {},
  };
}

function run(setup?: Setup): Finding[] {
  const ctx = context(setup);
  auditSite(ctx);
  return ctx.report.findings;
}
const rules = (findings: Finding[]) => [...new Set(findings.map((f) => f.rule))].sort();
const expectRules = (setup: Setup, expected: string[]) => {
  const findings = run(setup);
  assert.deepEqual(rules(findings), expected, formatFindings(findings));
  return findings;
};

/** Replaces text on one page (or every page with path '*'); fails when the text is absent. */
const on =
  (path: string, from: string | RegExp, to: string): Edit =>
  (text, p) => {
    if (path !== '*' && p !== path) return text;
    const out = text.replace(from, to);
    if (out === text && path !== '*') throw new Error(`edit on ${path} did not apply: ${String(from)}`);
    return out;
  };
const footer = (path: string, snippet: string) => on(path, '</footer>', `${snippet}</footer>`);
const inMain = (path: string, snippet: string) => on(path, '</main>', `${snippet}</main>`);

// ── tests ────────────────────────────────────────────────────────────────────

test('the good site passes', () => {
  expectRules({}, []);
  expectRules(
    {
      edits: [
        on('*', /hreflang="de-CH" href/g, 'hreflang="de" href'),
        on('*', /hreflang="fr-CH" href/g, 'hreflang="fr" href'),
      ],
    },
    [],
  );
});

test('hreflang-reciprocal', () => {
  expectRules(
    {
      edits: [
        on('/fr/prestations/', '<link rel="alternate" hreflang="de-CH" href="https://example.ch/leistungen/">', ''),
      ],
    },
    ['hreflang-reciprocal'],
  );
  expectRules(
    {
      edits: [
        on(
          '/leistungen/',
          'hreflang="fr-CH" href="https://example.ch/fr/prestations/"',
          'hreflang="fr-CH" href="/fr/prestations/"',
        ),
      ],
    },
    ['hreflang-reciprocal'],
  );
  // A custom route lists a page that does not list it back.
  const custom = `<!DOCTYPE html><html lang="de-CH"><head><meta name="robots" content="noindex"><link rel="alternate" hreflang="de-CH" href="${SITE}/aktion/"><link rel="alternate" hreflang="x-default" href="${SITE}/aktion/"><link rel="alternate" hreflang="fr-CH" href="${SITE}/fr/prestations/"></head><body><main></main></body></html>`;
  expectRules({ extra: [{ path: '/aktion/', html: custom }] }, ['hreflang-reciprocal']);
});

test('hreflang-x-default', () => {
  expectRules(
    {
      edits: [
        on(
          '/fr/prestations/',
          'hreflang="x-default" href="https://example.ch/leistungen/"',
          'hreflang="x-default" href="https://example.ch/fr/prestations/"',
        ),
      ],
    },
    ['hreflang-x-default'],
  );
  expectRules({ edits: [on('/', '<link rel="alternate" hreflang="x-default" href="https://example.ch/">', '')] }, [
    'hreflang-x-default',
  ]);
});

test('links-resolve', () => {
  expectRules({ edits: [footer('/', '<a href="/kontakt">Kontaktformular</a>')] }, ['links-resolve']);
  expectRules({ edits: [footer('/', '<a href="/kontakt/#formular">Zum Formular</a>')] }, ['links-resolve']);
  expectRules({ edits: [footer('/', '<a href="http://example.ch/kontakt/">Kontaktformular</a>')] }, ['links-resolve']);
  expectRules(
    { edits: [footer('/', '<a href="/angebot/">Angebot</a>')], redirects: [{ from: '/angebot/', to: '/leistungen/' }] },
    ['links-resolve'],
  );
  expectRules(
    { edits: [footer('/', '<a href="/alt/preise/">Preise</a>')], redirects: [{ from: '/alt/*', gone: true }] },
    ['links-resolve'],
  );
  const fine =
    '<a href="/kontakt/#main">Zum Formular</a> <a href="https://example.ch/kontakt/">Kontaktformular</a> <a href="/preise.pdf">Preisliste (PDF)</a> <a href="https://partner.example/">Partnerfirma</a>';
  expectRules({ edits: [footer('/', fine)], files: ['preise.pdf'] }, []);
});

test('links-generic', () => {
  expectRules({ edits: [footer('/', '<a href="/kontakt/">Mehr</a>')] }, ['links-generic']);
  expectRules({ edits: [footer('/', '<a href="/kontakt/">Weiterlesen …</a>')] }, ['links-generic']);
  expectRules({ edits: [footer('/fr/', '<a href="/fr/contact/">Cliquez ici</a>')] }, ['links-generic']);
  expectRules({ edits: [footer('/', '<a href="/kontakt/"><svg aria-hidden="true"></svg></a>')] }, ['links-generic']);
  const named =
    '<a href="/kontakt/">Mehr <span class="visually-hidden">über den Kontakt</span></a> <a href="/impressum/" aria-label="Mehr über das Impressum">Mehr</a>';
  expectRules({ edits: [footer('/', named)] }, []);
});

test('accessibleName follows aria-labelledby, aria-label, alt and aria-hidden', () => {
  const doc = parseHtml(
    '<p id="t">Leistungen</p><a id="a" aria-labelledby="t">x</a><a id="b"><img alt="Startseite"><span aria-hidden="true">→</span></a><a id="c" aria-label="Kontakt">K</a>',
  );
  const name = (id: string) => accessibleName(doc.getElementById(id) ?? doc, doc);
  assert.equal(name('a'), 'Leistungen');
  assert.equal(name('b'), 'Startseite');
  assert.equal(name('c'), 'Kontakt');
});

test('links-same-name', () => {
  expectRules({ edits: [footer('/', '<a href="/leistungen/">Kontakt</a>')] }, ['links-same-name']);
  expectRules({ edits: [footer('/', '<a href="/kontakt/">Kontakt</a>')] }, []);
});

test('links-target-blank', () => {
  expectRules({ edits: [footer('/', '<a href="https://partner.example/" target="_blank">Partnerfirma</a>')] }, [
    'links-target-blank',
  ]);
});

test('links-depth', () => {
  const orphan = expectRules({ edits: [on('*', /<a href="\/leistungen\/"[^>]*>[^<]*<\/a>/g, '')] }, ['links-depth']);
  assert.deepEqual(
    orphan.map((f) => f.where),
    ['/leistungen/'],
  );
  // With a limit of 0 only the two homes are in reach.
  assert.equal(expectRules({ clickDepth: 0 }, ['links-depth']).length, 10);
});

test('links-sitemap-page', () => {
  expectRules({ edits: [on('/kontakt/', '<a href="/sitemap/">Sitemap</a>', '')] }, ['links-sitemap-page']);
  const none = expectRules({ ids: IDS.filter((id) => id !== 'sitemap') }, ['links-sitemap-page']);
  assert.deepEqual(
    none.map((f) => f.where),
    ['src/content/pages/de', 'src/content/pages/fr'],
  );
});

test('extractFacts normalises every kind', () => {
  const text =
    'Mail info@example.ch, Tel. +41 (0)44 123 45 67 oder 031 123 45 67, CHE-123.456.789 MWST, IBAN CH93 0076 2011 6238 5295 7, CHF 1’290.00 und 129.– CHF';
  assert.deepEqual(
    extractFacts(text).map((f) => [f.kind, f.value]),
    [
      ['email', 'info@example.ch'],
      ['iban', 'CH9300762011623852957'],
      ['uid', 'CHE-123.456.789'],
      ['chf', "CHF 1'290.00"],
      ['chf', '129.– CHF'],
      ['phone', '+41441234567'],
      ['phone', '+41311234567'],
    ],
  );
});

test('facts-value', () => {
  expectRules({ edits: [on('/kontakt/', '044 000 00 00', '044 000 00 01')] }, ['facts-value']);
  expectRules({ edits: [on('/kontakt/', 'mailto:hallo@example.ch', 'mailto:info@example.ch')] }, ['facts-value']);
  expectRules({ edits: [footer('/', '<p>IBAN CH93 0076 2011 6238 5295 8</p>')] }, ['facts-value']);
  // A price must be a site.json price formatted for the locale; the change also breaks parity with de.
  expectRules({ edits: [on('/fr/prestations/', /129\.00\sCHF/, '129.– CHF')] }, ['content-stale', 'facts-value']);
  const fine =
    '<p>CHE-123.456.789 MWST · IBAN CH93 0076 2011 6238 5295 7 · +41 44 000 00 00</p><script type="application/ld+json">{"telephone":"+41 44 999 99 99"}</script>';
  expectRules({ edits: [footer('*', fine)] }, []);
});

test('legal-pages', () => {
  const findings = expectRules({ ids: IDS.filter((id) => id !== 'imprint') }, ['legal-pages']);
  assert.equal(findings.length, 2);
});

test('legal-processing', () => {
  const cdnOnly = (rs: PageRecord[]) => {
    for (const r of rs) if (r.id === 'privacy') r.processing = ['cdn'];
  };
  expectRules({ records: cdnOnly }, ['legal-processing']);
  const forms = expectRules({ options: { features: { forms: true, islands: false, scripts: false } } }, [
    'legal-processing',
  ]);
  assert.match(forms[0]?.detail ?? '', /forms, server/);
});

test('legal-statement', () => {
  const claim = inMain('/barrierefreiheit/', '<p>Diese Website ist konform mit WCAG 2.2 AA.</p>');
  const ids = [...IDS, 'accessibility'];
  expectRules({ ids, edits: [claim] }, ['legal-statement']);
  expectRules(
    {
      ids,
      edits: [claim],
      site: { accessibilityAudit: { date: '2026-10-01', by: 'Prüfstelle', scope: 'alle Seiten' } },
    },
    [],
  );
});

test('content-copied', () => {
  const copyTitle = (rs: PageRecord[]) => {
    const de = rs.find((r) => r.entryId === 'de/services');
    const fr = rs.find((r) => r.entryId === 'fr/services');
    if (de && fr) fr.title = de.title;
  };
  const findings = expectRules({ records: copyTitle }, ['content-copied']);
  assert.deepEqual(
    findings.map((f) => f.detail?.split(' ')[0]),
    ['title', 'h1'],
  );
});

test('content-stale structural parity', () => {
  expectRules({ edits: [inMain('/leistungen/', '<h2>Ablauf</h2>')] }, ['content-stale']);
  expectRules({ edits: [inMain('/leistungen/', '<p><a href="/kontakt/">Kontakt aufnehmen</a></p>')] }, [
    'content-stale',
  ]);
  expectRules({ edits: [inMain('/leistungen/', '<p>hallo@example.ch</p>')] }, ['content-stale']);
  const both = [
    inMain('/leistungen/', '<p><a href="/kontakt/">Kontakt aufnehmen</a></p>'),
    inMain('/fr/prestations/', '<p><a href="/fr/contact/">Nous contacter</a></p>'),
  ];
  expectRules({ edits: both }, []);
});

test('content-language', () => {
  expectRules({ edits: [on('/fr/prestations/', COPY.fr.p ?? '', COPY.de.p ?? '')] }, ['content-language']);
  const english =
    '<p>We help small and medium-sized companies in Zurich with their strategy, planning and the delivery of projects.</p>';
  expectRules({ edits: [inMain('/kontakt/', english)] }, ['content-language']);
  expectRules({ edits: [inMain('/kontakt/', english.replace('<p>', '<p lang="en">'))] }, []);
  assert.equal(dominantLanguage('Nous accompagnons les entreprises à Zurich.', 'de'), undefined);
});

test('content-glossary', () => {
  expectRules({ edits: [footer('/', '<p>Musterstraße 1</p>')] }, ['content-glossary']);
  expectRules({ edits: [footer('/', '<p>„Sehr gute Beratung“</p>')] }, ['content-glossary']);
  expectRules({ edits: [footer('/', '<p>«Sehr gute Beratung»</p>'), footer('/fr/', '<p>Musterstraße 1</p>')] }, []);

  const root = mkdtempSync(join(tmpdir(), 'astro-kit-glossary-'));
  mkdirSync(join(root, 'src/content'), { recursive: true });
  writeFileSync(join(root, 'src/content/glossary.json'), JSON.stringify({ de: { banned: { Email: 'E-Mail' } } }));
  expectRules({ root, edits: [footer('/', '<p>Schreiben Sie uns eine Email</p>')] }, ['content-glossary']);
  expectRules({ root, edits: [footer('/', '<p>Schreiben Sie uns eine E-Mail</p>')] }, []);
  writeFileSync(join(root, 'src/content/glossary.json'), '{ "de": { "banned": ["Email"] } }');
  assert.deepEqual(
    run({ root }).map((f) => f.where),
    ['src/content/glossary.json'],
  );
});
