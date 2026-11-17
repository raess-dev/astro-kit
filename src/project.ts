/**
 * The checks on the files of a project: `package.json`, the sources under `src/`, the files under `public/` and the
 * image originals (specification, section 8). Each exported check is one rule. A check adds every finding to the
 * report: it never stops at the first one, and it never throws for a finding.
 */
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fieldPlace, LIMITS, type Limits, type Options, readJson } from './options.ts';
import type { Report } from './registry.ts';

// Files and folders

/**
 * The folder names that Biome never checks under the kit preset (12.2), at any depth. A file under `src/` or
 * `public/` that lies in such a folder is a finding of `config-suppression`.
 */
export const UNCHECKED_FOLDERS: readonly string[] = ['node_modules', 'dist', '.astro', '.wrangler'];

/** The two folders that the checks of this module walk. */
export const WALKED_FOLDERS: readonly string[] = ['src', 'public'];

/** The largest file that Biome checks: its default `files.maxSize`. The source checks read no larger file. */
export const SOURCE_MAX_BYTES = 1_048_576;

/** One file of the project. */
export interface ProjectFile {
  /** The path from the root, with `/` between the parts: `src/pages/index.astro`. */
  path: string;
  /** The path on disk. */
  file: string;
  /** False for a symbolic link to a file outside the root. No check reads such a file. */
  inside: boolean;
}

/** What the walk of one folder found. Each list is sorted. */
export interface Walk {
  files: ProjectFile[];
  /**
   * The places that Biome does not check: a folder with a name of `UNCHECKED_FOLDERS` (with a final `/`), or a
   * symbolic link that leads into such a folder. The walk names the topmost place only, not what lies below it.
   */
  unchecked: string[];
  /** The symbolic links whose target lies outside the root. The walk does not follow them. */
  outside: string[];
}

type Kind = 'file' | 'folder' | 'none';

const byText = (a: string, b: string): number => {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

/** The path with every symbolic link resolved, or `undefined` when nothing is there. */
function realPath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

/** Says what the path names. A symbolic link counts as its target. */
function kindOf(path: string): Kind {
  try {
    const stats = statSync(path);
    if (stats.isDirectory()) return 'folder';
    return stats.isFile() ? 'file' : 'none';
  } catch {
    return 'none';
  }
}

const isWithin = (base: string, path: string): boolean =>
  path === base || path.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);

/** A folder of the project that a check may read: it exists, and it lies inside the root. */
interface Folder {
  /** The real path of the folder. */
  real: string;
  /** The names in the folder, sorted. */
  names: string[];
}

function openFolder(root: string, path: string): Folder | undefined {
  const base = realPath(root);
  const real = realPath(join(root, path));
  if (base === undefined || real === undefined || !isWithin(base, real) || kindOf(real) !== 'folder') return undefined;
  return { real, names: readdirSync(real).sort(byText) };
}

/**
 * Walks one folder of the project. No folder name is skipped. The walk follows a symbolic link only while the target
 * lies inside the root, and it never walks a folder that it is already in. A link to a file outside the root is
 * listed with `inside: false`, so that a check on file names still sees it.
 */
export function walk(root: string, folder: string): Walk {
  const found: Walk = { files: [], unchecked: [], outside: [] };
  const base = realPath(root);
  if (base === undefined || kindOf(join(root, folder)) !== 'folder') return found;
  const isUnchecked = (real: string): boolean =>
    relative(base, real)
      .split(sep)
      .some((part) => UNCHECKED_FOLDERS.includes(part));
  /** `flagged` says that a folder above this path is already in `unchecked`. */
  const visit = (path: string, trail: readonly string[], flagged: boolean): void => {
    const file = join(root, path);
    const real = realPath(file);
    const kind = real === undefined ? 'none' : kindOf(real);
    if (real === undefined || kind === 'none') return;
    if (!isWithin(base, real)) {
      found.outside.push(path);
      if (kind === 'file') found.files.push({ path, file, inside: false });
      return;
    }
    // A file with such a name is no folder: only the folders above it count.
    const unchecked = !flagged && isUnchecked(kind === 'file' ? dirname(real) : real);
    if (unchecked) found.unchecked.push(kind === 'folder' ? `${path}/` : path);
    if (kind === 'file') {
      found.files.push({ path, file, inside: true });
      return;
    }
    if (trail.includes(real)) return;
    for (const name of readdirSync(real)) visit(`${path}/${name}`, [...trail, real], flagged || unchecked);
  };
  visit(folder, [], false);
  found.files.sort((a, b) => byText(a.path, b.path));
  found.unchecked.sort(byText);
  found.outside.sort(byText);
  return found;
}

