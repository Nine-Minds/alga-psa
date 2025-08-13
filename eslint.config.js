import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import customRules from "./eslint-plugin-custom-rules/index.js";
import { fileURLToPath } from 'url';
import path from 'path';

// Ensure tsconfig resolution works regardless of process.cwd()
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  {
    files: ["**/*.{js,mjs,cjs,ts,jsx,tsx}"],
    ignores: [
      "eslint-plugin-custom-rules/**/*",
      "eslint.config.js",
      "**/eslint.config.js",
      "ee/server/migrations/**/*", // Ignore EE migration files (usually .cjs)
      "ee/extensions/**/*", // Exclude extension bundles/examples from lint to reduce load and avoid false positives
      "dist/**/*",
      "**/.next/**/*",
      "**/out/**/*",
      "tools/**/*",
      ".ai/**/*",
      "**/build/**/*",
      "server/public/**/*",
      "shared/workflow/workflows/system-email-processing-workflow.ts" // Plain JS for workflow runtime compatibility
    ],

    // Define language options
    languageOptions: {
      globals: {
        ...globals.browser,
        React: true,
        JSX: true
      },
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
        project: [
          path.join(__dirname, 'server/tsconfig.json'),
          path.join(__dirname, 'ee/server/tsconfig.json'),
          path.join(__dirname, 'shared/tsconfig.json'),
          path.join(__dirname, 'services/workflow-worker/tsconfig.json'),
        ],
        ecmaFeatures: {
          jsx: true
        },
        // Point to repo root so tsconfig extends work in editors
        tsconfigRootDir: __dirname,
      },
    },

    // Add base rules and plugins
    plugins: {
      "@typescript-eslint": tseslint,
      "react-hooks": pluginReactHooks,
      "custom-rules": customRules,
    },

    rules: {
      // TypeScript rules
      "@typescript-eslint/explicit-function-return-type": [
        "warn",
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowFunctionsWithoutTypeParameters: true,
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["off", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/await-thenable": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/restrict-plus-operands": "warn",
      "@typescript-eslint/restrict-template-expressions": "warn",
      "@typescript-eslint/unbound-method": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",

      // React hooks rules
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // Custom rules as warnings
      "custom-rules/map-return-type": "off",
      "custom-rules/check-required-props": "error",
      "custom-rules/no-legacy-ext-imports": "error",

      // Base ESLint rules
      "no-unused-vars": "off", // Turn off in favor of @typescript-eslint/no-unused-vars
      "react/react-in-jsx-scope": "off", // Not needed in Next.js
      "no-undef": "off", // TypeScript handles this
      "react/prop-types": "off", // TypeScript handles this

      // Override recommended configs to use warnings
      ...Object.fromEntries(
        Object.entries({
          ...tseslint.configs.recommended.rules,
          ...tseslint.configs["recommended-requiring-type-checking"].rules,
          ...tseslint.configs.strict.rules,
        }).map(([key, value]) => [
          key,
          typeof value === 'string' ? 'warn' : ['warn', ...(Array.isArray(value) ? value.slice(1) : [])],
        ])
      ),
    },

    settings: {
      typescript: {
        alwaysTryTypes: true,
      }
    }
  },

  // Add plugin-specific configurations with warnings
  {
    ...pluginJs.configs.recommended,
    rules: Object.fromEntries(
      Object.entries(pluginJs.configs.recommended.rules || {}).map(([key, value]) => [
        key,
        typeof value === 'string' ? 'warn' : ['warn', ...(Array.isArray(value) ? value.slice(1) : [])],
      ])
    ),
  },
  {
    ...pluginReact.configs.flat.recommended,
    rules: Object.fromEntries(
      Object.entries(pluginReact.configs.flat.recommended.rules || {}).map(([key, value]) => [
        key,
        typeof value === 'string' ? 'warn' : ['warn', ...(Array.isArray(value) ? value.slice(1) : [])],
      ])
    ),
    settings: {
      react: {
        version: "18.2"
      }
    }
  },

  // Configuration for test files
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx", "**/*.playwright.test.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        React: true,
        JSX: true
      }
    }
  }
];
