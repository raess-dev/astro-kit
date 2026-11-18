/**
 * The asset rules of the page audit (specification, section 8): `images-src`, `images-attrs`, `images-format`,
 * `images-priority`, `fonts-limit`, `media-animated`, `media-captions`, `media-pdf` and `svg-name`. Each function is
 * the built half of one rule. A finding on markup stands at the page path; a finding on a file (an animated image,
 * a PDF, a style sheet of `fonts-limit`) stands at the dist file, with a leading `/` (`/_astro/a.gif`).
 *
 * **Who reports what.**
 *
 * - `images-src` reports a source that is not an `/_astro/` file or an icon, and a file that is missing; the other
 *   image rules read the attributes only.
 * - `fonts-limit` holds for the site as a whole (Measurement details, Scopes): it reports each fact once, not once
 *   for each page. The bytes of the font files are `budget-fonts`'s.
 * - `media-pdf` reports a PDF of dist; a link to a PDF that is missing is `links-resolve`'s.
 */
import { type HTMLElement, NodeType } from 'node-html-parser';
import type { BuildContext, BuiltPage } from '../../context.ts';
import { asciiLower, type ComponentValue, parseCss, walk } from '../../css/parse.ts';
import { reportOnce, snippet } from '../../css/rules.ts';
import {
  accessibleName,
  attr,
  collapse,
  decodePath,
  descendantsOf,
  domOf,
  hasAttr,
  isHidden,
  linksOf,
  localeOf,
  type PageDom,
  pushAll,
  resolveHref,
  siteOf,
  tagOf,
  textOf,
  tokensOf,
} from '../dom.ts';
import { listed, startTag } from './shell.ts';

// Shared

/** ASCII white space of HTML. */
const isSpace = (char: string | undefined): boolean =>
  char === ' ' || char === '\t' || char === '\n' || char === '\f' || char === '\r';

/** One image candidate of a `srcset`: its URL and its descriptors (`640w`, `2x`). */
export interface SrcsetCandidate {
  url: string;
  descriptors: string[];
}

/**
 * The candidates of a `srcset` value, as HTML parses one ("parse a srcset attribute"), in one pass with no regex:
 * skip white space and commas; the URL runs to the next white space, and commas at its end end the candidate;
 * else the descriptors run to the next comma outside brackets. A URL may hold commas (`data:` URLs).
 */
export function srcsetCandidates(value: string): SrcsetCandidate[] {
  const out: SrcsetCandidate[] = [];
  let index = 0;
  while (index < value.length) {
    while (index < value.length && (isSpace(value[index]) || value[index] === ',')) index += 1;
    if (index >= value.length) break;
    const start = index;
    while (index < value.length && !isSpace(value[index])) index += 1;
    let url = value.slice(start, index);
    const descriptors: string[] = [];
    if (url.endsWith(',')) {
      let end = url.length;
      while (end > 0 && url[end - 1] === ',') end -= 1;
      url = url.slice(0, end);
    } else {
      let current = '';
      let inBrackets = false;
      for (; index < value.length; index += 1) {
        const char = value[index] ?? '';
        if (inBrackets) {
          current += char;
          if (char === ')') inBrackets = false;
        } else if (isSpace(char)) {
          if (current !== '') descriptors.push(current);
          current = '';
        } else if (char === ',') {
          index += 1;
          break;
        } else {
          current += char;
          if (char === '(') inBrackets = true;
        }
      }
      if (current !== '') descriptors.push(current);
    }
    if (url !== '') out.push({ url, descriptors });
  }
  return out;
}

/** Says whether a descriptor is a width descriptor: digits and a final `w` (`640w`). */
const isWidthDescriptor = (descriptor: string): boolean => /^\d+w$/.test(descriptor);

// images-src

const IMAGES_SRC = 'images-src';

/** The three icons of `head-icons`, which `public/` holds. */
const ICON_PATHS: ReadonlySet<string> = new Set(['/favicon.ico', '/icon.svg', '/apple-touch-icon.png']);

