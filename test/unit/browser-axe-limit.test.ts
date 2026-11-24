import assert from 'node:assert/strict';
import { test } from 'node:test';
import { axeRule } from '../../src/browser/color.ts';
import { ACTION_LIMIT_MS } from '../../src/browser/harness.ts';
import { BODY, CSS, findingsOf, html, useBrowser } from './browser-fixtures.ts';
import { DESIGN } from './css-rules-fixtures.ts';
import { SPEC } from './spec.ts';

const browser = useBrowser();

// A file of its own: the case waits for the limit of each axe run, so `npm test` runs it beside the others.

test('a11y-axe: a page that runs no timer stops axe; each state reports the limit, and the check finishes', async () => {
  assert.equal(ACTION_LIMIT_MS, 15_000);
  assert.ok(SPEC.includes('axe did not finish within 15 s'));
  // A sandbox without `allow-scripts` runs no timer and no animation frame, so `axe.run` never ends.
  const files = {
    'index.html': html(BODY, { css: CSS }),
    _headers: "/*\n  Content-Security-Policy: sandbox; default-src 'none'; style-src 'self' 'unsafe-inline'\n",
  };
  // One theme, so the case waits twice: once at 1280×800 and once at 390×844 after the reveal step.
  const design = { ...DESIGN, themes: DESIGN.themes.filter((theme) => theme === 'light') };
  const started = Date.now();
  const findings = await findingsOf(browser(), files, [axeRule], { design });
  assert.deepEqual(
    findings.map((finding) => `${finding.where} ${finding.detail ?? ''}`),
    [
      '/ 1280×800 in the light theme: axe did not finish within 15 s',
      '/ 390×844 after the reveal step: axe did not finish within 15 s',
    ],
  );
  assert.ok(Date.now() - started < 2 * ACTION_LIMIT_MS + 20_000);
});
