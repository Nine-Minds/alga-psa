'use server';

import { getCurrentUser as getAuthenticatedCurrentUser } from '@alga-psa/auth';
import { sanitizeUserForResponse } from '@alga-psa/types';

/** Browser-safe current-user response. Authentication remains in the auth package. */
export async function getCurrentUser() {
  const user = await getAuthenticatedCurrentUser();
  return user ? sanitizeUserForResponse(user) : null;
}
