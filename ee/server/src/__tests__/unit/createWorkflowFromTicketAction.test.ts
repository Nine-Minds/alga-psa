import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30000 });

const TICKET_ID = '11111111-1111-4111-8111-111111111111';

const m = vi.hoisted(() => {
  const trx = { raw: vi.fn(async (..._a: unknown[]) => undefined) };
  return {
  trx,
  transaction: vi.fn(async (cb: (t: typeof trx) => unknown) => cb(trx)),
  user: { user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1', roles: [] as any[] } as any,
  hasPermission: vi.fn(),
  getBlueprint: vi.fn(),
  buildTrigger: vi.fn(),
  createDefinition: vi.fn(),
  auditLog: vi.fn(async (..._a: unknown[]) => undefined),
  edition: { enterprise: true },
  };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (input: unknown) => action(m.user, { tenant: 'tenant-1' }, input),
  hasPermission: (...a: unknown[]) => m.hasPermission(...a),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: { transaction: (...a: unknown[]) => (m.transaction as any)(...a) } }),
  auditLog: (...a: unknown[]) => m.auditLog(...a),
}));
vi.mock('@alga-psa/core/features', () => ({
  get isEnterprise() {
    return m.edition.enterprise;
  },
}));
vi.mock('@alga-psa/tickets/actions/ticketActions', () => ({
  getTicketWorkflowBlueprint: (...a: unknown[]) => m.getBlueprint(...a),
}));
vi.mock('@alga-psa/workflows/actions', () => ({
  buildTriggerForCatalogEvent: (...a: unknown[]) => m.buildTrigger(...a),
  createWorkflowDefinitionAction: (...a: unknown[]) => m.createDefinition(...a),
}));

import { createWorkflowFromTicketAction, getWorkflowFromTicketImportSummaryAction } from '../../workflows/createFromTicket/actions.server';

const blueprint = {
  ticket_id: TICKET_ID,
  ticket_number: 'T-1',
  title: 'Onboard new hire',
  description: 'desc',
  client: { id: 'c1', name: 'Acme', type: 'company' },
  contact: null,
  location_id: null,
  board_id: 'b1',
  category_id: null,
  subcategory_id: null,
  priority_id: 'p1',
  assigned_to: 'u9',
  assigned_team_id: null,
  additional_agents: [],
  tags: [{ tag_id: 't1', tag_text: 'hr' }],
  custom_fields: {},
  checklist: [],
};

const input = {
  ticketId: TICKET_ID,
  name: 'Onboarding',
  trigger: { type: 'manual' as const },
  include: { assignment: true, tags: true, customFields: true, checklist: true },
};

