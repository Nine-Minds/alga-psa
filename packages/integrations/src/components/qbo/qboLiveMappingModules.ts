import {
  createExternalEntityMapping,
  deleteExternalEntityMapping,
  getExternalEntityMappings,
  getQboItems,
  getQboTaxCodes,
  getQboTerms,
  getServices,
  getTaxRegions,
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
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

const ADAPTER_TYPE = 'quickbooks_online';

type MappingLoadConfig<TAlga> = {
  context: AccountingMappingContext;
  algaEntityType: string;
  loadAlgaEntities: (context: AccountingMappingContext) => Promise<TAlga[]>;
  loadExternalEntities: (context: AccountingMappingContext) => Promise<Array<{ id: string; name: string }>>;
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

type TFn = (key: string, options?: Record<string, unknown>) => string;

function throwIfActionError(value: unknown): void {
  if (isActionMessageError(value) || isActionPermissionError(value)) {
    throw new Error(getErrorMessage(value));
  }
}

export function createQboLiveMappingModules(t?: TFn): AccountingMappingModule[] {
  const tab = (key: string, fallback: string) =>
    t ? t(`integrations.accounting.modules.tabs.${key}`, { defaultValue: fallback }) : fallback;
  return [
    createServiceModule(tab('itemsServices', 'Items / Services')),
    createTaxCodeModule(tab('taxCodes', 'Tax Codes')),
    createPaymentTermModule(tab('paymentTerms', 'Payment Terms'))
  ];
}

function createServiceModule(tabLabel: string): AccountingMappingModule {
  return {
    id: 'qbo-live-service-mappings',
    adapterType: ADAPTER_TYPE,
    algaEntityType: 'service',
    externalEntityType: 'Item',
    labels: {
      tab: tabLabel,
      description:
        'Map Alga services to QuickBooks items. Items are loaded live from the connected QuickBooks company.',
      addButton: 'Add Item Mapping',
      algaColumn: 'Alga Service',
      externalColumn: 'QuickBooks Item',
      dialog: {
        addTitle: 'Add Live QuickBooks Item Mapping',
        editTitle: 'Edit Live QuickBooks Item Mapping',
        algaField: 'Alga Service',
        externalField: 'QuickBooks Item',
        helpText: 'Choose the QuickBooks item that should be used when exporting this service.'
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
      addButton: 'add-qbo-live-item-mapping-button',
      table: 'qbo-live-item-mappings-table',
      dialog: 'qbo-live-item-mapping-dialog',
      deleteDialogPrefix: 'confirm-delete-qbo-live-item-mapping-dialog',
      editMenuPrefix: 'edit-qbo-live-item-mapping-menu-item-',
      deleteMenuPrefix: 'delete-qbo-live-item-mapping-menu-item-'
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
          const itemsResult = await getQboItems({ realmId: currentContext.realmId ?? null });
          throwIfActionError(itemsResult);
          const items = itemsResult as Array<{ id: string; name: string }>;
          return items.map((item) => ({
            id: item.id,
            name: item.name
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
      throwIfActionError(await deleteExternalEntityMapping(mappingId));
    }
  };
}

function createTaxCodeModule(tabLabel: string): AccountingMappingModule {
  return {
    id: 'qbo-live-tax-code-mappings',
    adapterType: ADAPTER_TYPE,
    algaEntityType: 'tax_code',
    externalEntityType: 'TaxCode',
    labels: {
      tab: tabLabel,
      description:
        'Map Alga tax regions to QuickBooks tax codes from the connected QuickBooks company.',
      addButton: 'Add Tax Code Mapping',
      algaColumn: 'Alga Tax Region',
      externalColumn: 'QuickBooks Tax Code',
      dialog: {
        addTitle: 'Add Live QuickBooks Tax Mapping',
        editTitle: 'Edit Live QuickBooks Tax Mapping',
        algaField: 'Alga Tax Region',
        externalField: 'QuickBooks Tax Code',
        helpText: 'Select the QuickBooks tax code that should be exported for this Alga tax region.'
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
      addButton: 'add-qbo-live-taxcode-mapping-button',
      table: 'qbo-live-taxcode-mappings-table',
      dialog: 'qbo-live-taxcode-mapping-dialog',
      deleteDialogPrefix: 'confirm-delete-qbo-live-taxcode-mapping-dialog',
      editMenuPrefix: 'edit-qbo-live-taxcode-mapping-menu-item-',
      deleteMenuPrefix: 'delete-qbo-live-taxcode-mapping-menu-item-'
    },
    load(context) {
      return loadMappings<ITaxRegion>({
        context,
        algaEntityType: 'tax_code',
        loadAlgaEntities: getTaxRegions,
        loadExternalEntities: async (currentContext) => {
          const taxCodesResult = await getQboTaxCodes({ realmId: currentContext.realmId ?? null });
          throwIfActionError(taxCodesResult);
          const taxCodes = taxCodesResult as Array<{ id: string; name: string }>;
          return taxCodes.map((taxCode) => ({
            id: taxCode.id,
            name: taxCode.name
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
      throwIfActionError(await deleteExternalEntityMapping(mappingId));
    }
  };
}

function createPaymentTermModule(tabLabel: string): AccountingMappingModule {
  return {
    id: 'qbo-live-payment-term-mappings',
    adapterType: ADAPTER_TYPE,
    algaEntityType: 'payment_term',
    externalEntityType: 'Term',
    labels: {
      tab: tabLabel,
      description:
        'Map Alga payment terms to QuickBooks terms from the connected QuickBooks company.',
      addButton: 'Add Payment Term Mapping',
      algaColumn: 'Alga Payment Term',
      externalColumn: 'QuickBooks Term',
      dialog: {
        addTitle: 'Add Live QuickBooks Term Mapping',
        editTitle: 'Edit Live QuickBooks Term Mapping',
        algaField: 'Alga Payment Term',
        externalField: 'QuickBooks Term',
        helpText: 'Select the QuickBooks term that matches this Alga payment term.'
      },
      deleteConfirmation: {
        title: 'Delete Payment Term Mapping',
        message: ({ algaName, externalName }) =>
          `Delete mapping${algaName ? ` for ${algaName}` : ''}${
            externalName ? ` ↔ ${externalName}` : ''
          }?`,
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel'
      }
    },
    elements: {
      addButton: 'add-qbo-live-term-mapping-button',
      table: 'qbo-live-term-mappings-table',
      dialog: 'qbo-live-term-mapping-dialog',
      deleteDialogPrefix: 'confirm-delete-qbo-live-term-mapping-dialog',
      editMenuPrefix: 'edit-qbo-live-term-mapping-menu-item-',
      deleteMenuPrefix: 'delete-qbo-live-term-mapping-menu-item-'
    },
    load(context) {
      return loadMappings<PaymentTermOption>({
        context,
        algaEntityType: 'payment_term',
        loadAlgaEntities: async () => PAYMENT_TERMS,
        loadExternalEntities: async (currentContext) => {
          const termsResult = await getQboTerms({ realmId: currentContext.realmId ?? null });
          throwIfActionError(termsResult);
          const terms = termsResult as Array<{ id: string; name: string }>;
          return terms.map((term) => ({
            id: term.id,
            name: term.name
          }));
        },
        mapAlga: (term) => term
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
      throwIfActionError(await deleteExternalEntityMapping(mappingId));
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
  throwIfActionError(mappings);

  return {
    mappings: mappings as ExternalEntityMapping[],
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

  return createExternalEntityMapping(payload).then((result) => {
    throwIfActionError(result);
    return result as ExternalEntityMapping;
  });
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

  return updateExternalEntityMapping(mappingId, payload).then((result) => {
    throwIfActionError(result);
    return result as ExternalEntityMapping;
  });
}

type IServicesResult = Pick<IService, 'service_id' | 'service_name'> & {
  item_kind?: IService['item_kind'];
  sku?: string | null;
};
