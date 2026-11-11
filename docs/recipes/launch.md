# Go live, or move from an old site

Reads: [new-site.md](new-site.md) and the smoke and zone groups of [standards.md](../standards.md). The owner does
every step marked (owner); the agent does the rest.

## Before the switch

1. Old URLs: build, then `npx --no astro-kit routes import old-sitemap.xml` (a saved copy, or a file with one URL
   per line). It adds `{from, gone: true}` for each old URL that is not built; turn each moved page into `{from, to}`.
   While the old site is live, `astro-kit ci` fails `routes-removed` for any URL in its sitemap that is neither built
   nor redirected.
2. (owner) Accounts: passkeys or security keys on Cloudflare, GitHub, npm, the registrar and the mailbox. Registrar
   lock on. Remove unused members and tokens.
3. (owner) Breach duties, written down before launch: report a breach that likely brings a high risk to visitors to
   the FDPIC as soon as possible (nDSG Art. 24); report to the EU authority within 72 hours (GDPR Art. 33) when EU
   visitors are affected; inform the people affected when the law requires it.

## DNS (owner)

4. Add the zone to Cloudflare and import the old records. Compare MX, SPF, DKIM, DMARC and verification TXT records
   with the old provider before going on.
5. DNSSEC, in this order: remove the DS record at the registrar, wait for its TTL, switch the nameservers to
   Cloudflare, wait until the zone is active, enable DNSSEC in Cloudflare, then add its DS record at the registrar.
6. Attach the canonical host to the Worker as a custom domain; `workers_dev` stays false. Set the repository
   variable `KIT_WORKERS_DEV` to `<worker>.<account>.workers.dev`, so smoke proves that host does not answer.
7. The other host (www or apex): a proxied `AAAA` record to `100::`, plus one Single Redirect rule with a 301 to the
   canonical host that keeps the path and the query.
8. Zone settings: `npx --no astro-kit provision zone --apply` with a one-day Zone Settings edit token in
   `CLOUDFLARE_API_TOKEN`, then `provision zone --check` with the read-only token, then
   `npx --no astro-kit smoke https://example.ch`. In a Claude cloud session, smoke needs the site host on the
   environment's allowed hosts.

## After the switch

9. (owner) Google Search Console: a domain property, verified by a DNS TXT record. Submit `/sitemap.xml`.
10. (owner) Bing Webmaster Tools: import the site from Search Console, or verify it, and submit `/sitemap.xml`.
11. After 28 days, read the field Core Web Vitals at p75 in Search Console, on mobile and desktop: LCP 2.5 s or less,
    INP 200 ms or less, CLS 0.1 or less. When one fails, open an issue with the URL group, and add a `KIT-FEEDBACK.md` entry.
12. Keep the old URLs in `src/content/redirects.json` for good; `astro-kit ci` fails when a published source is dropped.
