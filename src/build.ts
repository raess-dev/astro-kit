import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parse } from 'node-html-parser';
import type { BuildContext, BuiltCss, BuiltPage, RedirectRow } from './context.ts';
import { loadMessages, loadSchedule, loadSite } from './facts.ts';
import type { Manifest } from './manifest.ts';
import { effectiveLimits, type KitOptions } from './options.ts';
import { checkWrangler } from './project.ts';
import { Report } from './registry.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/** dist/fr/contact/index.html → /fr/contact/; dist/404.html → /404.html */
export function urlPathOf(dist: string, file: string): string {
  const rel = relative(dist, file).split(sep).join('/');
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return `/${rel.slice(0, -'index.html'.length)}`;
  return `/${rel}`;
}

export function parseHtml(html: string) {
  return parse(html, { comment: false, blockTextElements: { script: true, style: true, noscript: true, pre: true } });
}

export interface LoadInput {
  root: string;
  dist: string;
  options: KitOptions;
  manifest: Manifest;
  report: Report;
  redirects: RedirectRow[];
  env?: Record<string, string | undefined>;
}

/** Reads every built file into an audit context. */
export function loadBuild(input: LoadInput): BuildContext {
  const { root, dist, options, manifest, report } = input;
  const scratch = new Report();
  const all = walk(dist);
  const byPath = new Map(manifest.pages.map((p) => [p.path, p]));
  const codes = new Map(options.locales.map((l) => [l.tag.toLowerCase(), l.code]));
  const pages: BuiltPage[] = [];
  const css: BuiltCss[] = [];
  for (const file of all) {
    if (file.endsWith('.html')) {
      const html = readFileSync(file, 'utf8');
      const doc = parseHtml(html);
      const path = urlPathOf(dist, file);
      const record = byPath.get(path);
      const lang = (doc.querySelector('html')?.getAttribute('lang') ?? '').toLowerCase();
      const locale = record?.locale ?? codes.get(lang) ?? lang.split('-')[0] ?? options.defaultLocale;
      const built: BuiltPage = { file, path, html, doc, locale, is404: path === '/404.html' };
      if (record) built.record = record;
      pages.push(built);
      for (const style of doc.querySelectorAll('style')) css.push({ where: path, text: style.textContent });
    } else if (file.endsWith('.css')) {
      css.push({ where: `/${relative(dist, file).split(sep).join('/')}`, text: readFileSync(file, 'utf8') });
    }
  }
  return {
    root,
    dist,
    options,
    limits: effectiveLimits(options),
    manifest,
    site: loadSite(root, scratch),
    schedule: loadSchedule(root, scratch),
    messages: loadMessages(root, options, scratch),
    pages,
    css,
    files: all.map((f) => relative(dist, f).split(sep).join('/')),
    redirects: input.redirects,
    wrangler: checkWrangler(root, options, scratch),
    report,
    env: input.env ?? process.env,
  };
}
