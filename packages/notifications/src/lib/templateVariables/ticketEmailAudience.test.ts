import { describe, expect, it } from "vitest";
import { templateVariableRegistry } from "./registry";
import {
  CLIENT_TICKET_EMAIL_TEMPLATES,
  TICKET_EMAIL_CLIENT_VARIANTS,
  TICKET_EMAIL_TEMPLATES_COPIED_FROM,
  TICKET_EMAIL_VARIABLE_AUDIENCE,
  isTicketEmailTemplate,
  isTicketVariableClassified,
  projectTicketEmailContext,
  resolveTicketEmailTemplate,
  templateVariablesHiddenFromClients,
  ticketEmailRecipientVariables,
  ticketVariableAudience,
} from "./ticketEmailAudience";

const ticketTemplates = Object.entries(templateVariableRegistry).filter(
  ([, entry]) => entry.category === "tickets",
);

describe("ticket email variable audience", () => {
  it("classifies every variable of every ticket template", () => {
    const unclassified = ticketTemplates.flatMap(([name, entry]) =>
      entry.variables
        .filter((variable) => !isTicketVariableClassified(variable.path))
        .map((variable) => `${name}: ${variable.path}`),
    );
    expect(unclassified).toEqual([]);
  });

  it("puts the audience on each registry entry", () => {
    for (const [, entry] of ticketTemplates) {
      for (const variable of entry.variables) {
        expect(variable.audience).toBe(ticketVariableAudience(variable.path));
      }
    }
    expect(templateVariableRegistry["invoice-generated"].variables[0].audience).toBeUndefined();
  });

  it("treats a path nobody classified as MSP-only", () => {
    expect(ticketVariableAudience("ticket.somethingNew")).toBe("msp");
    expect(ticketVariableAudience("brandNewBlock.value")).toBe("msp");
  });

  it("lets an entry cover its subtree", () => {
    expect(ticketVariableAudience("ticket.assets[].serialNumber")).toBe("client");
    expect(ticketVariableAudience("ticket.timeEntries[].technician")).toBe("client");
    expect(ticketVariableAudience("ticket.materials[].rate")).toBe("msp");
  });

  it("uses only the two audiences", () => {
    expect(new Set(Object.values(TICKET_EMAIL_VARIABLE_AUDIENCE))).toEqual(
      new Set(["client", "msp"]),
    );
  });
});

describe("projectTicketEmailContext", () => {
  const context = {
    ticket: {
      id: "T-1",
      title: "Printer offline",
      url: "https://msp.example.com/msp/tickets/1",
      assets: [{ name: "HP-01", serialNumber: "X1" }],
      timeEntries: [{ technician: "Morgan", worked: 30 }],
      totalTimeWorked: 90,
      materialsTotal: 12000,
      somethingNew: "unclassified",
    },
    comment: { id: "c1", content: "<p>Hi</p>", authorType: "internal" },
    internalNotes: { anything: true },
  };

  it("hands the MSP rendering the context unchanged", () => {
    const projection = projectTicketEmailContext(context, "msp");
    expect(projection.context).toBe(context);
    expect(projection.dropped).toEqual([]);
  });

  it("names every path it leaves out of the client rendering", () => {
    expect(projectTicketEmailContext(context, "client").dropped.sort()).toEqual([
      "comment.authorType",
      "internalNotes.anything",
      "ticket.materialsTotal",
      "ticket.somethingNew",
    ]);
  });

  it("keeps only client-safe variables for the client rendering", () => {
    expect(projectTicketEmailContext(context, "client").context).toEqual({
      ticket: {
        id: "T-1",
        title: "Printer offline",
        url: "https://msp.example.com/msp/tickets/1",
        assets: [{ name: "HP-01", serialNumber: "X1" }],
        timeEntries: [{ technician: "Morgan", worked: 30 }],
        totalTimeWorked: 90,
      },
      comment: { id: "c1", content: "<p>Hi</p>" },
    });
  });

  it("does not mutate the context it projects", () => {
    const before = JSON.stringify(context);
    projectTicketEmailContext(context, "client");
    expect(JSON.stringify(context)).toBe(before);
  });
});

describe("ticket email recipient variable", () => {
  it("is true for staff and false for the client side", () => {
    expect(ticketEmailRecipientVariables("msp")).toEqual({ recipient: { isInternal: true } });
    expect(ticketEmailRecipientVariables("client")).toEqual({ recipient: { isInternal: false } });
  });

  it("is client-safe, so the client projection keeps it", () => {
    expect(
      projectTicketEmailContext({ ...ticketEmailRecipientVariables("client") }, "client").context,
    ).toEqual({ recipient: { isInternal: false } });
  });

  it("is documented on every ticket template, with an example matching who receives it", () => {
    for (const [name, entry] of ticketTemplates) {
      const variable = entry.variables.find((v) => v.path === "recipient.isInternal");
      expect(variable, name).toBeDefined();
      expect(variable?.type).toBe("boolean");
      expect(variable?.example).toBe(CLIENT_TICKET_EMAIL_TEMPLATES.has(name) ? "false" : "true");
    }
  });
});

