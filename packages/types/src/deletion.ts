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
