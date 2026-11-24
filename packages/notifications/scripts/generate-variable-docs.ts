import fs from "node:fs";
import path from "node:path";
import {
  templateVariableRegistry,
  type VariableDef,
} from "../src/lib/templateVariables";

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function tokenFor(variable: VariableDef): string {
  return variable.type === "raw-html"
    ? `{{{${variable.path}}}}`
    : `{{${variable.path}}}`;
}

const CATEGORY_HEADINGS: Record<string, string> = {
  auth: "Authentication",
  sla: "SLA",
};

function categoryHeading(category: string): string {
  return (
    CATEGORY_HEADINGS[category] ??
    category.charAt(0).toUpperCase() + category.slice(1)
  );
}

const OUTPUT_PATH = "docs/email/template-variable-reference.md";

function generateMarkdown(): string {
  const lines = [
    "# Email Template Variable Reference",
    "",
    `<!-- Generated from the template variable registry. Do not edit by hand. Regenerate with: npx tsx packages/notifications/scripts/generate-variable-docs.ts --output=${OUTPUT_PATH} -->`,
    "",
    "Every variable each AlgaPSA system email template can use, with its type, meaning, and an example value. It is the same list the in-app **Variable reference** searches, laid out one table per template.",
    "",
    "The customer-facing guide is in the website docs: [Customize Email Templates with Variables](https://www.nineminds.com/documentation/email-template-variables).",
    "",
    "## How to read this reference",
    "",
    "- Each section is one area, and each table is one system template, named as the in-app reference shows it under **Used by**.",
    "- A variable works only in the templates that list it. An invoice variable is empty in a ticket email.",
    "- Ordinary values use double braces, such as `{{ticket.title}}`. Variables of type `raw-html` use triple braces, such as `{{{ticket.changes}}}`, because their value is markup prepared by AlgaPSA.",
    "- A template marked **Not currently sent** can be customized, but AlgaPSA does not dispatch that email today.",
    "",
  ];

  const categories = [
    ...new Set(
      Object.values(templateVariableRegistry).map((entry) => entry.category),
    ),
  ].sort();
  for (const category of categories) {
    lines.push(`## ${categoryHeading(category)}`, "");
    for (const [templateName, entry] of Object.entries(
      templateVariableRegistry,
    )) {
      if (entry.category !== category) continue;
      lines.push(`### ${templateName}`, "");
      if (entry.contractInferred) {
        lines.push(
          "> **Not currently sent:** this variable contract is inferred from the customizable system template. AlgaPSA does not currently dispatch this email.",
          "",
        );
      }
      lines.push(
        "| Variable | Type | Description | Example |",
        "| --- | --- | --- | --- |",
      );
      for (const variable of entry.variables) {
        lines.push(
          `| \`${escapeTableCell(tokenFor(variable))}\` | ${variable.type} | ${escapeTableCell(variable.description)} | \`${escapeTableCell(variable.example)}\` |`,
        );
      }
      lines.push("");
    }
  }

  lines.push(
    "## Notes",
    "",
    "- A value called `ticket.id` or `project.id` is the human-readable ticket or project number, not a database UUID.",
    "- Some URL variables open the client portal for external recipients and the MSP workspace for internal recipients. Do not assume the hostname from the example value.",
    "- Dates may be pre-formatted display text or ISO timestamps. Follow the description for the specific variable rather than applying one date format to every template.",
    "- Keep conditional sections such as `{{#if contactPhone}}...{{/if}}` when the value is optional.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

const outputArgument = process.argv.find((argument) =>
  argument.startsWith("--output="),
);
const markdown = generateMarkdown();
if (outputArgument) {
  const outputPath = path.resolve(outputArgument.slice("--output=".length));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, markdown, "utf8");
  process.stdout.write(`Generated ${outputPath}\n`);
} else {
  process.stdout.write(markdown);
}
