import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['build/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `any` remains in the error-catch blocks and the service layer;
      // tightening those is a separate, larger change, so do not fail lint on it
      // here.
      '@typescript-eslint/no-explicit-any': 'off',
      // tsc's noUnusedLocals covers unused locals/imports; this also catches
      // unused arguments, while allowing intentionally-unused `_`-prefixed ones
      // (e.g. the handlers' `_extra`) and unused caught errors.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // The service rethrows with custom messages and no `cause` in many
      // places. Adding cause chaining everywhere is a separate error-handling
      // pass, so do not block lint on it now.
      'preserve-caught-error': 'off',
    },
  },
);
