import NextAuth from "next-auth";

import { getAuthOptions } from "./options";

const handler = async (req: any, res: any) => {
  const options = await getAuthOptions();
  return NextAuth(options)(req, res);
};

export { handler as GET, handler as POST };

export const runtime = 'nodejs';