/** The folder of Astro's built assets. */
const ASSETS = '/_astro/';

/** The URLs of one attribute: a `srcset` gives its candidates, any other attribute its value trimmed. */
function urlsOf(name: string, value: string): string[] {
  return name === 'srcset' ? srcsetCandidates(value).map((candidate) => candidate.url) : [value.trim()];
}

/**
 * Says whether a source is one that `images-src` allows: a root-relative path (it starts with one `/`) to a file of
 * `/_astro/`, or one of the three icons, after dot segments are removed (`resolveHref`).
 */
function isAllowedSource(url: string, page: BuiltPage, host: string): boolean {
  if (!url.startsWith('/') || url.startsWith('//')) return false;
  const target = resolveHref(url, page.path, host);
  if (target.kind !== 'internal') return false;
  return (target.path.startsWith(ASSETS) && target.path.length > ASSETS.length) || ICON_PATHS.has(target.path);
}

/** The dist file of a same-origin URL, or `undefined` for another origin or a URL that names no file. */
function fileOf(url: string, page: BuiltPage, host: string): string | undefined {
  if (url === '') return undefined;
  const target = resolveHref(url, page.path, host);
  if (target.kind !== 'internal') return undefined;
  return target.path.slice(1);
}

/**
 * `images-src`: the `src` and `srcset` of every `img`, and the `srcset` of every `source`, name `/_astro/…` files
 * or the three icons: one finding for each element and attribute that names another source (an empty value, a
 * relative path, another origin, a `data:` URL). And the file of every `img` (`src`, `srcset`), `source` (`srcset`,
 * `src`) and `video[poster]` exists in dist, as written or percent-decoded: one finding for each missing file of a
 * page. Another origin has no file to look for.
 */
export function auditImagesSrc(ctx: BuildContext): void {
  const { files, host } = siteOf(ctx);
  const exists = (file: string): boolean => {
    const decoded = decodePath(file);
    return files.has(file) || (decoded !== undefined && files.has(decoded));
  };
  for (const page of ctx.pages) {
    const dom = domOf(page);
    const missing = new Set<string>();
    const look = (url: string): void => {
      const file = fileOf(url, page, host);
      if (file === undefined || exists(file) || missing.has(file)) return;
      missing.add(file);
      ctx.report.add(IMAGES_SRC, page.path, `the file /${snippet(file)} is missing`);
    };
    for (const element of dom.elements) {
      const tag = tagOf(element);
      if (tag === 'video') {
        const poster = attr(element, 'poster');
        if (poster !== undefined) look(poster.trim());
        continue;
      }
      if (tag !== 'img' && tag !== 'source') continue;
      const checked = tag === 'img' ? ['src', 'srcset'] : ['srcset'];
      for (const name of checked) {
        const value = attr(element, name);
        if (value === undefined) continue;
        const urls = urlsOf(name, value);
        const wrong = urls.length === 0 ? '' : urls.find((url) => !isAllowedSource(url, page, host));
        if (wrong !== undefined) {
          ctx.report.add(
            IMAGES_SRC,
            page.path,
            `${name} ${JSON.stringify(snippet(wrong))} of ${startTag(page, element)}`,
          );
        }
        for (const url of urls) look(url);
      }
      const src = tag === 'source' ? attr(element, 'src') : undefined;
      if (src !== undefined) look(src.trim());
    }
  }
}

// images-attrs

/** Says whether an attribute is there with a value that is not only white space. */
const filled = (element: HTMLElement, name: string): boolean => collapse(attr(element, name) ?? '') !== '';

/**
 * `images-attrs`: every `img` has a non-empty `width` and `height` and an `alt` attribute (an empty `alt` counts),
 * and every `source` whose `srcset` has a width descriptor (`640w`) has a non-empty `sizes`. One finding for each
 * element, naming what it lacks.
 */
