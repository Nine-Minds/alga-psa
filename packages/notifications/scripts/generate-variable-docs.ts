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

function generateMarkdown(): string {
  const lines = [
    "---",
    'title: "10.7. Customize Email Templates with Variables"',
    "slug: email-template-variables",
    "category: 10. Settings",
    "order: 10.07",
    'description: "Find, insert, and safely use the variables available in each Alga PSA system email template."',
    "---",
    "Email template variables let your MSP reuse live ticket, client, invoice, appointment, and other operational details in custom messages. Alga PSA limits the available variables to the selected system template so a token from one workflow is not accidentally used in another.",
    "",
    "Open **Settings > Notifications > Email Templates**. Select **Variable reference** to search every template, or customize a template to see only the variables available in that message. Selecting a variable in the editor panel inserts it at the last cursor position; the copy action puts the complete Handlebars token on your clipboard.",
    "",
    "Use double braces for ordinary values, such as `{{ticket.title}}`. Variables marked `raw-html` use triple braces, such as `{{{ticket.changes}}}`, because their value contains markup prepared by Alga PSA. Only use triple braces for variables explicitly marked `raw-html`.",
    "",
    "After editing a template, preview it with sample data and send a test email. Check the subject, links, optional sections, and plain-text version before saving it for production use.",
    "",
  ];

  const categories = [
    ...new Set(
      Object.values(templateVariableRegistry).map((entry) => entry.category),
    ),
  ].sort();
  for (const category of categories) {
    lines.push(`## ${category}`, "");
    for (const [templateName, entry] of Object.entries(
      templateVariableRegistry,
    )) {
      if (entry.category !== category) continue;
      lines.push(`### ${templateName}`, "");
      if (entry.contractInferred) {
        lines.push(
          "> **Not currently sent:** this variable contract is inferred from the customizable system template. Alga PSA does not currently dispatch this email.",
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
    "## Operational checks",
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
