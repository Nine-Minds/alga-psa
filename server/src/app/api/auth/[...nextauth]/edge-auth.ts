import NextAuth from "next-auth";

// Minimal Edge-safe auth instance for middleware and server components
export const { auth } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
  providers: [],
  callbacks: {
    async session({ session, token }) {
      // Map custom claims from JWT into session.user for Edge consumers
      if (session.user && token) {
        (session.user as any).id = token.id as string | undefined;
        (session.user as any).tenant = token.tenant as string | undefined;
        (session.user as any).user_type = token.user_type as string | undefined;
        (session.user as any).companyId = token.companyId as string | undefined;
        (session.user as any).contactId = token.contactId as string | undefined;
      }
      return session as any;
    },
  },
});
