import type { Knex } from 'knex';

export type DeletionBlockCode =
  | 'PERMISSION_DENIED'
  | 'UNKNOWN_ENTITY'
  | 'NOT_FOUND'
  | 'IS_DEFAULT'
  | 'DEPENDENCIES_EXIST'
  | 'VALIDATION_FAILED';

export type DeletionDependency = {
  type: string;
  count: number;
  label: string;
  description?: string;
  viewUrl?: string;
  /**
   * False when the delete cleans the rows up itself. Such a dependency is
   * reported for information and never stops the deletion.
   */
  blocking?: boolean;
};

export type DeletionAlternative = {
  action: string;
  label: string;
  description?: string;
  warning?: string;
};

export type DeletionValidationResult = {
  canDelete: boolean;
  code?: DeletionBlockCode;
  message?: string;
  dependencies: DeletionDependency[];
  alternatives: DeletionAlternative[];
};

export type EntityDependencyConfig = {
  type: string;
  label: string;
  table: string;
  foreignKey?: string;
  countQuery?: (trx: Knex | Knex.Transaction, options: { tenant: string; entityId: string }) => Promise<number>;
  viewUrlTemplate?: string;
  /**
   * Defaults to true. Set false for links the deletion path clears on its own
   * — they are worth showing, but refusing the delete over them would mean the
   * cleanup never runs.
   */
  blocking?: boolean;
};

export type EntityDeletionConfig = {
  entityType: string;
  dependencies: EntityDependencyConfig[];
  supportsInactive?: boolean;
  supportsArchive?: boolean;
  tagEntityType?: string;
};
