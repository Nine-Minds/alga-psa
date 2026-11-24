/**
 * Who may read each ticket email variable, and which template each audience gets.
 *
 * A ticket email is rendered once per recipient, as `msp` (staff) or `client` (requester,
 * external watcher, copied address, out-of-scope seat technician). The `msp` rendering gets the
 * whole context. The `client` rendering gets only the variables marked `client` here, so a
 * variable nobody classified never reaches a client.
 *
 * This file imports nothing: the email subscriber, the variable registry and the template editor
 * all read it.
 */

export type TicketEmailRendering = "msp" | "client";

/** `client`: safe for both audiences. `msp`: MSP staff only. */
export type TicketVariableAudience = "client" | "msp";

/**
 * Every ticket email variable, by context path. An entry covers its whole subtree
 * (`ticket.assets` covers `ticket.assets[].name`); the longest matching entry wins.
 * A path with no entry is `msp`.
 */
export const TICKET_EMAIL_VARIABLE_AUDIENCE: Readonly<
  Record<string, TicketVariableAudience>
> = {
  // Who is reading. Set per recipient at send time.
  "recipient.isInternal": "client",

  // Ticket facts: everyone admitted to the ticket.
  "ticket.id": "client",
  "ticket.title": "client",
  "ticket.url": "client",
  "ticket.status": "client",
  "ticket.previousStatus": "client",
  "ticket.enteredStatus": "client",
  "ticket.priority": "client",
  "ticket.priorityColor": "client",
  "ticket.metaLine": "client",
  "ticket.clientName": "client",
  "ticket.summary": "client",
  "ticket.description": "client",
  "ticket.descriptionText": "client",
  "ticket.descriptionHtml": "client",
  "ticket.createdAt": "client",
  "ticket.createdBy": "client",
  "ticket.createdDetails": "client",
  "ticket.updatedAt": "client",
  "ticket.updatedBy": "client",
  "ticket.updateCount": "client",
  "ticket.closedAt": "client",
  "ticket.closedBy": "client",
  "ticket.scheduledCloseDate": "client",
  "ticket.changes": "client",
  // The same changes as structured items; the stock templates iterate these.
  "ticket.changeItems": "client",
  // The client rendering carries the latest client-visible resolution only.
  "ticket.resolution": "client",

  // Assignment. Clients see these in the stock emails today.
  "ticket.assignedToName": "client",
  "ticket.assignedToEmail": "client",
  "ticket.assignedDetails": "client",
  "ticket.assignedBy": "client",
  "ticket.teamName": "client",

  // The client's own contact and site.
  "ticket.requesterName": "client",
  "ticket.requesterEmail": "client",
  "ticket.requesterPhone": "client",
  "ticket.requesterContact": "client",
  "ticket.requesterDetails": "client",
  "ticket.locationSummary": "client",

  // Board and category rows. Clients see these in the stock emails today.
  "ticket.board": "client",
  "ticket.category": "client",
  "ticket.subcategory": "client",
  "ticket.categoryDetails": "client",

  // The comment a message quotes. Whether a recipient gets the message at all is decided by
  // the comment's audience before rendering.
  "comment.id": "client",
  "comment.author": "client",
  "comment.authorName": "client",
  "comment.body": "client",
  "comment.content": "client",
  "comment.html": "client",
  "comment.text": "client",
  "comment.plainText": "client",
  "comment.rawContent": "client",
  "comment.isInternal": "client",

  // Ticket detail variables arriving with PR 3957. Everyone admitted to the
  // ticket sees the same detail blocks on the close email.
  "ticket.assets": "client", // the client's own devices
  "ticket.remainingBlockHours": "client", // the client's own balance
  "ticket.totalTimeBillable": "client", // Client's own billable time
  "ticket.totalTimeWorked": "client", // includes non-billable time
  "ticket.timeEntries": "client", // technician names, non-billable time, Time Entries are meant to be client facing as "work history reports" for time base billed customers
  "ticket.materials": "msp", // rates and billed state
  "ticket.materialsTotal": "msp",
};

const normalizePath = (path: string): string => path.replace(/\[\]/g, "");

/** The audience of one variable path: its own entry, else its nearest classified ancestor, else `msp`. */
export function ticketVariableAudience(path: string): TicketVariableAudience {
  const parts = normalizePath(path).split(".");
  for (let length = parts.length; length > 0; length--) {
    const audience = TICKET_EMAIL_VARIABLE_AUDIENCE[parts.slice(0, length).join(".")];
    if (audience) return audience;
  }
  return "msp";
}

/** Has someone decided this path (itself or an ancestor)? Tests use it to keep the map complete. */
export function isTicketVariableClassified(path: string): boolean {
  const parts = normalizePath(path).split(".");
  for (let length = parts.length; length > 0; length--) {
    if (parts.slice(0, length).join(".") in TICKET_EMAIL_VARIABLE_AUDIENCE) return true;
  }
  return false;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function projectNode(node: Record<string, unknown>, prefix: string, dropped: string[]): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isTicketVariableClassified(path)) {
      if (ticketVariableAudience(path) === "client") projected[key] = value;
      else dropped.push(path);
      continue;
    }
    // Not classified itself: only its classified children may pass.
    if (isPlainObject(value)) {
      const child = projectNode(value, path, dropped);
      if (Object.keys(child).length > 0) projected[key] = child;
    } else {
      dropped.push(path);
    }
  }
  return projected;
}

