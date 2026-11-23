/**
 * The binary files of the test site: the photos in `src/assets/photos/`, the share image `public/og.jpg` and the PDF
 * menu `public/speisekarte.pdf`. The site commits them, and this script made them. It is kit test code, not a file of
 * the site.
 *
 * - The photos follow `photos.ts`: xorshift32 with seed 7, the noise of 14.2, JPEG quality 82. Only the size and the
 *   color differ from one photo to the next. Each is small, so the repository stays small.
 * - The share image has the size of `head-og` (1200 × 630) and less noise, so it stays under 153,600 B.
 * - The PDF is one A4 page of text, with its title in the document information. It takes the price of the evening
 *   menu and the phone of the restaurant from `site.json`. `site-assets.test.ts` fails when the committed PDF is not
 *   the one that the current `site.json` gives: then run this script again.
 *
 * Run at the repository root: `node test/acceptance/site-assets.ts` writes the files, and
 * `node test/acceptance/site-assets.ts --check` only compares them and ends with status 1 when one differs.
 * `sharp` comes from the Astro install of the repository (`node_modules/astro`). Another `sharp` version can write
 * other JPEG bytes: then the photos look the same, and the check names them.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, SITE } from './harness.ts';
import { photo, type Rgb, sharpFrom } from './photos.ts';

export interface SitePhoto {
  /** The path under `test/site/`. */
  file: string;
  width: number;
  height: number;
  color: Rgb;
  /** The amplitude of the noise, when it is not the one of 14.2. */
  noise?: number;
}

/** Every photo of the site. The colors are those of the place: larch gold, stone pine, the parlour, the lake. */
export const SITE_PHOTOS: readonly SitePhoto[] = [
  { file: 'src/assets/photos/home-hero.jpg', width: 1280, height: 720, color: [184, 156, 112] },
  { file: 'src/assets/photos/rooms.jpg', width: 960, height: 640, color: [158, 122, 88] },
  { file: 'src/assets/photos/restaurant.jpg', width: 960, height: 640, color: [126, 92, 70] },
  { file: 'src/assets/photos/getting-here.jpg', width: 960, height: 640, color: [92, 128, 138] },
  { file: 'public/og.jpg', width: 1200, height: 630, color: [176, 148, 108], noise: 4 },
];

/** The PDF menu, under `test/site/`. `site.json` maps it to the German restaurant page. */
export const MENU_FILE = 'public/speisekarte.pdf';

interface SiteFacts {
  name: string;
  prices: { id: string; amount: number; currency: string }[];
  contacts: { name: string; phone?: string }[];
}

/** A Swiss number in E.164 form as the site writes it: `+41 81 555 01 20`. */
function formatPhone(e164: string): string {
  const parts = /^\+41(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  return parts === null ? e164 : ['+41', ...parts.slice(1)].join(' ');
}

/** A text of the PDF as a literal string in WinAnsi bytes (the same as Latin-1 for these letters), with escapes. */
function pdfString(text: string): string {
  let out = '(';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0xff) throw new Error(`site-assets: the PDF text holds a character that WinAnsi lacks: ${char}`);
    if (char === '(' || char === ')' || char === '\\') out += `\\${char}`;
    else if (code < 0x20 || code > 0x7e) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += char;
  }
  return `${out})`;
}

/** The lines of the menu: a size, then the text. */
function menuLines(facts: SiteFacts): [number, string][] {
  const menu = facts.prices.find((entry) => entry.id === 'dinner-menu');
  const restaurant = facts.contacts.find((entry) => entry.name === 'Restaurant');
  if (menu === undefined || restaurant?.phone === undefined) {
    throw new Error('site-assets: site.json needs the price dinner-menu and the contact Restaurant with a phone');
  }
  const amount = `${menu.currency} ${(menu.amount / 100).toFixed(2)}`;
  return [
    [22, `${facts.name}`],
    [14, 'Speisekarte des Restaurants'],
    [11, ''],
    [16, 'Abendmenü in vier Gängen'],
    [11, ''],
    [12, 'Bündner Gerstensuppe mit Rauchfleisch aus dem Bergell'],
    [12, 'Capuns mit Bergkäse und Rahmsauce'],
    [12, 'Rehpfeffer aus dem Fextal mit Spätzli und Rotkraut'],
    [12, 'Engadiner Nusstorte nach dem Rezept der Grossmutter'],
    [11, ''],
    [12, `Preis pro Person: ${amount}`],
    [11, 'Auf Wunsch kochen wir das Menü vegetarisch. Sagen Sie es uns bei der Reservation.'],
    [11, 'Alle Preise in Schweizer Franken, mit Mehrwertsteuer.'],
    [11, ''],
    [12, `Tischreservation: ${formatPhone(restaurant.phone)}`],
  ];
}

/** A one-page PDF 1.4 with the menu, written with exact byte offsets. Latin-1 is one byte per character. */
export function menuPdf(facts: SiteFacts): Buffer {
  const lines = menuLines(facts);
  const stream = ['BT', '56 780 Td'];
  for (const [index, [size, text]] of lines.entries()) {
    const font = index === 0 || size >= 16 ? 'F1' : 'F2';
    if (index > 0) stream.push(`0 -${Math.round(size * 1.6)} Td`);
    stream.push(`/${font} ${size} Tf`, `${pdfString(text)} Tj`);
  }
  stream.push('ET');
  const content = stream.join('\n');
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R /Lang ${pdfString('de-CH')} >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    `<< /Title ${pdfString(`Speisekarte: ${facts.name}`)} /Author ${pdfString(facts.name)} >>`,
  ];
  let text = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(text, 'latin1'));
    text += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = Buffer.byteLength(text, 'latin1');
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) text += `${String(offset).padStart(10, '0')} 00000 n \n`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text, 'latin1');
}

/** Every file of the site that this script makes, as path under `test/site/` → bytes. */
export async function siteAssets(
  astroManifest = join(REPO, 'node_modules/astro/package.json'),
): Promise<Map<string, Buffer>> {
  const sharp = sharpFrom(astroManifest);
  const out = new Map<string, Buffer>();
  for (const { file, width, height, color, noise } of SITE_PHOTOS) {
    out.set(file, await photo(width, height, color, noise === undefined ? { sharp } : { sharp, noise }));
  }
  const facts = JSON.parse(readFileSync(join(SITE, 'site.json'), 'utf8')) as SiteFacts;
  out.set(MENU_FILE, menuPdf(facts));
  return out;
}

/** Writes the files into `test/site/`, or with `--check` compares them. */
async function main(args: readonly string[]): Promise<number> {
  const check = args.includes('--check');
  const differ: string[] = [];
  for (const [file, bytes] of await siteAssets()) {
    const path = join(SITE, file);
    let current: Buffer | undefined;
    try {
      current = readFileSync(path);
    } catch {
      current = undefined;
    }
    if (current?.equals(bytes) === true) continue;
    differ.push(file);
    if (check) continue;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
  for (const file of differ) process.stdout.write(`${check ? 'differs' : 'wrote'}: test/site/${file}\n`);
  return check && differ.length > 0 ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
