/**
 * Every browser rule, in the order of section 8 (the order of `RULES` in `src/registry.ts`). A part of milestone M6
 * that adds rules adds its file's list here, and nothing else changes in the runner.
 */
import { RULES } from '../registry.ts';
import { COLOR_RULES } from './color.ts';
import type { BrowserRule } from './harness.ts';
import { KEYBOARD_RULES } from './keyboard.ts';
import { LAYOUT_RULES } from './layout.ts';
import { PERF_RULES } from './perf.ts';

/** The browser rules of the registry, in its order. Throws when a rule has no registry entry of stage `browser`. */
export function inRegistryOrder(rules: readonly BrowserRule[]): BrowserRule[] {
  const order = new Map(RULES.filter((rule) => rule.stage === 'browser').map((rule, index) => [rule.id, index]));
  for (const rule of rules) {
    if (!order.has(rule.id)) throw new Error(`astro-kit: ${rule.id} is no browser rule of the registry`);
  }
  return [...rules].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export const BROWSER_RULES: readonly BrowserRule[] = inRegistryOrder([
  ...LAYOUT_RULES,
  ...KEYBOARD_RULES,
  ...COLOR_RULES,
  ...PERF_RULES,
]);
