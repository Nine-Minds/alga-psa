import {
  createExternalEntityMapping,
  deleteExternalEntityMapping,
  getExternalEntityMappings,
  getServices,
  getTaxRegions,
  getXeroAccounts,
  getXeroItems,
  getXeroTaxRates,
  getXeroTrackingCategories,
  updateExternalEntityMapping,
  type CreateMappingData,
  type ExternalEntityMapping,
  type UpdateMappingData
} from '@alga-psa/integrations/actions';
import type { IService, ITaxRegion } from '@alga-psa/types';
import type {
  AccountingMappingContext,
  AccountingMappingLoadResult,
  AccountingMappingModule
} from '@alga-psa/integrations/components';

const ADAPTER_TYPE = 'xero';

type MappingLoadConfig<TAlga> = {
  context: AccountingMappingContext;
  algaEntityType: string;
  loadAlgaEntities: (context: AccountingMappingContext) => Promise<TAlga[]>;
  loadExternalEntities: (context: AccountingMappingContext) => Promise<Array<{ id: string; name: string }>>;
  mapAlga: (entity: TAlga) => { id: string; name: string };
};

type TFn = (key: string, options?: Record<string, unknown>) => string;

export function createXeroLiveMappingModules(t?: TFn): AccountingMappingModule[] {
  const tab = (key: string, fallback: string) =>
    t ? t(`integrations.accounting.modules.tabs.${key}`, { defaultValue: fallback }) : fallback;
  return [
    createServiceModule(tab('itemsServices', 'Items / Services')),
    createTaxCodeModule(tab('taxCodes', 'Tax Codes'))
  ];
}

