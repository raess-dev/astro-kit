# Hotel Lärchenwald: the brief

The business brief of the site. Agents read it before they write a page. It says who the site is for, what each
page must do and where the facts come from. Brand and design live in `docs/design.md`.

Hotel Lärchenwald is a family hotel with 24 rooms in Sils im Engadin, at the entrance to the Fex valley and ten
minutes on foot from Lake Sils. The Clalüna family has run it for three generations. It is open in summer and in
winter, and it closes between the seasons. The hotel is fictitious: it is the sample site of `@raess/astro-kit`, and
every text and fact here is a sample.

## Audience

- **Couples and single travellers from 45 years on**, from German-speaking Switzerland and from Germany. They come
  to hike, to ski cross-country and to rest. Many come back every year. They read with care and book by email or by
  phone, not through a booking portal.
- **Families** from Switzerland in the school holidays. They ask for the family room, for the dog and for the car
  park first.
- **Guests from French-speaking Switzerland and from abroad**, who read French or English. They need the same facts
  as the German readers: prices, how to get there, how to book.
- **Job seekers** for the season: service, kitchen, housekeeping. They read German or French.

What they all want from the site: to see quickly whether the house suits them, what a night costs, how to get there
without a car, and how to reach a person.

**Voice.** Warm, plain and exact, as a host speaks to a guest at the reception desk. Short sentences. The formal
address (*Sie*, *vous*). No superlatives and no advertising language: a fact is worth more than an adjective.

## Locales

| Code | Tag | Coverage | Role |
|---|---|---|---|
| `de` | `de-CH` | full | The default language. It owns the root URLs. Every page exists in German. |
| `fr` | `fr-CH` | full | Every German page has a French version. |
| `en` | `en` | partial | Every page but the jobs page. |

- **German** is Swiss standard German: *ss* and never *ß*, « » as quotation marks, *Velo* and *Reservation*.
  The house writes *E-Mail* and *Frühstücksbuffet*.
- **French** is Swiss French: *septante*, *nonante*, *e-mail*. The name of the house stays *Hotel Lärchenwald*, with
  no accent on *Hotel*.
- **English** is British English. The valley is the *Engadin*, as the region itself writes it.
- A translation is written again from this brief for its readers, never line by line. It keeps the sections and the
  facts of the German page.
- `glossary.json` holds the banned variants of each language. The build fails on a banned variant.

## Pages

Each page has one intent, one main message and one call to action. The paths are in `src/data/routes.ts`.

| Page | Intent and audience | Message | Call to action |
|---|---|---|---|
| Home | A first visit. All audiences. | A quiet family hotel between the larch forest and the lake; what a stay is like, and what a double room costs. | Ask for a room on the contact page. |
| Rooms and prices | Guests who compare. | Three kinds of room, each with its price for a night with breakfast; the prices for a dog and for the car park. | Send a booking request. |
| Restaurant | Hotel guests and guests from the village. | Engadin cooking, the evening menu and its price, the closures between the seasons. | Call the restaurant for a table; read the menu as a PDF. |
| Getting here | Guests who plan the journey. | By train and bus in every season; by car, with the car park; the walk from the bus stop. | Ask for the pick-up from the bus stop. |
| Contact and booking request | Guests who are ready to ask. | How to reach the reception and the restaurant, and what a booking request holds. Two short forms follow at stage 3: a question, or a booking request with dates and room. | Write an email, or call. |
| Jobs | Job seekers (German and French only). | The house as an employer; the open positions of the season. | Write to the jobs address. |
| Legal note | Anyone who must know who runs the site. | The company, its address, its register entry and its tax number. | None. |
| Privacy | Anyone who asks what the site does with data. | What is processed, by whom and why, in plain words; the rights of the visitor. | Write to the hotel. |
| Sitemap page | Visitors who look for a page; search engines. | Every page of the language, in one list. | None. |
| 404 | Visitors on a wrong address, in any language. | The page does not exist; here is the way back. | Go to the home page of your language. |

**Stage 1** had the home page, the legal note and the privacy page in the three languages, and the 404 page.
**Stage 2** adds the other pages: 26 pages and the 404 page. The header holds the main navigation with every page of
the hotel in its language, and the footer links the legal pages and the sitemap page. So every page is one click
from every other page. **Stage 3** adds the two forms to the contact page. Until then the contact page asks for a
room by email and by phone.

