import { getSession } from 'next-auth/react';

export async function getCurrentTenant(): Promise<string> {
  const session = await getSession();
  if (!session?.user?.tenant) {
    throw new Error('No tenant found in session');
  }
  return session.user.tenant;
}

