export const isEnterprise = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

export function getFeatureImplementation<T>(ceModule: T, eeModule?: T): T {
  if (isEnterprise && eeModule) {
    return eeModule;
  }
  return ceModule;
}