export function auditImagesAttrs(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    const dom = domOf(page);
    for (const element of dom.elements) {
      const tag = tagOf(element);
      const lacks: string[] = [];
      if (tag === 'img') {
        if (!filled(element, 'width')) lacks.push('width');
        if (!filled(element, 'height')) lacks.push('height');
        if (!hasAttr(element, 'alt')) lacks.push('alt');
      } else if (tag === 'source') {
        const widths = srcsetCandidates(attr(element, 'srcset') ?? '').some((candidate) =>
          candidate.descriptors.some(isWidthDescriptor),
        );
        if (widths && !filled(element, 'sizes')) lacks.push('sizes');
      } else continue;
      if (lacks.length > 0)
        ctx.report.add('images-attrs', page.path, `${startTag(page, element)} lacks ${lacks.join(', ')}`);
    }
  }
}

// images-format

const PICTURE: ReadonlySet<string> = new Set(['picture']);

/** The path of a URL without its query and fragment. */
function pathPart(url: string): string {
  const end = url.search(/[?#]/);
  return end < 0 ? url : url.slice(0, end);
}

/**
 * `images-format`: every `picture` has at least one `source`, each with `type="image/avif"` (a MIME type compares
 * in ASCII lower case, trimmed), and an `img` whose `src` path ends in `.webp` (in any ASCII case). The `source` and
 * `img` elements are those of the picture, not of a picture inside it. One finding for each picture, naming every
 * problem.
 */
export function auditImagesFormat(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    const dom = domOf(page);
    for (const picture of dom.byTag('picture')) {
      const own = descendantsOf(picture, (element) => PICTURE.has(tagOf(element)));
      const sources = own.filter((element) => tagOf(element) === 'source');
      const img = own.find((element) => tagOf(element) === 'img');
      const problems: string[] = [];
      if (sources.length === 0) problems.push('no source');
      const other = sources.find((source) => asciiLower((attr(source, 'type') ?? '').trim()) !== 'image/avif');
      if (other !== undefined) problems.push(`a source that is not image/avif: ${startTag(page, other)}`);
      if (img === undefined) problems.push('no img');
      else if (!asciiLower(pathPart((attr(img, 'src') ?? '').trim())).endsWith('.webp')) {
        problems.push(`the img src is not a .webp file: ${startTag(page, img)}`);
      }
      if (problems.length > 0) ctx.report.add('images-format', page.path, listed(problems));
    }
  }
}

// images-priority

/**
 * `images-priority`: at most one `img` of a page has `fetchpriority="high"` (an enumerated attribute: ASCII
 * case-insensitive). One finding for each page with more.
 */
export function auditImagesPriority(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    const high = domOf(page)
      .byTag('img')
      .filter((img) => asciiLower(attr(img, 'fetchpriority') ?? '') === 'high');
    if (high.length > 1)
      ctx.report.add('images-priority', page.path, `${high.length} images with fetchpriority=high; at most 1`);
  }
}

// fonts-limit

const FONTS_LIMIT = 'fonts-limit';

/** The most families with `url()` faces (section 8). */
const MAX_FAMILIES = 2;

/** The family of a `font-family` value of `@font-face`: a string, or the names joined, in lower case. */
function familyOf(values: readonly ComponentValue[]): string {
  const parts: string[] = [];
  for (const value of values) {
    if (value.type === 'string' || value.type === 'ident') parts.push(value.value);
  }
  return collapse(parts.join(' ')).toLowerCase();
}

/** The URLs of the `url()` values of a `src` value: unquoted `url(x)` tokens and `url("x")` functions. */
function urlsOfSrc(values: readonly ComponentValue[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (value.type === 'url') out.push(value.value);
    else if (value.type === 'function' && value.name === 'url') {
      const text = value.args.find((arg) => arg.type === 'string');
      if (text?.type === 'string') out.push(text.value);
    }
  }
  return out;
}

/** One `@font-face` rule: its family (the last `font-family`) and the URLs of its `src`. */
interface Face {
  family: string;
  urls: string[];
}

