import type { ExternalEntityMapping, CreateMappingData, UpdateMappingData } from '@alga-psa/integrations/actions';

export type AccountingMappingEntityOption = {
  id: string;
  name: string;
  /**
   * Target-kind discriminator when the module offers more than one external
   * catalog (see AccountingMappingTargetConfig). Options without a kind are
   * shown regardless of the selected kind.
   */
  kind?: string;
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
  /** Optional description shown below the tab heading */
  description?: string;
  addButton: string;
  algaColumn: string;
  externalColumn: string;
  dialog: {
    addTitle: string;
    editTitle: string;
    algaField: string;
    externalField: string;
    /** Optional help text shown in the dialog */
    helpText?: string;
  };
  deleteConfirmation: {
    title: string;
    message: (names: { algaName?: string; externalName?: string }) => string;
    confirmLabel?: string;
    cancelLabel?: string;
  };
};

/**
 * Configuration for modules whose external side spans more than one provider
 * catalog (e.g. a Xero service maps to an Item or to a revenue Account). The
 * dialog renders an explicit kind chooser and filters the external options by
 * the chosen kind — the kind is a deliberate user decision, never inferred
 * from the shape of a code, because codes can collide across catalogs.
 */
export type AccountingMappingTargetConfig = {
  /** Dialog label for the kind chooser. */
  label: string;
  kinds: Array<{ id: string; label: string }>;
  /** Kind preselected when creating a new mapping. */
  defaultKindId: string;
  /** Kind persisted on a stored mapping row (legacy rows resolve to a default). */
  kindForMapping: (mapping: ExternalEntityMapping) => string;
  /** Catalog option id a stored mapping row corresponds to. */
  optionIdForMapping: (mapping: ExternalEntityMapping) => string;
  /**
   * Copy rendered (table and edit dialog) when a stored mapping's target no
   * longer exists in the live catalog — the remediation prompt for invalid
   * legacy mappings.
   */
  invalidNotice: string;
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
  /** Present when the external side spans multiple provider catalogs. */
  externalTarget?: AccountingMappingTargetConfig;
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
