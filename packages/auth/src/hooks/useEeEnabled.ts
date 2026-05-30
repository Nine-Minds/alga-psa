'use client';

import { useSession } from 'next-auth/react';

/**
 * Returns true when the EE feature surface is active for this install.
 * On Enterprise builds: true while effective tier > 'essentials'.
 * On CE builds: false (NEXT_PUBLIC_EDITION !== 'enterprise').
 *
 * Use this in package components (packages/integrations, packages/clients, etc.)
 * to gate EE surface/feature-exposure — not module-presence import guards.
 *
 * Falls back to the build-time NEXT_PUBLIC_EDITION check when session is not
 * yet loaded, so EE features appear immediately on EE SaaS builds.
 */
export function useEeEnabled(): boolean {
  const { data: session } = useSession();

  // Build-time CE check: always false on CE builds regardless of session.
  if (process.env.NEXT_PUBLIC_EDITION !== 'enterprise') return false;

  // Session not loaded yet: assume enabled (EE build, avoids flash of CE UI on SaaS).
  if (!session?.user) return true;

  // Use the server-resolved value when available.
  if (session.user.eeEnabled !== undefined) return session.user.eeEnabled;

  // Fallback for sessions pre-dating this field (SaaS deploys in transition).
  return true;
}