describe('createWorkflowFromTicketAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.edition.enterprise = true;
    m.trx.raw.mockImplementation(async () => undefined);
    m.transaction.mockImplementation(async (cb: (t: typeof m.trx) => unknown) => cb(m.trx));
    m.user = { user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1', roles: [] };
    m.hasPermission.mockImplementation(async (_u: any, resource: string, action: string) => resource === 'workflow' && action === 'manage');
    m.getBlueprint.mockResolvedValue(blueprint);
    m.createDefinition.mockResolvedValue({ workflowId: 'wf-1', draftVersion: 1 });
  });

  it('fails fast outside the Enterprise edition without reading anything', async () => {
    m.edition.enterprise = false;
    await expect(createWorkflowFromTicketAction(input)).rejects.toThrow(/Enterprise/);
    expect(m.getBlueprint).not.toHaveBeenCalled();
    expect(m.createDefinition).not.toHaveBeenCalled();
  });

  it('denies client-portal users before any permission or ticket lookup', async () => {
    m.user = { ...m.user, user_type: 'client' };
    const result = await createWorkflowFromTicketAction(input);
    expect(result).toHaveProperty('permissionError');
    expect(m.hasPermission).not.toHaveBeenCalled();
    expect(m.getBlueprint).not.toHaveBeenCalled();
    expect(m.createDefinition).not.toHaveBeenCalled();
  });

  it('denies without workflow manage/admin before reading the ticket', async () => {
    m.hasPermission.mockResolvedValue(false);
    const result = await createWorkflowFromTicketAction(input);
    expect(result).toHaveProperty('permissionError');
    expect(m.getBlueprint).not.toHaveBeenCalled();
    expect(m.createDefinition).not.toHaveBeenCalled();
  });

  it('accepts workflow:admin when manage is absent', async () => {
    m.hasPermission.mockImplementation(async (_u: any, _r: string, action: string) => action === 'admin');
    await expect(createWorkflowFromTicketAction(input)).resolves.toEqual({ workflowId: 'wf-1' });
  });

  it('returns the ticket row-auth denial and writes nothing', async () => {
    m.getBlueprint.mockResolvedValue({ permissionError: 'Permission denied: Cannot view ticket' });
    const result = await createWorkflowFromTicketAction(input);
    expect(result).toEqual({ permissionError: 'Permission denied: Cannot view ticket' });
    expect(m.createDefinition).not.toHaveBeenCalled();
    expect(m.auditLog).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid ticket id and an empty name with an inline error', async () => {
    expect(await createWorkflowFromTicketAction({ ...input, ticketId: 'nope' })).toHaveProperty('actionError');
    expect(await createWorkflowFromTicketAction({ ...input, name: '   ' })).toHaveProperty('actionError');
    expect(m.createDefinition).not.toHaveBeenCalled();
  });

  it('creates a manual draft (no trigger, empty payload schema) and audits it', async () => {
    const result = await createWorkflowFromTicketAction(input);
    expect(result).toEqual({ workflowId: 'wf-1' });
    expect(m.buildTrigger).not.toHaveBeenCalled();
    const { definition } = m.createDefinition.mock.calls[0][0];
    expect(definition.name).toBe('Onboarding');
    expect(definition.trigger).toBeUndefined();
    expect(definition.payloadSchemaRef).toBe('payload.Empty.v1');
    expect(definition.steps[0]).toMatchObject({ type: 'action.call', config: { actionId: 'tickets.create' } });
    expect(m.transaction).toHaveBeenCalledTimes(1);
    expect(m.auditLog).toHaveBeenCalledTimes(1);
    expect(m.auditLog).toHaveBeenCalledWith(
      m.trx,
      expect.objectContaining({
        userId: 'user-1',
        operation: 'workflow_definition_create_from_ticket',
        tableName: 'workflow_definitions',
        recordId: 'wf-1',
        changedData: { sourceTicketId: TICKET_ID, include: input.include, triggerEventName: null },
      })
    );
    // The audit must run on the tenant-scoped trx, with the tenant GUC set first.
    expect(m.auditLog.mock.calls[0][0]).toBe(m.trx);
    expect(m.trx.raw).toHaveBeenCalledWith("select set_config('app.current_tenant', ?, true)", ['tenant-1']);
    expect(m.trx.raw.mock.invocationCallOrder[0]).toBeLessThan(m.auditLog.mock.invocationCallOrder[0]);
  });

  it('resolves an event trigger from the catalog server-side, never from the client', async () => {
    m.buildTrigger.mockResolvedValue({
      payloadSchemaRef: 'payload.TicketCreated.v1',
      trigger: { type: 'event', eventName: 'TICKET_CREATED' },
      dateSourceId: null,
    });
    await createWorkflowFromTicketAction({ ...input, trigger: { type: 'event', eventName: 'TICKET_CREATED' } });
    expect(m.buildTrigger).toHaveBeenCalledWith({ eventName: 'TICKET_CREATED' });
    const { definition } = m.createDefinition.mock.calls[0][0];
    expect(definition.trigger).toEqual({ type: 'event', eventName: 'TICKET_CREATED' });
    expect(definition.payloadSchemaRef).toBe('payload.TicketCreated.v1');
    expect(m.auditLog).toHaveBeenCalledTimes(1);
    expect(m.auditLog.mock.calls[0][0]).toBe(m.trx);
    expect(m.auditLog).toHaveBeenCalledWith(
      m.trx,
      expect.objectContaining({ changedData: expect.objectContaining({ triggerEventName: 'TICKET_CREATED' }) })
    );
    expect(m.trx.raw).toHaveBeenCalledWith("select set_config('app.current_tenant', ?, true)", ['tenant-1']);
    expect(m.trx.raw.mock.invocationCallOrder[0]).toBeLessThan(m.auditLog.mock.invocationCallOrder[0]);
  });

  it('maps a Forbidden from createWorkflowDefinitionAction to a permission error and does not audit', async () => {
    m.createDefinition.mockRejectedValue(new Error('Forbidden'));
    expect(await createWorkflowFromTicketAction(input)).toHaveProperty('permissionError');
    expect(m.auditLog).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it('rethrows unexpected errors', async () => {
    m.createDefinition.mockRejectedValue(new Error('db down'));
    await expect(createWorkflowFromTicketAction(input)).rejects.toThrow('db down');
  });
});

describe('getWorkflowFromTicketImportSummaryAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.edition.enterprise = true;
    m.user = { user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1', roles: [] };
    m.hasPermission.mockImplementation(async (_u: any, resource: string, action: string) => resource === 'workflow' && action === 'manage');
  });

  it('returns only counts; inactive/missing-template items count as ad-hoc', async () => {
    m.getBlueprint.mockResolvedValue({
      ...blueprint,
      custom_fields: { a: 1, b: 2 },
      checklist: [
        { item_name: 'x', is_required: false, template_id: 't1', template_name: 'T', template_is_active: true },
        { item_name: 'y', is_required: false, template_id: 't1', template_name: 'T', template_is_active: true },
        { item_name: 'z', is_required: false, template_id: 't2', template_name: 'Old', template_is_active: false },
        { item_name: 'w', is_required: false, template_id: null },
      ],
    });
    const result = await getWorkflowFromTicketImportSummaryAction({ ticketId: TICKET_ID });
    expect(result).toEqual({ customFieldCount: 2, templateItemCount: 2, adHocItemCount: 2 });
  });

  it('fails fast outside EE, denies client users and users without workflow rights before reading the ticket', async () => {
    m.edition.enterprise = false;
    await expect(getWorkflowFromTicketImportSummaryAction({ ticketId: TICKET_ID })).rejects.toThrow(/Enterprise/);
    m.edition.enterprise = true;

    m.user = { ...m.user, user_type: 'client' };
    expect(await getWorkflowFromTicketImportSummaryAction({ ticketId: TICKET_ID })).toHaveProperty('permissionError');
    m.user = { ...m.user, user_type: 'internal' };

    m.hasPermission.mockResolvedValue(false);
    expect(await getWorkflowFromTicketImportSummaryAction({ ticketId: TICKET_ID })).toHaveProperty('permissionError');
    expect(m.getBlueprint).not.toHaveBeenCalled();
  });

  it('passes through the ticket row-auth denial and rejects a bad id', async () => {
    m.getBlueprint.mockResolvedValue({ permissionError: 'Permission denied: Cannot view ticket' });
    expect(await getWorkflowFromTicketImportSummaryAction({ ticketId: TICKET_ID })).toEqual({ permissionError: 'Permission denied: Cannot view ticket' });
    expect(await getWorkflowFromTicketImportSummaryAction({ ticketId: 'nope' })).toHaveProperty('actionError');
  });
});