/** Lists every file under one folder of the project, sorted by path. See `walk`. */
export function listFiles(root: string, folder: string): ProjectFile[] {
  return walk(root, folder).files;
}

const hasExtension = (path: string, extensions: readonly string[]): boolean => extensions.includes(extname(path));

/** One source file. `text` is `undefined` for a file of more than `SOURCE_MAX_BYTES`, which no check reads. */
interface Source {
  path: string;
  bytes: number;
  text: string | undefined;
}

/** The files under `src/` with one of the extensions, one at a time. A link to a file outside the root is left out. */
function* sources(root: string, extensions: readonly string[]): Generator<Source> {
  for (const file of listFiles(root, 'src')) {
    if (!file.inside || !hasExtension(file.path, extensions)) continue;
    const bytes = statSync(file.file).size;
    yield { path: file.path, bytes, text: bytes > SOURCE_MAX_BYTES ? undefined : readFileSync(file.file, 'utf8') };
  }
}

interface Hit {
  /** The line of the match, from 1. */
  line: number;
  match: RegExpExecArray;
}

/** Every match of a global pattern in a text, with its line. `offset` moves the place inside the match. */
function hits(text: string, pattern: RegExp, offset: (match: RegExpExecArray) => number = () => 0): Hit[] {
  return [...text.matchAll(pattern)].map((match) => ({
    line: text.slice(0, match.index + offset(match)).split('\n').length,
    match,
  }));
}

// package.json

export const PACKAGE_FILE = 'package.json';

/** The npm name of the kit. */
export const KIT_PACKAGE = '@raess/astro-kit';

/**
 * A dependency spec of the npm registry: a version, a range or a tag (section 8, `config-dep-spec`). Every other
 * form has a `:`, a `/`, a `#` or an `@`, starts with a dot, or ends like an archive, so it does not match: a git or
 * URL spec, a file or a link, a GitHub shorthand and an alias.
 */
export const REGISTRY_SPEC = /^(?!\.)(?!.*\.(tgz|tar|tar\.gz)$)[\w.*~^<>=|+ -]*$/i;

/** The sections of `package.json` that `config-dep-spec` reads. */
export const DEP_SPEC_SECTIONS: readonly string[] = ['dependencies', 'devDependencies', 'optionalDependencies'];

/** The sections that `config-dep-allowlist` reads: every section that makes npm install a package. */
export const DEP_ALLOWLIST_SECTIONS: readonly string[] = [...DEP_SPEC_SECTIONS, 'peerDependencies'];

/** The packages that every site may depend on. */
export const BASE_DEPENDENCIES: readonly string[] = ['astro', KIT_PACKAGE, 'wrangler'];

/** The packages that a site may depend on with `features.forms`. */
export const FORMS_DEPENDENCIES: readonly string[] = ['@astrojs/cloudflare'];

/** The packages that a site may depend on with `features.islands`. */
export const ISLANDS_DEPENDENCIES: readonly string[] = [
  '@astrojs/solid-js',
  'solid-js',
  'eslint',
  'eslint-plugin-solid',
  'typescript-eslint',
];

