import globals from 'globals';

/**
 * Node.js runtime preset: adds Node globals to server-side and tooling files.
 * Apply after the base preset.
 */
export default [
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
