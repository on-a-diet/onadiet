// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '.turbo/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Plain-JS config + bin/script files run under Node — give them Node/CommonJS globals, and allow
    // `require()` in CommonJS (`.cjs`) files (the smoke test exercises the CJS resolution path on purpose).
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        module: 'writable',
        require: 'readonly',
        exports: 'writable',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // The public site (site/) is browser code — give it browser globals and allow the idiomatic empty
    // catch used by the anti-FOUC / localStorage theme guards.
    files: ['site/**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        matchMedia: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        IntersectionObserver: 'readonly',
        // the live on-device demo (demo/demo.js) — Canvas re-encode + SSIM + the no-upload proof
        fetch: 'readonly',
        XMLHttpRequest: 'readonly',
        createImageBitmap: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        atob: 'readonly',
        requestAnimationFrame: 'readonly',
      },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  {
    // Pure core: no ambient time/randomness/process access in the engine — reach the outside world
    // only through injected ports and passed-in config. (Adapters and tests are free to use them.)
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Pure core: inject a Clock port instead of Date.now().',
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'Pure core: inject a Clock port instead of new Date().',
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: 'Pure core: inject a port instead of Math.random().',
        },
        {
          selector: "MemberExpression[object.name='process']",
          message:
            'Pure core: no ambient process/env access — receive values via config or injected ports.',
        },
      ],
    },
  },
)
