/**
 * The asset rules of the page audit (`src/audit/page/assets.ts`): `images-src`, `images-attrs`, `images-format`,
 * `images-priority`, `fonts-limit`, `media-animated`, `media-captions`, `media-pdf` and `svg-name`. Markup is shaped
 * as Astro writes it (`<Picture>` with AVIF sources and a WebP fallback); image files are byte arrays (14.1).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  auditFontsLimit,
  auditImagesAttrs,
  auditImagesFormat,
  auditImagesPriority,
  auditImagesSrc,
  auditMediaAnimated,
  auditMediaCaptions,
  auditMediaPdf,
  auditSvgName,
  gifFrames,
  isAnimated,
  srcsetCandidates,
} from '../../src/audit/page/assets.ts';
import type { BuildContext } from '../../src/context.ts';
import type { Report } from '../../src/registry.ts';
import {
  type ContextSettings,
  contextOf,
  fileOf,
  findings,
  ICON_FILES,
  ids,
  OPTIONS,
  page,
  SWITCH_OPTIONS,
  site,
} from './audit-fixtures.ts';
import { SITE } from './fixtures.ts';

// Inputs

type Rule = (ctx: BuildContext) => void;

/** Runs one rule on a client directory and gives the report. */
function runFiles(rule: Rule, files: Record<string, string | Uint8Array>, settings: ContextSettings = {}): Report {
  const ctx = contextOf(files, settings);
  rule(ctx);
  return ctx.report;
}

/** The home page of `OPTIONS` with this content of `main`, the icons, and more files. */
function withMain(main: string, more: Record<string, string | Uint8Array> = {}): Record<string, string | Uint8Array> {
  return { ...ICON_FILES, 'index.html': page(OPTIONS, '/', { main: `<h1>Titel der Seite</h1> ${main}` }), ...more };
}

const run = (rule: Rule, main: string, more: Record<string, string | Uint8Array> = {}): Report =>
  runFiles(rule, withMain(main, more));

/** The image files that the cases name. Their bytes do not matter to these rules. */
const IMAGES: Record<string, string> = {
  '_astro/hero_1.avif': 'a',
  '_astro/hero_2.avif': 'a',
  '_astro/hero_3.webp': 'w',
  '_astro/hero_4.webp': 'w',
};

/** A `<Picture>` as Astro writes it with `formats={['avif']}` and `fallbackFormat="webp"` (13.1, item 49). */
const PICTURE =
  '<picture> <source srcset="/_astro/hero_1.avif 640w, /_astro/hero_2.avif 960w" type="image/avif"> <img src="/_astro/hero_3.webp" srcset="/_astro/hero_3.webp 640w, /_astro/hero_4.webp 960w" alt="Der Silsersee im Herbst" sizes="(min-width: 960px) 960px, 100vw" loading="lazy" decoding="async" fetchpriority="auto" width="960" height="640" data-astro-image="constrained"> </picture>';

const IMG = '<img src="/_astro/hero_3.webp" alt="" width="960" height="640">';

// srcset

test('srcsetCandidates: candidates as HTML parses them, with commas inside a URL', () => {
  assert.deepEqual(srcsetCandidates(' /a.webp 640w,/b.webp  960w , /c.webp'), [
    { url: '/a.webp', descriptors: ['640w'] },
    { url: '/b.webp', descriptors: ['960w'] },
    { url: '/c.webp', descriptors: [] },
  ]);
  assert.deepEqual(srcsetCandidates('data:image/png;base64,AAA= 2x, /a.webp,, /b.webp'), [
    { url: 'data:image/png;base64,AAA=', descriptors: ['2x'] },
    { url: '/a.webp', descriptors: [] },
    { url: '/b.webp', descriptors: [] },
  ]);
  assert.deepEqual(srcsetCandidates('/a.webp foo(1, 2) 2x'), [{ url: '/a.webp', descriptors: ['foo(1, 2)', '2x'] }]);
  assert.deepEqual(srcsetCandidates(' , '), []);
});

// images-src

