/**
 * The form endpoint against Chromium (specification, 9.1): the form stub of `serveDist` answers a form that
 * Chromium fills and sends with JavaScript off, as a visitor sends it.
 *
 * - The body cap of the contact form holds the longest message that the browser lets a visitor type: 5,000 CJK
 *   characters urlencode to 45,000 B, more than the flat cap of 32,768 B of the first draft (F15 of 7b).
 * - `EMAIL_PATTERN` on `input[type=email]` makes the browser refuse what step 7 refuses (F17 of 7b): Chromium
 *   accepts `ann@gmailcom` without the pattern, and the endpoint answers `#not-sent`, which loses the typed text.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Page } from 'playwright-core';
import { FORM_TEXT } from '../../src/browser/keyboard.ts';
import { EMAIL_PATTERN } from '../../src/forms/fields.ts';
import { serveDist } from '../../src/serve.ts';
import { html, useBrowser } from './browser-fixtures.ts';
import { inTempAsync } from './fixtures.ts';
import { SETTINGS } from './forms-fixtures.ts';

const browser = useBrowser();

/** The contact form of the test site on `/kontakt/`, as the markup pattern of 9.1 writes it. */
const CONTACT_PAGE = html(
  [
    '<main><h1>Kontakt</h1><p id="sent" tabindex="-1">Danke.</p><p id="not-sent" tabindex="-1">Leider nicht.</p>',
    '<form action="/api/forms/contact/" method="post">',
    '<input type="hidden" name="return" value="/kontakt/">',
    '<div class="visually-hidden" inert aria-hidden="true"><input name="website" type="text" tabindex="-1" autocomplete="off"></div>',
    '<label>Name (Pflichtfeld) <input type="text" name="name" required maxlength="200" autocomplete="name"></label>',
    `<label>E-Mail (Pflichtfeld) <input type="email" name="email" required maxlength="254" pattern="${EMAIL_PATTERN}" autocomplete="email"></label>`,
    '<label>Nachricht (Pflichtfeld) <textarea name="message" required maxlength="5000" autocomplete="off"></textarea></label>',
    '<button>Senden</button></form></main>',
  ].join(''),
);

/** Opens `/kontakt/` with JavaScript off on a stub server, runs `steps`, and closes everything. */
async function onContactPage(steps: (tab: Page) => Promise<void>): Promise<void> {
  await inTempAsync({ 'kontakt/index.html': CONTACT_PAGE }, async (dist) => {
    const served = await serveDist(dist, { forms: SETTINGS });
    const context = await browser().newContext({ javaScriptEnabled: false });
    try {
      const tab = await context.newPage();
      await tab.goto(`${served.origin}/kontakt/`);
      await steps(tab);
    } finally {
      await context.close();
      await served.close();
    }
  });
}

/** Clicks the submit button and gives the path and hash where the tab lands. */
async function send(tab: Page): Promise<string> {
  const start = tab.url();
  await Promise.all([
    tab.waitForURL((next) => next.href !== start, { timeout: 10_000, waitUntil: 'load' }),
    tab.locator('button').click(),
  ]);
  const url = new URL(tab.url());
  return `${url.pathname}${url.hash}`;
}

test('Chromium: 5,000 CJK characters in the contact message reach #sent through the stub', async () => {
  await onContactPage(async (tab) => {
    await tab.locator('[name=name]').fill('Jürg Müller');
    await tab.locator('[name=email]').fill('juerg@example.com');
    await tab.locator('[name=message]').fill('日'.repeat(5_000));
    assert.equal(await tab.locator('form').evaluate((form: HTMLFormElement) => form.checkValidity()), true);
    assert.equal(await send(tab), '/kontakt/#sent');
  });
});

test('Chromium: EMAIL_PATTERN refuses ann@gmailcom with JS off and keeps the typed text', async () => {
  // HTML compiles a pattern with the v flag; the pattern must compile there with the meaning of EMAIL.
  assert.doesNotThrow(() => new RegExp(`^(?:${EMAIL_PATTERN})$`, 'v'));
  await onContactPage(async (tab) => {
    const email = tab.locator('[name=email]');
    await email.fill('ann@gmailcom');
    assert.equal(await email.evaluate((input: HTMLInputElement) => input.validity.patternMismatch), true);
    // Without the pattern, Chromium takes the address: only the pattern refuses it.
    assert.equal(
      await email.evaluate((input: HTMLInputElement) => {
        const bare = input.cloneNode() as HTMLInputElement;
        bare.removeAttribute('pattern');
        bare.value = 'ann@gmailcom';
        return bare.checkValidity();
      }),
      true,
    );
    await tab.locator('[name=name]').fill('Ann');
    await tab.locator('[name=message]').fill('Guten Tag');
    await tab.locator('button').click();
    // The browser refuses the submission: the tab stays on the page, and the typed text stays.
    assert.equal(await tab.evaluate(() => location.hash), '');
    assert.equal(await tab.locator('[name=message]').inputValue(), 'Guten Tag');
    assert.equal(await email.inputValue(), 'ann@gmailcom');
    // The fill value of a11y-no-js and an ordinary address pass the pattern.
    for (const value of ['probe@example.com', 'juerg.mueller+form@mail.example.ch']) {
      await email.fill(value);
      assert.equal(await email.evaluate((input: HTMLInputElement) => input.validity.valid), true, value);
    }
    await tab.locator('[name=name]').fill(FORM_TEXT);
    assert.equal(await send(tab), '/kontakt/#sent');
  });
});
