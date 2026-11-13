/**
 * Ambient types for the two modules that no package on disk provides (specification, 3.2).
 * This file is a script: it has no top-level import or export, so its declarations are global.
 */

/** The kit's virtual module. `virtualModulePlugin` of `src/virtual.ts` provides it in a build. */
declare module 'virtual:astro-kit' {
  /** The settings of `astro-kit.json`, with every default. */
  export const options: import('./options.ts').Options;
  /** The version of the kit that builds the site. */
  export const kitVersion: string;
}

/** The module of the Workers runtime. The form endpoint narrows `env` to its bindings (9.1). */
declare module 'cloudflare:workers' {
  export const env: unknown;
}
