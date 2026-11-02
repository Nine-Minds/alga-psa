import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { coManagedWorkflowTicketSeam } from '../../../../../lib/coManagedDelivery';

const state = vi.hoisted(() => ({ actions: [] as any[], queries: [] as string[], writes: [] as string[], hidden: [] as string[], readHidden: [] as string[], deny: false, candidateRows: [] as any[], addItems: vi.fn() }));
const tenant = '11111111-1111-4111-8111-111111111111';
const ticketId = '22222222-2222-4222-8222-222222222222';
const ticketBId = '77777777-7777-4777-8777-777777777777';
const clientId = '33333333-3333-4333-8333-333333333333';
const clientBId = '55555555-5555-4555-8555-555555555555';
const boardId = '44444444-4444-4444-8444-444444444444';
const ticket = { ticket_id: ticketId, ticket_number: 'T-1', title: 'Secret', client_id: clientId, board_id: boardId,
  priority_id: boardId, contact_name_id: boardId, response_state: 'awaiting_client',
  attributes: { external_ref: 'vendor-1', custom_fields: { secret: 'private' } } };
const tx = { tenantId: tenant, actorUserId: clientId, trx: { marker: 'same-transaction' } } as any;
vi.mock('../../../registries/actionRegistry', () => ({ getActionRegistryV2: () => ({ register: (a: any) => state.actions.push(a) }) }));
vi.mock('../shared', async original => ({
  ...await original<typeof import('../shared')>(),
  withTenantTransaction: async (_ctx: any, fn: any) => fn(tx),
  requirePermission: async () => {},
  writeRunAudit: async () => {},
}));
vi.mock('../../../../../lib/ticketChecklists', () => ({
  addChecklistItemsToTicket: state.addItems, applyChecklistTemplateToTicket: vi.fn()
}));
vi.mock('@alga-psa/db', () => ({ tenantDb: () => ({ tenantJoin: (query: any) => query, table: (name: string) => {
  state.queries.push(name);
  const filters: Record<string, unknown> = {};
  const query: any = new Proxy({}, { get: (_target, key) => {
    if (key === 'then') return (resolve: any) => resolve(name === 'tickets' ? [{ ticket_id: ticket.ticket_id }] : []);
    if (key === 'first') return async () => name === 'tickets' ? state.candidateRows.find(row => row.ticket_id === (filters.ticket_id ?? filters['tickets.ticket_id'])) ?? state.candidateRows[0] : name === 'comments' ? {
      comment_id: ticketId, note: 'private comment', created_at: '2026-01-01T00:00:00.000Z'
    } : { name: 'High', priority_name: 'High', client_name: 'Private client', board_name: 'Private board' };
    if (['insert', 'update', 'delete'].includes(String(key))) return async () => { state.writes.push(name); return []; };
    if (key === 'where') return (column: string, value: unknown) => { filters[column] = value; return query; };
    return () => query;
  } });
  return query;
} }) }));
import { registerTicketActions } from '../tickets';

