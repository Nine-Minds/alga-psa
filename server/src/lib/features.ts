// server/src/lib/features.ts
// Check both EDITION (server-side) and NEXT_PUBLIC_EDITION (client-side) for consistency
// EDITION can be 'ee' or 'enterprise', NEXT_PUBLIC_EDITION is always 'enterprise'
export function isEnterpriseEdition(): boolean {
  return (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
    (process.env.EDITION ?? '').toLowerCase() === 'enterprise' ||
    (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';
}

export const isEnterprise =
  isEnterpriseEdition();

export function getFeatureImplementation<T>(ceModule: T, eeModule?: T): T {
  if (isEnterprise && eeModule) {
    return eeModule;
  }
  return ceModule;
}

/**
 * Default-locked safety for server components / server actions.
 *
 * Returns false (EE surfaces hidden) until confirmed otherwise:
 * - On a CE build: always false.
 * - On an EE build at essentials tier: false.
 * - On an EE build at solo+ tier: true.
 *
 * Pass the session.user.eeEnabled value resolved by the auth options.
 * Falls back to true on EE SaaS sessions (session.user.eeEnabled is undefined
 * until sessions regenerate after deploy).
 */
export function serverEeEnabled(sessionEeEnabled: boolean | undefined): boolean {
  if (!isEnterprise) return false;
  if (sessionEeEnabled === undefined) return true;
  return sessionEeEnabled;
}
