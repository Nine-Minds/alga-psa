import NextAuth from 'next-auth';
import { getAuthOptions } from '../lib/nextAuthOptions';

// Full Node.js handlers with providers and callbacks
const full = NextAuth(async () => {
  const options = await getAuthOptions();
  return options;
});

// Export auth from the full configuration to get proper session data
export const { auth, handlers, signIn, signOut } = full;

