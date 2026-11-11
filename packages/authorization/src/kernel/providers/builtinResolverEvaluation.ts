import type {
  AuthorizationEvaluationInput,
  AuthorizationReason,
  AuthorizationScope,
  BuiltinAuthorizationResult,
} from '../contracts';
import { matchRulesForAction } from '../actionAliases';
import { closedSourcesNotNaming } from '../closedBaseline';
import { clientScopeReadRulesForCreate } from '../candidateRecord';
import { resolveAppliedBuiltinResolvers } from '../builtinRuleResolvers';
import { DENY_ALL_SCOPE, intersectAuthorizationScopes } from '../scope';
import { evaluateTemplateForRule } from './bundleProvider';

export const RESOLVER_NARROWING_APPLIED_CODE = 'resolver_narrowing_applied';
export const RESOLVER_TEMPLATE_DENIED_CODE = 'resolver_template_denied';
export const RESOLVER_CLOSED_BASELINE_DENIED_CODE = 'resolver_closed_baseline_denied';

/**
 * Evaluates every registered resolver that applies to the subject. Returns null when none contributes, so the
 * provider can return its pre-existing result untouched. Several resolvers compose: scopes intersect and any
 * one denial denies.
 */
export function evaluateBuiltinRuleResolvers(input: AuthorizationEvaluationInput): BuiltinAuthorizationResult | null {
  const applied = resolveAppliedBuiltinResolvers(input);
  if (applied.length === 0) return null;

  const resource = input.resource.type;
  const action = input.resource.action;
  const reasons: AuthorizationReason[] = [];
  const scopes: AuthorizationScope[] = [];
  let allowed = true;
  let contributed = false;

  // The same derivation the bundle provider and the SQL compiler use.
  const closedNotNaming = new Set(
    closedSourcesNotNaming(
      applied.filter((resolver) => resolver.baseline === 'closed'),
      resource,
      action
    ).map((resolver) => resolver.id)
  );

  for (const resolver of applied) {
    const matching = [
      ...matchRulesForAction(resolver.rules, resource, action),
      ...clientScopeReadRulesForCreate(resolver.rules, resource, action),
    ];

    if (closedNotNaming.has(resolver.id)) {
      contributed = true;
      allowed = false;
      reasons.push({
        stage: 'builtin',
        sourceType: 'resolver',
        sourceId: resolver.id,
        code: RESOLVER_CLOSED_BASELINE_DENIED_CODE,
        message: 'Closed built-in rule resolver does not name this resource and action; access is denied.',
        metadata: { resolverId: resolver.id, resource, action },
      });
      scopes.push(DENY_ALL_SCOPE);
      continue;
    }
    if (matching.length === 0) continue;

    contributed = true;
    const mismatched = matching.filter(
      (rule) => Boolean(rule.templateKey) && input.record !== undefined && !evaluateTemplateForRule(rule, input)
    );
    reasons.push({
      stage: 'builtin',
      sourceType: 'resolver',
      sourceId: resolver.id,
      code: RESOLVER_NARROWING_APPLIED_CODE,
      message: 'Built-in resolver narrowing rules were applied as intersections.',
      metadata: { resolverId: resolver.id, ruleIds: matching.map((rule) => rule.id) },
    });
    if (mismatched.length > 0) {
      allowed = false;
      scopes.push(DENY_ALL_SCOPE);
      reasons.push({
        stage: 'builtin',
        sourceType: 'resolver',
        sourceId: resolver.id,
        code: RESOLVER_TEMPLATE_DENIED_CODE,
        message: 'Built-in resolver relationship template narrowing denied access.',
        metadata: { resolverId: resolver.id, ruleIds: mismatched.map((rule) => rule.id), resource, action },
      });
    } else {
      scopes.push({ allowAll: false, denied: false, constraints: matching.flatMap((rule) => rule.constraints ?? []) });
    }
  }

  if (!contributed) return null;
  return { allowed, scope: intersectAuthorizationScopes(...scopes), reasons };
}
