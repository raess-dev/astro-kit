/**
 * Markdown photos. Markdown cannot set `sizes` or `priority`, and Astro's constrained default is `sizes="100vw"`
 * and lazy loading, so a browser loads a file far wider than the content column, and a hero photo, the LCP
 * element, loads late. This Sätteri hast plugin runs before Astro marks the images, so its values reach getImage().
 *
 * - The first photo of a page gets `priority` (eager, fetchpriority high): put the hero photo first.
 * - Every photo gets the content column as `sizes`: the 65ch measure is about 46rem at the largest body size.
 *   A lazy photo also gets `auto`, so a browser that supports it uses the laid-out width.
 */
export const COLUMN_SIZES = '(min-width: 50rem) 46rem, calc(100vw - 2rem)';
export const LAZY_SIZES = `auto, ${COLUMN_SIZES}`;

interface HastElement {
  properties?: Record<string, unknown>;
}

interface VisitContext {
  setProperty(node: HastElement, key: string, value: unknown): void;
}

/** A plugin factory: Sätteri calls it once per document, so "first photo" is per page. */
export function markdownImageSizes() {
  let first = true;
  return {
    name: 'astro-kit-image-sizes',
    element: {
      filter: ['img'],
      visit(node: HastElement, ctx: VisitContext): void {
        const hero = first;
        first = false;
        if (hero && node.properties?.priority === undefined) ctx.setProperty(node, 'priority', true);
        if (node.properties?.sizes === undefined) ctx.setProperty(node, 'sizes', hero ? COLUMN_SIZES : LAZY_SIZES);
      },
    },
  };
}

interface MarkdownProcessor {
  name?: string;
  options?: { hastPlugins?: unknown[] };
}

/** Adds the plugin to Astro's default Sätteri processor once. Returns false for any other processor. */
export function addMarkdownImageSizes(processor: MarkdownProcessor | undefined): boolean {
  const plugins = processor?.name === 'satteri' ? processor.options?.hastPlugins : undefined;
  if (!plugins) return false;
  if (!plugins.includes(markdownImageSizes)) plugins.push(markdownImageSizes);
  return true;
}
