import {
  createExternalEntityMapping,
  deleteExternalEntityMapping,
  getExternalEntityMappings,
  getServices,
  getTaxRegions,
  getXeroAccounts,
  getXeroItems,
  getXeroTaxRates,
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
import {
  readXeroServiceTargetKind,
  XERO_SALES_ACCOUNT_TYPES,
  XERO_TARGET_KIND_METADATA_KEY,
  type XeroServiceTargetKind
} from '../../lib/xero/xeroServiceMappingTarget';

const ADAPTER_TYPE = 'xero';

/**
 * UI option ids for the service module are kind-prefixed (`item:CONSULT`,
 * `account:200`) so identical Item and Account codes can never collide in the
 * picker or the table lookup. The prefix is a UI addressing concern only —
 * the persisted mapping stores the bare code plus an explicit
 * `metadata.xeroTargetKind`.
 */
const KIND_PREFIXES: Record<XeroServiceTargetKind, string> = {
  item: 'item:',
  account: 'account:'
};

function toOptionId(kind: XeroServiceTargetKind, code: string): string {
  return `${KIND_PREFIXES[kind]}${code}`;
}

function parseOptionId(optionId: string): { kind: XeroServiceTargetKind; code: string } {
  for (const [kind, prefix] of Object.entries(KIND_PREFIXES) as Array<
    [XeroServiceTargetKind, string]
  >) {
    if (optionId.startsWith(prefix)) {
      return { kind, code: optionId.slice(prefix.length) };
    }
  }
  // Fail fast: the picker only produces prefixed ids, so anything else is a
  // caller bug — persisting it could save an untyped mapping.
  throw new Error(`Xero service mapping selection "${optionId}" is missing its item/account kind.`);
}

/** A Xero catalog record in DELETED/ARCHIVED state is unusable for new mappings. */
function isUsableStatus(status: string | undefined): boolean {
  if (!status) return true;
  const normalized = status.toUpperCase();
  return normalized !== 'DELETED' && normalized !== 'ARCHIVED';
}

type MappingLoadConfig<TAlga> = {
  context: AccountingMappingContext;
  algaEntityType: string;
  loadAlgaEntities: (context: AccountingMappingContext) => Promise<TAlga[]>;
  loadExternalEntities: (context: AccountingMappingContext) => Promise<Array<{ id: string; name: string }>>;
  mapAlga: (entity: TAlga) => { id: string; name: string };
};

type TFn = (key: string, options?: Record<string, unknown>) => string;

function throwIfActionError(value: unknown): void {
  if (isActionMessageError(value) || isActionPermissionError(value)) {
    throw new Error(getErrorMessage(value));
  }
}

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
        'Map each Alga service to a Xero target. "Xero Item" sends the item code (ItemCode) from your Products and Services catalog. "Xero Revenue Account" is for organisations that invoice without items: lines are sent with the account code (AccountCode) only. Item codes and account codes are different Xero concepts — a value like 200 can exist in both catalogs, so pick the target type explicitly. Tracking categories may be referenced in the metadata JSON as `tracking`.',
      addButton: 'Add Service Mapping',
      algaColumn: 'Alga Service',
      externalColumn: 'Xero Target',
      dialog: {
        addTitle: 'Add Live Xero Service Mapping',
        editTitle: 'Edit Live Xero Service Mapping',
        algaField: 'Alga Service',
        externalField: 'Xero Item or Account',
        helpText:
          'Xero Item Code and Account Code are different concepts: an item comes from Products and Services, while a revenue account comes from the chart of accounts. Choose the target type first, then pick the record. Optional metadata JSON may include {"tracking":[{"name":"Region","option":"North"}]}; item mappings may also set {"accountCode":"200"}.'
      },
      deleteConfirmation: {
        title: 'Delete Service Mapping',
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
    externalTarget: {
      label: 'Map To',
      kinds: [
        { id: 'item', label: 'Xero Item' },
        { id: 'account', label: 'Xero Revenue Account' }
      ],
      defaultKindId: 'item',
      kindForMapping: (mapping) =>
        // Unrecognised stored kinds render as item so the row is visibly
        // invalid against the item catalog instead of crashing the screen;
        // the server rejects such rows at save time.
        readXeroServiceTargetKind(mapping.metadata ?? null) ?? 'item',
      optionIdForMapping: (mapping) =>
        toOptionId(
          readXeroServiceTargetKind(mapping.metadata ?? null) ?? 'item',
          mapping.external_entity_id
        ),
      invalidNotice:
        'This mapping no longer matches a usable record in the connected Xero organisation. Pick a valid Xero Item, or explicitly switch it to a Xero Revenue Account — it will not convert automatically.'
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
          const [itemsResult, accountsResult] = await Promise.all([
            getXeroItems(connectionId),
            getXeroAccounts(connectionId)
          ]);
          throwIfActionError(itemsResult);
          throwIfActionError(accountsResult);

          const items = itemsResult as Array<{
            id: string;
            name: string;
            code?: string;
            status?: string;
          }>;
          const accounts = accountsResult as Array<{
            id: string;
            name: string;
            code?: string;
            type?: string;
          }>;

          const itemOptions = items
            .filter((item) => isUsableStatus(item.status))
            .map((item) => ({
              id: toOptionId('item', item.code ?? item.id),
              name: `Item · ${item.code ? `${item.name} (${item.code})` : item.name}`,
              kind: 'item' as const
            }));

          // Account mode sends the code as the invoice line AccountCode, so
          // only accounts Xero accepts on ACCREC sales lines are offered:
          // active (getXeroAccounts already filters status), revenue-class
          // type, and carrying a non-empty code.
          const accountOptions = accounts
            .filter(
              (account) =>
                Boolean(account.code && account.code.trim()) &&
                XERO_SALES_ACCOUNT_TYPES.has((account.type ?? '').toUpperCase())
            )
            .map((account) => ({
              id: toOptionId('account', account.code!.trim()),
              name: `Revenue account · ${account.name} (${account.code!.trim()})`,
              kind: 'account' as const
            }));

          return [...itemOptions, ...accountOptions];
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
      const { kind, code } = parseOptionId(input.externalEntityId);
      return createMapping({
        context,
        input: {
          ...input,
          externalEntityId: code,
          metadata: { ...(input.metadata ?? {}), [XERO_TARGET_KIND_METADATA_KEY]: kind }
        },
        algaEntityType: 'service'
      });
    },
    update(_context, mappingId, input) {
      const { kind, code } = parseOptionId(input.externalEntityId);
      return updateMapping(mappingId, {
        ...input,
        externalEntityId: code,
        // The kind chosen in the picker is authoritative; it overrides any
        // stale xeroTargetKind carried over in the metadata JSON editor.
        metadata: { ...(input.metadata ?? {}), [XERO_TARGET_KIND_METADATA_KEY]: kind }
      });
    },
    async remove(_context, mappingId) {
      throwIfActionError(await deleteExternalEntityMapping(mappingId));
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
          const taxRatesResult = await getXeroTaxRates(currentContext.connectionId ?? null);
          throwIfActionError(taxRatesResult);
          const taxRates = taxRatesResult as Array<{ id: string; name: string; taxType?: string }>;
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
  const externalRealmId = context.realmId ?? null;

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
    metadata: input.metadata ?? null
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
