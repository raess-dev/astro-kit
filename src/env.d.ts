/// <reference types="astro/client" />

/** Provided by src/virtual.ts at build time; content.ts narrows the types. */
declare module 'virtual:astro-kit' {
  export const options: unknown;
  export const site: unknown;
  export const schedule: unknown;
  export const messages: unknown;
  export const manifest: unknown;
  export const kitVersion: string;
}

declare module 'virtual:astro-kit/theme.css';

/** Provided by workerd; the contact endpoint narrows env to its bindings. */
declare module 'cloudflare:workers' {
  export const env: unknown;
}
