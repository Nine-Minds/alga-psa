import type { VariableDef, VariableType } from "./types";
import { sharedBlockSeed } from "./seed";

type InventoryVariable = {
  path: string;
  type: string;
  description: string;
  example: string;
  availability: VariableDef["availability"];
  notes?: string;
};

const RAW_HTML_PATHS = new Set([
  "ticket.changes",
  "ticket.resolution",
  "ticket.description",
  "project.changes",
  "comment.content",
  "comment.contentHtml",
  "tenantLinksHtml",
  "credits.items",
  "rating_buttons_html",
]);

export function normalizeVariableType(
  variable: InventoryVariable,
): VariableType {
  if (RAW_HTML_PATHS.has(variable.path) && variable.type !== "array")
    return "raw-html";
  if (variable.type === "date-string") return "date";
  return variable.type as VariableType;
}

function blockVariable(variable: InventoryVariable): VariableDef {
  return {
    ...variable,
    type: normalizeVariableType(variable),
    concept: [variable.path],
  };
}

/**
 * Reusable authoring fragments documented by the approved inventory. Registry
 * entries remain per-template because availability is never block-global.
 */
export const sharedVariableBlocks = Object.fromEntries(
  sharedBlockSeed.map((block) => [
    block.name,
    block.variables.map((variable) =>
      blockVariable(variable as InventoryVariable),
    ),
  ]),
) as Record<string, VariableDef[]>;
