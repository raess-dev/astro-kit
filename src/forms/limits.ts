/**
 * The fixed values of the form endpoint (specification, 9.1). The endpoint, the test server stub and the build
 * rules share them. This module imports nothing, so it loads in the Worker and in Node alike.
 */

/** A form posts to `/api/forms/<id>/`. The trailing slash avoids a 308. */
export const FORM_ACTION_PREFIX = '/api/forms/';

/** The path of the endpoint of one form. */
export const formAction = (id: string): string => `${FORM_ACTION_PREFIX}${id}/`;

/** The endpoint rejects a larger `content-length`, and it cancels the body stream past this many bytes. */
export const MAX_BODY_BYTES = 32_768;

/** The honeypot field. A visitor never sees it, so a filled one is a bot. */
export const HONEYPOT = 'website';

/** The hidden field that holds the path of the posting page. */
export const RETURN_FIELD = 'return';

/** A valid `return` has at most this many characters. */
export const MAX_RETURN_CHARS = 512;

/** The `Cache-Control` of every answer. */
export const NO_STORE = 'private, no-store';

/**
 * The five headers of every answer of the endpoint and of the test server stub, next to its `Cache-Control`. The
 * answers come from the Worker, so no `_headers` rule reaches them (13.1 item 19, S9).
 */
export const FORM_HEADERS: ReadonlyMap<string, string> = new Map([
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
  ['Cross-Origin-Resource-Policy', 'same-origin'],
  ['Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'"],
]);
