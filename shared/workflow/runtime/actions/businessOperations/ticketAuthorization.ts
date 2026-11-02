import type { ActionContext, ActionDef, ActionRegistry } from '../../registries/actionRegistry';
import { tenantDb } from '@alga-psa/db';
import { authorizeWorkflowTicket, requirePermission, withTenantTransaction, workflowTicketAuthorityActive, type TenantTxContext } from './shared';

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
    return field === '*' || field === 'fields' || names.flatMap(name => [name, ...(derivedSources[name] ?? [])]).flatMap(name => [name, `tickets.${name}`]).some(name =>
      field === name || field.startsWith(`${name}.`) || name.startsWith(`${field}.`));
  });
}

const derivedSources: Record<string, string[]> = {
  attributes: ['description', 'custom_fields', 'tags', 'due_date', 'resolution_code', 'resolution_text'],
  client_id: ['company_id', 'client', 'clients'], company_id: ['client_id', 'client', 'clients'],
  client_name: ['client_id', 'company_id', 'client', 'clients', 'clients.client_name'],
  board_id: ['board', 'boards'], board_name: ['board_id', 'board', 'boards', 'boards.board_name'],
  contact_id: ['contact_name_id', 'contact_name', 'requester', 'contact', 'contacts', 'contacts.contact_name_id'],
  contact_name_id: ['contact_id', 'contact_name', 'requester', 'contact', 'contacts', 'contacts.contact_name_id'],
  contact_name: ['contact_id', 'contact_name_id', 'requester', 'contact', 'contacts', 'contacts.contact_name_id'],
  status_id: ['status', 'statuses'], status_name: ['status_id', 'status', 'statuses', 'statuses.name'],
  priority_id: ['priority', 'priorities'], priority_name: ['priority_id', 'priority', 'priorities', 'priorities.priority_name'],
  category_id: ['category', 'categories'], category_name: ['category_id', 'category', 'categories', 'categories.category_name'],
  subcategory_id: ['subcategory', 'categories'], subcategory_name: ['subcategory_id', 'subcategory', 'categories', 'categories.category_name'],
  assigned_to: ['assignment', 'assignee', 'users'], assigned_to_name: ['assigned_to', 'assignment', 'assignee', 'users', 'users.first_name', 'users.last_name', 'users.username'],
  is_closed: ['status_id', 'status', 'statuses'], closed_at: ['status_id', 'status', 'statuses'],
  response_state: ['status_id', 'status', 'statuses'],
  comments: ['conversation', 'note', 'markdown_content'],
  attachments: ['documents', 'document_associations', 'file_id', 'storage_ref'],
};

export function redactWorkflowTicket(ticket: Record<string, any>, redactions: string[]): Record<string, any> {
  return Object.fromEntries(Object.entries(ticket).flatMap(([key, value]) => {
    if (!workflowTicketFieldHidden(redactions, key, ...(derivedSources[key] ?? []))) return [[key, value]];
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
      if (!await workflowTicketAuthorityActive(tx)) {
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
      // Resolve candidate identities without evaluating protected predicates.
      // Each candidate's record scope and predicate-field permissions are
      // retained before the full row is loaded or any predicate is compared.
      const candidates = lookup.ticket_id
        ? [{ ticket_id: lookup.ticket_id }]
        : await tenantDb(tx.trx, tx.tenantId).table('tickets').select('ticket_id');
      for (const candidate of candidates) {
        const candidateTarget = { ticketId: candidate.ticket_id };
        let grant: { redactedFields: string[] };
        try {
          grant = await authorizeWorkflowTicket(ctx, tx, {
            ...candidateTarget,
            operation: authority.operation,
            fields: authority.fields(input),
            readFields: authority.readFields?.(input) ?? [],
            predicateFields,
          });
        } catch (error) {
          const code = (error as { code?: unknown } | null)?.code;
          // Unreadable candidates are invisible to this selector. A predicate
          // permission refusal is different: fail closed even if the value
          // would not have matched, preventing a match/no-match oracle.
          if (code === 'CO_MANAGED_SHARED_WORK_FORBIDDEN') continue;
          throw error;
        }
        const row = await tenantDb(tx.trx, tx.tenantId).table('tickets').where('ticket_id', candidate.ticket_id).first();
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