/** The package names that the site may depend on: the kit's list for its features, plus `dependencies`. */
export function allowedDependencies(options: Pick<Options, 'features' | 'dependencies'>): string[] {
  return [
    ...BASE_DEPENDENCIES,
    ...(options.features.forms ? FORMS_DEPENDENCIES : []),
    ...(options.features.islands ? ISLANDS_DEPENDENCIES : []),
    ...options.dependencies,
  ];
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type PackageFile = { state: 'ok'; value: Json } | { state: 'missing' } | { state: 'invalid'; message: string };

function readPackage(root: string): PackageFile {
  const read = readJson(root, PACKAGE_FILE);
  if (read.state === 'missing') return read;
  if (read.state === 'invalid') return { state: 'invalid', message: `the file is not valid JSON: ${read.message}` };
  if (!isRecord(read.value)) return { state: 'invalid', message: 'the file must hold a JSON object' };
  return { state: 'ok', value: read.value };
}

/** The entries of one dependency section, in the order of the file. */
function dependenciesOf(pkg: Json, section: string): [name: string, spec: unknown][] {
  const value = pkg[section];
  return isRecord(value) ? Object.entries(value) : [];
}

/** `config-overrides`: `package.json` has no `overrides` and no `resolutions`, not even an empty one. */
export function checkOverrides(root: string, report: Report): void {
  const pkg = readPackage(root);
  if (pkg.state !== 'ok') return;
  for (const key of ['overrides', 'resolutions']) {
    if (Object.hasOwn(pkg.value, key)) report.add('config-overrides', fieldPlace(PACKAGE_FILE, [key]));
  }
}

/**
 * `config-dep-spec`: every dependency other than the kit has a spec that matches `REGISTRY_SPEC`. The check trims
 * the spec first, as npm does.
 */
export function checkDepSpecs(root: string, report: Report): void {
  const pkg = readPackage(root);
  if (pkg.state !== 'ok') return;
  for (const section of DEP_SPEC_SECTIONS) {
    for (const [name, spec] of dependenciesOf(pkg.value, section)) {
      if (name === KIT_PACKAGE) continue;
      const place = fieldPlace(PACKAGE_FILE, [section, name]);
      if (typeof spec !== 'string') report.add('config-dep-spec', place, 'the version is not a string');
      else if (!REGISTRY_SPEC.test(spec.trim())) report.add('config-dep-spec', place, spec);
    }
  }
}

/**
 * `config-dep-allowlist`: every dependency is on the list of `allowedDependencies`. This check also reports a
 * `package.json` that it cannot read, because then nothing says which packages npm installs.
 */
export function checkDepAllowlist(
  root: string,
  options: Pick<Options, 'features' | 'dependencies'>,
  report: Report,
): void {
  const pkg = readPackage(root);
  if (pkg.state === 'missing') return;
  if (pkg.state === 'invalid') {
    report.add('config-dep-allowlist', PACKAGE_FILE, pkg.message);
    return;
  }
  const allowed = allowedDependencies(options);
  for (const section of DEP_ALLOWLIST_SECTIONS) {
    if (Object.hasOwn(pkg.value, section) && !isRecord(pkg.value[section])) {
      report.add('config-dep-allowlist', fieldPlace(PACKAGE_FILE, [section]), 'the section must be an object');
    }
    for (const [name] of dependenciesOf(pkg.value, section)) {
      if (allowed.includes(name)) continue;
      const place = fieldPlace(PACKAGE_FILE, [section, name]);
      if (FORMS_DEPENDENCIES.includes(name)) report.add('config-dep-allowlist', place, 'only with features.forms');
      else if (ISLANDS_DEPENDENCIES.includes(name)) {
        report.add('config-dep-allowlist', place, 'only with features.islands');
      } else report.add('config-dep-allowlist', place);
    }
  }
}

// Sources

/** The extensions of the files under `src/` that `config-imports` reads. */
export const IMPORT_EXTENSIONS: readonly string[] = [
  '.astro',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.jsx',
  '.mts',
  '.cts',
  '.cjs',
];

/** The files that `config-suppression` reads. */
export const SUPPRESSION_EXTENSIONS: readonly string[] = [...IMPORT_EXTENSIONS, '.css', '.md', '.mdx'];

/** What may stand between two tokens of an import: white space, a block comment or a line comment. */
const GAP = String.raw`(?:\s|\/\*(?:[^*]|\*(?!\/))*\*\/|\/\/[^\n]*)*`;

/** A static import, a re-export, a dynamic import or a `require` of `astro:transitions` or its client module. */
const TRANSITIONS_IMPORT = new RegExp(
  String.raw`\b(?:from|import|require)${GAP}(?:\(${GAP})?(['"\x60])(astro:transitions(?:\/client)?)\1`,
  'g',
);

/**
 * The four comments that switch a check of Biome or TypeScript off, in any letter case: TypeScript reads
 * `@ts-nocheck` in any case.
 */
const SUPPRESSION = /biome-ignore|@ts-ignore|@ts-expect-error|@ts-nocheck/gi;

const SERVER_DEFER = /\bserver:defer\b/g;

/** The names at the top of `src/` that make Astro load server code: as a folder, or as a file with an extension. */
const SERVER_NAMES: readonly string[] = ['middleware', 'actions'];

/** `config-imports`: no source imports `astro:transitions` or `astro:transitions/client`. */
export function checkImports(root: string, report: Report): void {
  const specifier = (match: RegExpExecArray): number => match[0].lastIndexOf(match[2] ?? '');
  for (const source of sources(root, IMPORT_EXTENSIONS)) {
    for (const hit of hits(source.text ?? '', TRANSITIONS_IMPORT, specifier)) {
      report.add('config-imports', `${source.path}:${hit.line}`, hit.match[2]);
    }
  }
}

/**
 * `config-suppression`: nothing takes a file out of the checks. No source holds a comment that switches a check off,
 * and no source is larger than Biome reads. No file under `src/` or `public/` lies in a folder that Biome skips, and
 * no symbolic link there leads out of the project.
 */
export function checkSuppression(root: string, report: Report): void {
  for (const source of sources(root, SUPPRESSION_EXTENSIONS)) {
    if (source.text === undefined) {
      const detail = `${source.bytes} B; Biome checks a file of at most ${SOURCE_MAX_BYTES} B`;
      report.add('config-suppression', source.path, detail);
      continue;
    }
    for (const hit of hits(source.text, SUPPRESSION)) {
      report.add('config-suppression', `${source.path}:${hit.line}`, hit.match[0]);
    }
  }
  const walks = WALKED_FOLDERS.map((folder) => walk(root, folder));
  for (const place of walks.flatMap((found) => found.unchecked)) {
    const names = UNCHECKED_FOLDERS.join(', ');
    report.add('config-suppression', place, `Biome skips every folder with one of these names: ${names}`);
  }
  for (const place of walks.flatMap((found) => found.outside)) {
    report.add('config-suppression', place, 'the link leads out of the project, so no check reads its target');
  }
}

/**
 * `config-server`: the project has no server code of its own. It has no `src/middleware.*` file and no
 * `src/middleware/` folder, no `src/actions/` folder and no `src/actions.*` file, and no `server:defer` in a `.astro`
 * file under `src/`.
 */
export function checkServer(root: string, report: Report): void {
  for (const name of openFolder(root, 'src')?.names ?? []) {
    const stem = SERVER_NAMES.find((entry) => name === entry || name.startsWith(`${entry}.`));
    if (stem === undefined) continue;
    const kind = kindOf(join(root, 'src', name));
    if (name === stem && kind === 'folder') report.add('config-server', `src/${name}/`);
    if (name !== stem && kind === 'file') report.add('config-server', `src/${name}`);
  }
  for (const source of sources(root, ['.astro'])) {
    for (const hit of hits(source.text ?? '', SERVER_DEFER)) {
      report.add('config-server', `${source.path}:${hit.line}`, hit.match[0]);
    }
  }
}

// public/

/** The paths under `public/` that would replace a file that the kit writes into the output. */
export const PUBLIC_SHADOWS: readonly string[] = [
  'robots.txt',
  '_headers',
  '_redirects',
  '.well-known/security.txt',
  '_kit',
];

/** `sitemap*.xml`, as a name at the top of `public/`. */
export const PUBLIC_SITEMAP = /^sitemap.*\.xml$/;

/** The extensions of a raster image, in lower case. */
export const RASTER_EXTENSIONS: readonly string[] = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.tif',
  '.tiff',
];