function facesOf(text: string, where: string): Face[] {
  const faces: Face[] = [];
  walk(parseCss(text, where), (node) => {
    if (node.type !== 'at-rule' || node.name !== 'font-face' || node.block === undefined) return;
    let family = '';
    const urls: string[] = [];
    for (const child of node.block) {
      if (child.type !== 'declaration') continue;
      if (child.property === 'font-family') family = familyOf(child.value);
      if (child.property === 'src') pushAll(urls, urlsOfSrc(child.value));
    }
    faces.push({ family, urls });
  });
  return faces;
}

/**
 * `fonts-limit`, for the site as a whole (Measurement details, Scopes):
 *
 * - At most two families have a face with a `url()` in its `src` (a face with only `local()` is exempt). Families
 *   compare without quotes and in lower case. One finding for the site, at the sheet that brings the third family:
 *   the page path of a `<style>` or the path of a `.css` file (`/_astro/a.css`), in the order of `ctx.css`.
 * - Every `url()` of a face is same-origin: it resolves to the site (`resolveHref`, against the page of a `<style>`
 *   or the path of a file), and it is no `data:` URL. One finding for each such URL, at the first sheet that has it.
 * - A page has at most one `link[rel~=preload][as=font]` (`as` in ASCII lower case). One finding for each page with
 *   more.
 *
 * A sheet text that many pages share is read once, at its first place.
 */
export function auditFontsLimit(ctx: BuildContext): void {
  const { host } = siteOf(ctx);
  const add = reportOnce(ctx.report);
  const read = new Set<string>();
  const families: string[] = [];
  let third: string | undefined;
  for (const css of ctx.css) {
    if (read.has(css.text)) continue;
    read.add(css.text);
    for (const face of facesOf(css.text, css.where)) {
      if (face.urls.length === 0) continue;
      if (!families.includes(face.family)) {
        families.push(face.family);
        if (families.length === MAX_FAMILIES + 1) third = css.where;
      }
      for (const url of face.urls) {
        if (resolveHref(url, css.where, host).kind !== 'internal') {
          add(FONTS_LIMIT, css.where, `a font url() of another origin: ${JSON.stringify(snippet(url))}`);
        }
      }
    }
  }
  if (third !== undefined) {
    const names = families.map((family) => JSON.stringify(family)).join(', ');
    ctx.report.add(
      FONTS_LIMIT,
      third,
      snippet(`${families.length} font families with url() faces: ${names}; at most ${MAX_FAMILIES}`),
    );
  }
  for (const page of ctx.pages) {
    const preloads = domOf(page)
      .byTag('link')
      .filter((link) => tokensOf(link, 'rel').includes('preload') && asciiLower(attr(link, 'as') ?? '') === 'font');
    if (preloads.length > 1) ctx.report.add(FONTS_LIMIT, page.path, `${preloads.length} font preloads; at most 1`);
  }
}

// media-animated

/**
 * The files that `media-animated` does not read, by extension in lower case: pages, styles, scripts and the other
 * text files that Astro and the kit write. A browser picks the image decoder from the bytes, not from the name, so
 * every other file is read, whatever its extension (`.jpg`, `.ico`) or none.
 */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.html',
  '.htm',
  '.css',
  '.js',
  '.mjs',
  '.cjs',
  '.map',
  '.json',
  '.txt',
  '.xml',
  '.svg',
  '.webmanifest',
]);

const extensionOf = (file: string): string => {
  const dot = file.lastIndexOf('.');
  return dot < 0 || dot < file.lastIndexOf('/') ? '' : file.slice(dot).toLowerCase();
};

/** The ASCII text of a byte range, or `''` when the range leaves the data. */
function ascii(bytes: Uint8Array, at: number, length: number): string {
  if (at < 0 || at + length > bytes.length) return '';
  let out = '';
  for (let index = at; index < at + length; index += 1) out += String.fromCharCode(bytes[index] ?? 0);
  return out;
}

const u32be = (bytes: Uint8Array, at: number): number =>
  (bytes[at] ?? 0) * 0x1000000 + ((bytes[at + 1] ?? 0) << 16) + ((bytes[at + 2] ?? 0) << 8) + (bytes[at + 3] ?? 0);
