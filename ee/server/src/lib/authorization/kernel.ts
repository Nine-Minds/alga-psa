import {
  type AuthorizationEvaluationInput,
  type AuthorizationKernel,
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
} from '@alga-psa/authorization/kernel';
import { createAuthorizationKernelWithDefaultRbac } from '@alga-psa/authorization/adapters/rbac';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';

async function resolveBundleNarrowingRules(input: AuthorizationEvaluationInput) {
  const cache = input.requestCache;
  const key = `bundle-rules:${input.subject.tenant}:${input.subject.userId}:${input.subject.apiKeyId ?? 'no-key'}`;

  if (!cache) {
    if (!input.knex) {
      return [];
    }
    return resolveBundleNarrowingRulesForEvaluation(input.knex, input);
  }

  return cache.getOrLoad(key, async () => {
    if (!input.knex) {
      return [];
    }
    return resolveBundleNarrowingRulesForEvaluation(input.knex, input);
  });
}

export function createEnterpriseAuthorizationKernel(): AuthorizationKernel {
  return createAuthorizationKernelWithDefaultRbac({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: resolveBundleNarrowingRules,
    }),
  });
}
