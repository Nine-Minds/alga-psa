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
  it("exposes shared and internal-only detail variables to the correct audiences", () => {
    for (const variablePath of [
      "ticket.assets", "ticket.assetsHtml", "ticket.categoryDetails",
      "ticket.totalTimeWorked", "ticket.totalTimeBillable", "ticket.remainingBlockHours",
    ]) {
      for (const audience of ["client", "internal"]) {
        expect(templateVariableRegistry[`ticket-closed-${audience}`].variables.some(
          (entry) => entry.path === variablePath,
        )).toBe(true);
      }
    }
    for (const variablePath of ["ticket.materialsHtml", "ticket.materialsTotal", "ticket.timeHtml"]) {
      expect(templateVariableRegistry["ticket-closed-client"].variables.some(
        (entry) => entry.path === variablePath,
      )).toBe(false);
      expect(templateVariableRegistry["ticket-closed-internal"].variables.some(
        (entry) => entry.path === variablePath,
      )).toBe(true);
    }
  });

  it("keeps the asset variable example as data and renders the editable stock loop", () => {
    const entry = templateVariableRegistry["ticket-closed-client"];
    const example = entry.variables.find((variable) => variable.path === "ticket.assets")!;
    expect(example.example).toBe("{{ticket.assets}}");
    // The require path is built through a non-foldable expression on purpose: a
    // statically resolvable require("server/...") here would add a
    // notifications -> server edge to the Nx project graph and re-introduce the
    // billing -> notifications -> server cycle the circular-deps gate fails on.
    const template = (require(require('node:path').resolve(__dirname, "../../../../../server/migrations/utils/templates/email/tickets/ticketClosedClient.cjs")) as TemplateModule).getTemplate();
    const data = getNestedTemplateExampleData("ticket-closed-client");
    const html = Handlebars.compile(template.translations[0].htmlContent, { strict: true })(data);
    expect(html).toContain("<table");
    expect(html).toContain("Office Printer");
    expect(html).toContain("Printer");
    expect(html).toContain("Brother HL-L6200DW");
    expect(html).toContain("SN-0042");
    expect(html).not.toContain("AST-0042");
    const internal = templateVariableRegistry["ticket-closed-internal"];
    const assetsHtml = internal.variables.find((variable) => variable.path === "ticket.assetsHtml")!.example;
    for (const header of ["Asset Tag", "Name", "Serial #", "Status", "Relationship"]) {
      expect(assetsHtml).toContain(`>${header}</th>`);
    }
    for (const [path, headers] of [
      ["ticket.materialsHtml", ["Item", "Qty", "Rate", "Amount", "Billed"]],
      ["ticket.timeHtml", ["Technician", "Date", "Worked", "Billable"]],
    ] as const) {
      const sample = internal.variables.find((variable) => variable.path === path)!.example;
      for (const header of headers) expect(sample).toContain(`>${header}</th>`);
    }
  });

  it("renders the documented quick start and hides empty detail sections", () => {
    const guide = readFileSync(path.join(repositoryRoot, "docs/email/editing-ticket-email-html.md"), "utf8");
    const source = guide.match(/```handlebars\r?\n([\s\S]*?)```/)![1];
    const render = Handlebars.compile(source, { strict: true });
    const data = getNestedTemplateExampleData("ticket-closed-internal");
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
    const variables = templateVariableRegistry["ticket-closed-internal"].variables;
    for (const variablePath of ["ticket.assetsHtml", "ticket.materialsHtml", "ticket.timeHtml"]) {
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
