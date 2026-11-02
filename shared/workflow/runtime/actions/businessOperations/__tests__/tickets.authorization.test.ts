import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { coManagedWorkflowTicketSeam } from '../../../../../lib/coManagedDelivery';

const state = vi.hoisted(() => ({ actions: [] as any[], queries: [] as string[], writes: [] as string[], hidden: [] as string[], deny: false, ticketClientId: '', addItems: vi.fn() }));
const tenant = '11111111-1111-4111-8111-111111111111';
const ticketId = '22222222-2222-4222-8222-222222222222';
const clientId = '33333333-3333-4333-8333-333333333333';
const clientBId = '55555555-5555-4555-8555-555555555555';
const boardId = '44444444-4444-4444-8444-444444444444';
const ticket = { ticket_id: ticketId, ticket_number: 'T-1', title: 'Secret', client_id: clientId, board_id: boardId,
  priority_id: boardId, attributes: { custom_fields: { secret: 'private' } } };
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
  const query: any = new Proxy({}, { get: (_target, key) => {
    if (key === 'then') return (resolve: any) => resolve([]);
    if (key === 'first') return async () => name === 'tickets' ? { ...ticket, client_id: state.ticketClientId || ticket.client_id } : name === 'comments' ? {
      comment_id: ticketId, note: 'private comment', created_at: '2026-01-01T00:00:00.000Z'
    } : { name: 'High', priority_name: 'High', client_name: 'Private client', board_name: 'Private board' };
    if (['insert', 'update', 'delete'].includes(String(key))) return async () => { state.writes.push(name); return []; };
    return () => query;
  } });
  return query;
} }) }));
import { registerTicketActions } from '../tickets';

const denied = new Error('bundle scope denied');
const authorize = vi.fn(async (_trx: any, input: any) => {
  if (state.deny || (input.operation === 'create' && input.prospective.clientId !== clientId)) throw denied;
  // Model the provider's effective bundle scope: this workflow is published
  // under client A, while its tenant-wide event may carry client B's ticket.
  if (input.operation !== 'create' && state.ticketClientId && state.ticketClientId !== clientId) throw denied;
  return { redactedFields: state.hidden };
});
const ctx = { tenantId: tenant, runId: tenant, nowIso: () => '2026-01-01T00:00:00.000Z' } as any;
const action = (id: string) => state.actions.find(a => a.id === `tickets.${id}`);

describe('registered ticket action authorization boundary', () => {
  const originalCapabilities = process.env.FORCE_CAPABILITIES;
  beforeEach(() => {
    state.actions.length = state.queries.length = state.writes.length = 0;
    state.hidden = []; state.deny = false; state.ticketClientId = clientId; authorize.mockClear(); state.addItems.mockReset();
    state.addItems.mockResolvedValue([{ checklist_item_id: ticketId, item_name: 'Review' }]);
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    coManagedWorkflowTicketSeam.reset();
    coManagedWorkflowTicketSeam.register(() => ({ authorize, retain: async () => {} }));
    registerTicketActions();
  });
  afterEach(() => { coManagedWorkflowTicketSeam.reset(); process.env.FORCE_CAPABILITIES = originalCapabilities ?? ''; });

  it.each([{ ticket_id: ticketId }, { ticket_number: 'T-1' }, { external_ref: 'vendor-1' }])('denies out-of-scope reads through %j before related data is loaded', async selector => {
    state.ticketClientId = clientBId;
    await expect(action('find').handler(selector, ctx)).rejects.toBe(denied);
    expect(state.queries).toEqual(['tickets']);
    expect(state.writes).toEqual([]);
  });

  it.each(['add_comment', 'update_fields', 'assign', 'close', 'link_entities', 'add_attachment', 'apply_checklist', 'add_checklist_items'])('denies %s when a client A publisher receives client B ticket context, before data reads or writes', async name => {
    state.ticketClientId = clientBId;
    const input = action(name).inputSchema.parse({ ticket_id: ticketId,
      patch: { title: 'changed' }, body: 'Review', assignment: { primary: { type: 'user', id: clientId } },
      resolution: { code: 'done' }, entity_type: 'asset', entity_id: boardId, link_type: 'related',
      source: { document_id: boardId }, template_id: boardId, items: [{ item_name: 'Review' }]
    });
    await expect(action(name).handler(input, ctx)).rejects.toBe(denied);
    expect(state.queries).toEqual([]);
    expect(state.writes).toEqual([]);
    expect(authorize).toHaveBeenCalledWith(tx.trx, expect.objectContaining({ operation: 'update', ticketId }));
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
