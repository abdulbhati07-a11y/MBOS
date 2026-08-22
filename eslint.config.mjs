import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The NestJS backend is a separate TS project with its own tsconfig and
    // eslint config (backend/eslint.config.mjs). It must not be linted or
    // type-checked by the frontend toolchain — Nest's decorators require
    // experimentalDecorators, which the frontend tsconfig does not set.
    "backend/**",
  ]),
]);

export default eslintConfig;
