import { createRequire } from "node:module";
import path from "node:path";
import Handlebars from "handlebars";
import { describe, expect, it } from "vitest";
import inventory from "../../../../../docs/plans/2026-07-17-email-template-variables-inventory.json";
import { getNestedTemplateExampleData } from "./exampleData";
import { templateVariableRegistry } from "./registry";
import { sharedBlockSeed, templateVariableSeed } from "./seed";

type TemplateModule = {
  getTemplate: () => {
    templateName: string;
    translations: Array<{
      language: string;
      subject: string;
      htmlContent: string;
      textContent: string;
    }>;
  };
};

const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(__dirname, "../../../../..");

describe("email template variable registry", () => {
  it("adds plain detail arrays only to the existing closed-ticket contract", () => {
    const variables = templateVariableRegistry["ticket-closed"].variables;
    for (const name of ["assets", "materials", "timeEntries"]) {
      expect(variables.find(variable => variable.path === `ticket.${name}`)?.type).toBe("array");
      for (const [template, entry] of Object.entries(templateVariableRegistry)) {
        if (template !== "ticket-closed" && template !== "ticket-closed-client") {
          expect(entry.variables.some(variable => variable.path === `ticket.${name}`)).toBe(false);
        }
      }
    }
    // The client variant may only carry client-audience detail variables: the
    // asset subtree, the work-history time blocks and the client's own hour-block
    // balance. Material rates and billed state stay MSP-only and are projected
    // out of client renderings.
    const clientVariables = templateVariableRegistry["ticket-closed-client"].variables;
    expect(clientVariables.find(variable => variable.path === "ticket.assets")?.type).toBe("array");
    expect(clientVariables.find(variable => variable.path === "ticket.timeEntries")?.type).toBe("array");
    expect(clientVariables.some(variable => variable.path === "ticket.remainingBlockHours")).toBe(true);
    for (const name of ["materials", "materialsTotal"]) {
      expect(clientVariables.some(variable => variable.path === `ticket.${name}`)).toBe(false);
    }
    expect(variables.some(variable => /ticket\.(assets|materials|time)Html/.test(variable.path))).toBe(false);
    expect(templateVariableRegistry["ticket-closed-internal"]).toBeUndefined();
    const data = getNestedTemplateExampleData("ticket-closed");
    const html = Handlebars.compile(
      "{{#each ticket.timeEntries}}{{date}} | {{technician}} | {{worked}} | {{billable}}{{/each}}",
      { strict: true },
    )(data);
    expect(html).toBe("06/10/2025 | Jane Smith | 1 hr, 30 min | 1 hr");
  });

  it("keeps the generated seed in sync with the inventory", () => {
    expect(templateVariableSeed).toEqual(inventory.categories.map((category) => ({
      category: category.category,
      templates: category.templates.map((template) => ({
        templateName: template.templateName,
        variables: template.variables,
      })),
    })));
    expect(sharedBlockSeed).toEqual(inventory.synthesis.sharedBlocks);
  });

  it("records the corrected contracts and inferred templates", () => {
    expect(
      Object.values(templateVariableRegistry).filter(
        (entry) => entry.contractInferred,
      ),
    ).toHaveLength(8);
    expect(
      templateVariableRegistry["credit-expiring"].variables.map(
        (variable) => variable.path,
      ),
    ).toContain("client.name");
    expect(
      templateVariableRegistry["credit-expiring"].variables.map(
        (variable) => variable.path,
      ),
    ).not.toContain("company.name");
    expect(
      templateVariableRegistry.SURVEY_TICKET_CLOSED.variables.find(
        (variable) => variable.path === "rating_buttons_html",
      )?.type,
    ).toBe("raw-html");
  });

  it("strictly renders every locale using registry examples", () => {
    const templates = inventory.categories.flatMap(
      (category) => category.templates,
    );
    expect(Object.keys(templateVariableRegistry)).toHaveLength(
      templates.length,
    );

    for (const inventoryTemplate of templates) {
      const modulePath = path.join(
        repositoryRoot,
        inventoryTemplate.sourceFile,
      );
      const template = (require(modulePath) as TemplateModule).getTemplate();
      const exampleData = getNestedTemplateExampleData(template.templateName);

      expect(
        templateVariableRegistry[template.templateName],
        template.templateName,
      ).toBeDefined();
      for (const translation of template.translations) {
        const context = `${template.templateName}/${translation.language}`;
        expect(
          () =>
            Handlebars.compile(translation.subject, { strict: true })(
              exampleData,
            ),
          context,
        ).not.toThrow();
        expect(
          () =>
            Handlebars.compile(translation.htmlContent, { strict: true })(
              exampleData,
            ),
          context,
        ).not.toThrow();
        expect(
          () =>
            Handlebars.compile(translation.textContent, { strict: true })(
              exampleData,
            ),
          context,
        ).not.toThrow();
      }
    }
  });
});
