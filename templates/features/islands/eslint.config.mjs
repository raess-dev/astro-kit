import solid from 'eslint-plugin-solid/configs/typescript';
import tseslint from 'typescript-eslint';

export default [
  {
    files: ['src/**/*.tsx', 'src/**/*.ts'],
    ...solid,
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
  },
];
