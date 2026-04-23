import type {
  AuthorizationEvaluationInput,
  AuthorizationReason,
  AuthorizationScope,
  RelationshipRule,
  RelationshipTemplateKey,
} from './contracts';
import { DENY_ALL_SCOPE } from './scope';

function hasIntersection(left: string[] = [], right: string[] = []): boolean {
  if (left.length === 0 || right.length === 0) {
    return false;
  }
  const rightSet = new Set(right);
  return left.some((item) => rightSet.has(item));
}

export function evaluateRelationshipTemplate(
  template: RelationshipTemplateKey,
  input: AuthorizationEvaluationInput
): boolean {
  const record = input.record;
  if (!record) {
    return false;
  }

  switch (template) {
    case 'own':
      return typeof record.ownerUserId === 'string' && record.ownerUserId === input.subject.userId;
    case 'assigned':
      return Array.isArray(record.assignedUserIds) && record.assignedUserIds.includes(input.subject.userId);
    case 'managed':
      return Array.isArray(record.assignedUserIds) && hasIntersection(record.assignedUserIds, input.subject.managedUserIds);
    case 'own_or_assigned':
      return (
        (typeof record.ownerUserId === 'string' && record.ownerUserId === input.subject.userId) ||
        (Array.isArray(record.assignedUserIds) && record.assignedUserIds.includes(input.subject.userId))
      );
    case 'own_or_managed':
      return (
        (typeof record.ownerUserId === 'string' && record.ownerUserId === input.subject.userId) ||
        (Array.isArray(record.assignedUserIds) && hasIntersection(record.assignedUserIds, input.subject.managedUserIds))
      );
    case 'same_client':
      return Boolean(record.clientId && input.subject.clientId && record.clientId === input.subject.clientId);
    case 'client_portfolio':
      return Boolean(record.clientId && input.subject.portfolioClientIds?.includes(record.clientId));
    case 'selected_clients':
      return Boolean(record.clientId && input.selectedClientIds?.includes(record.clientId));
    case 'same_team':
      return hasIntersection(record.teamIds, input.subject.teamIds);
    case 'selected_boards':
      return Boolean(record.boardId && input.selectedBoardIds?.includes(record.boardId));
    default:
      return false;
  }
}

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
