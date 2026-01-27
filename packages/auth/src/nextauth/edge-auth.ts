import NextAuth from 'next-auth';
import {
  getSessionCookieConfig,
  getSessionMaxAge,
} from '../lib/session';

const EDGE_SESSION_MAX_AGE = getSessionMaxAge();
const EDGE_SESSION_COOKIE = getSessionCookieConfig();

// Minimal Edge-safe auth instance for middleware and server components
// NOTE: Cannot check session revocation here because Edge Runtime doesn't support database access
// Session revocation is handled in layout components.
//
// IMPORTANT: Don't require NEXTAUTH_SECRET at module-evaluation time; Next.js will import route modules
// during `next build` (Collecting page data). We only enforce the secret when auth is actually invoked.
let cachedEdgeAuth: ReturnType<typeof NextAuth> | null = null;
const getEdgeAuth = (): ReturnType<typeof NextAuth> => {
  if (cachedEdgeAuth) return cachedEdgeAuth;

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET environment variable is required for edge auth.');
  }

  cachedEdgeAuth = NextAuth({
    // @ts-ignore trustHost exists in NextAuth v5 but types differ across build contexts
    trustHost: true,
    session: {
      strategy: 'jwt',
      maxAge: EDGE_SESSION_MAX_AGE,
    },
    secret,
    cookies: {
      sessionToken: EDGE_SESSION_COOKIE,
    },
    providers: [],
    callbacks: {
      async session({ session, token }) {
        // Map custom claims from JWT into session.user for Edge consumers
        if (session.user && token) {
          (session.user as any).id = token.id as string | undefined;
          (session.user as any).tenant = token.tenant as string | undefined;
          (session.user as any).user_type = token.user_type as string | undefined;
          (session.user as any).clientId = token.clientId as string | undefined;
          (session.user as any).contactId = token.contactId as string | undefined;
          (session.user as any).email = token.email as string | undefined;
          (session.user as any).name = token.name as string | undefined;
          (session.user as any).username = token.username as string | undefined;
          (session.user as any).image = token.image as string | undefined;
          (session.user as any).proToken = token.proToken as string | undefined;

          // Add session_id and login_method to enable session management
          (session as any).session_id = token.session_id as string | undefined;
          (session as any).login_method = token.login_method as string | undefined;
        }
        return session as any;
      },
    },
  });

  return cachedEdgeAuth;
};

export const auth: any = (...args: any[]) => (getEdgeAuth() as any).auth(...args);
