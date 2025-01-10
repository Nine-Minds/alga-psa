import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import pluginReact from "eslint-plugin-react";
import customRules from "./eslint-plugin-custom-rules/index.js";

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  {
    files: ["**/*.{js,mjs,cjs,ts,jsx,tsx}"],
    ignores: [
      "eslint-plugin-custom-rules/**/*",
      "eslint.config.js",
      "**/eslint.config.js"
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
        project: ["./server/tsconfig.json", "./ee/server/tsconfig.json"],
        ecmaFeatures: {
          jsx: true
        },
        tsconfigRootDir: ".",
      },
    },

    // Add base rules and plugins
    plugins: {
      "@typescript-eslint": tseslint,
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
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
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

      // Custom rules as warnings
      "custom-rules/map-return-type": "warn",
      "custom-rules/check-required-props": "error",

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
];
