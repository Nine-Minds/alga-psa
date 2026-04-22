import type { AuthorizationKernel } from './contracts';
import { createAuthorizationKernel } from './engine';
import { loadEnterpriseAuthorizationKernelFactory } from './enterpriseEntry';
import { BuiltinAuthorizationKernelProvider } from './providers/builtinProvider';

declare global {
  // eslint-disable-next-line no-var
  var __algaAuthorizationKernelSingleton: AuthorizationKernel | undefined;
}

export function createBuiltinAuthorizationKernel(): AuthorizationKernel {
  return createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
  });
}

export async function getAuthorizationKernel(): Promise<AuthorizationKernel> {
  if (globalThis.__algaAuthorizationKernelSingleton) {
    return globalThis.__algaAuthorizationKernelSingleton;
  }

  const enterpriseFactory = await loadEnterpriseAuthorizationKernelFactory();
  if (enterpriseFactory) {
    const enterpriseKernel = await enterpriseFactory();
    if (enterpriseKernel) {
      globalThis.__algaAuthorizationKernelSingleton = enterpriseKernel;
      return globalThis.__algaAuthorizationKernelSingleton;
    }
  }

  globalThis.__algaAuthorizationKernelSingleton = createBuiltinAuthorizationKernel();
  return globalThis.__algaAuthorizationKernelSingleton;
}

export function resetAuthorizationKernelForTests(): void {
  globalThis.__algaAuthorizationKernelSingleton = undefined;
}

export * from './contracts';
export * from './engine';
export * from './providers/builtinProvider';
export * from './providers/bundleProvider';
export * from './relationships';
export * from './requestCache';
export * from './scope';