**Photos.** Each home page has the hero photo, and the rooms, restaurant and getting-here pages each have one photo
with a caption. The photos stand in `src/assets/photos/` and reach the pages through Astro's `Picture`, as AVIF with
a WebP fallback. Every page has the share image `public/og.jpg`. The photos of this sample site are generated
stand-ins: the acceptance suite of the kit makes them (`test/acceptance/site-assets.ts` of the kit repository), and
their alt texts describe the photos that the hotel would take.

**The PDF menu.** `public/speisekarte.pdf` is the menu of the restaurant, in German. `site.json` maps it to the
German restaurant page, and the French and English restaurant pages link it too, marked as German.

**Content that every version of the home page holds:** the price of the double room and the price of the evening
menu, the phone number and the email address of the hotel, the reception hours and the next closure. The German home
page also holds one guest quote in English.

## Facts

No page types a fact. The facts live in two files, and a page reads them through `src/data/facts.ts`.

- `site.json`: the name and the legal name, the address, the main phone number and email address, the UID and the
  VAT number, the six prices (single, double and family room, dog, car park, evening menu), the PDF menu, and the
  contacts of the restaurant and of the jobs desk.
- `schedule.json`: the hours of the reception and the closures between the seasons.

The VAT number is one number in every language, and only its ending differs. `site.json` holds the German form,
which ends with `MWST`. A French page shows the same number with the ending `TVA`, through `vatId(locale)`. English
has no official ending, so an English page keeps `MWST`.

Rules for a price: it is in Swiss francs for one night and one room, with breakfast and VAT, without the visitor's
tax of the municipality. The price of the evening menu is for one person. The owner changes a fact, never an agent.

Facts that are not in these files and that pages state: the house was built in 1926, it has 24 rooms, and the
Clalüna family runs it. The persons who may sign for the company are named in the legal note.

## Legal sources

- **Legal note.** The duty to identify the provider: Article 3 paragraph 1 letter s of the Swiss Unfair Competition
  Act (UWG). The page names the company, its address, its email address, its register entry, the UID and the VAT
  number, and the persons who may sign.
- **Privacy.** The Swiss Federal Act on Data Protection (DSG, in force since 1 September 2023) and its ordinance
  (DSV): the duty to inform of Article 19, the disclosure abroad of Articles 16 and 17, and the rights of
  Articles 25 to 29 and 32.
- **What the privacy page may say.** Only what `processing` in `astro-kit.json` declares. Now that is `cdn`
  (Cloudflare delivers the site and processes the IP address, the user agent and the requested URL; the transfer to
  the United States rests on the Swiss-U.S. and the EU-U.S. Data Privacy Framework) and `previews` (Cloudflare Access
  sends a one-time code to a reviewer's email address). The site sets no cookie and has no statistics. The page also
  says that the browser keeps the chosen display mode on the device. With the forms of a later stage, the page
  gets the sentences for `forms` and `server`.
- **What the privacy page does not say.** It names no state abroad but the United States, because `cdn` declares no
  other. It has no section on enquiries by email or by phone: no setting declares who carries and stores the mail of
  the hotel, so the page could not name the recipients. It makes no promise that no fact supports, such as "we never
  pass your data on".
- The legal texts are samples that an editor of the hotel could have written. No lawyer has checked them.
- The owner approves each change to the text of a legal page through `legal.lock.json`.

## Open questions

- **The domain.** The production domain is not known yet. The site uses the provisional host `laerchenwald.example`.
  The host stands in `astro-kit.json`, `site.json`, `wrangler.jsonc`, `AGENTS.md` and this brief, and in no file
  under `src/`. `test/README.md` of the kit repository lists these places. That file is outside this folder.
- **Photos.** The photos are generated stand-ins. The hotel replaces them with its own photos, at the same names
  and sizes, and checks each alt text.
- **Legal check.** Should a lawyer read the legal note and the privacy page before the launch? Two points for that
  check. Cloudflare can also process data in states other than the United States, and the privacy page names no
  guarantee for them. And stage 1 asks for a room by email and by phone, and stage 2 asks job seekers for a CV by
  email, but the page says nothing about these enquiries or applications.
- **The hours of the restaurant.** `schedule.json` holds the reception hours only, so the restaurant pages show no
  hours, only the closures between the seasons. Should `schedule.json` get the hours of the restaurant and the
  terrace? The owner adds such a fact.
- **The stored display mode.** The privacy page mentions it. The owner decides whether it stays.
- **The edge of a card in the contrast themes.** A card has a background and a shadow, and a line only with forced
  colors. In every theme its background has a contrast of about 1.1:1 to the page, and in the dark contrast theme the
  shadow does not show. Should a card get a visible line in `--color-line`? The line would show in every theme,
  because a border color needs a contrast pair in each theme.
