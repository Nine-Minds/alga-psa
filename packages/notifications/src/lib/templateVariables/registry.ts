import { normalizeVariableType, sharedVariableBlocks } from "./blocks";
import { templateVariableSeed } from "./seed";
import type {
  TemplateVariableRegistry,
  VariableAvailability,
  VariableDef,
} from "./types";

type InventoryVariable = {
  path: string;
  type: string;
  description: string;
  example: string;
  availability: VariableAvailability;
  notes?: string;
};

const INFERRED_CONTRACTS = new Set([
  "invoice-generated",
  "payment-overdue",
  "payment-received",
  "milestone-completed",
  "task-updated",
  "time-entry-approved",
  "time-entry-rejected",
  "time-entry-submitted",
]);

const CONCEPT_ALIASES: Array<[RegExp, string[]]> = [
  [/ticket(?:\.|_)?(?:id|number)/i, ["ticket", "ticket number", "work item"]],
  [
    /ticket(?:\.|_)?(?:title|subject)/i,
    ["ticket", "ticket title", "work item"],
  ],
  [/(?:client|company)(?:\.|_)?name/i, ["client", "client company", "company"]],
  [
    /(?:recipient|requester|contact|user|technician)(?:\.|_)?name/i,
    ["recipient", "person", "contact"],
  ],
  [
    /(?:recipient|requester|contact|support|technician)(?:\.|_)?email/i,
    ["recipient email", "contact email"],
  ],
  [/(?:assigned|assignee|technician)/i, ["assignee", "technician"]],
  [/url|link/i, ["link", "url"]],
  [/date|at$/i, ["date", "time"]],
];

function conceptsFor(variable: InventoryVariable): string[] {
  const concepts = new Set<string>([
    variable.path,
    variable.path.replace(/[._]/g, " "),
  ]);
  const searchableText = `${variable.path} ${variable.description} ${variable.notes ?? ""}`;
  for (const [pattern, aliases] of CONCEPT_ALIASES) {
    if (pattern.test(searchableText))
      aliases.forEach((alias) => concepts.add(alias));
  }
  return [...concepts];
}

function registryVariable(variable: InventoryVariable): VariableDef {
  return {
    ...variable,
    type: normalizeVariableType(variable),
    concept: conceptsFor(variable),
  };
}

const FIXED_PHANTOM_PATHS: Record<string, Set<string>> = {
  "ticket-assigned": new Set(["ticket.summary"]),
  "ticket-created": new Set(["ticket.summary"]),
  "ticket-team-assigned": new Set(["ticket.summary"]),
  "ticket-updated": new Set(["ticket.summary", "ticket.updatedAt"]),
  "ticket-closed": new Set(["ticket.closedAt"]),
  "ticket-comment-added": new Set(["comment.authorName", "comment.body"]),
  SURVEY_TICKET_CLOSED: new Set(["technicien_name"]),
};

function correctedVariables(
  templateName: string,
  variables: InventoryVariable[],
): VariableDef[] {
  if (templateName === "credit-expiring") {
    return variables
      .filter((variable) => variable.path !== "company.name")
      .map((variable) =>
        registryVariable(
          variable.path === "client.name"
            ? { ...variable, availability: "used" }
            : variable,
        ),
      );
  }

  const removedPaths = FIXED_PHANTOM_PATHS[templateName];
  return variables
    .filter((variable) => !removedPaths?.has(variable.path))
    .map(registryVariable);
}

export const templateVariableRegistry: TemplateVariableRegistry =
  Object.fromEntries(
  templateVariableSeed.flatMap((category) =>
      category.templates.map((template) => [
        template.templateName,
        {
          category: category.category,
          variables: correctedVariables(
            template.templateName,
            template.variables as InventoryVariable[],
          ),
          contractInferred: INFERRED_CONTRACTS.has(template.templateName),
        },
      ]),
    ),
  );

export const templateVariableCategories = [
  ...new Set(
    Object.values(templateVariableRegistry).map((entry) => entry.category),
  ),
].sort();

export { sharedVariableBlocks };
