import type { ExternalEntityMapping, CreateMappingData, UpdateMappingData } from 'server/src/lib/actions/externalMappingActions';

export type AccountingMappingEntityOption = {
  id: string;
  name: string;
};

export type AccountingMappingLoadResult = {
  mappings: ExternalEntityMapping[];
  algaEntities: AccountingMappingEntityOption[];
  externalEntities: AccountingMappingEntityOption[];
};

export type AccountingMappingContext = {
  /**
   * Adapter/realm specific identifier (e.g., QBO realm ID, Xero tenant ID).
   * Optional so configurations that do not require a realm/context can omit it.
   */
  realmId?: string | null;
  /**
   * Optional identifier used solely for authenticated API calls (e.g., Xero connectionId).
   * When provided, components can use this for catalog lookups while persisting realmId separately.
   */
  connectionId?: string | null;
  /**
   * Human-readable value to display in forms when different from realmId.
   */
  realmDisplayValue?: string | null;
};

export type AccountingMappingOverrides = {
  loadData?: (context: AccountingMappingContext) => Promise<AccountingMappingLoadResult>;
  createMapping?: (
    context: AccountingMappingContext,
    data: CreateMappingData
  ) => Promise<unknown>;
  updateMapping?: (
    context: AccountingMappingContext,
    mappingId: string,
    data: UpdateMappingData
  ) => Promise<unknown>;
  deleteMapping?: (
    context: AccountingMappingContext,
    mappingId: string
  ) => Promise<unknown>;
};

export type AccountingMappingLabels = {
  tab: string;
  addButton: string;
  algaColumn: string;
  externalColumn: string;
  dialog: {
    addTitle: string;
    editTitle: string;
    algaField: string;
    externalField: string;
  };
  deleteConfirmation: {
    title: string;
    message: (names: { algaName?: string; externalName?: string }) => string;
    confirmLabel?: string;
    cancelLabel?: string;
  };
};

export type AccountingMetadataConfig = {
  /**
    * If true, allow users to edit metadata as JSON.
    * Defaults to false.
    */
  enableJsonEditor?: boolean;
};

export type AccountingMappingElementIds = {
  addButton?: string;
  table?: string;
  dialog?: string;
  deleteDialogPrefix?: string;
  editMenuPrefix?: string;
  deleteMenuPrefix?: string;
};

export interface AccountingMappingModule {
  id: string;
  adapterType: string;
  algaEntityType: string;
  externalEntityType: string;
  labels: AccountingMappingLabels;
  metadata?: AccountingMetadataConfig;
  overridesKey?: string;
  resolveOverrides?: (
    context: AccountingMappingContext
  ) => AccountingMappingOverrides | undefined;
  elements?: AccountingMappingElementIds;

  load(context: AccountingMappingContext): Promise<AccountingMappingLoadResult>;
  create(
    context: AccountingMappingContext,
    input: {
      algaEntityId: string;
      externalEntityId: string;
      metadata?: Record<string, unknown> | null;
    }
  ): Promise<ExternalEntityMapping>;
  update(
    context: AccountingMappingContext,
    mappingId: string,
    input: {
      externalEntityId: string;
      metadata?: Record<string, unknown> | null;
    }
  ): Promise<ExternalEntityMapping>;
  remove(context: AccountingMappingContext, mappingId: string): Promise<void>;
}
