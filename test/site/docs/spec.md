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
| Home | A first visit. All audiences. | A quiet family hotel between the larch forest and the lake; what a stay is like, and what a double room costs. | Ask for a room: by email at stage 1, on the contact page from stage 2. |
| Rooms and prices | Guests who compare. | Three kinds of room, each with its price for a night with breakfast; the prices for a dog and for the car park. | Send a booking request. |
| Restaurant | Hotel guests and guests from the village. | Engadin cooking, the evening menu and its price, the opening hours. | Call the restaurant for a table; read the menu as a PDF. |
| Getting here | Guests who plan the journey. | By train and bus in every season; by car, with the car park; the walk from the bus stop. | Ask for the pick-up from the bus stop. |
| Contact and booking request | Guests who are ready to ask. | Two short forms: a question, or a booking request with dates and room. | Send the form, or call. |
| Jobs | Job seekers (German and French only). | The house as an employer; the open positions of the season. | Write to the jobs address. |
| Legal note | Anyone who must know who runs the site. | The company, its address, its register entry and its tax number. | None. |
| Privacy | Anyone who asks what the site does with data. | What is processed, by whom and why, in plain words; the rights of the visitor. | Write to the hotel. |
| Sitemap page | Visitors who look for a page; search engines. | Every page of the language, in one list. | None. |
| 404 | Visitors on a wrong address, in any language. | The page does not exist; here is the way back. | Go to the home page of your language. |

**Stage 1** has the home page, the legal note and the privacy page in the three languages, and the 404 page. The
other pages follow at stage 2. Until then no page links a page that does not exist, and the home page asks for a
room by email and by phone.

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
- The legal texts are samples that an editor of the hotel could have written. No lawyer has checked them.
- The owner approves each change to the text of a legal page through `legal.lock.json`.

## Open questions

- **The domain.** The production domain is not known yet. The site uses the provisional host `laerchenwald.example`.
  The host stands in `astro-kit.json`, `site.json`, `wrangler.jsonc` and `AGENTS.md`, and in no file under `src/`.
  `README.md` lists these places.
- **Photos.** The hero photo of the home page and the share image come at stage 2.
- **Legal check.** Should a lawyer read the legal note and the privacy page before the launch?
- **The stored display mode.** The privacy page mentions it. The owner decides whether it stays.
