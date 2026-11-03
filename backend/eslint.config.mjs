// @ts-check
// Root lint = build-prompt enforcement layer.
// - no-restricted-imports implements the module boundary rules (section 4.3):
//   the API must never import frontend code; the web app talks to the API only
//   through the generated contract client (@kpmpl/contracts).
// - no-restricted-syntax bans dangerouslySetInnerHTML (section 9.1 XSS control).
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/src/generated/**', // generated OpenAPI types: reviewed via the yaml source, not here
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/web', '**/apps/web/**'],
              message: 'Invariant: the API must not import frontend code (module boundaries, build prompt 4.3).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/api', '**/apps/api/**', '**/apps/**'],
              message:
                'Invariant: the web app reaches the API only through the generated client in @kpmpl/contracts (one shared API, build prompt 4.1).',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Security control 9.1: dangerouslySetInnerHTML is banned (XSS). React escapes everything by default.',
        },
      ],
    },
  },
);