/** The files at the top of `public/` that `images-public` allows. */
export const PUBLIC_RASTER_ALLOWED: readonly string[] = ['favicon.ico', 'apple-touch-icon.png', 'og.png', 'og.jpg'];

/** Says whether the path names a raster image. The letter case of the extension does not count. */
export const isRaster = (path: string): boolean => RASTER_EXTENSIONS.includes(extname(path).toLowerCase());

/**
 * `config-public-shadow`: `public/` holds none of `robots.txt`, `_headers`, `_redirects`,
 * `.well-known/security.txt`, `_kit` and `sitemap*.xml`. Each of them names a path at the top of `public/`.
 */
export function checkPublicShadow(root: string, report: Report): void {
  const folder = openFolder(root, 'public');
  if (folder === undefined) return;
  for (const path of PUBLIC_SHADOWS) {
    if (existsSync(join(folder.real, path))) report.add('config-public-shadow', `public/${path}`);
  }
  for (const name of folder.names) {
    if (PUBLIC_SITEMAP.test(name)) report.add('config-public-shadow', `public/${name}`);
  }
}

/** `images-public`: `public/` holds no raster file except the four allowed files at its top. */
export function checkPublicImages(root: string, report: Report): void {
  for (const file of listFiles(root, 'public')) {
    if (!isRaster(file.path) || PUBLIC_RASTER_ALLOWED.includes(file.path.slice('public/'.length))) continue;
    report.add('images-public', file.path);
  }
}