describe("resolveTicketEmailTemplate", () => {
  it("keeps the internal template and subtype for the MSP rendering", () => {
    expect(resolveTicketEmailTemplate("ticket-created", "Ticket Created", "msp")).toEqual({
      template: "ticket-created",
      subtype: "Ticket Created",
    });
  });

  it("switches a client rendering to the client template and its subtype", () => {
    for (const [template, variant] of Object.entries(TICKET_EMAIL_CLIENT_VARIANTS)) {
      expect(resolveTicketEmailTemplate(template, variant.internalSubtype, "client")).toEqual({
        template: variant.template,
        subtype: variant.subtype,
      });
    }
  });

  it("keeps a subtype the send path chose on purpose", () => {
    const [template, variant] = Object.entries(TICKET_EMAIL_CLIENT_VARIANTS)[0];
    expect(resolveTicketEmailTemplate(template, "Some Special Subtype", "client")).toEqual({
      template: variant.template,
      subtype: "Some Special Subtype",
    });
  });

  it("leaves a template with no client counterpart alone", () => {
    expect(resolveTicketEmailTemplate("ticket-assigned", "Ticket Assigned", "client")).toEqual({
      template: "ticket-assigned",
      subtype: "Ticket Assigned",
    });
  });

  it("only names client templates and subtypes that exist", () => {
    for (const variant of Object.values(TICKET_EMAIL_CLIENT_VARIANTS)) {
      expect(templateVariableRegistry[variant.template], variant.template).toBeDefined();
    }
  });
});

describe("templateVariablesHiddenFromClients", () => {
  it("finds nothing in a template that only uses client-safe variables", () => {
    expect(
      templateVariablesHiddenFromClients(
        "{{ticket.title}} {{{comment.content}}} {{#if recipient.isInternal}}x{{/if}} {{#each ticket.assets}}{{name}}{{/each}}",
      ),
    ).toEqual([]);
  });

  it("names MSP-only and unclassified ticket variables, in any Handlebars form", () => {
    expect(
      templateVariablesHiddenFromClients(
        "{{ticket.materialsTotal}} {{{ ticket.internalNote }}} {{#each ticket.materials}}{{rate}}{{/each}} {{#if comment.authorType}}y{{/if}} {{ticket.somethingNew}}",
      ),
    ).toEqual(["comment.authorType", "ticket.internalNote", "ticket.materials", "ticket.materialsTotal", "ticket.somethingNew"]);
  });

  it("ignores names it cannot place: relative names and other roots", () => {
    expect(templateVariablesHiddenFromClients("{{name}} {{company.name}} {{currentYear}}")).toEqual([]);
  });

  it("finds nothing in any stock ticket template", () => {
    for (const [name, entry] of ticketTemplates) {
      const text = entry.variables.map((variable) => `{{${variable.path}}}`).join(" ");
      const hidden = templateVariablesHiddenFromClients(text);
      if (CLIENT_TICKET_EMAIL_TEMPLATES.has(name)) {
        expect(hidden, name).toEqual([]);
      } else {
        // Internal templates may carry the MSP-only material blocks; nothing
        // else they list may be hidden from clients.
        for (const path of hidden) {
          expect(ticketVariableAudience(path), `${name}: ${path}`).toBe("msp");
        }
      }
    }
  });
});

describe("client templates split from a shared one", () => {
  it("covers the comment and close emails", () => {
    expect(resolveTicketEmailTemplate("ticket-comment-added", "Ticket Comment Added", "client")).toEqual({
      template: "ticket-comment-added-client",
      subtype: "Ticket Comment Added Client",
    });
    expect(resolveTicketEmailTemplate("ticket-closed", "Ticket Closed", "client")).toEqual({
      template: "ticket-closed-client",
      subtype: "Ticket Closed Client",
    });
  });

  it("keeps the bundled-child subtype a send path chose", () => {
    expect(
      resolveTicketEmailTemplate("ticket-closed", "Ticket Closed (Bundled Child)", "client"),
    ).toEqual({ template: "ticket-closed-client", subtype: "Ticket Closed (Bundled Child)" });
  });

  it("names the shared template each copied client template came from, for the new pairs only", () => {
    // The 2026-06 pairs (created, updated) were split without a copy.
    expect(TICKET_EMAIL_TEMPLATES_COPIED_FROM).toEqual({
      "ticket-comment-added-client": "ticket-comment-added",
      "ticket-closed-client": "ticket-closed",
    });
  });

  it("recognises a template in either rendering", () => {
    expect(isTicketEmailTemplate("ticket-comment-added", "ticket-comment-added")).toBe(true);
    expect(isTicketEmailTemplate("ticket-comment-added-client", "ticket-comment-added")).toBe(true);
    expect(isTicketEmailTemplate("ticket-closed-client", "ticket-comment-added")).toBe(false);
  });

  it("lists only client-safe variables on every client template", () => {
    for (const name of CLIENT_TICKET_EMAIL_TEMPLATES) {
      const entry = templateVariableRegistry[name];
      expect(entry, name).toBeDefined();
      expect(entry.variables.filter((variable) => variable.audience !== "client")).toEqual([]);
    }
  });

  it("gives each client template the client-safe variables of its internal template", () => {
    for (const internalTemplate of ["ticket-comment-added", "ticket-closed"]) {
      const clientPaths = new Set(
        templateVariableRegistry[TICKET_EMAIL_CLIENT_VARIANTS[internalTemplate].template].variables.map((v) => v.path),
      );
      const expected = templateVariableRegistry[internalTemplate].variables
        .filter((variable) => variable.audience === "client")
        .map((variable) => variable.path);
      expect(expected.filter((path) => !clientPaths.has(path))).toEqual([]);
    }
  });
});