const u32le = (bytes: Uint8Array, at: number): number =>
  (bytes[at] ?? 0) + ((bytes[at + 1] ?? 0) << 8) + ((bytes[at + 2] ?? 0) << 16) + (bytes[at + 3] ?? 0) * 0x1000000;

/**
 * The number of whole frames of a GIF: image descriptors whose data ends inside the file. It reads the blocks of
 * the GIF 89a grammar: the header, the logical screen with its color table, then extensions, images and the
 * trailer. A truncated or broken file stops the count, so its last frame does not count.
 */
export function gifFrames(bytes: Uint8Array): number {
  const header = ascii(bytes, 0, 6);
  if (header !== 'GIF87a' && header !== 'GIF89a') return 0;
  const table = (packed: number): number => ((packed & 0x80) !== 0 ? 3 * 2 ** ((packed & 0x07) + 1) : 0);
  let at = 13 + table(bytes[10] ?? 0);
  /** The index after a list of data sub-blocks, or -1 when the file ends first. */
  const skipBlocks = (from: number): number => {
    let index = from;
    for (;;) {
      if (index >= bytes.length) return -1;
      const size = bytes[index] ?? 0;
      index += 1;
      if (size === 0) return index;
      index += size;
    }
  };
  let frames = 0;
  while (at < bytes.length) {
    const introducer = bytes[at];
    if (introducer === 0x21) {
      at = skipBlocks(at + 2);
    } else if (introducer === 0x2c) {
      if (at + 10 > bytes.length) break;
      at = skipBlocks(at + 10 + table(bytes[at + 9] ?? 0) + 1);
      if (at < 0) break;
      frames += 1;
    } else break;
    if (at < 0) break;
  }
  return frames;
}

/** Says whether a PNG is an APNG: an `acTL` chunk before the first `IDAT`. */
export function isApng(bytes: Uint8Array): boolean {
  if (ascii(bytes, 0, 8) !== '\x89PNG\r\n\x1a\n') return false;
  let at = 8;
  while (at + 8 <= bytes.length) {
    const type = ascii(bytes, at + 4, 4);
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    at += 12 + u32be(bytes, at);
  }
  return false;
}

/** Says whether a WebP file has an `ANIM` chunk: the RIFF chunks after `WEBP`, each padded to an even size. */
export function isAnimatedWebp(bytes: Uint8Array): boolean {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return false;
  let at = 12;
  while (at + 8 <= bytes.length) {
    if (ascii(bytes, at, 4) === 'ANIM') return true;
    const size = u32le(bytes, at + 4);
    at += 8 + size + (size % 2);
  }
  return false;
}

/** Says whether an AVIF file names the brand `avis` (an image sequence) in its `ftyp` box. */
export function isAvifSequence(bytes: Uint8Array): boolean {
  if (ascii(bytes, 4, 4) !== 'ftyp') return false;
  let size = u32be(bytes, 0);
  let body = 8;
  if (size === 1) {
    // A 64-bit size: a box this large is no ftyp box of a real file; read what the file holds.
    size = bytes.length;
    body = 16;
  } else if (size === 0) size = bytes.length;
  const end = Math.min(size, bytes.length);
  if (ascii(bytes, body, 4) === 'avis') return true;
  for (let at = body + 8; at + 4 <= end; at += 4) if (ascii(bytes, at, 4) === 'avis') return true;
  return false;
}

/** Says whether image bytes animate, by their signature, whatever the extension says. */
export function isAnimated(bytes: Uint8Array): boolean {
  return gifFrames(bytes) > 1 || isApng(bytes) || isAnimatedWebp(bytes) || isAvifSequence(bytes);
}

