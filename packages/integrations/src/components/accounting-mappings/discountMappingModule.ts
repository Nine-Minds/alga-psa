import {
  createExternalEntityMapping, updateExternalEntityMapping, deleteExternalEntityMapping,
  getExternalEntityMappings, getServices, getTaxRegions,
} from '../../actions';
import type { ExternalEntityMapping } from '../../actions';
import type { AccountingMappingModule } from './types';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

type Translate = (key: string, options?: Record<string, unknown>) => string;
function unwrap<T>(result: T): Exclude<T, { success: false }> {
  if (isActionMessageError(result) || isActionPermissionError(result)) throw new Error(getErrorMessage(result));
  return result as Exclude<T, { success: false }>;
}

/** A single explicit mapping per tenant/provider/realm; never an export fallback. */
export function createDiscountMappingModule(adapterType: string, t?: Translate, desktopEntity?: 'service' | 'tax_code'): AccountingMappingModule {
  const desktopServices = desktopEntity === 'service';
  const entityType = desktopEntity ?? 'discount';
  const id = `${adapterType}-${entityType}-mapping`;
  const label = (key: string, fallback: string) => t?.(`integrations.accounting.adjustmentMappings.${key}`, { defaultValue: fallback }) ?? fallback;
  const title = desktopEntity === 'tax_code' ? (t?.('integrations.accounting.modules.tabs.taxCodes', { defaultValue: 'Tax Codes' }) ?? 'Tax Codes') : desktopServices ? label('desktopServices', 'Desktop service accounts')
    : adapterType === 'quickbooks_desktop' ? label('desktopDiscounts', 'Desktop discounts') : label('discounts', 'Discounts and credits');
  const target = adapterType === 'quickbooks_online' ? label('qboAccount', 'QuickBooks discount account ID')
    : adapterType.startsWith('xero') ? label('xeroAccount', 'Xero account code')
    : adapterType === 'quickbooks_desktop' ? label('desktopAccount', 'Desktop income account name')
    : label('csvItem', 'QuickBooks discount item name');
  return {
    id, adapterType, algaEntityType: entityType, externalEntityType: 'Account',
    labels: {
      tab: title, description: label('description', 'Map invoice discounts and credits before exporting. The mapping belongs to this accounting company.'),
      addButton: label('add', 'Add mapping'), algaColumn: title, externalColumn: target,
      dialog: { addTitle: title, editTitle: title, algaField: title, externalField: target },
      deleteConfirmation: { title: label('remove', 'Remove mapping'), message: () => label('removeConfirm', 'Remove this accounting mapping?') },
    },
    elements: { addButton: `${id}-add`, table: `${id}-table`, dialog: `${id}-dialog` },
    async load(context) {
      const mappings = unwrap(await getExternalEntityMappings({ integrationType: adapterType, algaEntityType: entityType, externalRealmId: context.realmId ?? null }));
      const algaEntities = desktopEntity === 'tax_code'
        ? (await getTaxRegions()).map(region => ({ id: region.region_code, name: region.region_name ?? region.region_code }))
        : desktopServices
        ? (await getServices(1, 999, { item_kind: 'any' })).services.map(service => ({ id: service.service_id, name: service.service_name }))
        : [{ id: 'invoice_discount', name: title }];
      return { mappings: mappings as ExternalEntityMapping[], algaEntities, externalEntities: [] };
    },
    async create(context, input) {
      return unwrap(await createExternalEntityMapping({ integration_type: adapterType, alga_entity_type: entityType,
        alga_entity_id: desktopEntity ? input.algaEntityId : 'invoice_discount', external_entity_id: input.externalEntityId,
        external_realm_id: context.realmId ?? null })) as ExternalEntityMapping;
    },
    async update(_context, mappingId, input) {
      return unwrap(await updateExternalEntityMapping(mappingId, { external_entity_id: input.externalEntityId })) as ExternalEntityMapping;
    },
    async remove(_context, mappingId) { unwrap(await deleteExternalEntityMapping(mappingId)); },
  };
}