const denied = Object.assign(new Error('bundle scope denied'), { code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
const authorize = vi.fn(async (_trx: any, input: any) => {
  if (state.deny || (input.operation === 'create' && input.prospective.clientId !== clientId)) throw denied;
  // Model the provider's effective bundle scope: this workflow is published
  // under client A, while its tenant-wide event may carry client B's ticket.
  if (input.operation !== 'create' && state.candidateRows.find((row: any) => row.ticket_id === input.ticketId)?.client_id !== clientId) throw denied;
  if (input.operation === 'create' && input.readFields?.some((field: string) => state.readHidden.includes(`tickets.${field}`))) throw denied;
  if (input.operation === 'read' && input.predicateFields?.some((field: string) => state.readHidden.some((hidden: string) =>
    hidden === `tickets.${field}` || (field === 'attributes.external_ref' && hidden === 'tickets.external_ref')
      || (field === 'response_state' && hidden === 'tickets.status_id')))) {
    throw Object.assign(new Error('predicate denied'), { code: 'WORKFLOW_TICKET_PREDICATE_FORBIDDEN' });
  }
  if (['create', 'update'].includes(input.operation) && state.hidden.includes('tickets.custom_fields')
    && input.fields.some((field: string) => ['custom_fields', 'attributes.custom_fields'].includes(field))) throw denied;
  return { redactedFields: state.hidden };
});
const findCandidates = vi.fn(async (_trx: any, input: any) => {
  if (input.predicateFields.some((field: string) => state.readHidden.some((hidden: string) =>
    hidden === `tickets.${field}` || (field === 'attributes.external_ref' && hidden === 'tickets.external_ref')
      || (field === 'response_state' && hidden === 'tickets.status_id')))) {
    throw Object.assign(new Error('predicate denied'), { code: 'WORKFLOW_TICKET_PREDICATE_FORBIDDEN' });
  }
  // Model an indexed query that applies publisher scope and selector values
  // before returning IDs, without materializing unrelated tenant records.
  const selector = input.selector;
  return state.candidateRows.filter((row: any) => row.client_id === clientId
    && (!selector.ticketId || row.ticket_id === selector.ticketId)
    && (!selector.ticketNumber || row.ticket_number === selector.ticketNumber)
    && (!selector.externalRef || row.attributes?.external_ref === selector.externalRef)
    && (!selector.responseState || row.response_state === selector.responseState)).map((row: any) => row.ticket_id);
});
const ctx = { tenantId: tenant, runId: tenant, nowIso: () => '2026-01-01T00:00:00.000Z' } as any;
const action = (id: string) => state.actions.find(a => a.id === `tickets.${id}`);

describe('registered ticket action authorization boundary', () => {
  const originalCapabilities = process.env.FORCE_CAPABILITIES;
  beforeEach(() => {
    state.actions.length = state.queries.length = state.writes.length = 0;
    state.hidden = []; state.readHidden = []; state.deny = false;
    state.candidateRows = [ticket, { ...ticket, ticket_id: ticketBId, ticket_number: 'T-2', client_id: clientBId, attributes: { ...ticket.attributes, external_ref: 'vendor-2' } }];
    authorize.mockClear(); findCandidates.mockClear(); state.addItems.mockReset();
    state.addItems.mockResolvedValue([{ checklist_item_id: ticketId, item_name: 'Review' }]);
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    coManagedWorkflowTicketSeam.reset();
    coManagedWorkflowTicketSeam.register(() => ({ authorize, findCandidates, retain: async () => {} }));
    registerTicketActions();
  });
  afterEach(() => { coManagedWorkflowTicketSeam.reset(); process.env.FORCE_CAPABILITIES = originalCapabilities ?? ''; });

  it('denies an out-of-scope event-supplied ticket ID with the provider denial code', async () => {
    await expect(action('find').handler({ ticket_id: ticketBId }, ctx)).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    expect(state.queries).toEqual([]);
    expect(state.queries).not.toContain('comments');
  });

  it.each([{ ticket_number: 'T-2' }, { external_ref: 'vendor-2' }])('keeps out-of-scope selector candidates invisible: %j', async selector => {
    const result = await action('find').handler(selector, ctx);
    expect(result.ticket).toBeNull();
    expect(state.queries.filter(name => name !== 'tickets')).toEqual([]);
    expect(authorize).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]);
  });

  it.each(['add_comment', 'update_fields', 'assign', 'close', 'link_entities', 'add_attachment', 'apply_checklist', 'add_checklist_items'])('denies %s when a client A publisher receives client B ticket context, before data reads or writes', async name => {
    const input = action(name).inputSchema.parse({ ticket_id: ticketBId,
      patch: { title: 'changed' }, body: 'Review', assignment: { primary: { type: 'user', id: clientId } },
      resolution: { code: 'done' }, entity_type: 'asset', entity_id: boardId, link_type: 'related',
      source: { document_id: boardId }, template_id: boardId, items: [{ item_name: 'Review' }]
    });
    await expect(action(name).handler(input, ctx)).rejects.toBe(denied);
    expect(state.queries).toEqual([]);
    expect(state.writes).toEqual([]);
    expect(authorize).toHaveBeenCalledWith(tx.trx, expect.objectContaining({ operation: 'update', ticketId: ticketBId }));
  });

  it('rejects unsupported patch columns before accessing the ticket', async () => {
    await expect(action('update_fields').handler({ ticket_id: ticketId, patch: { tenant: boardId } }, ctx))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(state.queries).toEqual([]);
    expect(state.writes).toEqual([]);
  });

  it('checks prospective create scope before validation, reads or insertion', async () => {
    await expect(action('create').handler(action('create').inputSchema.parse({ client_id: boardId, board_id: boardId, priority_id: boardId, title: 'x', description: 'Review' }), ctx)).rejects.toBe(denied);
    expect(state.queries).toEqual([]);
    expect(state.writes).toEqual([]);
    expect(authorize).toHaveBeenCalledWith(tx.trx, expect.objectContaining({
      operation: 'create', prospective: expect.objectContaining({ clientId: boardId, boardId }),
      fields: expect.arrayContaining(['title', 'description', 'client_id', 'board_id', 'priority_id']),
    }));
  });

  it.each(['create', 'update'])('denies %s attributes.custom_fields masks before side effects', async operation => {
    state.hidden = ['tickets.custom_fields'];
    if (operation === 'create') {
      const input = action('create').inputSchema.parse({ client_id: clientId, board_id: boardId, priority_id: boardId, title: 'x', attributes: { custom_fields: { secret: 'x' } } });
      await expect(action('create').handler(input, ctx)).rejects.toBe(denied);
    } else {
      const input = action('update_fields').inputSchema.parse({ ticket_id: ticketId, patch: { attributes: { custom_fields: { secret: 'x' } } } });
      await expect(action('update_fields').handler(input, ctx)).rejects.toBe(denied);
    }
    expect(state.queries).toEqual([]);
    expect(state.writes).toEqual([]);
    expect(authorize).toHaveBeenCalledWith(tx.trx, expect.objectContaining({ fields: expect.arrayContaining(['attributes.custom_fields']) }));
  });

  it('checks read permission for the defaulted create status before insertion', async () => {
    state.readHidden = ['tickets.status_id'];
    const input = action('create').inputSchema.parse({ client_id: clientId, board_id: boardId, priority_id: boardId, title: 'x' });
    await expect(action('create').handler(input, ctx)).rejects.toBe(denied);
    expect(authorize).toHaveBeenCalledWith(tx.trx, expect.objectContaining({
      operation: 'create', fields: expect.arrayContaining(['status_id']), readFields: expect.arrayContaining(['status_id', 'priority_id', 'ticket_number', 'entered_at']),
    }));
    expect(state.queries).toEqual([]);
    expect(state.writes).toEqual([]);
  });

  it.each(['tickets.ticket_number', 'tickets.entered_at'])('denies create when returned value %s is unreadable before insertion', async hiddenField => {
    state.readHidden = [hiddenField];
    const input = action('create').inputSchema.parse({ client_id: clientId, board_id: boardId, priority_id: boardId, title: 'x' });
    await expect(action('create').handler(input, ctx)).rejects.toBe(denied);
    expect(state.writes).toEqual([]);
    expect(authorize).toHaveBeenCalledWith(tx.trx, expect.objectContaining({ readFields: expect.arrayContaining(['ticket_number', 'entered_at']) }));
  });

  it('returns an authorized ticket using read permission without update authority', async () => {
    const result = await action('find').handler({ ticket_id: ticketId }, ctx);
    expect(result.ticket.title).toBe('Secret');
    expect(result.latest_comment.note).toBe('private comment');
    expect(authorize).toHaveBeenCalledWith(tx.trx, expect.objectContaining({
      operation: 'read', ticketId,
      fields: expect.arrayContaining(['title', 'client_id', 'board_id', 'assignment', 'comments']),
      readFields: [],
    }));
    expect(authorize.mock.calls[0][0]).toBe(tx.trx);
  });

  it('includes requested nested return values in the read authorization request', async () => {
    await action('find').handler({ ticket_id: ticketId, include: { attributes: true, comments: true, attachments: true } }, ctx);
    expect(authorize).toHaveBeenCalledWith(tx.trx, expect.objectContaining({
      operation: 'read', ticketId,
      fields: expect.arrayContaining(['attributes', 'comments', 'attachments']),
    }));
  });

  it.each([
    ['tickets.priority_id', 'tickets.client_id', 'tickets.attributes.custom_fields.secret', 'comments.note', 'attachments.file_id'],
    ['priorities.priority_name', 'clients.client_name', 'custom_fields', 'conversation.note', 'documents.file_id'],
  ])('redacts source fields, derived names and nested collections for %j', async (...redactions) => {
    state.hidden = redactions;
    const result = await action('find').handler({ ticket_number: 'T-1', include: { attributes: true, comments: true, attachments: true } }, ctx);
    expect(result.ticket.priority_id).toBeNull();
    expect(result.ticket.priority_name).toBeNull();
    expect(result.ticket.client_id).toBeNull();
    expect(result.ticket.company_id).toBeNull();
    expect(result.ticket.client_name).toBeNull();
    expect(result.ticket).not.toHaveProperty('attributes');
    expect(result.latest_comment).toBeNull();
    expect(result.latest_customer_comment).toBeNull();
    expect(result).not.toHaveProperty('comments');
    expect(result).not.toHaveProperty('comments_meta');
    expect(result).not.toHaveProperty('attachments');
    expect(state.queries).not.toContain('comments');
    expect(state.queries).not.toContain('document_associations as da');
    if (redactions.includes('priorities.priority_name')) expect(state.queries).not.toContain('priorities');
    if (redactions.includes('clients.client_name')) expect(state.queries).not.toContain('clients');
  });

  it('suppresses requester identity and skips its lookup when contact_id is masked', async () => {
    state.hidden = ['tickets.contact_id'];
    const result = await action('find').handler({ ticket_id: ticketId }, ctx);
    expect(result.ticket.contact_name_id).toBeNull();
    expect(result.ticket.contact_name).toBeNull();
    expect(state.queries).not.toContain('contacts');
  });

  it.each([
    ['response_state', 'awaiting_client', 'tickets.response_state'],
    ['response_state', 'awaiting_internal', 'tickets.response_state'],
    ['response_state', 'awaiting_client', 'tickets.status_id'],
    ['response_state', 'awaiting_internal', 'tickets.status_id'],
    ['attributes.external_ref', 'vendor-1', 'tickets.attributes.external_ref'],
    ['attributes.external_ref', 'different-ref', 'tickets.attributes.external_ref'],
    ['attributes.external_ref', 'vendor-1', 'tickets.external_ref'],
    ['attributes.external_ref', 'different-ref', 'tickets.external_ref'],
  ])('rejects masked %s predicate whether it matches (%s) or not (mask %s)', async (field, value, mask) => {
    state.readHidden = [mask];
    const selector = field === 'response_state'
      ? { ticket_id: ticketId, response_state: value }
      : { external_ref: value };
    await expect(action('find').handler(selector, ctx)).rejects.toMatchObject({ code: 'WORKFLOW_TICKET_PREDICATE_FORBIDDEN' });
    const boundary = selector.ticket_id ? authorize : findCandidates;
    expect(boundary).toHaveBeenCalledWith(tx.trx, expect.objectContaining({
      predicateFields: [field === 'attributes.external_ref' ? 'attributes.external_ref' : 'response_state'],
    }));
    expect(state.queries).not.toContain('comments');
  });

  it('evaluates authorized selector values after authorizing the candidate record', async () => {
    const match = await action('find').handler({ external_ref: 'vendor-1', response_state: 'awaiting_client' }, ctx);
    expect(match.ticket.ticket_id).toBe(ticketId);
    const noMatch = await action('find').handler({ external_ref: 'different-ref' }, ctx);
    expect(noMatch.ticket).toBeNull();
  });

  it('returns a missing indexed selector without touching unrelated ticket records', async () => {
    const result = await action('find').handler({ external_ref: 'no-such-reference' }, ctx);
    expect(result.ticket).toBeNull();
    expect(findCandidates).toHaveBeenCalledTimes(1);
    expect(authorize).not.toHaveBeenCalled();
    expect(state.queries).toEqual([]);
  });

  it('runs an authorized checklist mutation in the retained transaction', async () => {
    const items = [{ item_name: 'Review', is_required: true }];
    const result = await action('add_checklist_items').handler({ ticket_id: ticketId, items }, ctx);
    expect(result.added).toEqual([{ checklist_item_id: ticketId, item_name: 'Review' }]);
    expect(state.addItems).toHaveBeenCalledWith(tx.trx, tenant, ticketId, items, { source: 'workflow', createdBy: clientId });
    expect(authorize).toHaveBeenCalledWith(tx.trx, expect.objectContaining({ operation: 'update', fields: ['checklist'] }));
  });

  it('fails closed if a served tenant has an old mutation-only provider', async () => {
    coManagedWorkflowTicketSeam.reset();
    coManagedWorkflowTicketSeam.register(() => ({ retain: async () => {} }));
    await expect(action('find').handler({ ticket_id: ticketId }, ctx)).rejects.toMatchObject({ code: 'WORKFLOW_TICKET_AUTHORITY_UNAVAILABLE' });
  });
});