test('images-src: a picture of /_astro/ files and an icon pass; the stage-1 site has no image', () => {
  assert.deepEqual(
    ids(run(auditImagesSrc, `${PICTURE} <img src="/icon.svg" alt="" width="32" height="32">`, IMAGES)),
    [],
  );
  assert.deepEqual(ids(runFiles(auditImagesSrc, site(OPTIONS))), []);
});

test('images-src: a source outside /_astro/ fails once for each element and attribute', () => {
  const report = run(auditImagesSrc, '<img src="/photo.webp" srcset="/photo.webp 1x, /_astro/hero_3.webp 2x" alt="">', {
    'photo.webp': 'w',
    ...IMAGES,
  });
  assert.deepEqual(findings(report), [
    'images-src / src "/photo.webp" of <img src="/photo.webp" srcset="/photo.webp 1x, /_astro/hero_3.webp 2x" alt="">',
    'images-src / srcset "/photo.webp" of <img src="/photo.webp" srcset="/photo.webp 1x, /_astro/hero_3.webp 2x" alt="">',
  ]);
});

test('images-src: a relative path, dot segments, another origin, a data: URL and an empty src fail', () => {
  for (const src of [
    '_astro/hero_3.webp',
    '/_astro/../hero_3.webp',
    'https://cdn.example/a.webp',
    '//example.ch/_astro/hero_3.webp',
    'data:image/png;base64,AAAA',
    '',
    '/_astro/',
  ]) {
    assert.deepEqual(ids(run(auditImagesSrc, `<img src="${src}" alt="">`, IMAGES)), ['images-src'], src);
  }
});

test('images-src: a source srcset outside /_astro/ fails', () => {
  const main = PICTURE.replace('/_astro/hero_2.avif 960w', '/hero.avif 960w');
  assert.deepEqual(ids(run(auditImagesSrc, main, { ...IMAGES, 'hero.avif': 'a' })), ['images-src']);
});

test('images-src: a missing file fails once for each file of a page', () => {
  const report = run(auditImagesSrc, `${PICTURE} ${PICTURE}`, {
    '_astro/hero_1.avif': 'a',
    '_astro/hero_3.webp': 'w',
    '_astro/hero_4.webp': 'w',
  });
  assert.deepEqual(findings(report), ['images-src / the file /_astro/hero_2.avif is missing']);
});

test('images-src: the poster of a video and the src of a media source must exist', () => {
  const video = '<video controls poster="/_astro/poster.webp"><source src="/_astro/film.mp4" type="video/mp4"></video>';
  assert.deepEqual(ids(run(auditImagesSrc, video, { '_astro/poster.webp': 'w', '_astro/film.mp4': 'm' })), []);
  assert.deepEqual(findings(run(auditImagesSrc, video, { '_astro/film.mp4': 'm' })), [
    'images-src / the file /_astro/poster.webp is missing',
  ]);
  assert.deepEqual(findings(run(auditImagesSrc, video, { '_astro/poster.webp': 'w' })), [
    'images-src / the file /_astro/film.mp4 is missing',
  ]);
});

test('images-src: a percent-encoded file name names the decoded file', () => {
  assert.deepEqual(
    ids(run(auditImagesSrc, '<img src="/_astro/l%C3%A4rche.webp" alt="">', { '_astro/lärche.webp': 'w' })),
    [],
  );
});

// images-attrs

test('images-attrs: width, height and alt (empty or not) on img, sizes on a width-based source pass', () => {
  assert.deepEqual(
    ids(run(auditImagesAttrs, `${PICTURE.replace('type="image/avif"', 'type="image/avif" sizes="100vw"')} ${IMG}`)),
    [],
  );
  assert.deepEqual(
    ids(
      run(
        auditImagesAttrs,
        '<picture><source srcset="/_astro/a.avif 2x" type="image/avif"><img src="/_astro/a.webp" alt="" width="1" height="1"></picture>',
      ),
    ),
    [],
  );
});

