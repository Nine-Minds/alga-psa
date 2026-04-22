import type {
  AuthorizationEvaluationInput,
  AuthorizationReason,
  BundleAuthorizationProvider,
  BundleAuthorizationResult,
  RelationshipTemplateKey,
  ScopeConstraint,
} from '../contracts';
import { ALLOW_ALL_SCOPE } from '../scope';
import { evaluateRelationshipTemplate } from '../relationships';

export interface BundleNarrowingRule {
  id: string;
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

export class BundleAuthorizationKernelProvider implements BundleAuthorizationProvider {
  private readonly resolveRules: BundleProviderConfig['resolveRules'];

  constructor(config: BundleProviderConfig) {
    this.resolveRules = config.resolveRules;
  }

  async evaluateNarrowing(input: AuthorizationEvaluationInput): Promise<BundleAuthorizationResult> {
    const rules = await this.resolveRules(input);
    const matchingRules = rules.filter(
      (rule) => rule.resource === input.resource.type && rule.action === input.resource.action
    );

    if (matchingRules.length === 0) {
      return {
        scope: ALLOW_ALL_SCOPE,
        reasons: [],
        mutationDeniedReason: null,
        redactedFields: [],
      };
    }

    const hasClientVisibleOnlyViolation = matchingRules.some(
      (rule) => rule.constraintKey === 'client_visible_only' && input.record?.is_client_visible !== true
    );

    const hasTemplateMismatch = matchingRules.some(
      (rule) =>
        Boolean(rule.templateKey) &&
        input.record !== undefined &&
        !evaluateTemplateForRule(rule, input)
    );

    const notSelfApproverViolation = matchingRules.some(
      (rule) =>
        rule.constraintKey === 'not_self_approver' &&
        input.mutation?.kind === 'approve' &&
        typeof input.record?.ownerUserId === 'string' &&
        input.record.ownerUserId === input.subject.userId
    );

    return {
      scope: {
        allowAll: false,
        denied: hasClientVisibleOnlyViolation || hasTemplateMismatch,
        constraints: matchingRules.flatMap((rule) => rule.constraints ?? []),
      },
      reasons: [
        ...buildReasons(matchingRules),
        ...(hasTemplateMismatch
          ? [
              {
                stage: 'bundle' as const,
                sourceType: 'bundle' as const,
                code: 'bundle_template_denied',
                message: 'Bundle relationship template narrowing denied access.',
              },
            ]
          : []),
        ...(hasClientVisibleOnlyViolation
          ? [
              {
                stage: 'bundle' as const,
                sourceType: 'bundle' as const,
                code: 'client_visible_only_denied',
                message: 'Bundle client-visible-only guard denied access.',
              },
            ]
          : []),
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
