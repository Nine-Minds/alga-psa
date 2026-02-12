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
  code?: string;
  message?: string;
  dependencies: DeletionDependency[];
  alternatives: DeletionAlternative[];
};