/**
 * `media-animated`: no dist file is animated: a GIF with more than one frame, an APNG (`acTL` before `IDAT`), a WebP
 * with an `ANIM` chunk, or an AVIF with the brand `avis`. The format comes from the bytes, not from the name: every
 * file is read but the text files of `TEXT_EXTENSIONS`, so an animated GIF named `og.jpg`, `favicon.ico` or with no
 * extension is found. Every read is bounded by the length of the file: a truncated file is no animation. One finding
 * for each file.
 */
export function auditMediaAnimated(ctx: BuildContext): void {
  for (const file of ctx.files) {
    if (TEXT_EXTENSIONS.has(extensionOf(file))) continue;
    const bytes = ctx.read(file);
    if (bytes !== undefined && isAnimated(bytes)) ctx.report.add('media-animated', `/${file}`, 'an animated image');
  }
}

// media-captions

const MEDIA_CAPTIONS = 'media-captions';

/** The link text or address that names a transcript (section 8). */
const TRANSCRIPT = /transcript|transkript|transcription|trascrizione/i;

/** The most elements that the search for a transcript link reads in one sibling. */
const MAX_SIBLING_ELEMENTS = 256;

const ELEMENT_CHILDREN = new WeakMap<HTMLElement, { list: HTMLElement[]; index: Map<HTMLElement, number> }>();

/** The next element sibling of an element, found through a table of its parent's children, built once. */
function nextElementOf(element: HTMLElement): HTMLElement | undefined {
  const parent = element.parentNode;
  if (parent === null) return undefined;
  let children = ELEMENT_CHILDREN.get(parent);
  if (children === undefined) {
    const list = parent.childNodes.filter((node): node is HTMLElement => node.nodeType === NodeType.ELEMENT_NODE);
    children = { list, index: new Map(list.map((child, index) => [child, index])) };
    ELEMENT_CHILDREN.set(parent, children);
  }
  const at = children.index.get(element);
  return at === undefined ? undefined : children.list[at + 1];
}

/** The element and its first descendants, in document order, at most `MAX_SIBLING_ELEMENTS`, without recursion. */
function nearElements(element: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [element];
  const stack = [...element.childNodes].reverse();
  for (let node = stack.pop(); node !== undefined && out.length < MAX_SIBLING_ELEMENTS; node = stack.pop()) {
    if (node.nodeType !== NodeType.ELEMENT_NODE) continue;
    const child = node as HTMLElement;
    out.push(child);
    for (let index = child.childNodes.length - 1; index >= 0; index -= 1) {
      const next = child.childNodes[index];
      if (next !== undefined) stack.push(next);
    }
  }
  return out;
}

/** Says whether an element is, or holds, a link whose accessible name or `href` names a transcript. */
function holdsTranscript(dom: PageDom, element: HTMLElement): boolean {
  return nearElements(element).some((candidate) => {
    const tag = tagOf(candidate);
    if ((tag !== 'a' && tag !== 'area') || !hasAttr(candidate, 'href')) return false;
    return TRANSCRIPT.test(accessibleName(dom, candidate)) || TRANSCRIPT.test(attr(candidate, 'href') ?? '');
  });
}

/**
 * `media-captions`:
 *
 * - Every `video` has a `track` child with `kind="captions"` whose `srclang` is the tag or the code of the page's
 *   locale. A browser reads only the `track` children of a media element, so a `track` deeper down does not count.
 *   `kind` and `srclang` compare in ASCII lower case, as a browser reads an enumerated attribute and BCP 47 a tag.
 * - Every `audio` is followed by a transcript link: its next element sibling, or the next element sibling of its
 *   parent, is or holds an `a[href]` or `area[href]` whose accessible name or `href` matches
 *   `/transcript|transkript|transcription|trascrizione/i`.
 *
 * One finding for each `video` or `audio` that fails.
 */
