import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
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
  it("labels ticket detail variables with their client and internal Ticket Closed scope", () => {
    for (const variablePath of [
      "ticket.assets", "ticket.assetsHtml", "ticket.materialsHtml", "ticket.materialsTotal",
      "ticket.timeHtml", "ticket.totalTimeWorked", "ticket.totalTimeBillable", "ticket.remainingBlockHours",
    ]) {
      const variable = templateVariableRegistry["ticket-closed"].variables.find((entry) => entry.path === variablePath)!;
      expect(variable.description).toMatch(/^Ticket Closed only \(client and internal emails\):/);
      for (const [templateName, template] of Object.entries(templateVariableRegistry)) {
        if (templateName !== "ticket-closed") {
          expect(template.variables.some((entry) => entry.path === variablePath)).toBe(false);
        }
      }
    }
  });

  it("renders the editable asset example with individually selectable fields", () => {
    const entry = templateVariableRegistry["ticket-closed"];
    const example = entry.variables.find((variable) => variable.path === "ticket.assets")!;
    const data = getNestedTemplateExampleData("ticket-closed");
    const html = Handlebars.compile(example.example, { strict: true })(data);
    expect(html).toContain("<table");
    expect(html.match(/<th /g)).toHaveLength(4);
    expect(html.match(/<td /g)).toHaveLength(4);
    expect(html).toContain("Office Printer");
    expect(html).toContain("Printer");
    expect(html).toContain("Brother HL-L6200DW");
    expect(html).toContain("SN-0042");
    expect(html).not.toContain("AST-0042");
    const assetsHtml = entry.variables.find((variable) => variable.path === "ticket.assetsHtml")!.example;
    for (const header of ["Asset Tag", "Name", "Serial #", "Status", "Relationship"]) {
      expect(assetsHtml).toContain(`>${header}</th>`);
    }
    for (const [path, headers] of [
      ["ticket.materialsHtml", ["Item", "Qty", "Rate", "Amount", "Billed"]],
      ["ticket.timeHtml", ["Technician", "Date", "Worked", "Billable"]],
    ] as const) {
      const sample = entry.variables.find((variable) => variable.path === path)!.example;
      for (const header of headers) expect(sample).toContain(`>${header}</th>`);
    }
  });

  it("renders the documented quick start and hides empty detail sections", () => {
    const guide = readFileSync(path.join(repositoryRoot, "docs/email/editing-ticket-email-html.md"), "utf8");
    const source = guide.match(/```handlebars\r?\n([\s\S]*?)```/)![1];
    const render = Handlebars.compile(source, { strict: true });
    const data = getNestedTemplateExampleData("ticket-closed");
    const html = render(data);
    for (const value of ["Office Printer", "Toner cartridge", "3 hrs 30 min", "2 hrs 15 min", "12 hrs 45 min"]) {
      expect(html).toContain(value);
    }
    const emptyHtml = render({
      ticket: {
        assetsHtml: "", materialsHtml: "", materialsTotal: "0",
        totalTimeWorked: "0 hrs", totalTimeBillable: "0 hrs", remainingBlockHours: "0 hrs",
      },
    });
    expect(emptyHtml).not.toContain("<h3>");
    expect(emptyHtml).toContain("Remaining Block Hours: 0 hrs");
  });

  it("uses the fixed renderer's exact table styles in every ticket detail example", () => {
    const source = readFileSync(path.join(repositoryRoot, "server/src/lib/notifications/ticketEmailDetailBlocks.ts"), "utf8");
    const styles = [
      ["table", "DETAIL_TABLE_STYLE"],
      ["th", "DETAIL_TH_STYLE"],
      ["td", "DETAIL_TD_STYLE"],
    ] as const;
    const variables = templateVariableRegistry["ticket-closed"].variables;
    for (const variablePath of ["ticket.assets", "ticket.assetsHtml", "ticket.materialsHtml", "ticket.timeHtml"]) {
      const sample = variables.find((variable) => variable.path === variablePath)!.example;
      for (const [tag, constant] of styles) {
        const style = source.match(new RegExp(`const ${constant} = '([^']+)';`))![1];
        const tags = sample.match(new RegExp(`<${tag}\\b[^>]*>`, "g"))!;
        expect(tags.length).toBeGreaterThan(0);
        for (const element of tags) expect(element).toBe(`<${tag} style="${style}">`);
      }
    }
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
