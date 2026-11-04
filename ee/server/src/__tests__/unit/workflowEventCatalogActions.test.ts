import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createTenantKnexMock,
  hasPermissionMock,
  initializeWorkflowRuntimeV2Mock,
  schemaRegistryHasMock
} = vi.hoisted(() => ({
  createTenantKnexMock: vi.fn(),
  hasPermissionMock: vi.fn(async () => true),
  initializeWorkflowRuntimeV2Mock: vi.fn(),
  schemaRegistryHasMock: vi.fn()
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (input: unknown) => action(
    { user_id: 'user-1', tenant: 'tenant-1', roles: [] },
    { tenant: 'tenant-1' },
    input
  ),
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args)
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: unknown[]) => createTenantKnexMock(...args),
  auditLog: vi.fn(async () => undefined),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
    unscoped: (t: string) => conn(t),
    tenantJoin: (q: any, t: string, _l?: any, _r?: any, o: any = {}) =>
      (o?.type === 'left' ? (q.leftJoin?.(t) ?? q) : (q.join?.(t) ?? q)),
  })
}));

vi.mock('@alga-psa/workflows/runtime', () => ({
  initializeWorkflowRuntimeV2: (...args: unknown[]) => initializeWorkflowRuntimeV2Mock(...args),
  getSchemaRegistry: () => ({
    has: (...args: unknown[]) => schemaRegistryHasMock(...args)
  })
}));

vi.mock('@alga-psa/workflows/persistence', () => ({
  WorkflowDefinitionModelV2: {},
  WorkflowDefinitionVersionModelV2: {}
}));

vi.mock('@alga-psa/workflows/actions/workflow-runtime-v2-actions', () => ({
  submitWorkflowEventAction: vi.fn(),
  createWorkflowDefinitionAction: vi.fn(),
  publishWorkflowDefinitionAction: vi.fn()
}));

vi.mock('@alga-psa/workflows/actions', () => ({
  createEventCatalogEntry: vi.fn()
}));

import { createWorkflowDefinitionAction } from '@alga-psa/workflows/actions/workflow-runtime-v2-actions';
import {
  buildTriggerForCatalogEvent,
  createWorkflowFromEventAction,
  listEventCatalogCategoriesV2Action,
  listEventCatalogOptionsV2Action
} from '@alga-psa/workflows/actions/workflow-event-catalog-v2-actions';
import { EventCatalogModel } from '@alga-psa/workflows/models/eventCatalog';

const makeDistinctBuilder = (rows: Array<Record<string, unknown>>) => ({
  distinct: vi.fn().mockReturnThis(),
  whereNotNull: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn(async () => rows)
});

describe('workflow event catalog actions', () => {
  beforeEach(() => {
    createTenantKnexMock.mockReset();
    hasPermissionMock.mockReset();
    initializeWorkflowRuntimeV2Mock.mockReset();
    schemaRegistryHasMock.mockReset();

    hasPermissionMock.mockResolvedValue(true);
    schemaRegistryHasMock.mockImplementation((schemaRef: string) => schemaRef !== 'payload.Unknown.v1');
  });

  it('T042: event catalog list action returns source-aware options with schema-ref status through the EE workflow package', async () => {
    const eventCatalogSpy = vi.spyOn(EventCatalogModel, 'getAll').mockResolvedValue([
      {
        event_id: 'tenant-evt',
        tenant: 'tenant-1',
        event_type: 'ticket.created',
        name: 'Ticket Created',
        description: 'Tenant override',
        category: 'Tickets',
        payload_schema_ref: 'payload.Ticket.v1',
        status: 'active'
      },
      {
        event_id: 'system-evt',
        tenant: null,
        event_type: 'survey.expired',
        name: 'Survey Expired',
        description: 'System event',
        category: 'Surveys',
        payload_schema_ref: 'payload.Unknown.v1',
        status: 'beta'
      }
    ] as any);

    createTenantKnexMock.mockResolvedValue({ knex: vi.fn(), tenant: 'tenant-1' });

    const result = await listEventCatalogOptionsV2Action({ search: 'ticket' });

    expect(initializeWorkflowRuntimeV2Mock).toHaveBeenCalledTimes(1);
    expect(eventCatalogSpy).toHaveBeenCalledWith(expect.anything(), 'tenant-1', { limit: 500, offset: 0 });
    expect(result.events).toEqual([
      expect.objectContaining({
        event_id: 'tenant-evt',
        source: 'tenant',
        payload_schema_ref_status: 'known',
        status: 'active'
      })
    ]);
    expect(hasPermissionMock).toHaveBeenCalled();

    eventCatalogSpy.mockRestore();
  });

  it('deduplicates tenant and system categories for the category list action', async () => {
    const eventCatalogBuilder = makeDistinctBuilder([
      { category: 'Tickets' },
      { category: 'Automation' }
    ]);
    const systemCatalogBuilder = makeDistinctBuilder([
      { category: 'Automation' },
      { category: 'Surveys' }
    ]);
    const knexMock: any = vi.fn((table: string) => {
      if (table === 'event_catalog') return eventCatalogBuilder;
      if (table === 'system_event_catalog') return systemCatalogBuilder;
      throw new Error(`Unexpected table ${table}`);
    });
    createTenantKnexMock.mockResolvedValue({ knex: knexMock, tenant: 'tenant-1' });

    const result = await listEventCatalogCategoriesV2Action();

    expect(result.categories).toEqual(['Automation', 'Surveys', 'Tickets']);
  });
});

