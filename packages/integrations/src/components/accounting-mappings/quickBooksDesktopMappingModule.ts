import {
  createExternalEntityMapping, updateExternalEntityMapping, deleteExternalEntityMapping,
  getExternalEntityMappings, getServices, getTaxRegions,
} from '../../actions';
import type { ExternalEntityMapping } from '../../actions';
import type { AccountingMappingModule } from './types';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { AUTOMATIC_DISCOUNT_MAPPING_ID, DISCOUNT_MAPPING_ENTITY_TYPE } from '@alga-psa/types';

type Translate = (key: string, options?: Record<string, unknown>) => string;
type DesktopEntity = typeof DISCOUNT_MAPPING_ENTITY_TYPE | 'service' | 'tax_code';

const ADAPTER_TYPE = 'quickbooks_desktop';

function unwrap<T>(result: T): Exclude<T, { success: false }> {
  if (isActionMessageError(result) || isActionPermissionError(result)) throw new Error(getErrorMessage(result));
  return result as Exclude<T, { success: false }>;
}

/**
 * QuickBooks Desktop (IIF) mappings: free-text Desktop account names, since
 * there is no live catalog to pick from. Discounts use the same per-realm
 * discount mapping every other adapter reads.
 */
export function createQuickBooksDesktopMappingModule(entity: DesktopEntity, t?: Translate): AccountingMappingModule {
  const id = `${ADAPTER_TYPE}-${entity}-mapping`;
  const label = (key: string, fallback: string) => t?.(`integrations.accounting.adjustmentMappings.${key}`, { defaultValue: fallback }) ?? fallback;
  const title = entity === 'tax_code' ? (t?.('integrations.accounting.modules.tabs.taxCodes', { defaultValue: 'Tax Codes' }) ?? 'Tax Codes')
    : entity === 'service' ? label('desktopServices', 'Desktop service accounts')
    : label('desktopDiscounts', 'Desktop discounts');
  const target = label('desktopAccount', 'Desktop income account name');
  return {
    id, adapterType: ADAPTER_TYPE, algaEntityType: entity, externalEntityType: 'Account', manualExternalEntry: true,
    labels: {
      tab: title, description: label('description', 'Map invoice discounts and credits before exporting. The mapping belongs to this accounting company.'),
      addButton: label('add', 'Add mapping'), algaColumn: title, externalColumn: target,
      dialog: { addTitle: title, editTitle: title, algaField: title, externalField: target },
      deleteConfirmation: { title: label('remove', 'Remove mapping'), message: () => label('removeConfirm', 'Remove this accounting mapping?') },
    },
    elements: { addButton: `${id}-add`, table: `${id}-table`, dialog: `${id}-dialog` },
    async load(context) {
      const mappings = unwrap(await getExternalEntityMappings({ integrationType: ADAPTER_TYPE, algaEntityType: entity, externalRealmId: context.realmId ?? null }));
      const algaEntities = entity === 'tax_code'
        ? (await getTaxRegions()).map(region => ({ id: region.region_code, name: region.region_name ?? region.region_code }))
        : entity === 'service'
        ? (await getServices(1, 999, { item_kind: 'any' })).services.map(service => ({ id: service.service_id, name: service.service_name }))
        : [{ id: AUTOMATIC_DISCOUNT_MAPPING_ID, name: title }];
      return { mappings: mappings as ExternalEntityMapping[], algaEntities, externalEntities: [] };
    },
    async create(context, input) {
      return unwrap(await createExternalEntityMapping({ integration_type: ADAPTER_TYPE, alga_entity_type: entity,
        alga_entity_id: entity === DISCOUNT_MAPPING_ENTITY_TYPE ? AUTOMATIC_DISCOUNT_MAPPING_ID : input.algaEntityId,
        external_entity_id: input.externalEntityId, external_realm_id: context.realmId ?? null })) as ExternalEntityMapping;
    },
    async update(_context, mappingId, input) {
      return unwrap(await updateExternalEntityMapping(mappingId, { external_entity_id: input.externalEntityId })) as ExternalEntityMapping;
    },
    async remove(_context, mappingId) { unwrap(await deleteExternalEntityMapping(mappingId)); },
  };
}
