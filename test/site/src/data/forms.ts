/**
 * The two forms of the site, `contact` and `booking`, with the texts of their labels in each locale. The fields and
 * their attributes equal `forms` of `astro-kit.json`: the kit renders nothing, and its build rule `forms-declared`
 * compares the built form with the declaration. This module stops the build when the names differ.
 */
import settings from '../../astro-kit.json';
import type { Locale } from './locales.ts';

/** The ids of the forms. Each one posts to `/api/forms/<id>/`. */
export type FormId = 'contact' | 'booking';

/** One field, as the page renders it. */
export type Field =
  | {
      name: string;
      type: 'text' | 'email' | 'tel' | 'textarea';
      maxLength: number;
      autocomplete: string;
      required: boolean;
    }
  | { name: string; type: 'date'; autocomplete: string; required: boolean }
  | { name: string; type: 'number'; min: number; max: number; autocomplete: string; required: boolean }
  | { name: string; type: 'choice'; options: readonly string[]; autocomplete: string; required: boolean }
  | { name: string; type: 'consent'; required: true };

/** The fields of each form, in the order of `astro-kit.json`. The defaults of the kit are written out. */
export const FIELDS: Readonly<Record<FormId, readonly Field[]>> = {
  contact: [
    { name: 'name', type: 'text', maxLength: 200, autocomplete: 'name', required: true },
    { name: 'email', type: 'email', maxLength: 254, autocomplete: 'email', required: true },
    { name: 'message', type: 'textarea', maxLength: 5000, autocomplete: 'off', required: true },
  ],
  booking: [
    { name: 'name', type: 'text', maxLength: 200, autocomplete: 'name', required: true },
    { name: 'email', type: 'email', maxLength: 254, autocomplete: 'email', required: true },
    { name: 'tel', type: 'tel', maxLength: 32, autocomplete: 'tel', required: false },
    { name: 'arrival', type: 'date', autocomplete: 'off', required: true },
    { name: 'nights', type: 'number', min: 1, max: 14, autocomplete: 'off', required: true },
    { name: 'room', type: 'choice', options: ['single', 'double', 'family'], autocomplete: 'off', required: true },
    { name: 'terms', type: 'consent', required: true },
  ],
};

for (const id of ['contact', 'booking'] as const) {
  const declared = settings.forms[id].fields.map((field) => field.name).join();
  if (declared !== FIELDS[id].map((field) => field.name).join()) {
    throw new Error(`src/data/forms.ts: the fields of ${id} must equal forms.${id}.fields of astro-kit.json`);
  }
}

/** The texts of the forms in one locale. */
export interface FormText {
  /** The word after a required and after an optional label, in brackets. The kit checks it (`forms-fields`). */
  required: string;
  optional: string;
  /** The label of each field by its name. */
  labels: Readonly<Record<string, string>>;
  /** The label of each room option, and of the empty option of the select. */
  rooms: Readonly<Record<string, string>>;
  choose: string;
  /** The privacy sentence of each form: the text before and after the link, and the link text. */
  privacyBefore: string;
  privacyLink: string;
  privacyAfter: string;
  /** The label of the send button of each form. */
  send: Readonly<Record<FormId, string>>;
  /** The two notes of the markup pattern: shown at `#sent` and at `#not-sent`. */
  sent: string;
  notSent: string;
}

export const FORM_TEXT: Readonly<Record<Locale, FormText>> = {
  de: {
    required: 'Pflichtfeld',
    optional: 'optional',
    labels: {
      name: 'Name',
      email: 'E-Mail',
      message: 'Ihre Nachricht',
      tel: 'Telefon',
      arrival: 'Anreise',
      nights: 'Nächte',
      room: 'Zimmer',
      terms: 'Ich weiss, dass dies eine Anfrage ist und noch keine Reservation.',
    },
    rooms: { single: 'Einzelzimmer', double: 'Doppelzimmer', family: 'Familienzimmer' },
    choose: 'Bitte wählen',
    privacyBefore: 'Wir verwenden Ihre Angaben nur für die Antwort. Mehr dazu steht in der',
    privacyLink: 'Erklärung zum Datenschutz',
    privacyAfter: '.',
    send: { contact: 'Nachricht senden', booking: 'Anfrage senden' },
    sent: 'Danke. Ihre Nachricht ist bei uns angekommen, und wir antworten Ihnen bald.',
    notSent:
      'Ihre Nachricht ist leider nicht angekommen. Prüfen Sie bitte Ihre Angaben, oder schreiben Sie uns eine E-Mail.',
  },
  fr: {
    required: 'obligatoire',
    optional: 'facultatif',
    labels: {
      name: 'Nom',
      email: 'E-mail',
      message: 'Votre message',
      tel: 'Téléphone',
      arrival: 'Arrivée',
      nights: 'Nuits',
      room: 'Chambre',
      terms: 'Je sais que ceci est une demande et pas encore une réservation.',
    },
    rooms: { single: 'Chambre simple', double: 'Chambre double', family: 'Chambre familiale' },
    choose: 'Veuillez choisir',
    privacyBefore: 'Nous utilisons vos données uniquement pour vous répondre. Pour en savoir plus, lisez la',
    privacyLink: 'déclaration de protection des données',
    privacyAfter: '.',
    send: { contact: 'Envoyer le message', booking: 'Envoyer la demande' },
    sent: 'Merci. Votre message nous est parvenu, et nous vous répondrons bientôt.',
    notSent: 'Votre message ne nous est malheureusement pas parvenu. Vérifiez vos données, ou écrivez-nous un e-mail.',
  },
  en: {
    required: 'required',
    optional: 'optional',
    labels: {
      name: 'Name',
      email: 'Email',
      message: 'Your message',
      tel: 'Phone',
      arrival: 'Arrival',
      nights: 'Nights',
      room: 'Room',
      terms: 'I know that this is a request and not yet a booking.',
    },
    rooms: { single: 'Single room', double: 'Double room', family: 'Family room' },
    choose: 'Please choose',
    privacyBefore: 'We use your data only to answer you. To learn more, read the',
    privacyLink: 'privacy statement',
    privacyAfter: '.',
    send: { contact: 'Send the message', booking: 'Send the request' },
    sent: 'Thank you. Your message has reached us, and we will answer you soon.',
    notSent: 'Sorry, your message did not reach us. Please check your data, or write us an email.',
  },
};

/** The path that a form posts to: `/api/forms/<id>/`, with the last slash, which avoids a 308. */
export const actionOf = (id: FormId): string => `/api/forms/${id}/`;
