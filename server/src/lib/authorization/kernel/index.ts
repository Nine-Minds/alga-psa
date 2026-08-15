import type { AuthorizationKernel } from '@alga-psa/authorization/kernel';
import {
  BuiltinAuthorizationKernelProvider,
  resolveDefaultBuiltinRelationshipRules,
} from '@alga-psa/authorization/kernel';
import { createAuthorizationKernelWithDefaultRbac } from '@alga-psa/authorization/adapters/rbac';
import { loadEnterpriseAuthorizationKernelFactory } from './enterpriseEntry';

declare global {
  // eslint-disable-next-line no-var
  var __algaAuthorizationKernelSingleton: AuthorizationKernel | undefined;
}

export function createBuiltinAuthorizationKernel(): AuthorizationKernel {
  return createAuthorizationKernelWithDefaultRbac({
    // Subject-aware same_client: client subjects are scoped to their own
    // client; internal subjects keep the allow-all built-in baseline so RBAC
    // and bundle narrowing behave exactly as before.
    builtinProvider: new BuiltinAuthorizationKernelProvider({
      resolveRelationshipRules: resolveDefaultBuiltinRelationshipRules,
    }),
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

export * from '@alga-psa/authorization/kernel';
