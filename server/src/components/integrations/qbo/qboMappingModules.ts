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
import {
  getQboItems,
  getQboTaxCodes,
  getQboTerms,
  type QboItem,
  type QboTaxCode,
  type QboTerm
} from 'server/src/lib/actions/integrations/qboActions';
import { getTaxRegions } from 'server/src/lib/actions/taxSettingsActions';
import { getPaymentTermsList } from 'server/src/lib/actions/billingAndTax';
import type { IService } from 'server/src/interfaces/billing.interfaces';
import type { ITaxRegion } from 'server/src/interfaces/tax.interfaces';
import type { IPaymentTermOption } from 'server/src/lib/actions/billingAndTax';
import type {
  AccountingMappingContext,
  AccountingMappingModule,
  AccountingMappingOverrides,
  AccountingMappingLoadResult
} from 'server/src/components/accounting-mappings/types';

const ADAPTER_TYPE = 'quickbooks_online';

type MappingLoadConfig<TAlga, TExternal> = {
  context: AccountingMappingContext;
  algaEntityType: string;
  loadAlgaEntities: () => Promise<TAlga[]>;
  mapAlga: (entity: TAlga) => { id: string; name: string };
  loadExternalEntities: () => Promise<TExternal[]>;
  mapExternal: (entity: TExternal) => { id: string; name: string };
};

export function createQboMappingModules(): AccountingMappingModule[] {
  return [
    createServiceModule(),
    createTaxCodeModule(),
    createPaymentTermModule()
  ];
}

function createServiceModule(): AccountingMappingModule {
  return {
    id: 'qbo-service-mappings',
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
    resolveOverrides: resolveAccountingOverrides(ADAPTER_TYPE, 'qbo-service-mappings', 'itemMappingOverrides'),
    elements: {
      addButton: 'add-qbo-item-mapping-button',
      table: 'qbo-item-mappings-table',
      dialog: 'qbo-item-mapping-dialog',
      deleteDialogPrefix: 'confirm-delete-qbo-item-mapping-dialog',
      editMenuPrefix: 'edit-qbo-item-mapping-menu-item-',
      deleteMenuPrefix: 'delete-qbo-item-mapping-menu-item-'
    },
    async load(context) {
      return loadMappings<IServicesResult, QboItem>({
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
        }),
        loadExternalEntities: getQboItems,
        mapExternal: (item) => ({
          id: item.id,
          name: item.name
        })
      });
    },
    create(context, input) {
      return createMapping({
        context,
        input,
        algaEntityType: 'service',
        externalEntityType: 'Item'
      });
    },
    update(context, mappingId, input) {
      return updateMapping(context, mappingId, input);
    },
    async remove(context, mappingId) {
      await deleteExternalEntityMapping(mappingId);
    }
  };
}

function createTaxCodeModule(): AccountingMappingModule {
  return {
    id: 'qbo-tax-code-mappings',
    adapterType: ADAPTER_TYPE,
    algaEntityType: 'tax_region',
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
    resolveOverrides: resolveAccountingOverrides(ADAPTER_TYPE, 'qbo-tax-code-mappings'),
    elements: {
      addButton: 'add-qbo-taxcode-mapping-button',
      table: 'qbo-taxcode-mappings-table',
      dialog: 'qbo-taxcode-mapping-dialog',
      deleteDialogPrefix: 'confirm-delete-qbo-taxcode-mapping-dialog',
      editMenuPrefix: 'edit-qbo-taxcode-mapping-menu-item-',
      deleteMenuPrefix: 'delete-qbo-taxcode-mapping-menu-item-'
    },
    async load(context) {
      return loadMappings<ITaxRegion, QboTaxCode>({
        context,
        algaEntityType: 'tax_region',
        loadAlgaEntities: getTaxRegions,
        mapAlga: (region) => ({
          id: region.region_code,
          name: region.region_name ?? region.region_code
        }),
        loadExternalEntities: getQboTaxCodes,
        mapExternal: (taxCode) => ({
          id: taxCode.id,
          name: taxCode.name
        })
      });
    },
    create(context, input) {
      return createMapping({
        context,
        input,
        algaEntityType: 'tax_region',
        externalEntityType: 'TaxCode'
      });
    },
    update(context, mappingId, input) {
      return updateMapping(context, mappingId, input);
    },
    async remove(_context, mappingId) {
      await deleteExternalEntityMapping(mappingId);
    }
  };
}

