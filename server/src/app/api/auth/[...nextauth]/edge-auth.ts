import NextAuth from "next-auth";
import {
  getNextAuthSecretSync,
  getSessionCookieConfig,
  getSessionMaxAge,
} from "server/src/lib/auth/sessionCookies";
import { UserSession } from "server/src/lib/models/UserSession";

const EDGE_SESSION_MAX_AGE = getSessionMaxAge();
const EDGE_SESSION_COOKIE = getSessionCookieConfig();
const EDGE_SECRET = getNextAuthSecretSync();

// Minimal Edge-safe auth instance for middleware and server components
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
    async jwt({ token }) {
      // Check if session was revoked
      if (token.session_id && token.tenant) {
        try {
          const isRevoked = await UserSession.isRevoked(
            token.tenant as string,
            token.session_id as string
          );

          if (isRevoked) {
            console.log('[edge-auth] Session revoked, invalidating token:', token.session_id);
            return null; // This will invalidate the session
          }
        } catch (error) {
          console.error('[edge-auth] Session revocation check error:', error);
          // Don't block on errors
        }
      }
      return token;
    },
    async session({ session, token }) {
      // If token is null (revoked), return null session
      if (!token) {
        return null as any;
      }

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
