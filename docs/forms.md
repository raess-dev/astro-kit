# The contact form (`features.forms`)

The contact page stays static. Its form posts to `/api/contact/`, the one route that runs a Worker. The answer is
always a 303 to the contact page of the validated locale plus `#sent` or `#not-sent`, never to a URL the visitor sent.
`base.css` shows that block with `:target`. There is no client script.

**Owner:** switches `features.forms` on in `astro-kit.json` with `contact.to`, `contact.from` (`form@<domain>`) and an
optional `contact.probe`; verifies those addresses in Cloudflare Email Routing; keeps the `send_email` binding and the
rate limiter in `wrangler.jsonc`; adds one SPF record and a `_dmarc` record; stores the same random value as the Worker
secret and the repository secret `KIT_PROBE_SECRET`; and adds `forms` and `server` to each privacy page's `processing`.

**Agent:** writes `src/content/pages/<locale>/contact.md` in every locale. The page route renders
`<ContactForm locale={page.locale} />` for the id `contact`, and `src/pages/api/contact.ts` holds only this:

```ts
import { createContactEndpoint } from '@raess/astro-kit/forms';

export const prerender = false;
export const POST = createContactEndpoint();
```

The kit fixes the rest; do not rebuild it in the project:

- Fields: name (100 characters), email (254) and message (5000), with native validation. Labels say required or optional, every input has `autocomplete`, and there are no placeholders ([forms-fields](standards.md#forms-fields)).
- Safety: no file input, no pre-checked box, and a link to the locale's privacy page ([forms-safety](standards.md#forms-safety)).
- Abuse: a 32 KB body cap, Astro's origin check, a hidden honeypot field, and rate limits per IP address and for the whole form.
- Mail: text only, a fixed subject per locale, `replyTo` set to the visitor's address, and a first line saying the sender is not verified. Logs hold error codes, never form content.
- Proof: `astro-kit smoke --probe` posts weekly with the probe secret and expects `#sent`; one live send must show `dmarc=pass` ([smoke-probe](standards.md#smoke-probe), [smoke-mail-dns](standards.md#smoke-mail-dns)).

The deploy fails when the built `send_email` binding differs from `wrangler.jsonc`. A form with other fields, an
upload or another destination is not a kit feature: apply the stop rule.
