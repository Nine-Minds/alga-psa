// Compatibility layer for NextAuth v5 migration using the edge-safe session helper
import { getSession } from '@alga-psa/auth';

// This function provides backwards compatibility for getServerSession
// It can be imported as getServerSession from this file instead of next-auth
export async function getServerSession() {
  return await getSession();
}

export const auth = getSession;