test('images-attrs: an img without alt, width or height fails once, naming what it lacks', () => {
  assert.deepEqual(findings(run(auditImagesAttrs, '<img src="/_astro/a.webp">')), [
    'images-attrs / <img src="/_astro/a.webp"> lacks width, height, alt',
  ]);
  assert.deepEqual(ids(run(auditImagesAttrs, IMG.replace(' alt=""', ''))), ['images-attrs']);
  assert.deepEqual(ids(run(auditImagesAttrs, IMG.replace('width="960"', 'width=" "'))), ['images-attrs']);
  assert.deepEqual(ids(run(auditImagesAttrs, IMG.replace(' height="640"', ''))), ['images-attrs']);
});

test('images-attrs: a source with a width descriptor and no sizes fails', () => {
  const report = run(auditImagesAttrs, PICTURE);
  assert.deepEqual(findings(report), [
    'images-attrs / <source srcset="/_astro/hero_1.avif 640w, /_astro/hero_2.avif 960w" type="image/avif"> lacks sizes',
  ]);
});

// images-format

test('images-format: AVIF sources and a WebP img pass, the type in any case', () => {
  assert.deepEqual(ids(run(auditImagesFormat, PICTURE)), []);
  assert.deepEqual(ids(run(auditImagesFormat, PICTURE.replace('type="image/avif"', 'type=" Image/AVIF "'))), []);
});

test('images-format: a picture without source, with a WebP source, without img or with a JPEG img fails', () => {
  assert.deepEqual(findings(run(auditImagesFormat, `<picture> ${IMG} </picture>`)), ['images-format / no source']);
  const webp = PICTURE.replace('type="image/avif"', 'type="image/webp"');
  assert.deepEqual(ids(run(auditImagesFormat, webp)), ['images-format']);
  assert.deepEqual(
    findings(run(auditImagesFormat, '<picture><source srcset="/_astro/a.avif" type="image/avif"></picture>')),
    ['images-format / no img'],
  );
  const jpeg = PICTURE.replace('src="/_astro/hero_3.webp"', 'src="/_astro/hero_3.jpg"');
  assert.deepEqual(ids(run(auditImagesFormat, jpeg)), ['images-format']);
  const nested = `<picture> <picture> <source srcset="/_astro/a.avif" type="image/avif"> ${IMG} </picture> ${IMG} </picture>`;
  assert.deepEqual(findings(run(auditImagesFormat, nested)), ['images-format / no source']);
});

// images-priority

test('images-priority: one high-priority image passes; two fail, in any case', () => {
  const high = IMG.replace('<img', '<img fetchpriority="high"');
  assert.deepEqual(ids(run(auditImagesPriority, `${high} ${PICTURE}`)), []);
  assert.deepEqual(findings(run(auditImagesPriority, `${high} ${high.replace('"high"', '"HIGH"')}`)), [
    'images-priority / 2 images with fetchpriority=high; at most 1',
  ]);
});

// fonts-limit

const face = (family: string, src: string): string => `@font-face{font-family:${family};src:${src}}`;

test('fonts-limit: two families with url() faces pass; a face with only local() is exempt', () => {
  const css = [
    face('Inter', 'url(/_astro/inter.woff2)format("woff2")'),
    face('"Inter"', 'url("/_astro/inter-bold.woff2")'),
    face('Source Serif', 'url(/_astro/serif.woff2)'),
    face('Georgia Local', 'local("Georgia")'),
  ].join('');
  const files = { ...ICON_FILES, 'index.html': page(OPTIONS, '/', { css }) };
  assert.deepEqual(ids(runFiles(auditFontsLimit, files)), []);
  assert.deepEqual(ids(runFiles(auditFontsLimit, site(SWITCH_OPTIONS), { options: SWITCH_OPTIONS })), []);
});

