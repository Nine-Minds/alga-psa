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

export default [
    // Global ignores (apply to all config blocks)
    {
        ignores: [
            "eslint-plugin-custom-rules/**/*",
            ".ai/**/*",
            "tools/**/*",
            "ee/extensions/**/*",
            "**/.next/**/*",
            "**/dist/**/*",
            "**/out/**/*",
            "**/build/**/*",
            "**/coverage/**/*",
            "server/public/**/*",
            "server/src/invoice-templates/assemblyscript/**/*"
        ],
    },
    // Configuration for migration files - enforce naming conventions
    // IMPORTANT: This must come first before other configs that might ignore these files
    {
        files: ["**/migrations/**/*.cjs"],
        ignores: [
            "**/migrations/**/utils/**", // Exclude utility files in utils directories
            "ee/server/migrations/**/*", // Exclude EE migrations entirely
        ],
        languageOptions: {
            globals: {
                ...globals.node
            },
            ecmaVersion: 2022,
            sourceType: "commonjs"
        },
        plugins: {
            "custom-rules": customRules,
        },
        rules: {
            "custom-rules/migration-filename": "error",
            "no-unused-vars": "warn",
        }
    },
    // Configuration for JavaScript files (no TypeScript)
    {
        files: ["**/*.{js,mjs,cjs}"],
        ignores: [
            "eslint-plugin-custom-rules/**/*",
            "eslint.config.js",
            "**/eslint.config.js",
            "ee/server/migrations/**/*", // Ignore EE migration files (usually .cjs)
            // Mirror packages under ee/server that aren't primary sources (avoid duplicate lint targets)
            "ee/server/packages/extension-iframe-sdk/**/*",
            "ee/extensions/**/*", // Exclude extension bundles/examples from lint to reduce load and avoid false positives
            "**/dist/**/*",
            "**/.next/**/*",
            "**/out/**/*",
            "tools/**/*",
            ".ai/**/*",
            "**/build/**/*",
            "server/public/**/*",
            "services/workflow-worker/src/workflows/system-email-processing-workflow.ts", // Plain JS for workflow runtime compatibility
            "server/src/invoice-templates/assemblyscript/**/*" // AssemblyScript files have different syntax
        ],
        // Define language options for JS files
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
                React: true,
                JSX: true
            },
            ecmaVersion: 2022,
            sourceType: "module"
        },
        plugins: {
            "custom-rules": customRules,
        },
        rules: {
            // Base ESLint rules for JS
            "no-unused-vars": "warn",
            "no-undef": "warn",
            "no-console": "off",
            // Custom rules
            "custom-rules/map-return-type": "off",
            "custom-rules/check-required-props": "error",
            "custom-rules/no-legacy-ext-imports": "error",
            "custom-rules/no-feature-to-feature-imports": "error",
        }
    },
    // Configuration for TypeScript files
    {
        files: ["**/*.{ts,tsx}"],
        ignores: [
            "eslint-plugin-custom-rules/**/*",
            "eslint.config.js",
            "**/eslint.config.js",
            "ee/server/migrations/**/*",
            // Mirror packages under ee/server that aren't primary sources (avoid duplicate lint targets)
            "ee/server/packages/extension-iframe-sdk/**/*",
            "ee/extensions/**/*",
            "**/dist/**/*",
            "**/.next/**/*",
            "**/out/**/*",
            "tools/**/*",
            ".ai/**/*",
            "**/build/**/*",
            "server/public/**/*",
            "shared/workflow/workflows/system-email-processing-workflow.ts",
            "server/src/invoice-templates/assemblyscript/**/*" // AssemblyScript files have different syntax
        ],
        languageOptions: {
            globals: {
                ...globals.browser,
                React: true,
                JSX: true
            },
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: "module",
                ecmaFeatures: {
                    jsx: true
                },
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
            // NOTE: These rules require type information (parserOptions.project).
            // This repo runs ESLint without typed linting to avoid OOM on large workspaces.
            "@typescript-eslint/no-unsafe-assignment": "off",
            "@typescript-eslint/no-unsafe-member-access": "off",
            "@typescript-eslint/no-unsafe-return": "off",
            "@typescript-eslint/no-unsafe-call": "off",
            "@typescript-eslint/no-unsafe-argument": "off",
            "@typescript-eslint/no-misused-promises": "off",
            "@typescript-eslint/await-thenable": "off",
            "@typescript-eslint/no-floating-promises": "off",
            "@typescript-eslint/no-unnecessary-type-assertion": "off",
            "@typescript-eslint/restrict-plus-operands": "off",
            "@typescript-eslint/restrict-template-expressions": "off",
            "@typescript-eslint/unbound-method": "off",
            "@typescript-eslint/no-non-null-assertion": "warn",
            "@typescript-eslint/no-redundant-type-constituents": "off", // Disabled due to infinite recursion with complex types
            // React hooks rules
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "warn",
            // Custom rules as warnings
            "custom-rules/map-return-type": "off",
            "custom-rules/check-required-props": "error",
            "custom-rules/no-legacy-ext-imports": "error",
            "custom-rules/no-feature-to-feature-imports": "error",
            // Base ESLint rules
            "no-unused-vars": "off", // Turn off in favor of @typescript-eslint/no-unused-vars
            "react/react-in-jsx-scope": "off", // Not needed in Next.js
            "no-undef": "off", // TypeScript handles this
            "react/prop-types": "off", // TypeScript handles this
            // Override recommended configs to use warnings
            // NOTE: Disabled "recommended-requiring-type-checking" due to memory exhaustion during type checking
            ...Object.fromEntries(Object.entries({
                ...tseslint.configs.recommended.rules,
                // ...tseslint.configs["recommended-requiring-type-checking"].rules,  // DISABLED: Causes OOM
            }).map(([key, value]) => [
                key,
                typeof value === 'string' ? 'warn' : ['warn', ...(Array.isArray(value) ? value.slice(1) : [])],
            ])),
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
        rules: Object.fromEntries(Object.entries(pluginJs.configs.recommended.rules || {}).map(([key, value]) => [
            key,
            typeof value === 'string' ? 'warn' : ['warn', ...(Array.isArray(value) ? value.slice(1) : [])],
        ])),
    },
    {
        ...pluginReact.configs.flat.recommended,
        rules: Object.fromEntries(Object.entries(pluginReact.configs.flat.recommended.rules || {}).map(([key, value]) => [
            key,
            typeof value === 'string' ? 'warn' : ['warn', ...(Array.isArray(value) ? value.slice(1) : [])],
        ])),
        settings: {
            react: {
                version: "18.2"
            }
        }
    },
    // Configuration for test files
    {
        files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx", "**/*.playwright.test.ts", "**/__tests__/**/*.ts", "**/__tests__/**/*.tsx"],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.browser,
                React: true,
                JSX: true
            }
        }
    },
    {
        ignores: [
            "**/vitest.config.*.timestamp*"
        ]
    }
];
