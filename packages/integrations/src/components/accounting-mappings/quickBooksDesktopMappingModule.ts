import {
  createExternalEntityMapping, updateExternalEntityMapping, deleteExternalEntityMapping,
  getExternalEntityMappings, getServices, getTaxRegions,
} from '../../actions';
import type { ExternalEntityMapping } from '../../actions';
import type { AccountingMappingModule, AccountingMetadataField } from './types';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { AUTOMATIC_DISCOUNT_MAPPING_ID, DISCOUNT_MAPPING_ENTITY_TYPE } from '@alga-psa/types';
import { getIntegrationClients } from '../../actions/clientLookupActions';
import { PAYMENT_TERMS } from '../csv/csvMappingModules';

type Translate = (key: string, options?: Record<string, unknown>) => string;
type DesktopEntity = typeof DISCOUNT_MAPPING_ENTITY_TYPE | 'service' | 'tax_code' | 'client' | 'payment_term';

const ADAPTER_TYPE = 'quickbooks_desktop';

/** Tab order on the QuickBooks Desktop settings screen. */
export const QUICKBOOKS_DESKTOP_MAPPING_ENTITIES: readonly DesktopEntity[] = [
  'client', 'service', DISCOUNT_MAPPING_ENTITY_TYPE, 'tax_code', 'payment_term',
];

function unwrap<T>(result: T): Exclude<T, { success: false }> {
  if (isActionMessageError(result) || isActionPermissionError(result)) throw new Error(getErrorMessage(result));
  return result as Exclude<T, { success: false }>;
}

/**
 * QuickBooks Desktop (IIF) mappings: free-text Desktop names, since there is no
 * live catalog to pick from. A Services or Discounts mapping's value is the
 * income account the line posts to and its "Desktop item name" (metadata.qbdItem)
 * the item it names; a Tax Codes mapping's value is the sales tax account and
 * its metadata.qbdSalesTaxItem the sales tax item. Discounts use the same
 * per-realm discount mapping every other adapter reads.
 */
export function createQuickBooksDesktopMappingModule(entity: DesktopEntity, t?: Translate): AccountingMappingModule {
  const id = `${ADAPTER_TYPE}-${entity}-mapping`;
  const label = (key: string, fallback: string) => t?.(`integrations.accounting.adjustmentMappings.${key}`, { defaultValue: fallback }) ?? fallback;
  const tab = (key: string, fallback: string) => t?.(`integrations.accounting.modules.tabs.${key}`, { defaultValue: fallback }) ?? fallback;
  const title = entity === 'tax_code' ? tab('taxCodes', 'Tax Codes')
    : entity === 'service' ? tab('itemsServices', 'Items / Services')
    : entity === 'client' ? tab('clients', 'Clients')
    : entity === 'payment_term' ? tab('paymentTerms', 'Payment Terms')
    : tab('discounts', 'Discounts');
  const target = entity === 'tax_code' ? label('desktopTaxAccount', 'Desktop sales tax account name')
    : entity === 'client' ? label('desktopCustomer', 'Desktop customer name')
    : entity === 'payment_term' ? label('desktopTerms', 'Desktop terms name')
    : label('desktopAccount', 'Desktop income account name');
  const description = entity === 'tax_code'
    ? label('descriptionTaxCodes', 'Each tax region names the sales tax item or group QuickBooks Desktop charges and the liability account it posts to.')
    : entity === 'service'
    ? label('descriptionServices', 'Each service names the QuickBooks Desktop item its invoice lines use and the income account they post to.')
    : entity === 'client'
    ? label('descriptionClients', 'The QuickBooks Desktop customer each client is invoiced as. Unmapped clients block the export.')
    : entity === 'payment_term'
    ? label('descriptionPaymentTerms', 'The QuickBooks Desktop terms printed on each invoice. Unmapped terms are left blank.')
    : label('description', 'Map invoice discounts and credits before exporting. The mapping belongs to this accounting company.');

  const itemField: AccountingMetadataField = {
    key: 'qbdItem',
    label: label('desktopItem', 'Desktop item name'),
    helpText: label('desktopItemHelp', 'The item exactly as it appears in your QuickBooks Desktop Item List. Every invoice line names an item, so exports are blocked until it is set.'),
    required: true,
  };
  const salesTaxItemField: AccountingMetadataField = {
    key: 'qbdSalesTaxItem',
    label: label('desktopSalesTaxItem', 'Sales tax item or group'),
    helpText: label('desktopSalesTaxItemHelp', 'Leave blank to use the default sales tax item from the QuickBooks Desktop settings.'),
  };
  const fields = entity === 'service' || entity === DISCOUNT_MAPPING_ENTITY_TYPE ? [itemField]
    : entity === 'tax_code' ? [salesTaxItemField]
    : [];

  return {
    id, adapterType: ADAPTER_TYPE, algaEntityType: entity, externalEntityType: entity === 'client' ? 'Customer' : entity === 'payment_term' ? 'Term' : 'Account',
    manualExternalEntry: true,
    labels: {
      tab: title, description,
      addButton: label('add', 'Add mapping'), algaColumn: title, externalColumn: target,
      dialog: { addTitle: title, editTitle: title, algaField: title, externalField: target },
      deleteConfirmation: { title: label('remove', 'Remove mapping'), message: () => label('removeConfirm', 'Remove this accounting mapping?') },
    },
    ...(fields.length > 0 ? { metadata: { fields } } : {}),
    elements: { addButton: `${id}-add`, table: `${id}-table`, dialog: `${id}-dialog` },
    async load(context) {
      const mappings = unwrap(await getExternalEntityMappings({ integrationType: ADAPTER_TYPE, algaEntityType: entity, externalRealmId: context.realmId ?? null }));
      const algaEntities = entity === 'tax_code'
        ? (await getTaxRegions()).map(region => ({ id: region.region_code, name: region.region_name ?? region.region_code }))
        : entity === 'service'
        ? (await getServices(1, 999, { item_kind: 'any' })).services.map(service => ({ id: service.service_id, name: service.service_name }))
        : entity === 'client'
        ? (await getIntegrationClients(true)).map(client => ({ id: client.client_id, name: client.client_name }))
        : entity === 'payment_term'
        ? PAYMENT_TERMS.map(term => ({ id: term.id, name: term.name }))
        : [{ id: AUTOMATIC_DISCOUNT_MAPPING_ID, name: title }];
      return { mappings: mappings as ExternalEntityMapping[], algaEntities, externalEntities: [] };
    },
    async create(context, input) {
      return unwrap(await createExternalEntityMapping({ integration_type: ADAPTER_TYPE, alga_entity_type: entity,
        alga_entity_id: entity === DISCOUNT_MAPPING_ENTITY_TYPE ? AUTOMATIC_DISCOUNT_MAPPING_ID : input.algaEntityId,
        external_entity_id: input.externalEntityId, external_realm_id: context.realmId ?? null,
        metadata: input.metadata ?? null })) as ExternalEntityMapping;
    },
    async update(_context, mappingId, input) {
      return unwrap(await updateExternalEntityMapping(mappingId, {
        external_entity_id: input.externalEntityId,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      })) as ExternalEntityMapping;
    },
    async remove(_context, mappingId) { unwrap(await deleteExternalEntityMapping(mappingId)); },
  };
}

export function createQuickBooksDesktopMappingModules(t?: Translate): AccountingMappingModule[] {
  return QUICKBOOKS_DESKTOP_MAPPING_ENTITIES.map((entity) => createQuickBooksDesktopMappingModule(entity, t));
}
