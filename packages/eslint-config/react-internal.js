// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import pluginReactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import { config as baseConfig } from "./base.js";

/**
 * A custom ESLint configuration for libraries that use React.
 *
 * @type {import("eslint").Linter.Config[]} */
export const config = [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        ...globals.browser,
      },
    },
  },
  pluginReactHooks.configs.flat.recommended,
  {
    rules: {
      // React-Compiler-grade analyses from react-hooks v7's recommended
      // preset. Both fire on patterns this codebase uses deliberately:
      // `set-state-in-effect` on one-shot mount effects (opening overlays
      // from navigation intents, resetting inputs when a dialog target
      // changes) and `immutability` on callback refs that assign the
      // forwarded ref object. `rules-of-hooks` and `exhaustive-deps` — the
      // correctness rules — stay enforced. Revisit both when the shell is
      // React-Compiler-ready.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
    },
  },
];
