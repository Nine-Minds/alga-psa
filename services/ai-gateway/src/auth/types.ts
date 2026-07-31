import type { DeploymentType } from '../db/types.js';

export interface AuthenticatedPrincipal {
  tenantId: string;
  deploymentType: DeploymentType;
  edition?: string;
}

export class AuthenticationError extends Error {
  constructor(message = 'Invalid or expired bearer credential') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthenticationServiceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AuthenticationServiceError';
  }
}
