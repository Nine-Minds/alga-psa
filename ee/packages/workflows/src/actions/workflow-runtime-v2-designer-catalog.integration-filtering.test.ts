import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

type ExtensionInstallRow = { publisher: string | null; name: string | null };

type FixtureState = {
  tenant: string;
  hasExtensionTables: boolean;
  ninjaOneActive: boolean;
  extensionInstallRows: ExtensionInstallRow[];
};

const fixture: FixtureState = vi.hoisted(() => ({
  tenant: 'tenant-a',
  hasExtensionTables: false,
  ninjaOneActive: false,
  extensionInstallRows: []
}));

const createRmmIntegrationBuilder = () => {
  const builder: any = {
    where: vi.fn().mockReturnThis(),
    whereNotNull: vi.fn().mockReturnThis(),
    first: vi.fn().mockImplementation(async () => (fixture.ninjaOneActive ? { id: 'rmm-1' } : undefined))
  };
  return builder;
};

const createExtensionInstallBuilder = () => {
  const builder: any = {
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockImplementation((callbackOrField: unknown) => {
      if (typeof callbackOrField === 'function') {
        callbackOrField({ where: vi.fn().mockReturnThis(), orWhere: vi.fn().mockReturnThis() });
      }
      return builder;
    }),
    select: vi.fn().mockImplementation(async () => fixture.extensionInstallRows)
  };
  return builder;
};

const knexMock: any = vi.hoisted(() => vi.fn((table: string) => {
  if (table === 'rmm_integrations') {
    return createRmmIntegrationBuilder();
  }
  if (table === 'tenant_extension_install as install') {
    return createExtensionInstallBuilder();
  }
  throw new Error(`Unexpected table: ${table}`);
}));
knexMock.schema = {
  hasTable: vi.fn(async (table: string) => fixture.hasExtensionTables && (table === 'tenant_extension_install' || table === 'extension_registry'))
};

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: knexMock, tenant: fixture.tenant })),
  auditLog: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (input: unknown) => fn({ user_id: 'user-1', user_type: 'internal', roles: [] }, { tenant: fixture.tenant }, input),
  hasPermission: vi.fn().mockResolvedValue(true),
  getCurrentUser: vi.fn().mockResolvedValue({ user_id: 'user-1', user_type: 'internal', roles: [] }),
  preCheckDeletion: vi.fn()
}));

vi.mock('@alga-psa/core', () => ({
  deleteEntityWithValidation: vi.fn()
}));

vi.mock('@alga-psa/analytics', () => ({
  analytics: { capture: vi.fn() }
}));

vi.mock('@alga-psa/db/workDate', () => ({
  computeWorkDateFields: vi.fn(() => ({ localDate: '2026-01-01' })),
  resolveUserTimeZone: vi.fn(() => 'America/New_York')
}));

vi.mock('@alga-psa/workflows/runtime', () => {
  return {
    WorkflowRuntimeV2: class {},
    initializeWorkflowRuntimeV2: vi.fn(),
    getNodeTypeRegistry: vi.fn(() => ({ list: () => [] })),
    getSchemaRegistry: vi.fn(() => ({ has: () => false, toJsonSchema: () => ({}), listRefs: () => [] })),
    applyRedactions: vi.fn((input) => input),
    isWorkflowEventTrigger: vi.fn(() => false),
    isWorkflowOneTimeScheduleTrigger: vi.fn(() => false),
    isWorkflowRecurringScheduleTrigger: vi.fn(() => false),
    isWorkflowTimeTrigger: vi.fn(() => false),
    resolveActionCallOutputSchema: vi.fn(() => null),
    zodToWorkflowJsonSchema: vi.fn(() => ({})),
    validateWorkflowDefinition: vi.fn(() => ({ errors: [], warnings: [] })),
    validateInputMapping: vi.fn(() => ({ ok: true, errors: [] })),
    resolveInputMapping: vi.fn(() => ({})),
    createSecretResolverFromProvider: vi.fn(() => vi.fn()),
    verifySecretsExist: vi.fn(async () => ({ missing: [] })),
    workflowDefinitionSchema: z.record(z.any()),
    getActionRegistryV2: () => ({
      list: () => [
        {
          id: 'ninjaone.devices.find',
          version: 1,
          sideEffectful: false,
          idempotency: { mode: 'none' },
          ui: { label: 'Find devices', description: 'Find NinjaOne devices', icon: 'ninjaone' },
          inputSchema: z.object({}),
          outputSchema: z.object({})
        },
        {
          id: 'acme.sync.records',
          version: 1,
          sideEffectful: false,
          idempotency: { mode: 'none' },
          ui: { label: 'Sync records', description: 'Sync ACME records', icon: 'app' },
          inputSchema: z.object({}),
          outputSchema: z.object({})
        }
      ]
    }),
    getWorkflowIntegrationModuleRegistry: () => ({
      list: () => [
        {
          groupKey: 'app:ninjaone',
          label: 'NinjaOne',
          description: 'NinjaOne module',
          tileKind: 'app',
          iconToken: 'ninjaone',
          defaultActionId: 'ninjaone.devices.find',
          allowedActionIds: ['ninjaone.devices.find'],
          availabilityKey: 'rmm:ninjaone'
        }
      ]
    }),
    buildWorkflowDesignerActionCatalog: () => [
      {
        groupKey: 'ticket',
        label: 'Ticket',
        iconToken: 'ticket',
        tileKind: 'core-object',
        allowedActionIds: ['tickets.create'],
        actions: []
      },
      {
        groupKey: 'app:ninjaone',
        label: 'NinjaOne',
        iconToken: 'ninjaone',
        tileKind: 'app',
        allowedActionIds: ['ninjaone.devices.find'],
        actions: []
      },
      {
        groupKey: 'app:acme.sync',
        label: 'Acme Sync',
        iconToken: 'app',
        tileKind: 'app',
        allowedActionIds: ['acme.sync.records'],
        actions: []
      }
    ]
  };
});

import { listWorkflowDesignerActionCatalogAction } from './workflow-runtime-v2-actions';

describe('workflow designer catalog integration module filtering', () => {
  beforeEach(() => {
    fixture.tenant = 'tenant-a';
    fixture.hasExtensionTables = false;
    fixture.ninjaOneActive = false;
    fixture.extensionInstallRows = [];
    knexMock.mockClear();
    knexMock.schema.hasTable.mockClear();
  });

  it('T003: tenant with active NinjaOne integration receives NinjaOne designer catalog record', async () => {
    fixture.ninjaOneActive = true;

    const catalog = await listWorkflowDesignerActionCatalogAction();

    expect(catalog.some((record) => record.groupKey === 'app:ninjaone')).toBe(true);
  });

  it('T004: tenant without active/connected NinjaOne integration does not receive NinjaOne catalog record', async () => {
    fixture.ninjaOneActive = false;

    const catalog = await listWorkflowDesignerActionCatalogAction();

    expect(catalog.some((record) => record.groupKey === 'app:ninjaone')).toBe(false);
  });

  it('T005: extension app filtering remains enabled alongside first-party integration filtering', async () => {
    fixture.ninjaOneActive = true;
    fixture.hasExtensionTables = true;
    fixture.extensionInstallRows = [{ publisher: 'acme', name: 'sync' }];

    const catalog = await listWorkflowDesignerActionCatalogAction();

    expect(catalog.some((record) => record.groupKey === 'app:ninjaone')).toBe(true);
    expect(catalog.some((record) => record.groupKey === 'app:acme.sync')).toBe(true);
  });
});
