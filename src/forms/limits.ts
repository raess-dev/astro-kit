/** Where the form posts. The trailing slash matches trailingSlash: 'always', so no 308 detour. */
export const CONTACT_ACTION = '/api/contact/';

/** Field limits shared by the ContactForm markup (maxlength) and the endpoint's validation. */
export const LIMITS = { name: 100, email: 254, message: 5000 } as const;

/** The endpoint rejects a larger Content-Length and stops reading past this many bytes. */
export const MAX_BODY_BYTES = 32 * 1024;

/** The honeypot field: people never see it, so a filled one is a bot. */
export const HONEYPOT = 'website';

/** Attributes of each visible field, spread onto the inputs by ContactForm.astro. */
export const FIELD = {
  name: { type: 'text', autocomplete: 'name', maxlength: LIMITS.name, required: true },
  email: { type: 'email', autocomplete: 'email', maxlength: LIMITS.email, required: true },
  message: { autocomplete: 'off', maxlength: LIMITS.message, rows: 8, required: true },
} as const;

export type FieldName = keyof typeof FIELD;
