import {
  type AuthorizationEvaluationInput,
  type AuthorizationKernel,
  createAuthorizationKernel,
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
} from 'server/src/lib/authorization/kernel';
import { resolveBundleNarrowingRulesForEvaluation } from 'server/src/lib/authorization/bundles/service';

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
  return createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: resolveBundleNarrowingRules,
    }),
  });
}