test('fonts-limit: a third family fails once for the site, at the first sheet that brings it', () => {
  const css = [
    face('Inter', 'url(/_astro/a.woff2)'),
    face('Serif', 'url(/_astro/b.woff2)'),
    face('INTER', 'url(/_astro/c.woff2)'),
  ].join('');
  const third = `${css}${face('Mono', 'url(/_astro/d.woff2)')}`;
  const files = {
    ...ICON_FILES,
    'index.html': page(OPTIONS, '/', { css }),
    'fr/index.html': page(OPTIONS, '/fr/', { css: third }),
    'impressum/index.html': page(OPTIONS, '/impressum/', { css: third }),
  };
  assert.deepEqual(findings(runFiles(auditFontsLimit, files)), [
    'fonts-limit /fr/ 3 font families with url() faces: "inter", "serif", "mono"; at most 2',
  ]);
  const inFile = {
    ...ICON_FILES,
    'index.html': page(OPTIONS, '/', { css }),
    '_astro/fonts.css': face('Mono', 'url(/_astro/d.woff2)'),
  };
  assert.deepEqual(findings(runFiles(auditFontsLimit, inFile)), [
    'fonts-limit /_astro/fonts.css 3 font families with url() faces: "inter", "serif", "mono"; at most 2',
  ]);
});

test('fonts-limit: a font url() of another origin or a data: URL fails once; a relative URL of a file passes', () => {
  const css = `${face('Inter', 'url(https://fonts.example/inter.woff2)')}${face('Serif', 'url(data:font/woff2;base64,AAAA)')}`;
  const files = {
    ...ICON_FILES,
    'index.html': page(OPTIONS, '/', { css }),
    'fr/index.html': page(OPTIONS, '/fr/', { css }),
  };
  assert.deepEqual(findings(runFiles(auditFontsLimit, files)), [
    'fonts-limit / a font url() of another origin: "data:font/woff2;base64,AAAA"',
    'fonts-limit / a font url() of another origin: "https://fonts.example/inter.woff2"',
  ]);
  const relative = {
    ...ICON_FILES,
    'index.html': page(OPTIONS, '/'),
    '_astro/a.css': face('Inter', 'url(../fonts/inter.woff2)'),
  };
  assert.deepEqual(ids(runFiles(auditFontsLimit, relative)), []);
  const own = {
    ...ICON_FILES,
    'index.html': page(OPTIONS, '/', { css: face('Inter', 'url(https://example.ch/f.woff2)') }),
  };
  assert.deepEqual(ids(runFiles(auditFontsLimit, own)), []);
});

test('fonts-limit: two font preloads on a page fail at the page; one passes', () => {
  const preload = '<link rel="preload" as="font" href="/_astro/a.woff2" type="font/woff2" crossorigin>';
  const one = { ...ICON_FILES, 'index.html': page(OPTIONS, '/', { head: preload }) };
  assert.deepEqual(ids(runFiles(auditFontsLimit, one)), []);
  const two = {
    ...ICON_FILES,
    'index.html': page(OPTIONS, '/', { head: `${preload}${preload.replace('as="font"', 'as="FONT"')}` }),
  };
  assert.deepEqual(findings(runFiles(auditFontsLimit, two)), ['fonts-limit / 2 font preloads; at most 1']);
});

// media-animated

const bytesOf = (...parts: (string | readonly number[])[]): Uint8Array =>
  Uint8Array.from(
    parts.flatMap((part) => (typeof part === 'string' ? [...part].map((char) => char.charCodeAt(0)) : [...part])),
  );
const be32 = (value: number): number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];
const le32 = (value: number): number[] => be32(value).reverse();

/** A GIF of `frames` 1×1 images, each with a graphic control extension, with or without a global color table. */
function gif(frames: number, table = false): Uint8Array {
  const frame = [0x21, 0xf9, 4, 0, 10, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0];
  const screen = [1, 0, 1, 0, table ? 0x80 : 0, 0, 0, ...(table ? [0, 0, 0, 255, 255, 255] : [])];
  return bytesOf('GIF89a', screen, ...Array.from({ length: frames }, () => frame), [0x3b]);
}

const chunk = (type: string, data: readonly number[]): (string | number[])[] => [
  be32(data.length),
  type,
  [...data],
  [0, 0, 0, 0],
];
const png = (...types: string[]): Uint8Array =>
  bytesOf(
    [0x89],
    'PNG\r\n\x1a\n',
    ...types.flatMap((type) => chunk(type, type === 'IHDR' ? new Array(13).fill(0) : [0, 0, 0, 0, 0, 0, 0, 0])),
  );
