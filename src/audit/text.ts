/**
 * Word lists for the site audit. Stopword lists are short and keep only words that are frequent
 * in one language and rare in the others, so a score tells the languages apart.
 */

const words = (list: string): ReadonlySet<string> => new Set(list.split(/\s+/).filter(Boolean));

export const STOPWORDS: Record<string, ReadonlySet<string>> = {
  de: words(`der die das und ist nicht mit sich auf für dem den ein eine einen einem einer zu von wir sie ihr ihre
    ihren auch als oder werden wird bei nach noch wie über sind aus durch können uns unsere unser dass im zum zur sowie`),
  fr: words(`le la les des du de et est une pour dans que sur au aux avec nous vous ce cette ces sont pas par plus
    ou mais leur leurs son sa ses être aussi très notre nos votre vos comme entre sans à en qui`),
  it: words(`lo gli della delle dei degli del di che è e per con non una uno sono nel nella alla alle al anche come
    più questo questa nostro nostra nostri nostre ci si ma dalla dal tra essere ha hanno molto loro sua suo`),
  en: words(`the and of to is are for with that this it as be by from at or we you your our have has can not which
    their they more about all into been were there what when these would its us how who`),
};

/** Link texts that name no destination (compared trimmed and lower-cased). */
export const GENERIC_LINK_TEXT: ReadonlySet<string> = new Set([
  'here',
  'click',
  'click here',
  'more',
  'read more',
  'learn more',
  'link',
  'hier',
  'klicken',
  'hier klicken',
  'mehr',
  'weiterlesen',
  'mehr erfahren',
  'ici',
  'cliquez',
  'cliquez ici',
  'plus',
  'lire la suite',
  'en savoir plus',
  'qui',
  'clicca qui',
  'di più',
  'scopri di più',
  'leggi tutto',
]);

/** Built-in banned variants for Swiss German (tags de and de-CH): variant → canonical. */
export const DE_CH_BANNED: Readonly<Record<string, string>> = { ß: 'ss', '„': '«', '“': '»' };
