// Managed by @raess/astro-kit (features.islands): `astro-kit check` lints src/islands/ with it and compares this file with the kit's copy.
import solid from 'eslint-plugin-solid/configs/typescript';
import tseslint from 'typescript-eslint';

export default [
  {
    files: ['src/islands/**/*.{ts,tsx}'],
    ...solid,
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
  },
];
