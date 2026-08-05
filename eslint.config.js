import js from '@eslint/js';
import 'eslint'; // must be loaded BEFORE eslint-plugin-html (it patches require.cache)
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';
import html from 'eslint-plugin-html';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['**/node_modules/**', '**/dist/**', '**/.wrangler/**', 'site.zip', 'docs/**']),
  js.configs.recommended,
  {
    files: ['backend/**/*.js'],
    languageOptions: {
      globals: globals.node,
      sourceType: 'module',
      ecmaVersion: 'latest',
    },
  },
  {
    files: ['site/**/*.html'],
    plugins: { html },
    languageOptions: {
      globals: globals.browser,
      ecmaVersion: 'latest',
    },
  },
  {
    files: ['parts-manager/src/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    extends: [reactHooks.configs.flat.recommended],
    rules: {
      'react/jsx-uses-vars': 'error',
    },
    languageOptions: {
      globals: globals.browser,
      ecmaVersion: 'latest',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
]);
