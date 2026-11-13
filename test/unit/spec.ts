/**
 * The specification as test input. A test compares a text of the kit with the exact block of `docs/spec.md`, so
 * the two cannot differ.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The whole of `docs/spec.md`. */
export const SPEC: string = readFileSync(fileURLToPath(new URL('../../docs/spec.md', import.meta.url)), 'utf8');

const FENCE = '```';

/**
 * The text of the first fenced code block of one language after a marker text, without the two fence lines and
 * without a final newline. The indentation of the opening fence is cut from every line, so a block inside a list
 * reads as it is meant. Throws when the marker or the block is missing.
 */
export function specBlock(marker: string, language: string): string {
  const start = SPEC.indexOf(marker);
  if (start < 0) throw new Error(`docs/spec.md does not hold the text ${JSON.stringify(marker)}`);
  const lines = SPEC.slice(start).split('\n');
  const open = lines.findIndex((line) => line.trim() === `${FENCE}${language}`);
  const close = lines.findIndex((line, index) => index > open && line.trim() === FENCE);
  if (open < 0 || close < 0) throw new Error(`docs/spec.md has no ${language} block after ${JSON.stringify(marker)}`);
  const indent = (lines[open] ?? '').indexOf(FENCE);
  return lines
    .slice(open + 1, close)
    .map((line) => line.slice(indent))
    .join('\n');
}

/** The text `${name}`: a variable in a block of the specification. */
export const variable = (name: string): string => `\${${name}}`;
