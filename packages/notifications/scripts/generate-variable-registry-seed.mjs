import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const inventoryPath = path.join(
  repositoryRoot,
  "docs/plans/2026-07-17-email-template-variables-inventory.json",
);
const outputPath = path.join(
  scriptDirectory,
  "../src/lib/templateVariables/seed.ts",
);
const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));

const templateVariableSeed = inventory.categories.map((category) => ({
  category: category.category,
  templates: category.templates.map((template) => ({
    templateName: template.templateName,
    variables: template.variables,
  })),
}));

const contents = `/**
 * Generated from docs/plans/2026-07-17-email-template-variables-inventory.json.
 * Run packages/notifications/scripts/generate-variable-registry-seed.mjs after
 * an approved inventory change; runtime code must not import planning files.
 */
type SeedVariable = {
  path: string;
  type: string;
  description: string;
  example: string;
  availability: string;
  notes?: string;
};

type TemplateVariableSeedCategory = {
  category: string;
  templates: Array<{
    templateName: string;
    variables: SeedVariable[];
  }>;
};

type SharedVariableBlockSeed = {
  name: string;
  usedByCategories: string[];
  notes: string;
  variables: SeedVariable[];
};

export const templateVariableSeed: TemplateVariableSeedCategory[] = ${JSON.stringify(templateVariableSeed, null, 2)};

export const sharedBlockSeed: SharedVariableBlockSeed[] = ${JSON.stringify(inventory.synthesis.sharedBlocks, null, 2)};
`;

fs.writeFileSync(outputPath, contents, "utf8");
process.stdout.write(`Generated ${outputPath}\n`);
