export interface PlanAssociationDetails {
  servicesByCategory: Record<string, { id: string; name: string }[]>;
  companies: string[];
}

export class PlanDeletionError extends Error {
  associations: PlanAssociationDetails;
  constructor(message: string, associations: PlanAssociationDetails) {
    super(message);
    this.name = 'PlanDeletionError';
    this.associations = associations;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}
