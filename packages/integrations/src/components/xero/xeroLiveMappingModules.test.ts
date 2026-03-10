import { beforeEach, describe, expect, it, vi } from 'vitest';

const getExternalEntityMappingsMock = vi.hoisted(() => vi.fn());
const getServicesMock = vi.hoisted(() => vi.fn());
const getTaxRegionsMock = vi.hoisted(() => vi.fn());
const getXeroAccountsMock = vi.hoisted(() => vi.fn());
const getXeroItemsMock = vi.hoisted(() => vi.fn());
const getXeroTaxRatesMock = vi.hoisted(() => vi.fn());
const getXeroTrackingCategoriesMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/integrations/actions', () => ({
  createExternalEntityMapping: vi.fn(),
  deleteExternalEntityMapping: vi.fn(),
  getExternalEntityMappings: getExternalEntityMappingsMock,
  getServices: getServicesMock,
  getTaxRegions: getTaxRegionsMock,
  getXeroAccounts: getXeroAccountsMock,
  getXeroItems: getXeroItemsMock,
  getXeroTaxRates: getXeroTaxRatesMock,
  getXeroTrackingCategories: getXeroTrackingCategoriesMock,
  updateExternalEntityMapping: vi.fn()
}));

import { createXeroLiveMappingModules } from './xeroLiveMappingModules';

describe('Xero live mapping modules', () => {
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
    getXeroItemsMock.mockResolvedValue([
      {
        id: 'item-id-1',
        code: 'ITEM-001',
        name: 'Managed Backup',
        status: 'ACTIVE'
      }
    ]);
    getXeroAccountsMock.mockResolvedValue([
      {
        id: 'account-1',
        code: '200',
        name: 'Sales',
        type: 'REVENUE'
      }
    ]);
    getXeroTaxRatesMock.mockResolvedValue([
      {
        id: 'tax-1',
        taxType: 'OUTPUT',
        name: 'GST',
        status: 'ACTIVE'
      }
    ]);
    getXeroTrackingCategoriesMock.mockResolvedValue([
      {
        id: 'tracking-1',
        name: 'Region',
        status: 'ACTIVE',
        options: [{ id: 'north', name: 'North', status: 'ACTIVE' }]
      }
    ]);
  });

  it('T020: live Xero mapping modules load accounts, items, tax rates, and tracking categories using the default connection context', async () => {
    const [serviceModule, taxModule] = createXeroLiveMappingModules();
    const context = {
      realmId: 'xero-tenant-1',
      connectionId: 'connection-1',
      realmDisplayValue: 'Acme Holdings'
    };

    const serviceLoad = await serviceModule.load(context);
    const taxLoad = await taxModule.load(context);

    expect(getExternalEntityMappingsMock).toHaveBeenCalledWith({
      integrationType: 'xero',
      algaEntityType: 'service',
      externalRealmId: 'xero-tenant-1'
    });
    expect(getExternalEntityMappingsMock).toHaveBeenCalledWith({
      integrationType: 'xero',
      algaEntityType: 'tax_code',
      externalRealmId: 'xero-tenant-1'
    });
    expect(getXeroItemsMock).toHaveBeenCalledWith('connection-1');
    expect(getXeroAccountsMock).toHaveBeenCalledWith('connection-1');
    expect(getXeroTrackingCategoriesMock).toHaveBeenCalledWith('connection-1');
    expect(getXeroTaxRatesMock).toHaveBeenCalledWith('connection-1');

    expect(serviceLoad.externalEntities).toEqual([
      {
        id: 'ITEM-001',
        name: 'Managed Backup (ITEM-001)'
      }
    ]);
    expect(taxLoad.externalEntities).toEqual([
      {
        id: 'OUTPUT',
        name: 'GST (OUTPUT)'
      }
    ]);
  });
});