/**
 * The context one rendering may read. `msp` gets it unchanged; `client` gets a copy holding
 * only client-safe variables, and `dropped` names every path that was left out.
 */
export function projectTicketEmailContext<T extends Record<string, unknown>>(
  context: T,
  rendering: TicketEmailRendering,
): { context: Record<string, unknown>; dropped: string[] } {
  if (rendering === "msp") return { context, dropped: [] };
  const dropped: string[] = [];
  return { context: projectNode(context, "", dropped), dropped };
}

const TEMPLATE_VARIABLE_ROOTS = [
  ...new Set(Object.keys(TICKET_EMAIL_VARIABLE_AUDIENCE).map((path) => path.split(".")[0])),
];
const TEMPLATE_VARIABLE_PATTERN = new RegExp(
  `\\{\\{\\{?\\s*(?:#\\s*)?(?:(?:if|unless|each|with)\\s+)?((?:${TEMPLATE_VARIABLE_ROOTS.join("|")})(?:\\.[A-Za-z_]\\w*)+)`,
  "g",
);

/**
 * The ticket variables a template references that a client rendering never receives: MSP-only
 * ones and ones nobody classified. They render empty for clients, so a customized template that
 * uses one is worth a warning. Only full paths are read (`ticket.x`, `comment.x`); a relative
 * name inside an `{{#each}}` block is covered by the block's own path.
 */
export function templateVariablesHiddenFromClients(templateText: string): string[] {
  const hidden = new Set<string>();
  for (const match of templateText.matchAll(TEMPLATE_VARIABLE_PATTERN)) {
    if (ticketVariableAudience(match[1]) !== "client") hidden.add(match[1]);
  }
  return [...hidden].sort();
}

/** The per-recipient variables every ticket email carries. */
export function ticketEmailRecipientVariables(rendering: TicketEmailRendering): {
  recipient: { isInternal: boolean };
} {
  return { recipient: { isInternal: rendering === "msp" } };
}

export interface TicketEmailClientVariant {
  /** The client template and its notification subtype. */
  template: string;
  subtype: string;
  /** The internal template's subtype; a send under any other subtype keeps the one it named. */
  internalSubtype: string;
  /**
   * True when the internal template used to go to clients too, and the split migration copied
   * each tenant's version of it (and its on/off settings) to the client template. The two are
   * separate from then on; a copied row is what branding recognises as its own
   * (`TICKET_EMAIL_TEMPLATES_COPIED_FROM`). The 2026-06 pairs (created, updated) were split
   * without a copy.
   */
  copiedFromShared?: boolean;
}

/**
 * Internal ticket templates that have a client counterpart. A send names the internal template;
 * a `client` rendering is switched to the counterpart here, never by the send path.
 */
export const TICKET_EMAIL_CLIENT_VARIANTS: Readonly<Record<string, TicketEmailClientVariant>> = {
  "ticket-created": {
    template: "ticket-created-client",
    subtype: "Ticket Created Client",
    internalSubtype: "Ticket Created",
  },
  "ticket-updated": {
    template: "ticket-updated-client",
    subtype: "Ticket Updated Client",
    internalSubtype: "Ticket Updated",
  },
  "ticket-comment-added": {
    template: "ticket-comment-added-client",
    subtype: "Ticket Comment Added Client",
    internalSubtype: "Ticket Comment Added",
    copiedFromShared: true,
  },
  "ticket-closed": {
    template: "ticket-closed-client",
    subtype: "Ticket Closed Client",
    internalSubtype: "Ticket Closed",
    copiedFromShared: true,
  },
};

/** Is `template` this internal template or its client counterpart? */
export function isTicketEmailTemplate(template: string, internalTemplate: string): boolean {
  return template === internalTemplate || TICKET_EMAIL_CLIENT_VARIANTS[internalTemplate]?.template === template;
}

/**
 * Client template name -> the shared template its tenant rows were copied from when it was
 * split off. Email branding uses it to recognise a copied row it wrote itself.
 */
export const TICKET_EMAIL_TEMPLATES_COPIED_FROM: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(TICKET_EMAIL_CLIENT_VARIANTS)
    .filter(([, variant]) => variant.copiedFromShared)
    .map(([internalTemplate, variant]) => [variant.template, internalTemplate]),
);

/** Ticket templates only clients ever receive: the counterparts above and the requester-only mails. */
export const CLIENT_TICKET_EMAIL_TEMPLATES: ReadonlySet<string> = new Set([
  ...Object.values(TICKET_EMAIL_CLIENT_VARIANTS).map((variant) => variant.template),
  "ticket-agent-assigned-client",
  "ticket-auto-close-warning",
]);

/** The template and subtype one rendering of a ticket email uses. */
export function resolveTicketEmailTemplate(
  template: string,
  subtype: string,
  rendering: TicketEmailRendering,
): { template: string; subtype: string } {
  const variant = rendering === "client" ? TICKET_EMAIL_CLIENT_VARIANTS[template] : undefined;
  if (!variant) return { template, subtype };
  return {
    template: variant.template,
    subtype: subtype === variant.internalSubtype ? variant.subtype : subtype,
  };
}
