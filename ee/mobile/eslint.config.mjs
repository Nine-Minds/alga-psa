import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

/**
 * Colours belong to the tenant's theme pair, which arrives from the server; a
 * hex literal in a component ignores it. The allow-list is the palette layer
 * itself plus the identity colours and the generated editor HTML.
 */
export const HEX_COLOR_ALLOW_LIST = [
  "src/ui/themes.ts",
  "src/ui/colors.ts",
  "src/ui/tagColors.ts",
  "src/ui/components/Avatar.tsx",
  "src/features/ticketRichText/generatedEditorHtml.ts",
];

const HEX_LITERAL_SELECTOR =
  "Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]";

export default [
  {
    ignores: ["node_modules/**", ".expo/**", "dist/**", "web-build/**"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: [...HEX_COLOR_ALLOW_LIST, "src/**/*.test.ts", "src/**/*.test.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: HEX_LITERAL_SELECTOR,
          message:
            "Use a theme token (useTheme().colors.*) instead of a hex colour; the tenant's pair comes from the server.",
        },
      ],
    },
  },
];
