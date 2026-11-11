/**
 * Header navigation labels. No imports: content.ts loads this inside Astro and the Cloudflare worker, and the
 * preflight check (manifest.ts) loads it in Node, so both use the same rule.
 */

/** The longest header navigation label (links-nav-label). Longer labels wrap the header onto several rows. */
export const NAV_LABEL_MAX = 32;

/** A nav page's header label: its nav.<id> message, else its title up to the first dash. */
export function navLabel(title: string, message?: string): string {
  return message ?? title.split(/ [–—|-] /)[0] ?? title;
}