describe('createWorkflowFromEventAction', () => {
  beforeEach(() => {
    createTenantKnexMock.mockReset();
    hasPermissionMock.mockReset();
    hasPermissionMock.mockResolvedValue(true);
    createTenantKnexMock.mockResolvedValue({ knex: vi.fn(), tenant: 'tenant-1' });
    vi.mocked(createWorkflowDefinitionAction).mockReset();
    vi.mocked(createWorkflowDefinitionAction).mockResolvedValue({ workflowId: 'wf-1' } as any);
  });

  it('creates a date trigger for the status-age catalog row, ignoring the caller payload schema ref', async () => {
    await createWorkflowFromEventAction({
      eventType: 'TICKET_STATUS_AGE',
      payloadSchemaRef: 'payload.Wrong.v1',
      sourcePayloadSchemaRef: 'payload.Wrong.v1'
    });
    const { definition } = vi.mocked(createWorkflowDefinitionAction).mock.calls[0][0] as any;
    expect(definition.payloadSchemaRef).toBe('payload.TicketStatusAge.v1');
    expect(definition.trigger).toEqual({
      type: 'date',
      source: 'ticket.status_age',
      offsetDays: 0,
      localTime: '08:00',
      params: { statusName: '', boardId: null, days: 7, repeatEveryDays: null, requireNoActivity: false }
    });
  });

  it('still creates an event trigger for an ordinary event', async () => {
    await createWorkflowFromEventAction({ eventType: 'TICKET_CREATED', payloadSchemaRef: 'payload.Ticket.v1' });
    const { definition } = vi.mocked(createWorkflowDefinitionAction).mock.calls[0][0] as any;
    expect(definition.payloadSchemaRef).toBe('payload.Ticket.v1');
    expect(definition.trigger).toMatchObject({ type: 'event', eventName: 'TICKET_CREATED' });
  });

  it('creates a maintenance date workflow from the Event Catalog instead of subscribing to a nonexistent event', async () => {
    await createWorkflowFromEventAction({
      eventType: 'ASSET_MAINTENANCE_DUE',
      payloadSchemaRef: 'payload.Wrong.v1',
    });
    const { definition } = vi.mocked(createWorkflowDefinitionAction).mock.calls[0][0];
    expect(definition.payloadSchemaRef).toBe('payload.AssetMaintenanceDue.v1');
    expect(definition.trigger).toEqual({
      type: 'date', source: 'asset.maintenance_due', offsetDays: -30, localTime: '08:00',
    });
  });
});

describe('buildTriggerForCatalogEvent', () => {
  beforeEach(() => {
    createTenantKnexMock.mockReset();
    hasPermissionMock.mockReset();
    hasPermissionMock.mockResolvedValue(true);
    createTenantKnexMock.mockResolvedValue({ knex: vi.fn(), tenant: 'tenant-1' });
  });

  it('resolves the payload schema ref from the catalog, never from the caller', async () => {
    vi.spyOn(EventCatalogModel, 'getByEventType').mockResolvedValue({
      event_type: 'TICKET_CREATED',
      payload_schema_ref: 'payload.TicketCreated.v1'
    } as any);
    const result = await buildTriggerForCatalogEvent({ eventName: 'TICKET_CREATED', payloadSchemaRef: 'payload.Wrong.v1' });
    expect(result.payloadSchemaRef).toBe('payload.TicketCreated.v1');
    expect(result.trigger).toEqual({ type: 'event', eventName: 'TICKET_CREATED' });
    expect(result.dateSourceId).toBeNull();
  });

  it('throws on an unknown event instead of falling back to an empty schema ref', async () => {
    vi.spyOn(EventCatalogModel, 'getByEventType').mockResolvedValue(null);
    await expect(buildTriggerForCatalogEvent({ eventName: 'NOPE' })).rejects.toThrow('Unknown workflow event: NOPE');
  });

  it('throws when the catalog row has no payload schema', async () => {
    vi.spyOn(EventCatalogModel, 'getByEventType').mockResolvedValue({ event_type: 'X_EVENT', payload_schema_ref: null } as any);
    await expect(buildTriggerForCatalogEvent({ eventName: 'X_EVENT' })).rejects.toThrow('no payload schema');
  });

  it.each([
    ['TICKET_STATUS_AGE', 'ticket.status_age', 'payload.TicketStatusAge.v1'],
    ['ASSET_MAINTENANCE_DUE', 'asset.maintenance_due', 'payload.AssetMaintenanceDue.v1'],
  ])('builds a date trigger for the %s catalog row', async (eventName, source, schemaRef) => {
    vi.spyOn(EventCatalogModel, 'getByEventType').mockResolvedValue({
      event_type: eventName,
      payload_schema_ref: 'payload.Wrong.v1'
    } as any);
    const result = await buildTriggerForCatalogEvent({ eventName });
    expect(result.payloadSchemaRef).toBe(schemaRef);
    expect(result.trigger).toMatchObject({ type: 'date', source });
    expect(result.dateSourceId).toBe(source);
  });
});
