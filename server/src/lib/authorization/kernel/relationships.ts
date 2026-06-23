import type {
  AuthorizationEvaluationInput,
  AuthorizationReason,
  AuthorizationScope,
  RelationshipRule,
} from './contracts';
import { DENY_ALL_SCOPE } from './scope';
import { evaluateRelationshipTemplate } from './relationshipTemplates';

export function evaluateRelationshipRules(
  rules: RelationshipRule[],
  input: AuthorizationEvaluationInput
): { allowed: boolean; scope: AuthorizationScope; reasons: AuthorizationReason[] } {
  if (rules.length === 0) {
    return {
      allowed: true,
      scope: {
        allowAll: true,
        denied: false,
        constraints: [],
      },
      reasons: [],
    };
  }

  const matched = rules.filter((rule) => evaluateRelationshipTemplate(rule.template, input));

  if (matched.length === 0) {
    return {
      allowed: false,
      scope: DENY_ALL_SCOPE,
      reasons: [
        {
          stage: 'builtin',
          sourceType: 'builtin',
          code: 'relationship_rules_denied',
          message: 'No relationship rule matched for this record.',
          metadata: { templates: rules.map((rule) => rule.template) },
        },
      ],
    };
  }

  return {
    allowed: true,
    scope: {
      allowAll: false,
      denied: false,
      constraints: [],
    },
    reasons: [
      {
        stage: 'builtin',
        sourceType: 'builtin',
        code: 'relationship_rules_allowed',
        message: 'Access allowed by built-in relationship templates.',
        metadata: { matchedTemplates: matched.map((rule) => rule.template) },
      },
    ],
  };
}
