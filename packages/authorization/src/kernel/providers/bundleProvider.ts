import type {
  AuthorizationEvaluationInput,
  AuthorizationReason,
  BundleAuthorizationProvider,
  BundleAuthorizationResult,
  RelationshipTemplateKey,
  ScopeConstraint,
} from '../contracts';
import { ALLOW_ALL_SCOPE, DENY_ALL_SCOPE } from '../scope';
import { evaluateRelationshipTemplate } from '../relationshipTemplates';
import { isSelfApprovalBlocked } from '../selfApproval';
import { matchRulesForAction } from '../actionAliases';

export const BUNDLE_CLOSED_BASELINE_DENIED_CODE = 'bundle_closed_baseline_denied';
export const BUNDLE_TEMPLATE_DENIED_CODE = 'bundle_template_denied';
export const BUNDLE_PORTFOLIO_DENIED_CODE = 'bundle_portfolio_denied';
export const CLIENT_VISIBLE_ONLY_DENIED_CODE = 'client_visible_only_denied';

export interface BundleNarrowingRule {
  id: string;
  /** Owning bundle and published revision. Absent on hand-built rules. */
  bundleId?: string;
  revisionId?: string;
  /** The owning revision's baseline. Absent means 'open'. */
  baseline?: 'open' | 'closed';
  resource: string;
  action: string;
  templateKey?: RelationshipTemplateKey | null;
  constraintKey?: string | null;
  constraints?: ScopeConstraint[];
  redactedFields?: string[];
  selectedClientIds?: string[];
  selectedBoardIds?: string[];
}

export interface BundleProviderConfig {
  resolveRules: (input: AuthorizationEvaluationInput) => Promise<BundleNarrowingRule[]>;
}

function buildReasons(rules: BundleNarrowingRule[]): AuthorizationReason[] {
  if (rules.length === 0) {
    return [];
  }

  return [
    {
      stage: 'bundle',
      sourceType: 'bundle',
      code: 'bundle_narrowing_applied',
      message: 'Bundle-based narrowing rules were applied as intersections.',
      metadata: {
        ruleIds: rules.map((rule) => rule.id),
      },
    },
  ];
}

function evaluateTemplateForRule(
  rule: BundleNarrowingRule,
  input: AuthorizationEvaluationInput
): boolean {
  if (!rule.templateKey) {
    return true;
  }

  const ruleScopedInput: AuthorizationEvaluationInput = {
    ...input,
    selectedClientIds:
      rule.templateKey === 'selected_clients' ? (rule.selectedClientIds ?? []) : input.selectedClientIds,
    selectedBoardIds:
      rule.templateKey === 'selected_boards' ? (rule.selectedBoardIds ?? []) : input.selectedBoardIds,
  };

  return evaluateRelationshipTemplate(rule.templateKey as RelationshipTemplateKey, ruleScopedInput);
}

/**
 * Closed bundles are the bundles whose rules carry baseline 'closed'. The provider derives them from the
 * rule list it already receives: publishBundleRevision refuses an empty revision, so a published closed
 * revision always has at least one rule and therefore always shows up here. (Pinned by closedBaseline.matrix.test.ts.)
 * Therefore a `resolveRules` implementation must return the subject's full assigned rule set, unfiltered; filtering
 * rules out makes a closed bundle look like it does not name a resource (false deny) or hides it (false allow).
 * To neutralise a rule, keep it and change it (e.g. `templateKey: null`) instead of dropping it.
 * A rule with no bundleId cannot be attributed to a bundle and is never treated as closed.
 */
function groupClosedBundles(rules: BundleNarrowingRule[]): Map<string, BundleNarrowingRule[]> {
  const closed = new Map<string, BundleNarrowingRule[]>();
  for (const rule of rules) {
    if (rule.baseline !== 'closed' || !rule.bundleId) continue;
    const group = closed.get(rule.bundleId);
    if (group) group.push(rule);
    else closed.set(rule.bundleId, [rule]);
  }
  return closed;
}

