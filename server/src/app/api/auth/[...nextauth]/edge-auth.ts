import NextAuth from "next-auth";
import {
  getNextAuthSecretSync,
  getSessionCookieConfig,
  getSessionMaxAge,
} from "server/src/lib/auth/sessionCookies";

const EDGE_SESSION_MAX_AGE = getSessionMaxAge();
const EDGE_SESSION_COOKIE = getSessionCookieConfig();
const EDGE_SECRET = getNextAuthSecretSync();

// Minimal Edge-safe auth instance for middleware and server components
// NOTE: Cannot check session revocation here because Edge Runtime doesn't support database access
// Session revocation is handled in the layout components (msp/layout.tsx, client-portal/layout.tsx)
export const { auth } = NextAuth({
  trustHost: true,
  session: {
    strategy: 'jwt',
    maxAge: EDGE_SESSION_MAX_AGE,
  },
  secret: EDGE_SECRET,
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

        // NEW: Add session_id and login_method to enable session management
        (session as any).session_id = token.session_id as string | undefined;
        (session as any).login_method = token.login_method as string | undefined;
      }
      return session as any;
    },
  },
});
