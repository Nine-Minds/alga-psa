import NextAuth from "next-auth";
import { getAuthOptions } from "./options";

// Minimal Edge-safe auth for middleware and server components
const minimal = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
  providers: [],
});

// Full Node.js handlers with providers and callbacks
const full = NextAuth(async () => {
  const options = await getAuthOptions();
  return options;
});

export const { auth } = minimal;
export const { handlers, signIn, signOut } = full;