function closedBaselineReasons(
  rules: BundleNarrowingRule[],
  input: AuthorizationEvaluationInput
): AuthorizationReason[] {
  const reasons: AuthorizationReason[] = [];
  for (const [bundleId, bundleRules] of groupClosedBundles(rules)) {
    if (matchRulesForAction(bundleRules, input.resource.type, input.resource.action).length > 0) continue;
    reasons.push({
      stage: 'bundle',
      sourceType: 'bundle',
      sourceId: bundleId,
      code: BUNDLE_CLOSED_BASELINE_DENIED_CODE,
      message: 'Closed bundle does not name this resource and action; access is denied.',
      metadata: {
        bundleId,
        revisionId: bundleRules.find((rule) => rule.revisionId)?.revisionId ?? null,
        resource: input.resource.type,
        action: input.resource.action,
      },
    });
  }
  return reasons;
}

function ruleDenialReason(
  code: string,
  message: string,
  denying: BundleNarrowingRule[],
  input: AuthorizationEvaluationInput
): AuthorizationReason {
  return {
    stage: 'bundle',
    sourceType: 'bundle',
    sourceId: denying[0]?.id,
    code,
    message,
    metadata: {
      ruleIds: denying.map((rule) => rule.id),
      bundleIds: [...new Set(denying.map((rule) => rule.bundleId).filter((v): v is string => Boolean(v)))],
      resource: input.resource.type,
      action: input.resource.action,
    },
  };
}

export class BundleAuthorizationKernelProvider implements BundleAuthorizationProvider {
  private readonly resolveRules: BundleProviderConfig['resolveRules'];

  constructor(config: BundleProviderConfig) {
    this.resolveRules = config.resolveRules;
  }

  async evaluateNarrowing(input: AuthorizationEvaluationInput): Promise<BundleAuthorizationResult> {
    const rules = await this.resolveRules(input);
    const matchingRules = matchRulesForAction(rules, input.resource.type, input.resource.action);
    const closedReasons = closedBaselineReasons(rules, input);

    if (matchingRules.length === 0) {
      if (closedReasons.length > 0) {
        return {
          scope: DENY_ALL_SCOPE,
          reasons: closedReasons,
          mutationDeniedReason: null,
          redactedFields: [],
        };
      }
      return {
        scope: ALLOW_ALL_SCOPE,
        reasons: [],
        mutationDeniedReason: null,
        redactedFields: [],
      };
    }

    const clientVisibleOnlyRules = matchingRules.filter(
      (rule) => rule.constraintKey === 'client_visible_only' && input.record?.is_client_visible !== true
    );
    const hasClientVisibleOnlyViolation = clientVisibleOnlyRules.length > 0;

    const templateMismatchRules = matchingRules.filter(
      (rule) =>
        Boolean(rule.templateKey) &&
        input.record !== undefined &&
        !evaluateTemplateForRule(rule, input)
    );
    const hasTemplateMismatch = templateMismatchRules.length > 0;
    const portfolioMismatchRules = templateMismatchRules.filter((rule) => rule.templateKey === 'client_portfolio');

    const notSelfApproverViolation = matchingRules.some(
      (rule) => rule.constraintKey === 'not_self_approver' && isSelfApprovalBlocked(input)
    );

    return {
      scope: {
        allowAll: false,
        denied: hasClientVisibleOnlyViolation || hasTemplateMismatch || closedReasons.length > 0,
        constraints: matchingRules.flatMap((rule) => rule.constraints ?? []),
      },
      reasons: [
        ...buildReasons(matchingRules),
        ...(templateMismatchRules.length > 0
          ? [
              ruleDenialReason(
                BUNDLE_TEMPLATE_DENIED_CODE,
                'Bundle relationship template narrowing denied access.',
                templateMismatchRules,
                input
              ),
            ]
          : []),
        ...(portfolioMismatchRules.length > 0
          ? [
              ruleDenialReason(
                BUNDLE_PORTFOLIO_DENIED_CODE,
                'Bundle client portfolio narrowing denied access.',
                portfolioMismatchRules,
                input
              ),
            ]
          : []),
        ...(hasClientVisibleOnlyViolation
          ? [
              ruleDenialReason(
                CLIENT_VISIBLE_ONLY_DENIED_CODE,
                'Bundle client-visible-only guard denied access.',
                clientVisibleOnlyRules,
                input
              ),
            ]
          : []),
        ...closedReasons,
      ],
      mutationDeniedReason: notSelfApproverViolation
        ? {
            stage: 'mutation',
            sourceType: 'bundle',
            code: 'not_self_approver_denied',
            message: 'Bundle not-self-approver guard denied this mutation.',
          }
        : null,
      redactedFields: matchingRules.flatMap((rule) => rule.redactedFields ?? []),
    };
  }
}
