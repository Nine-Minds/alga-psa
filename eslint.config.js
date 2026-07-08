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

// Feature packages whose `@alga-psa/<pkg>/actions` (and, where noted, `/components`) BARREL
// must not be imported from shared/hot code: a barrel pulls every 'use server' file of the
// package into every route's RSC server-reference manifest, which in dev grows ~O(actions ×
// routes) and eventually exceeds V8's ~512MB JSON.stringify string cap (OOM). Import the
// specific module instead (e.g. @alga-psa/clients/actions/queryActions). Exact-string `paths`
// (not globs) so granular subpaths like `.../actions/queryActions` stay allowed.
// See docs/architecture/package-build-system.md.
const ALGA_ACTION_BARREL_PKGS = [
    "assets", "auth", "billing", "block-content", "client-portal", "clients", "documents",
    "email", "integrations", "inventory", "jobs", "licensing", "notifications", "onboarding",
    "portal-shared", "projects", "reference-data", "reporting", "scheduling", "search", "sla",
    "surveys", "tags", "teams", "tenancy", "tickets", "user-activities", "user-composition", "users",
];
const ALGA_COMPONENT_BARREL_PKGS = [
    "assets", "auth", "billing", "client-portal", "clients", "documents", "integrations",
    "inventory", "jobs", "notifications", "onboarding", "projects", "reference-data", "scheduling",
    "sla", "surveys", "tags", "tenancy", "tickets", "user-activities", "users",
];
const ALGA_BARREL_RESTRICTED_PATHS = [
    ...ALGA_ACTION_BARREL_PKGS.map((p) => ({
        name: `@alga-psa/${p}/actions`,
        message: `Import the specific action module (e.g. @alga-psa/${p}/actions/<file>), not the /actions barrel — the barrel pulls every 'use server' file of the package into every route's RSC server-reference manifest (dev OOM). See docs/architecture/package-build-system.md.`,
    })),
    ...ALGA_COMPONENT_BARREL_PKGS.map((p) => ({
        name: `@alga-psa/${p}/components`,
        message: `Import the specific component file (e.g. @alga-psa/${p}/components/<file>), not the feature /components barrel — it transitively pulls the package's /actions barrel into every route's manifest (dev OOM).`,
    })),
];

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
    // Runtime boundary guardrails for workflow worker and shared runtime.
    {
        files: [
            "services/workflow-worker/src/**/*.{js,mjs,cjs,ts,tsx}",
            "shared/workflow/runtime/**/*.{js,mjs,cjs,ts,tsx}"
        ],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    paths: [
                        {
                            name: "@alga-psa/auth",
                            message: "Auth package root imports are not allowed in worker/runtime code."
                        },
                        {
                            name: "@alga-psa/documents",
                            message: "Use @alga-psa/documents/runtime or @alga-psa/storage in worker/runtime code."
                        },
                        {
                            name: "@alga-psa/integrations",
                            message: "Use @alga-psa/integrations/runtime in worker/runtime code."
                        },
                        {
                            name: "@alga-psa/billing",
                            message: "Use @alga-psa/billing/runtime in worker/runtime code."
                        },
                        {
                            name: "@alga-psa/ui",
                            message: "UI package imports are not allowed in worker/runtime code."
                        }
                    ],
                    patterns: [
                        {
                            group: [
                                "@alga-psa/ui/*",
                                "@alga-psa/*/components",
                                "@alga-psa/*/components/*"
                            ],
                            message: "Component imports are not allowed in worker/runtime code."
                        }
                    ]
                }
            ]
        }
    },
    // Server-action barrel guardrail (dev RSC server-reference-manifest bloat → OOM).
    // A `@alga-psa/<pkg>/actions` barrel (or a feature `/components` barrel, which pulls it)
    // drags every 'use server' file of the package into every route's server-reference
    // manifest — dev has no tree-shaking, so the manifest grows ~O(actions × routes) and
    // eventually exceeds V8's ~512MB string cap during JSON.stringify. In shared/hot code,
    // import the specific module: `@alga-psa/clients/actions/queryActions`, not `/actions`.
    // See docs/architecture/package-build-system.md.
    {
        files: [
            "server/src/components/layout/**/*.{ts,tsx}",
            "server/src/app/layout.tsx",
            "server/src/app/msp/layout.tsx",
            "server/src/app/msp/MspLayoutClient.tsx",
            "packages/msp-composition/src/**/*.{ts,tsx}",
            // Shell-reachable feature components granularized in the same pass:
            "packages/billing/src/components/settings/billing/QuickAddProduct.tsx",
            "packages/billing/src/components/settings/billing/QuickAddService.tsx",
            "packages/clients/src/components/clients/QuickAddClient.tsx",
            "packages/clients/src/components/clients/ClientQuickView.tsx",
            "packages/clients/src/components/contacts/QuickAddContact.tsx",
            "packages/projects/src/components/ProjectQuickAdd.tsx",
            "packages/tickets/src/components/QuickAddTicket.tsx",
            // Cross-package barrels inside action files re-close the graph over every package,
            // so every server-action file is held to the same rule.
            "packages/*/src/actions/**/*.{ts,tsx}",
        ],
        ignores: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**"],
        rules: {
            "no-restricted-imports": ["error", { paths: ALGA_BARREL_RESTRICTED_PATHS }],
        },
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