function createPaymentTermModule(): AccountingMappingModule {
  return {
    id: 'qbo-term-mappings',
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
    elements: {
      addButton: 'add-qbo-term-mapping-button',
      table: 'qbo-term-mappings-table',
      dialog: 'qbo-term-mapping-dialog',
      deleteDialogPrefix: 'confirm-delete-qbo-term-mapping-dialog',
      editMenuPrefix: 'edit-qbo-term-mapping-menu-item-',
      deleteMenuPrefix: 'delete-qbo-term-mapping-menu-item-'
    },
    async load(context) {
      return loadMappings<IPaymentTermOption, QboTerm>({
        context,
        algaEntityType: 'payment_term',
        loadAlgaEntities: getPaymentTermsList,
        mapAlga: (term) => ({
          id: term.id,
          name: term.name
        }),
        loadExternalEntities: getQboTerms,
        mapExternal: (term) => ({
          id: term.id,
          name: term.name
        })
      });
    },
    create(context, input) {
      return createMapping({
        context,
        input,
        algaEntityType: 'payment_term',
        externalEntityType: 'Term'
      });
    },
    update(context, mappingId, input) {
      return updateMapping(context, mappingId, input);
    },
    async remove(_context, mappingId) {
      await deleteExternalEntityMapping(mappingId);
    }
  };
}

async function loadMappings<TAlga, TExternal>({
  context,
  algaEntityType,
  loadAlgaEntities,
  mapAlga,
  loadExternalEntities,
  mapExternal
}: MappingLoadConfig<TAlga, TExternal>): Promise<AccountingMappingLoadResult> {
  const [mappings, algaEntities, externalEntities] = await Promise.all([
    getExternalEntityMappings({
      integrationType: ADAPTER_TYPE,
      algaEntityType,
      externalRealmId: context.realmId ?? undefined
    }),
    loadAlgaEntities(),
    loadExternalEntities()
  ]);

  return {
    mappings,
    algaEntities: algaEntities.map(mapAlga),
    externalEntities: externalEntities.map(mapExternal)
  };
}

async function createMapping({
  context,
  input,
  algaEntityType,
  externalEntityType
}: {
  context: AccountingMappingContext;
  input: {
    algaEntityId: string;
    externalEntityId: string;
    metadata?: Record<string, unknown> | null;
  };
  algaEntityType: string;
  externalEntityType: string;
}): Promise<ExternalEntityMapping> {
  const payload: CreateMappingData = {
    integration_type: ADAPTER_TYPE,
    alga_entity_type: algaEntityType,
    alga_entity_id: input.algaEntityId,
    external_entity_id: input.externalEntityId,
    external_realm_id: context.realmId ?? null,
    metadata: input.metadata ?? undefined,
    sync_status: 'manual_link'
  };

  return createExternalEntityMapping(payload);
}

async function updateMapping(
  context: AccountingMappingContext,
  mappingId: string,
  input: {
    externalEntityId: string;
    metadata?: Record<string, unknown> | null;
  }
): Promise<ExternalEntityMapping> {
  const payload: UpdateMappingData = {
    external_entity_id: input.externalEntityId,
    metadata: input.metadata ?? undefined
  };

  return updateExternalEntityMapping(mappingId, payload);
}

function resolveAccountingOverrides(
  adapterType: string,
  moduleKey: string,
  fallbackKey?: string
) {
  return (_context: AccountingMappingContext): AccountingMappingOverrides | undefined => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const globalWithMocks = window as typeof window & {
      __ALGA_PLAYWRIGHT_ACCOUNTING__?: Record<string, Record<string, AccountingMappingOverrides>>;
      __ALGA_PLAYWRIGHT_QBO__?: Record<string, AccountingMappingOverrides>;
    };

    const generic = globalWithMocks.__ALGA_PLAYWRIGHT_ACCOUNTING__?.[adapterType]?.[moduleKey];
    if (generic) {
      return generic;
    }

    if (fallbackKey) {
      return globalWithMocks.__ALGA_PLAYWRIGHT_QBO__?.[fallbackKey];
    }

    return undefined;
  };
}

type IServicesResult = Pick<IService, 'service_id' | 'service_name'>;
