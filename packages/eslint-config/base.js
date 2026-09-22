// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import babelParser from "@babel/eslint-parser";
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import turboPlugin from "eslint-plugin-turbo";
import onlyWarn from "eslint-plugin-only-warn";
import globals from "globals";
import { createRequire } from "node:module";

// babelOptions must stay structured-cloneable (the parser may cross a worker
// boundary), so the JSX syntax plugin rides along as an absolute PATH string
// rather than an imported module.
const require = createRequire(import.meta.url);
const syntaxJsxPath = require.resolve("@babel/plugin-syntax-jsx");

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const config = [
  js.configs.recommended,
  eslintConfigPrettier,
  {
    // ESLint only lints .js/.mjs/.cjs unless a config matches the extension.
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: ["@babel/preset-typescript"],
        },
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
      // TypeScript owns undefined-variable checking: the babel parser carries
      // no type information, so no-undef would misfire on globals and types.
      "no-undef": "off",
      // Underscore prefixes mark intentionally unused args/vars (the TS
      // configs do not enable noUnusedLocals/noUnusedParameters).
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    plugins: {
      onlyWarn,
    },
  },
  {
    // Babel 8 dropped preset-typescript's isTSX switch — JSX syntax needs
    // the explicit plugin (merged over the block above for .tsx files).
    files: ["**/*.tsx"],
    languageOptions: {
      parserOptions: {
        babelOptions: {
          plugins: [syntaxJsxPath],
        },
      },
    },
  },
  {
    // `no-unused-vars` cannot work on babel-parsed TypeScript: the parser
    // strips type positions before scope analysis, so imports used only in
    // types (and JSX element references) are flagged as unused — false
    // positives by construction. The rule stays on for plain JS, where
    // scope analysis is sound. (typescript-eslint, which understands type
    // space, hard-errors on the TS 7 compiler this repo pins.)
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-unused-vars": "off",
    },
  },
  {
    ignores: ["dist/**", "**/dist/**", ".turbo/**"],
  },
];
