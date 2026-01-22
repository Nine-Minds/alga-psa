/**
 * Users helpers for tags package
 *
 * TODO: Consolidate after circular dependency is resolved
 */

import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';

export async function getCurrentUserAsync() {
  return getCurrentUser();
}