export function auditMediaCaptions(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    const dom = domOf(page);
    const locale = localeOf(ctx.options, page.locale);
    const langs = new Set([locale?.tag, locale?.code].filter((lang) => lang !== undefined).map(asciiLower));
    for (const video of dom.byTag('video')) {
      const captions = video.childNodes.some(
        (track) =>
          track.nodeType === NodeType.ELEMENT_NODE &&
          tagOf(track as HTMLElement) === 'track' &&
          asciiLower(attr(track as HTMLElement, 'kind') ?? '') === 'captions' &&
          langs.has(asciiLower(attr(track as HTMLElement, 'srclang') ?? '')),
      );
      if (!captions)
        ctx.report.add(
          MEDIA_CAPTIONS,
          page.path,
          `${startTag(page, video)} has no captions track in ${[...langs].join(' or ')}`,
        );
    }
    for (const audio of dom.byTag('audio')) {
      const parent = audio.parentNode;
      const candidates = [nextElementOf(audio), parent === null ? undefined : nextElementOf(parent)];
      if (!candidates.some((candidate) => candidate !== undefined && holdsTranscript(dom, candidate))) {
        ctx.report.add(MEDIA_CAPTIONS, page.path, `${startTag(page, audio)} is not followed by a transcript link`);
      }
    }
  }
}

// media-pdf

/**
 * `media-pdf`: every `.pdf` file of dist (any folder, the extension in any case) is a key of `site.json`
 * `documents` (the dist path without a leading `/`, exactly), its value is the path of a built page, and that page
 * links the PDF: a same-origin link whose path is `/` and the key, as written or percent-decoded. One finding for
 * each PDF that fails, at `/` and its path.
 */
export function auditMediaPdf(ctx: BuildContext): void {
  const { pages } = siteOf(ctx);
  const documents = new Map(Object.entries(ctx.facts.site.documents));
  for (const file of ctx.files) {
    if (extensionOf(file) !== '.pdf') continue;
    const where = `/${file}`;
    const path = documents.get(file);
    if (path === undefined) {
      ctx.report.add('media-pdf', where, 'not a key of site.json documents');
      continue;
    }
    const page = pages.get(path);
    if (page === undefined) {
      ctx.report.add('media-pdf', where, `documents names ${snippet(path)}, which is not a built page`);
      continue;
    }
    const linked = linksOf(ctx, page).some(
      ({ target }) => target.kind === 'internal' && (target.path === where || decodePath(target.path) === where),
    );
    if (!linked) ctx.report.add('media-pdf', where, `the page ${path} does not link it`);
  }
}

// svg-name

/**
 * `svg-name`: every outer inline `svg` (one with no `svg` ancestor) is hidden, or has `role="img"` (its first role
 * token) with a non-empty `aria-label` or a child `title` with text. Hidden means that the `svg` or an ancestor has
 * `aria-hidden="true"` (ASCII case-insensitive, trimmed) or the `hidden` attribute (`isHidden`): a browser exposes
 * none of it. One finding for each such `svg` that is neither. The outer `svg` elements are found in one pass: an
 * `svg` inside one already read is skipped with its subtree. Hidden elements are found in one pass in document
 * order, where a parent comes before its children.
 */
export function auditSvgName(ctx: BuildContext): void {
  for (const page of ctx.pages) {
    const dom = domOf(page);
    const hidden = new Set<HTMLElement>();
    for (const element of dom.elements) {
      const parent = element.parentNode;
      if (isHidden(element) || (parent !== null && hidden.has(parent))) hidden.add(element);
    }
    const inner = new Set<HTMLElement>();
    for (const svg of dom.byTag('svg')) {
      if (inner.has(svg)) continue;
      for (const element of descendantsOf(svg)) if (tagOf(element) === 'svg') inner.add(element);
      if (hidden.has(svg)) continue;
      if (tokensOf(svg, 'role')[0] === 'img') {
        if (collapse(attr(svg, 'aria-label') ?? '') !== '') continue;
        const title = svg.childNodes.find(
          (node) => node.nodeType === NodeType.ELEMENT_NODE && tagOf(node as HTMLElement) === 'title',
        );
        if (title !== undefined && collapse(textOf(title as HTMLElement)) !== '') continue;
      }
      ctx.report.add('svg-name', page.path, `${startTag(page, svg)} is not hidden and has no name`);
    }
  }
}