const webp = (...types: string[]): Uint8Array => {
  const body = types.flatMap((type) => [type, le32(3), [0, 0, 0, 0]]);
  return bytesOf('RIFF', le32(4 + types.length * 12), 'WEBP', ...body);
};
const avif = (major: string, ...brands: string[]): Uint8Array =>
  bytesOf(be32(16 + brands.length * 4), 'ftyp', major, be32(0), ...brands);

test('media-animated: still images pass; the format comes from the bytes', () => {
  const files = {
    ...ICON_FILES,
    'index.html': page(OPTIONS, '/'),
    '_astro/a.gif': gif(1),
    '_astro/b.gif': gif(1, true),
    '_astro/c.png': png('IHDR', 'IDAT', 'acTL', 'IEND'),
    '_astro/d.webp': webp('VP8X', 'VP8 '),
    '_astro/e.avif': avif('avif', 'mif1', 'avif'),
    '_astro/f.jpg': gif(1),
    '_astro/g.gif': new Uint8Array(0),
    '_astro/h.js': gif(2),
  };
  assert.deepEqual(ids(runFiles(auditMediaAnimated, files)), []);
});

test('media-animated: an animated file of any other name fails too: .jpg, .ico, or no extension', () => {
  const still = { ...ICON_FILES, 'index.html': page(OPTIONS, '/'), 'og.jpg': gif(1), 'favicon2.ico': gif(1) };
  assert.deepEqual(ids(runFiles(auditMediaAnimated, still)), []);
  const files = {
    ...ICON_FILES,
    'index.html': page(OPTIONS, '/'),
    'og.jpg': gif(2),
    'favicon2.ico': png('IHDR', 'acTL', 'IDAT'),
    '_astro/plain': webp('VP8X', 'ANIM'),
  };
  assert.deepEqual(findings(runFiles(auditMediaAnimated, files)), [
    'media-animated /_astro/plain an animated image',
    'media-animated /favicon2.ico an animated image',
    'media-animated /og.jpg an animated image',
  ]);
});

test('media-animated: an animated GIF, APNG, WebP or AVIF fails once at its file, in any extension case', () => {
  const files = {
    ...ICON_FILES,
    'index.html': page(OPTIONS, '/'),
    '_astro/a.GIF': gif(2),
    '_astro/b.png': png('IHDR', 'acTL', 'IDAT', 'IEND'),
    '_astro/c.apng': png('IHDR', 'acTL', 'IDAT'),
    '_astro/d.webp': webp('VP8X', 'ANIM', 'ANMF'),
    '_astro/e.avif': avif('avif', 'mif1', 'avis'),
    '_astro/f.avif': avif('avis', 'msf1'),
    '_astro/g.png': gif(3, true),
  };
  assert.deepEqual(findings(runFiles(auditMediaAnimated, files)), [
    'media-animated /_astro/a.GIF an animated image',
    'media-animated /_astro/b.png an animated image',
    'media-animated /_astro/c.apng an animated image',
    'media-animated /_astro/d.webp an animated image',
    'media-animated /_astro/e.avif an animated image',
    'media-animated /_astro/f.avif an animated image',
    'media-animated /_astro/g.png an animated image',
  ]);
});

test('media-animated: a truncated file is no animation, and a frame that the file cuts does not count', () => {
  const two = gif(2);
  assert.equal(gifFrames(two), 2);
  assert.equal(gifFrames(two.slice(0, two.length - 4)), 1);
  for (let end = 0; end < two.length - 3; end += 1) assert.equal(isAnimated(two.slice(0, end)), false, String(end));
  const apng = png('IHDR', 'acTL', 'IDAT');
  for (let end = 0; end < 33 + 8; end += 1) assert.equal(isAnimated(apng.slice(0, end)), false, String(end));
  assert.equal(isAnimated(bytesOf(be32(1), 'ftyp')), false);
  assert.equal(isAnimated(bytesOf('RIFF', le32(0xffffffff), 'WEBP', 'VP8X', le32(0xfffffff0))), false);
});

