import {
  type AuthorizationEvaluationInput,
  type AuthorizationKernel,
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  resolveDefaultBuiltinRelationshipRules,
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
    // Same subject-aware built-in invariant as CE: client subjects resolve to
    // a same_client rule, internal subjects stay unchanged. Enterprise bundle
    // narrowing intersects with the built-in result and can never widen it.
    builtinProvider: new BuiltinAuthorizationKernelProvider({
      resolveRelationshipRules: resolveDefaultBuiltinRelationshipRules,
    }),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: resolveBundleNarrowingRules,
    }),
  });
}
