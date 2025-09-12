import NextAuth from "next-auth";
import { getAuthOptions } from "./options";

// Create the auth instance with options
export const { auth, handlers, signIn, signOut } = NextAuth(async () => {
  const options = await getAuthOptions();
  return options;
});