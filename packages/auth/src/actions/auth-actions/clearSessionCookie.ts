'use server';

import { cookies } from 'next/headers';
import { getSessionCookieConfig } from '../../lib/session';

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  const sessionCookieConfig = getSessionCookieConfig();

  if (cookieStore.has(sessionCookieConfig.name)) {
    console.log('[clearSessionCookie] Clearing session cookie');
    cookieStore.delete(sessionCookieConfig.name);
  }
}
