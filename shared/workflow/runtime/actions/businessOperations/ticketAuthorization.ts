import type { ActionContext, ActionDef, ActionRegistry } from '../../registries/actionRegistry';
import { tenantDb } from '@alga-psa/db';
import { WORKFLOW_TICKET_DERIVED_SOURCES, workflowTicketFieldSources } from '../../../../lib/coManagedDelivery';
import { authorizeWorkflowTicket, findWorkflowTicketCandidates, requirePermission, withTenantTransaction, type TenantTxContext } from './shared';

type TicketAuthority<I> = {
  operation: 'read' | 'create' | 'update';
  fields: (input: I) => string[];
  readFields?: (input: I) => string[];
  target: (input: I) => { assignment?: { assignedUserIds: string[]; teamIds: string[] }; ticketId?: string; prospective?: { clientId: string; boardId: string; assignedUserIds: string[]; teamIds: string[] } };
};
export type TicketReadAuthority = { ticket: any; redactedFields: string[] };

/** A hidden parent or descendant hides the complete derived value. */
export function workflowTicketFieldHidden(redactions: string[], ...names: string[]): boolean {
  return redactions.some(raw => {
    const field = raw.startsWith('fields.') ? raw.slice(7) : raw;
    return field === '*' || field === 'fields' || names.flatMap(workflowTicketFieldSources).flatMap(name => [name, `tickets.${name}`]).some(name =>
      field === name || field.startsWith(`${name}.`) || name.startsWith(`${field}.`));
  });
}

export function redactWorkflowTicket(ticket: Record<string, any>, redactions: string[]): Record<string, any> {
  return Object.fromEntries(Object.entries(ticket).flatMap(([key, value]) => {
    const sources = [key, ...(WORKFLOW_TICKET_DERIVED_SOURCES[key] ?? [])];
    if (key === 'attributes') {
      const attributes = typeof value === 'string' ? safeParseAttributes(value) : value;
      // Attribute keys are extensible. Include their actual paths so a mask
      // on either `attributes.key` or its `key` alias hides the whole value.
      if (attributes && typeof attributes === 'object' && !Array.isArray(attributes)) {
        sources.push(...Object.keys(attributes).map(field => `attributes.${field}`));
      }
    }
    if (!workflowTicketFieldHidden(redactions, ...sources)) return [[key, value]];
    // Attributes are optional; scalar summary fields are nullable.
    return key === 'attributes' ? [] : [[key, null]];
  }));
}

/** All ticket handlers share the transaction that retains run, actor and record authority. */
export function registerAuthorizedTicketAction<I, O>(
  registry: Pick<ActionRegistry, 'register'>,
  def: Omit<ActionDef<I, O>, 'handler'> & {
    authority: TicketAuthority<I>;
    handler: (input: I, ctx: ActionContext, tx: TenantTxContext, grant: TicketReadAuthority) => Promise<O>;
  }
): void {
  const { authority, handler, ...metadata } = def;
  registry.register({ ...metadata, handler: (input, ctx) => withTenantTransaction(ctx, async tx => {
    await requirePermission(ctx, tx, { resource: 'ticket', action: authority.operation });
    let ticket: any = null;
    let target = authority.target(input);
    if (authority.operation === 'read') {
      const lookup = input as { ticket_id?: string; ticket_number?: string; external_ref?: string; response_state?: string };
      if (!lookup.ticket_id && !lookup.ticket_number && !lookup.external_ref) throw new Error('Ticket lookup requires a selector');
      const predicateFields = [
        ...(lookup.ticket_number ? ['ticket_number'] : []),
        ...(lookup.external_ref ? ['attributes.external_ref'] : []),
        ...(lookup.response_state ? ['response_state'] : []),
      ];
      if (lookup.ticket_id) {
        const candidateTarget = { ticketId: lookup.ticket_id };
        const grant = await authorizeWorkflowTicket(ctx, tx, {
          ...candidateTarget, operation: authority.operation, fields: authority.fields(input),
          readFields: authority.readFields?.(input) ?? [], predicateFields,
        });
        ticket = await tenantDb(tx.trx, tx.tenantId).table('tickets').where('ticket_id', lookup.ticket_id).first();
        if (ticket) {
          const attrs = typeof ticket.attributes === 'string' ? safeParseAttributes(ticket.attributes) : ticket.attributes;
          if (ticket && lookup.ticket_number && ticket.ticket_number !== lookup.ticket_number) ticket = null;
          if (ticket && lookup.response_state && ticket.response_state !== lookup.response_state) ticket = null;
          if (ticket && lookup.external_ref && attrs?.external_ref !== lookup.external_ref) ticket = null;
        }
        return handler(input, ctx, tx, { ticket, redactedFields: grant.redactedFields });
      }
      const candidateIds = await findWorkflowTicketCandidates(ctx, tx, {
        ticketId: lookup.ticket_id,
        ticketNumber: lookup.ticket_number,
        externalRef: lookup.external_ref,
        responseState: lookup.response_state,
        predicateFields,
      });
      if (candidateIds === null) {
        const query = tenantDb(tx.trx, tx.tenantId).table('tickets');
        if (lookup.ticket_id) query.where('ticket_id', lookup.ticket_id);
        else if (lookup.ticket_number) query.where('ticket_number', lookup.ticket_number);
        else if (lookup.external_ref) query.andWhereRaw("(attributes->>'external_ref') = ?", [lookup.external_ref]);
        if (lookup.response_state) query.where('response_state', lookup.response_state);
        const found = await query.select('ticket_id').first();
        if (!found) return handler(input, ctx, tx, { ticket: null, redactedFields: [] });
        target = { ticketId: found.ticket_id };
        const grant = await authorizeWorkflowTicket(ctx, tx, { ...target, operation: authority.operation, fields: authority.fields(input), readFields: authority.readFields?.(input) ?? [] });
        ticket = await tenantDb(tx.trx, tx.tenantId).table('tickets').where('ticket_id', target.ticketId).first();
        return handler(input, ctx, tx, { ticket, redactedFields: grant.redactedFields });
      }
      for (const candidateId of candidateIds) {
        const candidateTarget = { ticketId: candidateId };
        const grant = await authorizeWorkflowTicket(ctx, tx, {
          ...candidateTarget,
          operation: authority.operation,
          fields: authority.fields(input),
          readFields: authority.readFields?.(input) ?? [],
          predicateFields,
        });
        const row = await tenantDb(tx.trx, tx.tenantId).table('tickets').where('ticket_id', candidateId).first();
        if (!row) continue;
        const attrs = typeof row.attributes === 'string' ? safeParseAttributes(row.attributes) : row.attributes;
        if (lookup.ticket_number && row.ticket_number !== lookup.ticket_number) continue;
        if (lookup.external_ref && attrs?.external_ref !== lookup.external_ref) continue;
        if (lookup.response_state && row.response_state !== lookup.response_state) continue;
        target = candidateTarget;
        ticket = row;
        return handler(input, ctx, tx, { ticket, redactedFields: grant.redactedFields });
      }
      return handler(input, ctx, tx, { ticket: null, redactedFields: [] });
    }
    const grant = await authorizeWorkflowTicket(ctx, tx, { ...target, operation: authority.operation, fields: authority.fields(input), readFields: authority.readFields?.(input) ?? [] });
    return handler(input, ctx, tx, { ticket, redactedFields: grant.redactedFields });
  }) });
}

function safeParseAttributes(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
