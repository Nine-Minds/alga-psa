// Compatibility layer for NextAuth v5 migration
import { auth } from '../app/api/auth/[...nextauth]/auth';

// This function provides backwards compatibility for getServerSession
// It can be imported as getServerSession from this file instead of next-auth
export async function getServerSession() {
  return await auth();
}

export { auth };