// media-captions

test('media-captions: a video with captions in the tag or the code of the page locale passes', () => {
  for (const srclang of ['de', 'de-CH', 'DE-ch']) {
    const main = `<video controls src="/_astro/a.mp4"><track kind="captions" srclang="${srclang}" src="/_astro/a.vtt" label="Deutsch"></video>`;
    assert.deepEqual(ids(run(auditMediaCaptions, main)), [], srclang);
  }
  const fr = {
    ...ICON_FILES,
    'fr/index.html': page(OPTIONS, '/fr/', {
      main: '<h1>Titre</h1> <video><track kind="Captions" srclang="fr"></video>',
    }),
  };
  assert.deepEqual(ids(runFiles(auditMediaCaptions, fr)), []);
});

test('media-captions: a video without captions, with subtitles or in another language fails once', () => {
  assert.deepEqual(findings(run(auditMediaCaptions, '<video controls src="/_astro/a.mp4"></video>')), [
    'media-captions / <video controls src="/_astro/a.mp4"> has no captions track in de-ch or de',
  ]);
  assert.deepEqual(ids(run(auditMediaCaptions, '<video><track kind="subtitles" srclang="de"></video>')), [
    'media-captions',
  ]);
  assert.deepEqual(ids(run(auditMediaCaptions, '<video><track kind="captions" srclang="fr"></video>')), [
    'media-captions',
  ]);
});

test("media-captions: an audio followed by a transcript link passes: next sibling, or the parent's", () => {
  assert.deepEqual(
    ids(
      run(auditMediaCaptions, '<audio controls src="/_astro/a.mp3"></audio> <a href="/podcast/">Transkript lesen</a>'),
    ),
    [],
  );
  assert.deepEqual(
    ids(
      run(
        auditMediaCaptions,
        '<figure><audio controls></audio><figcaption>Folge 1</figcaption></figure> <p><a href="/folge-1/">Zum Transkript</a></p>',
      ),
    ),
    [],
  );
  assert.deepEqual(
    ids(run(auditMediaCaptions, '<audio controls></audio> <p>Text: <a href="/folge-1-transcription/">Folge 1</a></p>')),
    [],
  );
});

test('media-captions: an audio without a transcript link after it fails', () => {
  assert.deepEqual(findings(run(auditMediaCaptions, '<audio controls></audio> <a href="/podcast/">Mehr hören</a>')), [
    'media-captions / <audio controls> is not followed by a transcript link',
  ]);
  assert.deepEqual(ids(run(auditMediaCaptions, '<p>Transkript</p> <audio controls></audio>')), ['media-captions']);
  assert.deepEqual(ids(run(auditMediaCaptions, '<audio controls></audio> <p><a>Transkript</a></p>')), [
    'media-captions',
  ]);
});

// media-pdf

const PDF = { site: { ...SITE, documents: { 'speisekarte.pdf': '/' } } };

test('media-pdf: a declared PDF that its page links passes', () => {
  assert.deepEqual(
    ids(
      runFiles(
        auditMediaPdf,
        withMain('<p><a href="/speisekarte.pdf">Speisekarte (PDF)</a></p>', { 'speisekarte.pdf': '%PDF' }),
        PDF,
      ),
    ),
    [],
  );
  assert.deepEqual(ids(runFiles(auditMediaPdf, site(OPTIONS))), []);
});

test('media-pdf: a PDF that is not declared fails at the file, in any folder and any extension case', () => {
  const report = runFiles(auditMediaPdf, withMain('', { 'docs/Karte.PDF': '%PDF', 'b.pdf': '%PDF' }));
  assert.deepEqual(findings(report), [
    'media-pdf /b.pdf not a key of site.json documents',
    'media-pdf /docs/Karte.PDF not a key of site.json documents',
  ]);
});

