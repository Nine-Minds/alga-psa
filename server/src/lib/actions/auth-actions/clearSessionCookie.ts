'use server';

import { cookies } from 'next/headers';
import { getSessionCookieConfig } from 'server/src/lib/auth/sessionCookies';

/**
 * Server Action to clear the session cookie.
 * This is needed because cookies can only be modified in Server Actions or Route Handlers,
 * not in Server Components.
 */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  const sessionCookieConfig = getSessionCookieConfig();

  if (cookieStore.has(sessionCookieConfig.name)) {
    console.log('[clearSessionCookie] Clearing session cookie');
    cookieStore.delete(sessionCookieConfig.name);
  }
}
