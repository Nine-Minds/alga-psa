import { beforeEach, describe, expect, it, vi } from 'vitest';

const getExternalEntityMappingsMock = vi.hoisted(() => vi.fn());
const getServicesMock = vi.hoisted(() => vi.fn());
const getTaxRegionsMock = vi.hoisted(() => vi.fn());
const getQboItemsMock = vi.hoisted(() => vi.fn());
const getQboTaxCodesMock = vi.hoisted(() => vi.fn());
const getQboAutomatedSalesTaxModeMock = vi.hoisted(() => vi.fn());
const getQboTermsMock = vi.hoisted(() => vi.fn());
const createExternalEntityMappingMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/integrations/actions', () => ({
  createExternalEntityMapping: (...args: unknown[]) => createExternalEntityMappingMock(...args),
  deleteExternalEntityMapping: vi.fn(),
  getExternalEntityMappings: getExternalEntityMappingsMock,
  getQboItems: getQboItemsMock,
  getQboAutomatedSalesTaxMode: getQboAutomatedSalesTaxModeMock,
  getQboTaxCodes: getQboTaxCodesMock,
  getQboTerms: getQboTermsMock,
  getServices: getServicesMock,
  getTaxRegions: getTaxRegionsMock,
  updateExternalEntityMapping: vi.fn()
}));

import {
  createQboLiveMappingModules,
  formatQboTaxCodeLabel,
  formatQboTaxCodeOptions,
  getQboAstPseudoTaxCodes
} from './qboLiveMappingModules';

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
    getQboAutomatedSalesTaxModeMock.mockResolvedValue({ enabled: false });
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
  // --- Automated Sales Tax pseudo codes ---

  it('T046: AST off omits the TAX/NON pseudo codes from the tax-code options', async () => {
    getQboAutomatedSalesTaxModeMock.mockResolvedValue({ enabled: false });
    const [, taxModule] = createQboLiveMappingModules();

    const result = await taxModule.load({ realmId: 'realm-123', connectionId: 'conn-1' });

    expect(result.externalEntities.map((entity) => entity.id)).toEqual(['TAX-001']);
  });

  it('T047: AST on prepends the TAX/NON pseudo codes to the tax-code options', async () => {
    getQboAutomatedSalesTaxModeMock.mockResolvedValue({ enabled: true });
    const [, taxModule] = createQboLiveMappingModules();

    const result = await taxModule.load({ realmId: 'realm-123', connectionId: 'conn-1' });

    expect(result.externalEntities.map((entity) => entity.id)).toEqual(['TAX', 'NON', 'TAX-001']);
  });

  it('T048: AST mode is read for the same realm as the tax-code catalog', async () => {
    const [, taxModule] = createQboLiveMappingModules();

    await taxModule.load({ realmId: 'realm-123', connectionId: 'conn-1' });

    expect(getQboAutomatedSalesTaxModeMock).toHaveBeenCalledWith({ realmId: 'realm-123' });
  });

  it('T049: a catalog that already contains TAX/NON is not given duplicates', async () => {
    getQboAutomatedSalesTaxModeMock.mockResolvedValue({ enabled: true });
    getQboTaxCodesMock.mockResolvedValue([
      { id: 'TAX', name: 'TAX' },
      { id: 'TAX-001', name: 'GST' }
    ]);
    const [, taxModule] = createQboLiveMappingModules();

    const result = await taxModule.load({ realmId: 'realm-123', connectionId: 'conn-1' });

    const ids = result.externalEntities.map((entity) => entity.id);
    expect(ids.filter((id) => id === 'TAX')).toHaveLength(1);
    expect(ids).toEqual(['NON', 'TAX', 'TAX-001']);
  });

  it('T050: pseudo-code labels come from the translator when one is supplied', () => {
    const t = (key: string, options?: Record<string, unknown>) =>
      key === 'integrations.qbo.taxCodes.pseudo.taxable'
        ? 'Steuerpflichtig'
        : String(options?.defaultValue ?? key);

    const [taxable, nonTaxable] = getQboAstPseudoTaxCodes(t);

    expect(taxable).toEqual({ id: 'TAX', name: 'Steuerpflichtig' });
    expect(nonTaxable.name).toBe('NON — non-taxable');
  });

  // --- Tax-code label enrichment ---

  it('T051: a resolvable rate is appended to the tax code name', () => {
    expect(formatQboTaxCodeLabel({ id: '5', name: 'CA-Santa Clara', ratePercent: 9.125 }))
      .toBe('CA-Santa Clara (9.125%)');
  });

  it('T052: a zero rate is shown rather than treated as unknown', () => {
    expect(formatQboTaxCodeLabel({ id: '6', name: 'Out of scope', ratePercent: 0 }))
      .toBe('Out of scope (0%)');
  });

  it('T053: with no rate, a description that adds information is appended', () => {
    expect(
      formatQboTaxCodeLabel({ id: '7', name: 'GST', ratePercent: null, description: 'Goods and services' })
    ).toBe('GST — Goods and services');
  });

  it('T054: a description identical to the name is not repeated', () => {
    expect(
      formatQboTaxCodeLabel({ id: '8', name: 'GST', ratePercent: null, description: 'GST' })
    ).toBe('GST');
  });

  it('T055: a nameless tax code falls back to its QuickBooks id', () => {
    expect(formatQboTaxCodeLabel({ id: '101', name: '', ratePercent: null })).toBe('101');
  });

  it('T056: duplicate AST labels are disambiguated by QuickBooks id', () => {
    // Intuit generates same-named AST tax codes with different rate sets, so the
    // name alone cannot identify which one a user picked.
    const options = formatQboTaxCodeOptions([
      { id: '101', name: 'NM-Roosevelt-Roosevelt', ratePercent: 5.5 },
      { id: '175', name: 'NM-Roosevelt-Roosevelt', ratePercent: 5.5 },
      { id: '4', name: 'CA-Santa Clara', ratePercent: 9.125 }
    ]);

    expect(options).toEqual([
      { id: '101', name: 'NM-Roosevelt-Roosevelt (5.5%) \u00b7 ID 101' },
      { id: '175', name: 'NM-Roosevelt-Roosevelt (5.5%) \u00b7 ID 175' },
      { id: '4', name: 'CA-Santa Clara (9.125%)' }
    ]);
  });

  it('T057: same name but different rates is already unambiguous and keeps the plain label', () => {
    const options = formatQboTaxCodeOptions([
      { id: '101', name: 'NM-Roosevelt', ratePercent: 5.5 },
      { id: '175', name: 'NM-Roosevelt', ratePercent: 6.25 }
    ]);

    expect(options.map((option) => option.name)).toEqual([
      'NM-Roosevelt (5.5%)',
      'NM-Roosevelt (6.25%)'
    ]);
  });
});