test('media-pdf: a PDF declared for a page that is not built, or that the page does not link, fails', () => {
  const unbuilt = { site: { ...SITE, documents: { 'speisekarte.pdf': '/restaurant/' } } };
  assert.deepEqual(findings(runFiles(auditMediaPdf, withMain('', { 'speisekarte.pdf': '%PDF' }), unbuilt)), [
    'media-pdf /speisekarte.pdf documents names /restaurant/, which is not a built page',
  ]);
  assert.deepEqual(
    findings(
      runFiles(auditMediaPdf, withMain('<p><a href="/karte.pdf">PDF</a></p>', { 'speisekarte.pdf': '%PDF' }), PDF),
    ),
    ['media-pdf /speisekarte.pdf the page / does not link it'],
  );
});

// svg-name

test('svg-name: a hidden svg, or an img svg with a label or a title, passes; an inner svg is not checked', () => {
  const main = [
    '<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"> <path d="M0 0"></path> <svg></svg> </svg>',
    '<svg role="img" aria-label="Karte"></svg>',
    '<svg role="img"><title>Karte des Fextals</title></svg>',
    '<svg aria-hidden=" TRUE "></svg>',
  ].join(' ');
  assert.deepEqual(ids(run(auditSvgName, main)), []);
  assert.deepEqual(ids(runFiles(auditSvgName, site(OPTIONS))), []);
});

test('svg-name: an outer svg that is neither hidden nor named fails once', () => {
  assert.deepEqual(findings(run(auditSvgName, '<svg viewBox="0 0 1 1"><svg></svg></svg>')), [
    'svg-name / <svg viewBox="0 0 1 1"> is not hidden and has no name',
  ]);
  for (const svg of [
    '<svg aria-hidden="false"></svg>',
    '<svg role="img"></svg>',
    '<svg role="img" aria-label=" "></svg>',
    '<svg role="img"><title> </title></svg>',
    '<svg role="presentation img" aria-label="Karte"></svg>',
    '<svg aria-label="Karte"></svg>',
  ]) {
    assert.deepEqual(ids(run(auditSvgName, svg)), ['svg-name'], svg);
  }
});

// Hostile input

const ASSET_RULES: readonly Rule[] = [
  auditImagesSrc,
  auditImagesAttrs,
  auditImagesFormat,
  auditImagesPriority,
  auditFontsLimit,
  auditMediaAnimated,
  auditMediaCaptions,
  auditMediaPdf,
  auditSvgName,
];

function hostileFiles(): Record<string, string | Uint8Array> {
  const deep = `${'<div>'.repeat(5000)}<svg><img src="/x.webp"><audio></audio>${'<svg>'.repeat(2000)}${'</svg>'.repeat(2001)}${'</div>'.repeat(5000)}`;
  const big = `${'<p><img src="/_astro/a.webp" srcset="/_astro/a.webp 1x,,,, /b.webp 2x" alt="" width="1" height="1"><audio></audio><svg></svg></p>'.repeat(15000)}`;
  const odd =
    '<img constructor="x" __proto__="y" src="\ud800\u0000" srcset="(((((((" alt><svg constructor="1" role="img"><title>\ud800</title></svg><video __proto__="1"><track constructor="x" kind="captions"></video><picture constructor="x"><source __proto__ type="image/avif"></picture>';
  const css = `${'@font-face{font-family:a'.repeat(2000)}${'@font-face{font-family:"\ud800";src:url(\u0000)}'.repeat(2000)}`;
  return {
    ...ICON_FILES,
    'index.html': page(OPTIONS, '/', { main: deep }),
    'big/index.html': page(OPTIONS, '/big/', { main: big }),
    'odd/index.html': page(OPTIONS, '/odd/', { main: odd, css }),
    'bytes/index.html': '\u0000\ud800<html \u0000><<<>>>&#xD800;',
    '_astro/a.gif': Uint8Array.from({ length: 100_000 }, (_, index) => (index < 6 ? 'GIF89a'.charCodeAt(index) : 0x21)),
    '_astro/b.png': bytesOf([0x89], 'PNG\r\n\x1a\n', be32(0xffffffff), 'IHDR'),
    '_astro/c.avif': bytesOf(be32(0), 'ftyp', 'avif'),
    'x.pdf': '%PDF',
  };
}