function createServiceModule(tabLabel: string): AccountingMappingModule {
  return {
    id: 'xero-live-service-mappings',
    adapterType: ADAPTER_TYPE,
    algaEntityType: 'service',
    externalEntityType: 'Item',
    labels: {
      tab: tabLabel,
      description:
        'Map Alga services to Xero item codes. Revenue accounts and tracking categories are loaded from the default connected Xero organisation and can be referenced in the metadata JSON as `accountCode` and `tracking`.',
      addButton: 'Add Item Mapping',
      algaColumn: 'Alga Service',
      externalColumn: 'Xero Item',
      dialog: {
        addTitle: 'Add Live Xero Item Mapping',
        editTitle: 'Edit Live Xero Item Mapping',
        algaField: 'Alga Service',
        externalField: 'Xero Item Code',
        helpText:
          'Choose the Xero item code for this service. Optional metadata JSON may include {"accountCode":"200","tracking":[{"name":"Region","option":"North"}]}.'
      },
      deleteConfirmation: {
        title: 'Delete Item Mapping',
        message: ({ algaName, externalName }) =>
          `Delete mapping${algaName ? ` for ${algaName}` : ''}${
            externalName ? ` ↔ ${externalName}` : ''
          }? This action cannot be undone.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel'
      }
    },
    metadata: {
      enableJsonEditor: true
    },
    elements: {
      addButton: 'add-xero-live-item-mapping-button',
      table: 'xero-live-item-mappings-table',
      dialog: 'xero-live-item-mapping-dialog',
      deleteDialogPrefix: 'confirm-delete-xero-live-item-mapping-dialog',
      editMenuPrefix: 'edit-xero-live-item-mapping-menu-item-',
      deleteMenuPrefix: 'delete-xero-live-item-mapping-menu-item-'
    },
    load(context) {
      return loadMappings<IServicesResult>({
        context,
        algaEntityType: 'service',
        loadAlgaEntities: async () => {
          const response = await getServices(1, 999, { item_kind: 'any' });
          return response.services.map(
            (service): IServicesResult => ({
              service_id: service.service_id,
              service_name: service.service_name,
              item_kind: service.item_kind,
              sku: service.sku ?? null
            })
          );
        },
        loadExternalEntities: async (currentContext) => {
          const connectionId = currentContext.connectionId ?? null;
          const [items, accounts, trackingCategories] = await Promise.all([
            getXeroItems(connectionId),
            getXeroAccounts(connectionId),
            getXeroTrackingCategories(connectionId)
          ]);

          void accounts;
          void trackingCategories;

          return items.map((item) => ({
            id: item.code ?? item.id,
            name: item.code ? `${item.name} (${item.code})` : item.name
          }));
        },
        mapAlga: (service) => ({
          id: service.service_id,
          name:
            `${service.item_kind === 'product' ? '[Product] ' : ''}${service.service_name}` +
            (service.sku ? ` (${service.sku})` : '')
        })
      });
    },
    create(context, input) {
      return createMapping({
        context,
        input,
        algaEntityType: 'service'
      });
    },
    update(_context, mappingId, input) {
      return updateMapping(mappingId, input);
    },
    async remove(_context, mappingId) {
      await deleteExternalEntityMapping(mappingId);
    }
  };
}

function createTaxCodeModule(tabLabel: string): AccountingMappingModule {
  return {
    id: 'xero-live-tax-code-mappings',
    adapterType: ADAPTER_TYPE,
    algaEntityType: 'tax_code',
    externalEntityType: 'TaxRate',
    labels: {
      tab: tabLabel,
      description:
        'Map Alga tax regions to Xero tax types from the default connected Xero organisation.',
      addButton: 'Add Tax Code Mapping',
      algaColumn: 'Alga Tax Region',
      externalColumn: 'Xero Tax Type',
      dialog: {
        addTitle: 'Add Live Xero Tax Mapping',
        editTitle: 'Edit Live Xero Tax Mapping',
        algaField: 'Alga Tax Region',
        externalField: 'Xero Tax Type',
        helpText:
          'Select the Xero tax type that should be exported for this Alga tax region.'
      },
      deleteConfirmation: {
        title: 'Delete Tax Code Mapping',
        message: ({ algaName, externalName }) =>
          `Delete mapping${algaName ? ` for ${algaName}` : ''}${
            externalName ? ` ↔ ${externalName}` : ''
          }?`,
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel'
      }
    },
    metadata: {
      enableJsonEditor: true
    },
    elements: {
      addButton: 'add-xero-live-taxcode-mapping-button',
      table: 'xero-live-taxcode-mappings-table',
      dialog: 'xero-live-taxcode-mapping-dialog',
      deleteDialogPrefix: 'confirm-delete-xero-live-taxcode-mapping-dialog',
      editMenuPrefix: 'edit-xero-live-taxcode-mapping-menu-item-',
      deleteMenuPrefix: 'delete-xero-live-taxcode-mapping-menu-item-'
    },
    load(context) {
      return loadMappings<ITaxRegion>({
        context,
        algaEntityType: 'tax_code',
        loadAlgaEntities: getTaxRegions,
        loadExternalEntities: async (currentContext) => {
          const taxRates = await getXeroTaxRates(currentContext.connectionId ?? null);
          return taxRates.map((taxRate) => ({
            id: taxRate.taxType ?? taxRate.id,
            name: taxRate.taxType ? `${taxRate.name} (${taxRate.taxType})` : taxRate.name
          }));
        },
        mapAlga: (region) => ({
          id: region.region_code,
          name: region.region_name ?? region.region_code
        })
      });
    },
    create(context, input) {
      return createMapping({
        context,
        input,
        algaEntityType: 'tax_code'
      });
    },
    update(_context, mappingId, input) {
      return updateMapping(mappingId, input);
    },
    async remove(_context, mappingId) {
      await deleteExternalEntityMapping(mappingId);
    }
  };
}

async function loadMappings<TAlga>({
  context,
  algaEntityType,
  loadAlgaEntities,
  loadExternalEntities,
  mapAlga
}: MappingLoadConfig<TAlga>): Promise<AccountingMappingLoadResult> {
  const externalRealmId = context.realmId === undefined ? undefined : context.realmId;

  const [mappings, algaEntities, externalEntities] = await Promise.all([
    getExternalEntityMappings({
      integrationType: ADAPTER_TYPE,
      algaEntityType,
      externalRealmId
    }),
    loadAlgaEntities(context),
    loadExternalEntities(context)
  ]);

  return {
    mappings,
    algaEntities: algaEntities.map(mapAlga),
    externalEntities
  };
}

function createMapping({
  context,
  input,
  algaEntityType
}: {
  context: AccountingMappingContext;
  input: {
    algaEntityId: string;
    externalEntityId: string;
    metadata?: Record<string, unknown> | null;
  };
  algaEntityType: string;
}): Promise<ExternalEntityMapping> {
  const payload: CreateMappingData = {
    integration_type: ADAPTER_TYPE,
    alga_entity_type: algaEntityType,
    alga_entity_id: input.algaEntityId,
    external_entity_id: input.externalEntityId,
    external_realm_id: context.realmId ?? null,
    metadata: input.metadata ?? null,
    sync_status: 'manual_link'
  };

  return createExternalEntityMapping(payload);
}

function updateMapping(
  mappingId: string,
  input: {
    algaEntityId?: string;
    externalEntityId: string;
    metadata?: Record<string, unknown> | null;
  }
): Promise<ExternalEntityMapping> {
  const payload: UpdateMappingData = {
    external_entity_id: input.externalEntityId,
    metadata: input.metadata ?? null
  };

  if (input.algaEntityId) {
    payload.alga_entity_id = input.algaEntityId;
  }

  return updateExternalEntityMapping(mappingId, payload);
}

type IServicesResult = Pick<IService, 'service_id' | 'service_name'> & {
  item_kind?: IService['item_kind'];
  sku?: string | null;
};
