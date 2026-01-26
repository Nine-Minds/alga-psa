import {
  createExternalEntityMapping,
  deleteExternalEntityMapping,
  getExternalEntityMappings,
  updateExternalEntityMapping,
  type CreateMappingData,
  type ExternalEntityMapping,
  type UpdateMappingData
} from '../../actions/externalMappingActions';
import { getServices } from '../../actions/serviceCatalogActions';
import { getTaxRegions } from '../../actions/taxRegionActions';
import { getAllClients } from '@alga-psa/clients/actions';
import type { IClient, IService, ITaxRegion } from '@alga-psa/types';
import type {
  AccountingMappingContext,
  AccountingMappingModule,
  AccountingMappingLoadResult
} from '../accounting-mappings/types';

const ADAPTER_TYPE = 'xero_csv';

type MappingLoadConfig<TAlga> = {
  context: AccountingMappingContext;
  algaEntityType: string;
  loadAlgaEntities: (context: AccountingMappingContext) => Promise<TAlga[]>;
  mapAlga: (entity: TAlga) => { id: string; name: string };
};

export function createXeroCsvMappingModules(): AccountingMappingModule[] {
  return [
    createClientModule(),
    createServiceModule(),
    createTaxCodeModule()
  ];
}

function createClientModule(): AccountingMappingModule {
  return {
    id: 'xero-csv-client-mappings',
    adapterType: ADAPTER_TYPE,
    algaEntityType: 'client',
    externalEntityType: 'Contact',
    labels: {
      tab: 'Clients',
      description: 'Map Alga clients to Xero contact names. The contact name appears in the "ContactName" column of the CSV export.',
      addButton: 'Add Client Mapping',
      algaColumn: 'Alga Client',
      externalColumn: 'Xero Contact',
      dialog: {
        addTitle: 'Add Xero Contact Mapping',
        editTitle: 'Edit Xero Contact Mapping',
        algaField: 'Alga Client',
        externalField: 'Xero Contact Name',
        helpText: 'Enter the exact contact name as it appears in Xero.'
      },
      deleteConfirmation: {
        title: 'Delete Client Mapping',
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
      addButton: 'add-xero-csv-client-mapping-button',
      table: 'xero-csv-client-mappings-table',
      dialog: 'xero-csv-client-mapping-dialog',
      deleteDialogPrefix: 'confirm-delete-xero-csv-client-mapping-dialog',
      editMenuPrefix: 'edit-xero-csv-client-mapping-menu-item-',
      deleteMenuPrefix: 'delete-xero-csv-client-mapping-menu-item-'
    },
    load(context) {
      return loadMappings<IClient>({
        context,
        algaEntityType: 'client',
        loadAlgaEntities: async () => getAllClients(true),
        mapAlga: (client) => ({
          id: client.client_id,
          name: client.client_name
        })
      });
    },
    create(context, input) {
      return createMapping({
        context,
        input,
        algaEntityType: 'client'
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

function createServiceModule(): AccountingMappingModule {
  return {
    id: 'xero-csv-service-mappings',
    adapterType: ADAPTER_TYPE,
    algaEntityType: 'service',
    externalEntityType: 'Item',
    overridesKey: 'itemMappingOverrides',
    labels: {
      tab: 'Items / Services',
      description: 'Map Alga services to Xero inventory item codes. The item code appears in the "InventoryItemCode" column of the CSV export.',
      addButton: 'Add Item Mapping',
      algaColumn: 'Alga Service',
      externalColumn: 'Xero Item',
      dialog: {
        addTitle: 'Add Xero Item Mapping',
        editTitle: 'Edit Xero Item Mapping',
        algaField: 'Alga Service',
        externalField: 'Xero Item Code',
        helpText: 'Enter the item code from Xero (found in Products and Services).'
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
      addButton: 'add-xero-csv-item-mapping-button',
      table: 'xero-csv-item-mappings-table',
      dialog: 'xero-csv-item-mapping-dialog',
      deleteDialogPrefix: 'confirm-delete-xero-csv-item-mapping-dialog',
      editMenuPrefix: 'edit-xero-csv-item-mapping-menu-item-',
      deleteMenuPrefix: 'delete-xero-csv-item-mapping-menu-item-'
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
    update(context, mappingId, input) {
      return updateMapping(mappingId, input);
    },
    async remove(_context, mappingId) {
      await deleteExternalEntityMapping(mappingId);
    }
  };
}

function createTaxCodeModule(): AccountingMappingModule {
  return {
    id: 'xero-csv-tax-code-mappings',
    adapterType: ADAPTER_TYPE,
    algaEntityType: 'tax_code',
    externalEntityType: 'TaxType',
    labels: {
      tab: 'Tax Codes',
      description: 'Map Alga tax regions to Xero tax types. The tax type appears in the "TaxType" column of the CSV export. Find tax types in Xero under Settings → Tax Rates.',
      addButton: 'Add Tax Code Mapping',
      algaColumn: 'Alga Tax Region',
      externalColumn: 'Xero Tax Type',
      dialog: {
        addTitle: 'Add Xero Tax Type Mapping',
        editTitle: 'Edit Xero Tax Type Mapping',
        algaField: 'Alga Tax Region',
        externalField: 'Xero Tax Type',
        helpText: 'Enter the tax type code from Xero (e.g., OUTPUT2, ZERORATEDINPUT, TAX001). Find these under Settings → Tax Rates in Xero.'
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
      addButton: 'add-xero-csv-taxcode-mapping-button',
      table: 'xero-csv-taxcode-mappings-table',
      dialog: 'xero-csv-taxcode-mapping-dialog',
      deleteDialogPrefix: 'confirm-delete-xero-csv-taxcode-mapping-dialog',
      editMenuPrefix: 'edit-xero-csv-taxcode-mapping-menu-item-',
      deleteMenuPrefix: 'delete-xero-csv-taxcode-mapping-menu-item-'
    },
    load(context) {
      return loadMappings<ITaxRegion>({
        context,
        algaEntityType: 'tax_code',
        loadAlgaEntities: getTaxRegions,
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
  mapAlga
}: MappingLoadConfig<TAlga>): Promise<AccountingMappingLoadResult> {
  const externalRealmId = context.realmId === undefined ? undefined : context.realmId;

  const [mappings, algaEntities] = await Promise.all([
    getExternalEntityMappings({
      integrationType: ADAPTER_TYPE,
      algaEntityType,
      externalRealmId
    }),
    loadAlgaEntities(context)
  ]);

  return {
    mappings,
    algaEntities: algaEntities.map(mapAlga),
    externalEntities: []
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

  // Include alga_entity_id if provided (allows changing the Alga entity)
  if (input.algaEntityId) {
    payload.alga_entity_id = input.algaEntityId;
  }

  return updateExternalEntityMapping(mappingId, payload);
}

type IServicesResult = Pick<IService, 'service_id' | 'service_name'> & {
  item_kind?: IService['item_kind'];
  sku?: string | null;
};