test('asset rules: a deep, a large and an odd page and broken files give a stable result fast and never throw', () => {
  const started = performance.now();
  const run1 = contextOf(hostileFiles(), { site: { ...SITE, documents: { 'x.pdf': '/odd/' } } });
  for (const rule of ASSET_RULES) rule(run1);
  const run2 = contextOf(hostileFiles(), { site: { ...SITE, documents: { 'x.pdf': '/odd/' } } });
  for (const rule of ASSET_RULES) rule(run2);
  assert.deepEqual(findings(run1.report), findings(run2.report));
  assert.ok(performance.now() - started < 20_000);
  assert.ok(findings(run1.report).includes('media-pdf /x.pdf the page /odd/ does not link it'));
  assert.ok(findings(run1.report).includes('images-src / src "/x.webp" of <img src="/x.webp">'));
});

// The fixture pages

test('asset rules: the fixture site gives no finding', () => {
  const ctx = contextOf(site(OPTIONS));
  for (const rule of ASSET_RULES) rule(ctx);
  assert.deepEqual(ids(ctx.report), []);
  assert.equal(fileOf('/fr/'), 'fr/index.html');
});

// Review cases of part 5b

test('media-captions reads only the track children of a video, as a browser does', () => {
  const track = '<track kind="captions" srclang="de" src="/_astro/a.vtt">';
  assert.deepEqual(ids(run(auditMediaCaptions, `<video controls>${track}</video>`)), []);
  assert.deepEqual(ids(run(auditMediaCaptions, `<video controls><div>${track}</div></video>`)), ['media-captions']);
});

test('media-captions: 20,000 nested videos take linear time', () => {
  const started = performance.now();
  const report = run(auditMediaCaptions, `${'<video>'.repeat(20_000)}${'</video>'.repeat(20_000)}`);
  assert.ok(performance.now() - started < 2_000);
  assert.equal(report.findings.length, 20_000);
});

test('svg-name: an svg in an aria-hidden wrapper, or with hidden, passes; one in a template is no svg of the page', () => {
  for (const main of [
    '<span aria-hidden="true"><svg viewBox="0 0 1 1"></svg></span>',
    '<span aria-hidden=" TRUE "><b><svg viewBox="0 0 1 1"></svg></b></span>',
    '<svg hidden viewBox="0 0 1 1"></svg>',
    '<div hidden><svg viewBox="0 0 1 1"></svg></div>',
    '<template><svg viewBox="0 0 1 1"></svg></template>',
  ]) {
    assert.deepEqual(ids(run(auditSvgName, main)), [], main);
  }
  assert.deepEqual(ids(run(auditSvgName, '<span aria-hidden="false"><svg viewBox="0 0 1 1"></svg></span>')), [
    'svg-name',
  ]);
});

test('the image rules and svg-name read the content of pre as markup', () => {
  assert.deepEqual(ids(run(auditImagesAttrs, '<pre><img src="/_astro/hero_3.webp"></pre>', IMAGES)), ['images-attrs']);
  assert.deepEqual(
    ids(run(auditImagesSrc, '<pre><img src="http://evil.example/x.png" alt="" width="1" height="1"></pre>')),
    ['images-src'],
  );
  assert.deepEqual(ids(run(auditSvgName, '<pre><svg><circle r="1"/></svg></pre>')), ['svg-name']);
  assert.deepEqual(ids(run(auditMediaCaptions, '<pre><video controls></video></pre>')), ['media-captions']);
});

test('fonts-limit reads rel as a token list: preload among other tokens, in any case, counts', () => {
  const preload = '<link rel="preload" as="font" href="/_astro/a.woff2" type="font/woff2" crossorigin>';
  for (const rel of ['preload prefetch', '  PRELOAD ']) {
    const second = preload.replace('rel="preload"', `rel="${rel}"`).replace('a.woff2', 'b.woff2');
    const files = { ...ICON_FILES, 'index.html': page(OPTIONS, '/', { head: `${preload}${second}` }) };
    assert.deepEqual(ids(runFiles(auditFontsLimit, files)), ['fonts-limit'], rel);
  }
});
