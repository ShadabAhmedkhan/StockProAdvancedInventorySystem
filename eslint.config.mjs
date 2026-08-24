import base from '@stock-pro/eslint-config/base';
import node from '@stock-pro/eslint-config/node';
import react from '@stock-pro/eslint-config/react';
import globals from 'globals';

/**
 * Root ESLint configuration for the Stock Pro monorepo.
 *
 * ESLint 9 flat config does not cascade into subdirectories, so this single
 * config governs every workspace package. Package-specific overrides are
 * appended here as each application is introduced.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  ...base,
  ...node,
  ...react,
  {
    // A NestJS module is a decorator-only class with an intentionally empty
    // body: it exists solely as a dependency-injection token. There is no way
    // to satisfy no-extraneous-class without abandoning the framework.
    files: ['apps/api/**/*.module.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
];
