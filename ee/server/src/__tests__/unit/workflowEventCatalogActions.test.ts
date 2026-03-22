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
  auditLog: vi.fn(async () => undefined)
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

import {
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
