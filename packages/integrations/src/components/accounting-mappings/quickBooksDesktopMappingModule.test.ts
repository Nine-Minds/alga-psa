import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOMATIC_DISCOUNT_MAPPING_ID } from '@alga-psa/types';

const actions = vi.hoisted(() => ({
  createExternalEntityMapping: vi.fn(async (data: Record<string, unknown>) => ({ id: 'map-new', ...data })),
  updateExternalEntityMapping: vi.fn(async (id: string, data: Record<string, unknown>) => ({ id, ...data })),
  deleteExternalEntityMapping: vi.fn(async () => undefined),
  getExternalEntityMappings: vi.fn(async () => []),
  getServices: vi.fn(async () => ({ services: [] })),
  getTaxRegions: vi.fn(async () => [])
}));

vi.mock('../../actions', () => actions);
vi.mock('@alga-psa/integrations/actions', () => actions);
vi.mock('../../actions/clientLookupActions', () => ({
  getIntegrationClients: vi.fn(async () => [{ client_id: 'client-1', client_name: 'Acme Corp' }])
}));

import {
  createQuickBooksDesktopMappingModule,
  createQuickBooksDesktopMappingModules
} from './quickBooksDesktopMappingModule';
import { createCsvMappingModules } from '../csv/csvMappingModules';

describe('QuickBooks Desktop mapping modules', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers every Desktop mapping on one screen, in a fixed tab order', () => {
    expect(createQuickBooksDesktopMappingModules().map((module) => module.id)).toEqual([
      'quickbooks_desktop-client-mapping',
      'quickbooks_desktop-service-mapping',
      'quickbooks_desktop-discount-mapping',
      'quickbooks_desktop-tax_code-mapping',
      'quickbooks_desktop-payment_term-mapping'
    ]);
    expect(createQuickBooksDesktopMappingModules().every((module) => module.adapterType === 'quickbooks_desktop')).toBe(true);
  });

  it('keeps the QuickBooks CSV screen free of Desktop tabs', () => {
    expect(createCsvMappingModules().every((module) => module.adapterType === 'quickbooks_csv')).toBe(true);
  });

  it('requires an item name on services and discounts and offers an optional sales tax item on tax codes', () => {
    const fieldsOf = (entity: Parameters<typeof createQuickBooksDesktopMappingModule>[0]) =>
      createQuickBooksDesktopMappingModule(entity).metadata?.fields ?? [];
    expect(fieldsOf('service')).toEqual([expect.objectContaining({ key: 'qbdItem', required: true })]);
    expect(fieldsOf('discount')).toEqual([expect.objectContaining({ key: 'qbdItem', required: true })]);
    expect(fieldsOf('tax_code')).toEqual([expect.objectContaining({ key: 'qbdSalesTaxItem' })]);
    expect(fieldsOf('tax_code')[0].required).toBeFalsy();
    expect(fieldsOf('client')).toEqual([]);
    expect(fieldsOf('payment_term')).toEqual([]);
  });

  it('stores the account as the mapping value and the item in metadata', async () => {
    const discounts = createQuickBooksDesktopMappingModule('discount');
    await discounts.create({ realmId: null }, {
      algaEntityId: 'ignored', externalEntityId: 'Discounts Given', metadata: { qbdItem: 'Loyalty Discount' }
    });
    expect(actions.createExternalEntityMapping).toHaveBeenCalledWith({
      integration_type: 'quickbooks_desktop',
      alga_entity_type: 'discount',
      alga_entity_id: AUTOMATIC_DISCOUNT_MAPPING_ID,
      external_entity_id: 'Discounts Given',
      external_realm_id: null,
      metadata: { qbdItem: 'Loyalty Discount' }
    });
  });

  it('saves metadata on update, and leaves it alone when none is given', async () => {
    const services = createQuickBooksDesktopMappingModule('service');
    await services.update({ realmId: null }, 'map-1', {
      externalEntityId: 'Backup Income', metadata: { qbdItem: 'Managed Backup', qbdCreateInBatch: 'batch-1' }
    });
    expect(actions.updateExternalEntityMapping).toHaveBeenLastCalledWith('map-1', {
      external_entity_id: 'Backup Income',
      metadata: { qbdItem: 'Managed Backup', qbdCreateInBatch: 'batch-1' }
    });

    await services.update({ realmId: null }, 'map-1', { externalEntityId: 'Backup Income' });
    expect(actions.updateExternalEntityMapping).toHaveBeenLastCalledWith('map-1', { external_entity_id: 'Backup Income' });
  });

  it('loads clients and payment terms as the Alga side of their tabs', async () => {
    const clients = await createQuickBooksDesktopMappingModule('client').load({ realmId: null });
    expect(clients.algaEntities).toEqual([{ id: 'client-1', name: 'Acme Corp' }]);
    const terms = await createQuickBooksDesktopMappingModule('payment_term').load({ realmId: null });
    expect(terms.algaEntities.map((term) => term.id)).toEqual(['net_30', 'net_15', 'net_14', 'net_7', 'due_on_receipt']);
    expect(actions.getExternalEntityMappings).toHaveBeenCalledWith({
      integrationType: 'quickbooks_desktop', algaEntityType: 'payment_term', externalRealmId: null
    });
  });
});
