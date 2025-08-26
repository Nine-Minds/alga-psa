const FORBIDDEN_SUBSTRINGS = [
  "ee/server/src/lib/extensions/ui/descriptors/",
  "ee/server/src/lib/extensions/ui/pages/",
  "ee/server/src/lib/extensions/ui/tabs/",
  "ee/server/src/lib/extensions/ui/navigation/",
  "ee/server/src/lib/extensions/security/propWhitelist.ts",
  "ee/server/src/lib/extensions/schemas/manifest.schema.ts",
  "ee/server/src/lib/extensions/schemas/extension-points.schema.ts",
  "ee/server/src/lib/extensions/validator.ts",
  "/api/extensions/",
];

// Normalize path separators for safety across OS
function normalizePath(value) {
  if (typeof value !== "string") return value;
  return value.replace(/\\+/g, "/");
}

function isForbidden(value) {
  if (typeof value !== "string") return false;
  const v = normalizePath(value);
  return FORBIDDEN_SUBSTRINGS.some((needle) => v.includes(needle));
}

const MESSAGE =
  "Legacy extension system import is forbidden; use v2 APIs (Runner/Gateway/ManifestV2).";

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow imports/usages from legacy extension system paths. Use v2 APIs instead.",
      recommended: true,
    },
    schema: [], // no options
    messages: {
      forbiddenLegacy: MESSAGE,
    },
  },

  create(context) {
    return {
      // import foo from "module";
      // import("module")
      ImportDeclaration(node) {
        const sourceVal = node?.source?.value;
        if (isForbidden(sourceVal)) {
          context.report({
            node: node.source,
            messageId: "forbiddenLegacy",
          });
        }
      },

      // require("module")
      CallExpression(node) {
        try {
          const callee = node.callee;
          const isRequire =
            callee &&
            callee.type === "Identifier" &&
            callee.name === "require";

          if (isRequire && node.arguments && node.arguments.length) {
            const arg = node.arguments[0];
            if (arg && arg.type === "Literal" && typeof arg.value === "string") {
              if (isForbidden(arg.value)) {
                context.report({
                  node: arg,
                  messageId: "forbiddenLegacy",
                });
              }
            }
          }
        } catch {
          // noop
        }
      },

      // import("module") as ImportExpression (ESTree for dynamic import)
      ImportExpression(node) {
        const src = node.source;
        if (src && src.type === "Literal" && typeof src.value === "string") {
          if (isForbidden(src.value)) {
            context.report({
              node: src,
              messageId: "forbiddenLegacy",
            });
          }
        }
      },

      // Bare string literals anywhere in source (to catch raw "/api/extensions/" usage)
      // Note: This purposely may be broad to ensure no raw usage sneaks in.
      Literal(node) {
        if (typeof node.value === "string" && isForbidden(node.value)) {
          // Avoid double-reporting on import literals already handled above by checking parent types
          const parentType = node.parent && node.parent.type;
          const parentIsImport =
            parentType === "ImportDeclaration" ||
            parentType === "ImportExpression" ||
            (parentType === "CallExpression" &&
              node.parent.callee &&
              node.parent.callee.type === "Identifier" &&
              node.parent.callee.name === "require");

          if (!parentIsImport) {
            context.report({
              node,
              messageId: "forbiddenLegacy",
            });
          }
        }
      },
    };
  },
};