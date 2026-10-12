/**
 * Xero live service-mapping module: explicit item-vs-account target selection.
 *
 * The service module surfaces two catalogs (Items and revenue Accounts) as
 * kind-prefixed options so identical codes can never collide, persists the
 * chosen kind as explicit metadata, and treats kind-less legacy rows as item
 * mappings.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actionsMock = vi.hoisted(() => ({
  createExternalEntityMapping: vi.fn(),
  createExternalEntityMappings: vi.fn(),
  deleteExternalEntityMapping: vi.fn(),
  getExternalEntityMappings: vi.fn(),
  getServices: vi.fn(),
  getTaxRegions: vi.fn(),
  getXeroAccounts: vi.fn(),
  getXeroItems: vi.fn(),
  getXeroTaxRates: vi.fn(),
  getXeroTrackingCategories: vi.fn(),
  updateExternalEntityMapping: vi.fn(),
}));

vi.mock('@alga-psa/integrations/actions', () => actionsMock);

import { createXeroLiveMappingModules } from './xeroLiveMappingModules';
import type { ExternalEntityMapping } from '@alga-psa/integrations/actions';

const context = { realmId: 'xero-tenant-1', connectionId: 'conn-1' };

function serviceModule() {
  const module = createXeroLiveMappingModules().find(
    (candidate) => candidate.algaEntityType === 'service'
  );
  if (!module) throw new Error('service module missing');
  return module;
}

function mapping(overrides: Partial<ExternalEntityMapping> = {}): ExternalEntityMapping {
  return {
    id: 'mapping-1',
    tenant: 'tenant-1',
    integration_type: 'xero',
    alga_entity_type: 'service',
    alga_entity_id: 'svc-1',
    external_entity_id: '200',
    external_realm_id: 'xero-tenant-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as ExternalEntityMapping;
}

beforeEach(() => {
  vi.clearAllMocks();
  actionsMock.getExternalEntityMappings.mockResolvedValue([]);
  actionsMock.getServices.mockResolvedValue({ services: [] });
  actionsMock.getXeroItems.mockResolvedValue([
    { id: 'item-1', name: 'Consulting', code: 'CONSULT', status: 'ACTIVE' },
    { id: 'item-2', name: 'Old SKU', code: 'OLD', status: 'ARCHIVED' },
  ]);
  actionsMock.getXeroAccounts.mockResolvedValue([
    { id: 'acct-1', name: 'Sales - IT Professional Services', code: '200', type: 'REVENUE' },
    { id: 'acct-2', name: 'Bank', code: '090', type: 'BANK' },
    { id: 'acct-3', name: 'Codeless Revenue', code: '', type: 'REVENUE' },
    { id: 'acct-4', name: 'Global Sales', code: '400', type: 'SALES' },
  ]);
});

describe('service module external catalog', () => {
  it('offers usable items and eligible revenue accounts as explicitly kinded options', async () => {
    const result = await serviceModule().load(context);

    expect(result.externalEntities).toEqual([
      {
        id: 'item:CONSULT',
        name: 'Item · Consulting (CONSULT)',
        kind: 'item',
        code: 'CONSULT',
        baseName: 'Consulting',
      },
      {
        id: 'account:200',
        name: 'Revenue account · Sales - IT Professional Services (200)',
        kind: 'account',
        code: '200',
        baseName: 'Sales - IT Professional Services',
      },
      {
        id: 'account:400',
        name: 'Revenue account · Global Sales (400)',
        kind: 'account',
        code: '400',
        baseName: 'Global Sales',
      },
    ]);
  });

  it('T020: loads catalogs through the exact connection context and reads mappings realm-scoped', async () => {
    actionsMock.getTaxRegions.mockResolvedValue([
      { region_code: 'tax-region-1', region_name: 'GST Region' },
    ]);
    actionsMock.getXeroTaxRates.mockResolvedValue([
      { id: 'tax-1', taxType: 'OUTPUT', name: 'GST', status: 'ACTIVE' },
    ]);

    const modules = createXeroLiveMappingModules();
    const taxModule = modules.find((candidate) => candidate.algaEntityType === 'tax_code')!;

    await serviceModule().load(context);
    const taxLoad = await taxModule.load(context);

    expect(actionsMock.getExternalEntityMappings).toHaveBeenCalledWith({
      integrationType: 'xero',
      algaEntityType: 'service',
      externalRealmId: 'xero-tenant-1',
    });
    expect(actionsMock.getExternalEntityMappings).toHaveBeenCalledWith({
      integrationType: 'xero',
      algaEntityType: 'tax_code',
      externalRealmId: 'xero-tenant-1',
    });
    expect(actionsMock.getXeroItems).toHaveBeenCalledWith('conn-1');
    expect(actionsMock.getXeroAccounts).toHaveBeenCalledWith('conn-1');
    expect(actionsMock.getXeroTaxRates).toHaveBeenCalledWith('conn-1');

    expect(taxLoad.externalEntities).toEqual([{ id: 'OUTPUT', name: 'GST (OUTPUT)' }]);
  });
});

describe('service module persistence', () => {
  it('create() strips the option prefix and persists the explicit account kind', async () => {
    actionsMock.createExternalEntityMapping.mockResolvedValue(mapping());

    await serviceModule().create(context, {
      algaEntityId: 'svc-1',
      externalEntityId: 'account:200',
      metadata: { externalDisplayName: 'Revenue account · Sales (200)' },
    });

    expect(actionsMock.createExternalEntityMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        external_entity_id: '200',
        external_realm_id: 'xero-tenant-1',
        metadata: expect.objectContaining({ xeroTargetKind: 'account' }),
      })
    );
  });

  it('update() overrides a stale metadata kind with the picked one', async () => {
    actionsMock.updateExternalEntityMapping.mockResolvedValue(mapping());

    await serviceModule().update(context, 'mapping-1', {
      externalEntityId: 'item:CONSULT',
      metadata: { xeroTargetKind: 'account' },
    });

    expect(actionsMock.updateExternalEntityMapping).toHaveBeenCalledWith(
      'mapping-1',
      expect.objectContaining({
        external_entity_id: 'CONSULT',
        metadata: expect.objectContaining({ xeroTargetKind: 'item' }),
      })
    );
  });

  it('create() rejects an unkinded selection instead of persisting it', () => {
    expect(() =>
      serviceModule().create(context, { algaEntityId: 'svc-1', externalEntityId: '200' })
    ).toThrow(/missing its item\/account kind/);
    expect(actionsMock.createExternalEntityMapping).not.toHaveBeenCalled();
  });
});

describe('service module target-kind resolution for stored rows', () => {
  it('reads the explicit kind, defaults legacy rows to item, and never guesses account', () => {
    const target = serviceModule().externalTarget!;

    expect(target.kindForMapping(mapping({ metadata: { xeroTargetKind: 'account' } }))).toBe('account');
    expect(target.optionIdForMapping(mapping({ metadata: { xeroTargetKind: 'account' } }))).toBe('account:200');

    // Legacy row: same code, no kind — stays item, even though account 200 exists.
    expect(target.kindForMapping(mapping({ metadata: null }))).toBe('item');
    expect(target.optionIdForMapping(mapping({ metadata: null }))).toBe('item:200');
  });
});

describe('service module createMany', () => {
  it('persists item:200 and account:200 in one batch as code 200 with distinct kinds', async () => {
    actionsMock.createExternalEntityMappings.mockImplementation(async (rows: any[]) =>
      rows.map((row) => ({ alga_entity_id: row.alga_entity_id, ok: true, mapping: mapping() }))
    );

    const results = await serviceModule().createMany!(context, [
      { algaEntityId: 'svc-a', externalEntityId: 'item:200', metadata: { externalDisplayName: 'A' } },
      { algaEntityId: 'svc-b', externalEntityId: 'account:200' },
    ]);

    expect(actionsMock.createExternalEntityMappings).toHaveBeenCalledTimes(1);
    expect(actionsMock.createExternalEntityMappings).toHaveBeenCalledWith([
      expect.objectContaining({
        integration_type: 'xero',
        alga_entity_type: 'service',
        alga_entity_id: 'svc-a',
        external_entity_id: '200',
        external_realm_id: 'xero-tenant-1',
        metadata: { externalDisplayName: 'A', xeroTargetKind: 'item' },
      }),
      expect.objectContaining({
        alga_entity_id: 'svc-b',
        external_entity_id: '200',
        metadata: { xeroTargetKind: 'account' },
      }),
    ]);
    expect(results.map((r) => r.ok)).toEqual([true, true]);
  });

  it('fails only the row with an unprefixed id and never sends it', async () => {
    actionsMock.createExternalEntityMappings.mockImplementation(async (rows: any[]) =>
      rows.map((row) => ({ alga_entity_id: row.alga_entity_id, ok: true, mapping: mapping() }))
    );

    const results = await serviceModule().createMany!(context, [
      { algaEntityId: 'svc-a', externalEntityId: '200' },
      { algaEntityId: 'svc-b', externalEntityId: 'item:ABC' },
    ]);

    const sent = actionsMock.createExternalEntityMappings.mock.calls[0][0];
    expect(sent).toHaveLength(1);
    expect(sent[0].alga_entity_id).toBe('svc-b');
    expect(results[0]).toMatchObject({ algaEntityId: 'svc-a', ok: false });
    expect(results[0].error).toMatch(/missing its item\/account kind/);
    expect(results[1]).toMatchObject({ algaEntityId: 'svc-b', ok: true });
  });

  it('surfaces server per-row failures without failing the batch', async () => {
    actionsMock.createExternalEntityMappings.mockResolvedValue([
      { alga_entity_id: 'svc-a', ok: false, error: 'A mapping for this entity already exists' },
      { alga_entity_id: 'svc-b', ok: true, mapping: mapping() },
    ]);
    const results = await serviceModule().createMany!(context, [
      { algaEntityId: 'svc-a', externalEntityId: 'item:X' },
      { algaEntityId: 'svc-b', externalEntityId: 'item:Y' },
    ]);
    expect(results.map((r) => r.ok)).toEqual([false, true]);
    expect(results[0].error).toMatch(/already exists/);
  });
});
