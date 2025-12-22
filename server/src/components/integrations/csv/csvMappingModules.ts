import {
  createExternalEntityMapping,
  deleteExternalEntityMapping,
  getExternalEntityMappings,
  updateExternalEntityMapping,
  type CreateMappingData,
  type ExternalEntityMapping,
  type UpdateMappingData
} from 'server/src/lib/actions/externalMappingActions';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { getTaxRegions } from 'server/src/lib/actions/taxSettingsActions';
import { getAllClients } from 'server/src/lib/actions/client-actions/clientActions';
import type { IService } from 'server/src/interfaces/billing.interfaces';
import type { ITaxRegion } from 'server/src/interfaces/tax.interfaces';
import type { IClient } from 'server/src/interfaces/client.interfaces';
import type {
  AccountingMappingContext,
  AccountingMappingModule,
  AccountingMappingLoadResult
} from 'server/src/components/accounting-mappings/types';

const ADAPTER_TYPE = 'quickbooks_csv';

type MappingLoadConfig<TAlga> = {
  context: AccountingMappingContext;
  algaEntityType: string;
  loadAlgaEntities: (context: AccountingMappingContext) => Promise<TAlga[]>;
  mapAlga: (entity: TAlga) => { id: string; name: string };
};

type PaymentTermOption = {
  id: string;
  name: string;
};

const PAYMENT_TERMS: PaymentTermOption[] = [
  { id: 'net_30', name: 'Net 30' },
  { id: 'net_15', name: 'Net 15' },
  { id: 'due_on_receipt', name: 'Due on receipt' }
];

export function createCsvMappingModules(): AccountingMappingModule[] {
  return [
    createCustomerModule(),
    createServiceModule(),
    createTaxCodeModule(),
    createPaymentTermModule()
  ];
}

function createCustomerModule(): AccountingMappingModule {
  return {
    id: 'qbcsv-customer-mappings',
    adapterType: ADAPTER_TYPE,
    algaEntityType: 'client',
    externalEntityType: 'Customer',
    labels: {
      tab: 'Clients',
      addButton: 'Add Client Mapping',
      algaColumn: 'Alga Client',
      externalColumn: 'QuickBooks Customer',
      dialog: {
        addTitle: 'Add QuickBooks Customer Mapping',
        editTitle: 'Edit QuickBooks Customer Mapping',
        algaField: 'Alga Client',
        externalField: 'QuickBooks Customer'
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
      addButton: 'add-qbcsv-customer-mapping-button',
      table: 'qbcsv-customer-mappings-table',
      dialog: 'qbcsv-customer-mapping-dialog',
      deleteDialogPrefix: 'confirm-delete-qbcsv-customer-mapping-dialog',
      editMenuPrefix: 'edit-qbcsv-customer-mapping-menu-item-',
      deleteMenuPrefix: 'delete-qbcsv-customer-mapping-menu-item-'
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
    id: 'qbcsv-service-mappings',
    adapterType: ADAPTER_TYPE,
    algaEntityType: 'service',
    externalEntityType: 'Item',
    overridesKey: 'itemMappingOverrides',
    labels: {
      tab: 'Items / Services',
      addButton: 'Add Item Mapping',
      algaColumn: 'Alga Service',
      externalColumn: 'QuickBooks Item',
      dialog: {
        addTitle: 'Add QuickBooks Item Mapping',
        editTitle: 'Edit QuickBooks Item Mapping',
        algaField: 'Alga Service',
        externalField: 'QuickBooks Item'
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
      addButton: 'add-qbcsv-item-mapping-button',
      table: 'qbcsv-item-mappings-table',
      dialog: 'qbcsv-item-mapping-dialog',
      deleteDialogPrefix: 'confirm-delete-qbcsv-item-mapping-dialog',
      editMenuPrefix: 'edit-qbcsv-item-mapping-menu-item-',
      deleteMenuPrefix: 'delete-qbcsv-item-mapping-menu-item-'
    },
    load(context) {
      return loadMappings<IServicesResult>({
        context,
        algaEntityType: 'service',
        loadAlgaEntities: async () => {
          const response = await getServices();
          return response.services.map(
            (service): IServicesResult => ({
              service_id: service.service_id,
              service_name: service.service_name
            })
          );
        },
        mapAlga: (service) => ({
          id: service.service_id,
          name: service.service_name
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
    id: 'qbcsv-tax-code-mappings',
    adapterType: ADAPTER_TYPE,
    algaEntityType: 'tax_code',
    externalEntityType: 'TaxCode',
    labels: {
      tab: 'Tax Codes',
      addButton: 'Add Tax Code Mapping',
      algaColumn: 'Alga Tax Region',
      externalColumn: 'QuickBooks Tax Code',
      dialog: {
        addTitle: 'Add QuickBooks Tax Code Mapping',
        editTitle: 'Edit QuickBooks Tax Code Mapping',
        algaField: 'Alga Tax Region',
        externalField: 'QuickBooks Tax Code'
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
      addButton: 'add-qbcsv-taxcode-mapping-button',
      table: 'qbcsv-taxcode-mappings-table',
      dialog: 'qbcsv-taxcode-mapping-dialog',
      deleteDialogPrefix: 'confirm-delete-qbcsv-taxcode-mapping-dialog',
      editMenuPrefix: 'edit-qbcsv-taxcode-mapping-menu-item-',
      deleteMenuPrefix: 'delete-qbcsv-taxcode-mapping-menu-item-'
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

function createPaymentTermModule(): AccountingMappingModule {
  return {
    id: 'qbcsv-term-mappings',
    adapterType: ADAPTER_TYPE,
    algaEntityType: 'payment_term',
    externalEntityType: 'Term',
    labels: {
      tab: 'Payment Terms',
      addButton: 'Add Term Mapping',
      algaColumn: 'Alga Payment Term',
      externalColumn: 'QuickBooks Term',
      dialog: {
        addTitle: 'Add QuickBooks Term Mapping',
        editTitle: 'Edit QuickBooks Term Mapping',
        algaField: 'Alga Payment Term',
        externalField: 'QuickBooks Term'
      },
      deleteConfirmation: {
        title: 'Delete Term Mapping',
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
      addButton: 'add-qbcsv-term-mapping-button',
      table: 'qbcsv-term-mappings-table',
      dialog: 'qbcsv-term-mapping-dialog',
      deleteDialogPrefix: 'confirm-delete-qbcsv-term-mapping-dialog',
      editMenuPrefix: 'edit-qbcsv-term-mapping-menu-item-',
      deleteMenuPrefix: 'delete-qbcsv-term-mapping-menu-item-'
    },
    load(context) {
      return loadMappings<PaymentTermOption>({
        context,
        algaEntityType: 'payment_term',
        loadAlgaEntities: async () => PAYMENT_TERMS,
        mapAlga: (term) => ({
          id: term.id,
          name: term.name
        })
      });
    },
    create(context, input) {
      return createMapping({
        context,
        input,
        algaEntityType: 'payment_term'
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

type IServicesResult = Pick<IService, 'service_id' | 'service_name'>;
