import {
  createExternalEntityMapping,
  deleteExternalEntityMapping,
  getExternalEntityMappings,
  updateExternalEntityMapping,
  type ExternalEntityMapping
} from 'server/src/lib/actions/externalMappingActions';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { getTaxRegions } from 'server/src/lib/actions/taxSettingsActions';
import {
  getXeroItems,
  getXeroTaxRates,
  type XeroItemOption,
  type XeroTaxRateOption
} from 'server/src/lib/actions/integrations/xeroActions';
import type { IService } from 'server/src/interfaces/billing.interfaces';
import type { ITaxRegion } from 'server/src/interfaces/tax.interfaces';
import type {
  AccountingMappingContext,
  AccountingMappingModule,
  AccountingMappingOverrides
} from 'server/src/components/accounting-mappings/types';

const ADAPTER_TYPE = 'xero';

type ServiceListItem = Pick<IService, 'service_id' | 'service_name'>;

export function createXeroMappingModules(): AccountingMappingModule[] {
  return [createServiceModule(), createTaxModule()];
}

function createServiceModule(): AccountingMappingModule {
  return {
    id: 'xero-service-mappings',
    adapterType: ADAPTER_TYPE,
    algaEntityType: 'service',
    externalEntityType: 'Item',
    labels: {
      tab: 'Items / Services',
      addButton: 'Add Item Mapping',
      algaColumn: 'Alga Service',
      externalColumn: 'Xero Item Code',
      dialog: {
        addTitle: 'Add Xero Item Mapping',
        editTitle: 'Edit Xero Item Mapping',
        algaField: 'Alga Service',
        externalField: 'Xero Item'
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
    resolveOverrides: resolveAccountingOverrides(ADAPTER_TYPE, 'xero-service-mappings'),
    metadata: {
      enableJsonEditor: true
    },
    elements: {
      addButton: 'add-xero-item-mapping-button',
      table: 'xero-item-mappings-table',
      dialog: 'xero-item-mapping-dialog',
      deleteDialogPrefix: 'confirm-delete-xero-item-mapping-dialog',
      editMenuPrefix: 'edit-xero-item-mapping-menu-item-',
      deleteMenuPrefix: 'delete-xero-item-mapping-menu-item-'
    },
    async load(context) {
      const effectiveConnectionId = context.connectionId ?? context.realmId ?? null;
      const [mappingsForRealm, servicesResponse, xeroItems] = await Promise.all([
        getExternalEntityMappings({
          integrationType: ADAPTER_TYPE,
          algaEntityType: 'service',
          externalRealmId: context.realmId ?? undefined
        }),
        getServices(),
        getXeroItems(effectiveConnectionId)
      ]);

      const mappingData = await normalizeRealmAssignments({
        mappingsForRealm,
        context,
        algaEntityType: 'service'
      });

      const serviceOptions: ServiceListItem[] = servicesResponse.services.map((service) => ({
        service_id: service.service_id,
        service_name: service.service_name
      }));

      return {
        mappings: mappingData,
        algaEntities: serviceOptions.map((service) => ({
          id: service.service_id,
          name: service.service_name
        })),
        externalEntities: xeroItems.map((item) => ({
          id: item.code ?? item.id,
          name: renderItemLabel(item)
        }))
      };
    },
    create(context, input) {
      return createExternalEntityMapping({
        integration_type: ADAPTER_TYPE,
        alga_entity_type: 'service',
        alga_entity_id: input.algaEntityId,
        external_entity_id: input.externalEntityId,
        external_realm_id: context.realmId ?? null,
        metadata: input.metadata ?? null,
        sync_status: 'manual_link'
      });
    },
    update(_context, mappingId, input) {
      return updateExternalEntityMapping(mappingId, {
        external_entity_id: input.externalEntityId,
        metadata: input.metadata ?? null
      });
    },
    async remove(_context, mappingId) {
      await deleteExternalEntityMapping(mappingId);
    }
  };
}

function createTaxModule(): AccountingMappingModule {
  return {
    id: 'xero-tax-rate-mappings',
    adapterType: ADAPTER_TYPE,
    algaEntityType: 'tax_region',
    externalEntityType: 'TaxRate',
    labels: {
      tab: 'Tax Rates',
      addButton: 'Add Tax Rate Mapping',
      algaColumn: 'Alga Tax Region',
      externalColumn: 'Xero Tax Type',
      dialog: {
        addTitle: 'Add Xero Tax Rate Mapping',
        editTitle: 'Edit Xero Tax Rate Mapping',
        algaField: 'Alga Tax Region',
        externalField: 'Xero Tax Rate'
      },
      deleteConfirmation: {
        title: 'Delete Tax Rate Mapping',
        message: ({ algaName, externalName }) =>
          `Delete mapping${algaName ? ` for ${algaName}` : ''}${
            externalName ? ` ↔ ${externalName}` : ''
          }?`,
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel'
      }
    },
    resolveOverrides: resolveAccountingOverrides(ADAPTER_TYPE, 'xero-tax-rate-mappings'),
    metadata: {
      enableJsonEditor: true
    },
    elements: {
      addButton: 'add-xero-taxrate-mapping-button',
      table: 'xero-taxrate-mappings-table',
      dialog: 'xero-taxrate-mapping-dialog',
      deleteDialogPrefix: 'confirm-delete-xero-taxrate-mapping-dialog',
      editMenuPrefix: 'edit-xero-taxrate-mapping-menu-item-',
      deleteMenuPrefix: 'delete-xero-taxrate-mapping-menu-item-'
    },
    async load(context) {
      const effectiveConnectionId = context.connectionId ?? context.realmId ?? null;
      const [mappingsForRealm, regions, taxRates] = await Promise.all([
        getExternalEntityMappings({
          integrationType: ADAPTER_TYPE,
          algaEntityType: 'tax_region',
          externalRealmId: context.realmId ?? undefined
        }),
        getTaxRegions(),
        getXeroTaxRates(effectiveConnectionId)
      ]);

      const mappingData = await normalizeRealmAssignments({
        mappingsForRealm,
        context,
        algaEntityType: 'tax_region'
      });

      return {
        mappings: mappingData,
        algaEntities: regions.map((region: ITaxRegion) => ({
          id: region.region_code,
          name: region.region_name ?? region.region_code
        })),
        externalEntities: taxRates.map((rate) => ({
          id: rate.taxType ?? rate.id,
          name: renderTaxRateLabel(rate)
        }))
      };
    },
    create(context, input) {
      return createExternalEntityMapping({
        integration_type: ADAPTER_TYPE,
        alga_entity_type: 'tax_region',
        alga_entity_id: input.algaEntityId,
        external_entity_id: input.externalEntityId,
        external_realm_id: context.realmId ?? null,
        metadata: input.metadata ?? null,
        sync_status: 'manual_link'
      });
    },
    update(_context, mappingId, input) {
      return updateExternalEntityMapping(mappingId, {
        external_entity_id: input.externalEntityId,
        metadata: input.metadata ?? null
      });
    },
    async remove(_context, mappingId) {
      await deleteExternalEntityMapping(mappingId);
    }
  };
}

async function normalizeRealmAssignments({
  mappingsForRealm,
  context,
  algaEntityType
}: {
  mappingsForRealm: ExternalEntityMapping[];
  context: AccountingMappingContext;
  algaEntityType: 'service' | 'tax_region';
}): Promise<ExternalEntityMapping[]> {
  const desiredRealm = context.realmId ?? null;
  if (desiredRealm === null) {
    return mappingsForRealm;
  }

  if (mappingsForRealm.length > 0) {
    return mappingsForRealm;
  }

  const legacyRealmCandidates = new Set<string>();
  if (context.realmDisplayValue && context.realmDisplayValue !== desiredRealm) {
    legacyRealmCandidates.add(context.realmDisplayValue);
  }

  if (legacyRealmCandidates.size === 0) {
    return mappingsForRealm;
  }

  const migrated: ExternalEntityMapping[] = [];

  for (const legacyRealm of legacyRealmCandidates) {
    try {
      const legacyMappings = await getExternalEntityMappings({
        integrationType: ADAPTER_TYPE,
        algaEntityType,
        externalRealmId: legacyRealm
      });

      for (const mapping of legacyMappings) {
        if (mapping.external_realm_id === desiredRealm) {
          migrated.push(mapping);
          continue;
        }
        try {
          const updated = await updateExternalEntityMapping(mapping.id, {
            external_realm_id: desiredRealm
          });
          migrated.push(updated);
        } catch (error) {
          console.error('[Xero Mapping] Failed to migrate legacy mapping realm', {
            mappingId: mapping.id,
            algaEntityType,
            fromRealm: legacyRealm,
            toRealm: desiredRealm,
            error
          });
          migrated.push(mapping);
        }
      }
    } catch (error) {
      console.error('[Xero Mapping] Failed to load legacy mappings for realm', {
        algaEntityType,
        legacyRealm,
        error
      });
    }
  }

  if (!migrated.length) {
    return mappingsForRealm;
  }

  const merged = new Map<string, ExternalEntityMapping>();
  for (const entry of [...mappingsForRealm, ...migrated]) {
    merged.set(entry.id, entry);
  }
  return Array.from(merged.values());
}

function renderItemLabel(item: XeroItemOption): string {
  const segments: string[] = [item.name];
  if (item.code) {
    segments.push(`(${item.code})`);
  }
  return segments.filter(Boolean).join(' ');
}

function renderTaxRateLabel(rate: XeroTaxRateOption): string {
  const segments: string[] = [rate.name];
  if (rate.taxType) {
    segments.push(`[${rate.taxType}]`);
  }
  if (typeof rate.effectiveRate === 'number') {
    segments.push(`${rate.effectiveRate}%`);
  }
  return segments.filter(Boolean).join(' ');
}

function resolveAccountingOverrides(
  adapterType: string,
  moduleKey: string
) {
  return (_context: AccountingMappingContext): AccountingMappingOverrides | undefined => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const globalWithMocks = window as typeof window & {
      __ALGA_PLAYWRIGHT_ACCOUNTING__?: Record<string, Record<string, AccountingMappingOverrides>>;
    };

    return globalWithMocks.__ALGA_PLAYWRIGHT_ACCOUNTING__?.[adapterType]?.[moduleKey];
  };
}
