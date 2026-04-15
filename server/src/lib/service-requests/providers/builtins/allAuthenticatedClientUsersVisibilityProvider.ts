import type { ServiceRequestVisibilityProvider } from '../contracts';

export const allAuthenticatedClientUsersVisibilityProvider: ServiceRequestVisibilityProvider = {
  key: 'all-authenticated-client-users',
  displayName: 'All Authenticated Client Users',
  validateConfig: () => ({ isValid: true }),
  async canAccessDefinition() {
    return true;
  },
};
