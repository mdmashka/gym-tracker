import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**', '*.tsx', '*.ts', '!vitest.config.ts', '!playwright.config.ts'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'supabase/functions/**/*.ts', 'tests/**/*.{ts,tsx}', 'vitest.config.ts', 'playwright.config.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, Deno: 'readonly' } },
    rules: { ...js.configs.recommended.rules, '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }], 'no-unused-vars': 'off', 'no-undef': 'off' },
  },
];
