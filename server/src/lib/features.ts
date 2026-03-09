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
