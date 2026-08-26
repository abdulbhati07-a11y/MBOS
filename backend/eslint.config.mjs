// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Prisma writes src/generated/prisma; it is build output, not source.
    ignores: ['eslint.config.mjs', 'src/generated/**', 'dist/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],

      // A leading underscore marks a binding that exists for a reason other than
      // being read, and there are two such reasons here that both matter:
      //
      //   - A parameter that satisfies an interface. `ConsoleMailProvider`
      //     implements `MailProvider.sendPasswordReset(email, token)`; the token
      //     is deliberately not logged, because logging it would put a working
      //     reset credential in the log.
      //   - A `@Body()` parameter that exists to be *validated*. Binding
      //     `UpdateOrderStatusDto` is what rejects every status other than
      //     'Completed' before the service is reached. Nothing reads the value,
      //     and deleting the parameter would silently remove the check.
      //
      // Without this pattern the rule's only remedies are to delete a parameter
      // that is load-bearing or to sprinkle disable comments, so the convention
      // is configured once here instead.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Test files traffic in `any` by design: Jest's matcher helpers
    // (`expect.any`, `expect.objectContaining`) are typed `any`, and asserting
    // on HTTP response bodies means reading untyped JSON. Relaxing these two
    // rules here keeps that noise out without loosening the shipped code.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
);
