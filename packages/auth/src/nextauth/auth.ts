import NextAuth from 'next-auth';
import { getAuthOptions } from '../lib/nextAuthOptions';
import { createCustomHostAwareHandler, resolveCustomAuthHost } from './customHostAuth';

// Full Node.js handlers with providers and callbacks
const full = (NextAuth as any)(async () => {
  const options = await getAuthOptions();
  return { ...options, trustHost: true };
});

// next-auth rewrites every request to NEXTAUTH_URL's origin. Requests that arrive on a
// tenant's custom MSP domain must keep their own origin (OAuth redirect_uri, callback
// URLs, host-only state cookies) - see customHostAuth.ts.
const httpHandler = createCustomHostAwareHandler({
  defaultHandler: full.handlers.GET,
  resolveHost: (request) => resolveCustomAuthHost(request),
  loadConfig: () => getAuthOptions() as Promise<Record<string, any>>,
});

// Export auth from the full configuration to get proper session data
export const { auth, signIn, signOut } = full;
export const handlers = { GET: httpHandler, POST: httpHandler };
