import { beforeEach, describe, expect, it, vi } from 'vitest';

const getExternalEntityMappingsMock = vi.hoisted(() => vi.fn());
const getServicesMock = vi.hoisted(() => vi.fn());
const getTaxRegionsMock = vi.hoisted(() => vi.fn());
const getQboItemsMock = vi.hoisted(() => vi.fn());
const getQboTaxCodesMock = vi.hoisted(() => vi.fn());
const getQboTermsMock = vi.hoisted(() => vi.fn());
const createExternalEntityMappingMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/integrations/actions', () => ({
  createExternalEntityMapping: (...args: unknown[]) => createExternalEntityMappingMock(...args),
  deleteExternalEntityMapping: vi.fn(),
  getExternalEntityMappings: getExternalEntityMappingsMock,
  getQboItems: getQboItemsMock,
  getQboTaxCodes: getQboTaxCodesMock,
  getQboTerms: getQboTermsMock,
  getServices: getServicesMock,
  getTaxRegions: getTaxRegionsMock,
  updateExternalEntityMapping: vi.fn()
}));

import { createQboLiveMappingModules } from './qboLiveMappingModules';

describe('QBO live mapping modules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getExternalEntityMappingsMock.mockResolvedValue([]);
    getServicesMock.mockResolvedValue({
      services: [
        {
          service_id: 'service-1',
          service_name: 'Managed Backup',
          item_kind: 'service',
          sku: 'MB-1'
        }
      ]
    });
    getTaxRegionsMock.mockResolvedValue([
      {
        region_code: 'tax-region-1',
        region_name: 'GST Region'
      }
    ]);
    getQboItemsMock.mockResolvedValue([
      {
        id: 'qbo-item-1',
        name: 'Consulting Services'
      }
    ]);
    getQboTaxCodesMock.mockResolvedValue([
      {
        id: 'TAX-001',
        name: 'GST (10%)'
      }
    ]);
    getQboTermsMock.mockResolvedValue([
      {
        id: 'term-1',
        name: 'Net 30'
      }
    ]);
    createExternalEntityMappingMock.mockResolvedValue({
      id: 'mapping-1',
      integration_type: 'quickbooks_online',
      alga_entity_type: 'service',
      alga_entity_id: 'service-1',
      external_entity_id: 'qbo-item-1',
      external_realm_id: 'realm-123',
      sync_status: 'manual_link'
    });
  });

  it('T030: returns exactly 3 modules in order: service, tax_code, payment_term', () => {
    const modules = createQboLiveMappingModules();
    expect(modules).toHaveLength(3);
    expect(modules[0].id).toBe('qbo-live-service-mappings');
    expect(modules[1].id).toBe('qbo-live-tax-code-mappings');
    expect(modules[2].id).toBe('qbo-live-payment-term-mappings');
  });

  it('T031: all three modules have adapterType quickbooks_online', () => {
    const modules = createQboLiveMappingModules();
    for (const mod of modules) {
      expect(mod.adapterType).toBe('quickbooks_online');
    }
  });

  it('T032: modules have correct algaEntityType and externalEntityType', () => {
    const [serviceModule, taxModule, termModule] = createQboLiveMappingModules();
    expect(serviceModule.algaEntityType).toBe('service');
    expect(serviceModule.externalEntityType).toBe('Item');
    expect(taxModule.algaEntityType).toBe('tax_code');
    expect(taxModule.externalEntityType).toBe('TaxCode');
    expect(termModule.algaEntityType).toBe('payment_term');
    expect(termModule.externalEntityType).toBe('Term');
  });

  it('T033: service module load threads realmId to getQboItems and getExternalEntityMappings', async () => {
    const [serviceModule] = createQboLiveMappingModules();
    const context = { realmId: 'realm-abc', connectionId: 'conn-1', realmDisplayValue: 'Acme' };

    await serviceModule.load(context);

    expect(getQboItemsMock).toHaveBeenCalledWith({ realmId: 'realm-abc' });
    expect(getServicesMock).toHaveBeenCalledWith(1, 999, { item_kind: 'any' });
    expect(getExternalEntityMappingsMock).toHaveBeenCalledWith({
      integrationType: 'quickbooks_online',
      algaEntityType: 'service',
      externalRealmId: 'realm-abc'
    });
  });

  it('T034: tax module load threads realmId to getQboTaxCodes and getExternalEntityMappings', async () => {
    const [, taxModule] = createQboLiveMappingModules();
    const context = { realmId: 'realm-abc', connectionId: 'conn-1', realmDisplayValue: 'Acme' };

    await taxModule.load(context);

    expect(getQboTaxCodesMock).toHaveBeenCalledWith({ realmId: 'realm-abc' });
    expect(getTaxRegionsMock).toHaveBeenCalled();
    expect(getExternalEntityMappingsMock).toHaveBeenCalledWith({
      integrationType: 'quickbooks_online',
      algaEntityType: 'tax_code',
      externalRealmId: 'realm-abc'
    });
  });

  it('T035: payment term module load threads realmId to getQboTerms and getExternalEntityMappings', async () => {
    const [, , termModule] = createQboLiveMappingModules();
    const context = { realmId: 'realm-xyz', connectionId: 'conn-2', realmDisplayValue: 'Beta Corp' };

    await termModule.load(context);

    expect(getQboTermsMock).toHaveBeenCalledWith({ realmId: 'realm-xyz' });
    expect(getExternalEntityMappingsMock).toHaveBeenCalledWith({
      integrationType: 'quickbooks_online',
      algaEntityType: 'payment_term',
      externalRealmId: 'realm-xyz'
    });
  });

  it('T036: service module load returns externalEntities from getQboItems', async () => {
    const [serviceModule] = createQboLiveMappingModules();
    const context = { realmId: 'realm-abc', connectionId: 'conn-1', realmDisplayValue: 'Acme' };

    const result = await serviceModule.load(context);

    expect(result.externalEntities).toEqual([
      { id: 'qbo-item-1', name: 'Consulting Services' }
    ]);
  });

  it('T037: tax module load returns externalEntities from getQboTaxCodes', async () => {
    const [, taxModule] = createQboLiveMappingModules();
    const context = { realmId: 'realm-abc', connectionId: 'conn-1', realmDisplayValue: 'Acme' };

    const result = await taxModule.load(context);

    expect(result.externalEntities).toEqual([
      { id: 'TAX-001', name: 'GST (10%)' }
    ]);
  });

  it('T038: payment term module load returns externalEntities from getQboTerms', async () => {
    const [, , termModule] = createQboLiveMappingModules();
    const context = { realmId: 'realm-xyz', connectionId: 'conn-2', realmDisplayValue: 'Beta Corp' };

    const result = await termModule.load(context);

    expect(result.externalEntities).toEqual([
      { id: 'term-1', name: 'Net 30' }
    ]);
  });

  it('T039: create passes external_realm_id from context.realmId and sync_status manual_link', async () => {
    const [serviceModule] = createQboLiveMappingModules();
    const context = { realmId: 'realm-abc', connectionId: 'conn-1', realmDisplayValue: 'Acme' };

    await serviceModule.create(context, {
      algaEntityId: 'service-1',
      externalEntityId: 'qbo-item-1'
    });

    expect(createExternalEntityMappingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_type: 'quickbooks_online',
        alga_entity_type: 'service',
        alga_entity_id: 'service-1',
        external_entity_id: 'qbo-item-1',
        external_realm_id: 'realm-abc',
        sync_status: 'manual_link'
      })
    );
  });

  it('T040: create with null realmId passes external_realm_id as null', async () => {
    const [serviceModule] = createQboLiveMappingModules();
    const context = { realmId: null, connectionId: 'conn-1', realmDisplayValue: 'Acme' };

    await serviceModule.create(context, {
      algaEntityId: 'service-1',
      externalEntityId: 'qbo-item-1'
    });

    expect(createExternalEntityMappingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        external_realm_id: null
      })
    );
  });

  it('T041: tax module create passes algaEntityType tax_code', async () => {
    const [, taxModule] = createQboLiveMappingModules();
    const context = { realmId: 'realm-abc', connectionId: 'conn-1', realmDisplayValue: 'Acme' };

    await taxModule.create(context, {
      algaEntityId: 'tax-region-1',
      externalEntityId: 'TAX-001'
    });

    expect(createExternalEntityMappingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_type: 'quickbooks_online',
        alga_entity_type: 'tax_code',
        external_realm_id: 'realm-abc',
        sync_status: 'manual_link'
      })
    );
  });

  it('T042: payment term module create passes algaEntityType payment_term', async () => {
    const [, , termModule] = createQboLiveMappingModules();
    const context = { realmId: 'realm-xyz', connectionId: 'conn-2', realmDisplayValue: 'Beta Corp' };

    await termModule.create(context, {
      algaEntityId: 'net_30',
      externalEntityId: 'term-1'
    });

    expect(createExternalEntityMappingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_type: 'quickbooks_online',
        alga_entity_type: 'payment_term',
        external_realm_id: 'realm-xyz',
        sync_status: 'manual_link'
      })
    );
  });

  it('T043: optional translation function is used for tab labels', () => {
    const t = (key: string, options?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'integrations.accounting.modules.tabs.itemsServices': 'Items / Services FR',
        'integrations.accounting.modules.tabs.taxCodes': 'Tax Codes FR',
        'integrations.accounting.modules.tabs.paymentTerms': 'Payment Terms FR'
      };
      return map[key] ?? ((options?.defaultValue as string) ?? key);
    };
    const modules = createQboLiveMappingModules(t);
    expect(modules[0].labels.tab).toBe('Items / Services FR');
    expect(modules[1].labels.tab).toBe('Tax Codes FR');
    expect(modules[2].labels.tab).toBe('Payment Terms FR');
  });

  it('T044: without translation function, tab labels use English defaults', () => {
    const modules = createQboLiveMappingModules();
    expect(modules[0].labels.tab).toBe('Items / Services');
    expect(modules[1].labels.tab).toBe('Tax Codes');
    expect(modules[2].labels.tab).toBe('Payment Terms');
  });

  it('T045: load with undefined realmId passes undefined externalRealmId', async () => {
    const [serviceModule] = createQboLiveMappingModules();
    const context = { realmId: undefined, connectionId: 'conn-1', realmDisplayValue: 'Acme' };

    await serviceModule.load(context);

    expect(getExternalEntityMappingsMock).toHaveBeenCalledWith({
      integrationType: 'quickbooks_online',
      algaEntityType: 'service',
      externalRealmId: undefined
    });
  });
});
