import { createRequire } from "node:module";
import path from "node:path";
import Handlebars from "handlebars";
import { describe, expect, it } from "vitest";
import inventory from "../../../../../docs/plans/2026-07-17-email-template-variables-inventory.json";
import { getNestedTemplateExampleData } from "./exampleData";
import { templateVariableRegistry } from "./registry";

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