// Image originals

export interface ImageSize {
  width: number;
  height: number;
}

/** The raster extensions whose files carry one of the four headers that the kit reads. */
export const HEADER_EXTENSIONS: readonly string[] = ['.png', '.gif', '.webp', '.jpg', '.jpeg'];

/** Returns up to `length` bytes from `position`. It returns fewer bytes at the end of the data. */
type ReadAt = (position: number, length: number) => Uint8Array;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const viewOf = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const textAt = (bytes: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(start, start + length));

/** PNG: the IHDR chunk is the first chunk. It holds the width and the height as 32-bit numbers. */
function pngSize(head: Uint8Array): ImageSize | undefined {
  if (head.length < 24 || !PNG_SIGNATURE.every((byte, index) => head[index] === byte)) return undefined;
  if (textAt(head, 12, 4) !== 'IHDR') return undefined;
  const view = viewOf(head);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** GIF: the logical screen size follows the six signature bytes. */
function gifSize(head: Uint8Array): ImageSize | undefined {
  const signature = textAt(head, 0, 6);
  if (head.length < 10 || (signature !== 'GIF87a' && signature !== 'GIF89a')) return undefined;
  const view = viewOf(head);
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

/** WebP: the first chunk of the RIFF file is `VP8 ` (lossy), `VP8L` (lossless) or `VP8X` (extended). */
function webpSize(head: Uint8Array): ImageSize | undefined {
  if (head.length < 30 || textAt(head, 0, 4) !== 'RIFF' || textAt(head, 8, 4) !== 'WEBP') return undefined;
  const view = viewOf(head);
  const chunk = textAt(head, 12, 4);
  if (chunk === 'VP8 ') {
    // Three bytes of frame tag, the start code 9D 01 2A, then two 14-bit sizes with two scale bits each.
    if (head[23] !== 0x9d || head[24] !== 0x01 || head[25] !== 0x2a) return undefined;
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    // The signature byte 2F, then 14 bits of width minus one and 14 bits of height minus one.
    if (head[20] !== 0x2f) return undefined;
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    // Four bytes of flags, then the canvas width minus one and the canvas height minus one, 24 bits each.
    const width = view.getUint16(24, true) + view.getUint8(26) * 0x10000;
    const height = view.getUint16(27, true) + view.getUint8(29) * 0x10000;
    return { width: width + 1, height: height + 1 };
  }
  return undefined;
}

/** A start-of-frame marker: C0 to CF without C4 (Huffman tables), C8 (reserved) and CC (arithmetic conditioning). */
const isFrameMarker = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

/** A marker that has no length field: TEM, a restart marker or a second start of image. */
const isBareMarker = (marker: number): boolean => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8);

/**
 * The most markers and fill bytes that the reader passes before the frame header. A real file has far fewer, and
 * the limit keeps the work small for a file that is made to be slow.
 */
export const JPEG_MAX_STEPS = 4_096;

/**
 * JPEG: the reader goes from segment to segment until the frame header. It never searches the bytes for a marker,
 * because a segment such as Exif can hold a preview image with a frame header of its own.
 */
function jpegSize(read: ReadAt): ImageSize | undefined {
  let position = 2;
  for (let step = 0; step < JPEG_MAX_STEPS; step += 1) {
    const header = read(position, 4);
    const marker = header[1];
    if (header[0] !== 0xff || marker === undefined) return undefined;
    if (marker === 0xff) {
      // A fill byte before the marker.
      position += 1;
      continue;
    }
    if (isBareMarker(marker)) {
      position += 2;
      continue;
    }
    // The end of the image, or the start of the scan: this file has no frame header before its data.
    if (marker === 0xd9 || marker === 0xda || header.length < 4) return undefined;
    const length = viewOf(header).getUint16(2);
    if (length < 2) return undefined;
    if (isFrameMarker(marker)) {
      // One byte of precision, then the height and the width.
      const frame = read(position + 4, 5);
      if (frame.length < 5) return undefined;
      const view = viewOf(frame);
      return { width: view.getUint16(3), height: view.getUint16(1) };
    }
    position += 2 + length;
  }
  return undefined;
}

function sizeFrom(read: ReadAt): ImageSize | undefined {
  const head = read(0, 32);
  if (head[0] === 0xff && head[1] === 0xd8) return jpegSize(read);
  return pngSize(head) ?? gifSize(head) ?? webpSize(head);
}

/**
 * Reads the width and the height of an image from its PNG, GIF, WebP or JPEG header. It reads the bytes of the
 * header only and never decodes the image. Returns `undefined` when the bytes hold none of the four headers.
 */
export function imageSize(bytes: Uint8Array): ImageSize | undefined {
  return sizeFrom((position, length) => bytes.subarray(position, position + length));
}

/** The same for a file. It reads a few bytes at each place that the header names, never the whole file. */
export function imageFileSize(file: string): ImageSize | undefined {
  const descriptor = openSync(file, 'r');
  try {
    return sizeFrom((position, length) => {
      const bytes = new Uint8Array(length);
      return bytes.subarray(0, readSync(descriptor, bytes, 0, length, position));
    });
  } finally {
    closeSync(descriptor);
  }
}

/**
 * `images-original`: every raster file under `src/` has at most `imageMaxPx` pixels on its long edge and at most
 * `imageMaxBytes` bytes. A PNG, GIF, WebP or JPEG file whose header gives no size is a finding too, because then
 * nothing says how large the image is. An AVIF, BMP or TIFF file has the byte limit only.
 */
export function checkImageOriginals(
  root: string,
  report: Report,
  limits: Pick<Limits, 'imageMaxPx' | 'imageMaxBytes'> = LIMITS,
): void {
  for (const file of listFiles(root, 'src')) {
    if (!file.inside || !isRaster(file.path)) continue;
    const bytes = statSync(file.file).size;
    if (bytes > limits.imageMaxBytes) {
      report.add('images-original', file.path, `${bytes} B; the limit is ${limits.imageMaxBytes} B`);
    }
    const size = imageFileSize(file.file);
    if (size === undefined) {
      if (HEADER_EXTENSIONS.includes(extname(file.path).toLowerCase())) {
        report.add('images-original', file.path, 'the file has no PNG, GIF, WebP or JPEG header with a size');
      }
    } else if (Math.max(size.width, size.height) > limits.imageMaxPx) {
      report.add(
        'images-original',
        file.path,
        `${size.width} × ${size.height} px; the limit is ${limits.imageMaxPx} px on the long edge`,
      );
    }
  }
}
