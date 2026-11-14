import type { Knex } from 'knex';
import type {
  AuthorizationEvaluationInput,
  AuthorizationReason,
  BundleAuthorizationProvider,
  BundleAuthorizationResult,
} from '../kernel/contracts';
import { BundleAuthorizationKernelProvider } from '../kernel/providers/bundleProvider';
import { DENY_ALL_SCOPE } from '../kernel/scope';
import { resolveBundleNarrowingRulesForEvaluation } from './service';

export const BUNDLE_RULES_UNAVAILABLE_CODE = 'bundle_rules_unavailable';

function rulesUnavailableReason(input: AuthorizationEvaluationInput): AuthorizationReason {
  return {
    stage: 'bundle',
    sourceType: 'system',
    code: BUNDLE_RULES_UNAVAILABLE_CODE,
    message: 'Bundle narrowing rules could not be loaded; access is denied.',
    metadata: {
      resource: input.resource.type,
      action: input.resource.action,
    },
  };
}

/**
 * The bundle provider for a kernel that reads its narrowing rules from the database.
 *
 * Bundle rules only ever narrow what RBAC granted, so "no rules" means "unrestricted". A failed load is
 * therefore never treated as an empty rule set: the evaluation is denied, with a reason that names the
 * fault. The fault is logged once per provider (one provider serves one request's decisions).
 */
export function createBundleNarrowingProvider(conn: Knex | Knex.Transaction): BundleAuthorizationProvider {
  let faultLogged = false;

  return {
    async evaluateNarrowing(input: AuthorizationEvaluationInput): Promise<BundleAuthorizationResult> {
      let rules: Awaited<ReturnType<typeof resolveBundleNarrowingRulesForEvaluation>>;
      try {
        rules = await resolveBundleNarrowingRulesForEvaluation(conn, input);
      } catch (error) {
        if (!faultLogged) {
          faultLogged = true;
          console.error(
            `[authorization] Failed to load bundle narrowing rules for ${input.resource.type}:${input.resource.action}; denying access.`,
            error
          );
        }
        return {
          scope: DENY_ALL_SCOPE,
          reasons: [rulesUnavailableReason(input)],
          mutationDeniedReason: null,
          redactedFields: [],
        };
      }

      return new BundleAuthorizationKernelProvider({ resolveRules: async () => rules }).evaluateNarrowing(input);
    },
  };
}
