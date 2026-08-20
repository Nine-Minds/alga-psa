import type {
  AuthorizationEvaluationInput,
  BuiltinAuthorizationProvider,
  BuiltinAuthorizationResult,
  FieldRedactionResult,
  MutationGuardResult,
  RelationshipRule,
} from '../contracts';
import { evaluateRelationshipRules } from '../relationships';
import { ALLOW_ALL_SCOPE, DENY_ALL_SCOPE } from '../scope';

export type BuiltinRelationshipRulesResolver = (
  input: AuthorizationEvaluationInput
) => RelationshipRule[];

/**
 * Default subject-aware built-in relationship rules. Client-portal subjects are
 * scoped to their own client (fail-closed `same_client`); internal subjects
 * retain today's allow-all built-in behavior so RBAC/bundle narrowing keep
 * working unchanged. This is the global default when no explicit
 * `relationshipRules` or `resolveRelationshipRules` option is supplied.
 */
export function resolveDefaultBuiltinRelationshipRules(
  input: AuthorizationEvaluationInput
): RelationshipRule[] {
  if (input.subject.userType === 'client') {
    return [{ template: 'same_client' }];
  }
  return [];
}

export interface BuiltinProviderConfig {
  relationshipRules?: RelationshipRule[];
  resolveRelationshipRules?: BuiltinRelationshipRulesResolver;
  mutationGuards?: Array<(input: AuthorizationEvaluationInput) => MutationGuardResult | Promise<MutationGuardResult>>;
  fieldRedactionResolver?: (input: AuthorizationEvaluationInput) => string[] | Promise<string[]>;
}

export class BuiltinAuthorizationKernelProvider implements BuiltinAuthorizationProvider {
  private readonly relationshipRules: RelationshipRule[] | null;
  private readonly resolveRelationshipRules: BuiltinRelationshipRulesResolver | null;
  private readonly mutationGuards: Array<
    (input: AuthorizationEvaluationInput) => MutationGuardResult | Promise<MutationGuardResult>
  >;
  private readonly fieldRedactionResolver?: (input: AuthorizationEvaluationInput) => string[] | Promise<string[]>;

  constructor(config: BuiltinProviderConfig = {}) {
    this.relationshipRules = config.relationshipRules ?? null;
    this.resolveRelationshipRules = config.resolveRelationshipRules ?? null;
    this.mutationGuards = config.mutationGuards ?? [];
    this.fieldRedactionResolver = config.fieldRedactionResolver;
  }

  private resolveRules(input: AuthorizationEvaluationInput): RelationshipRule[] {
    if (this.resolveRelationshipRules) {
      return this.resolveRelationshipRules(input);
    }
    if (this.relationshipRules !== null) {
      return this.relationshipRules;
    }
    return resolveDefaultBuiltinRelationshipRules(input);
  }

  private sameClientRuleActive(rules: RelationshipRule[]): boolean {
    return rules.some((rule) => rule.template === 'same_client');
  }

  async evaluate(input: AuthorizationEvaluationInput): Promise<BuiltinAuthorizationResult> {
    const rules = this.resolveRules(input);

    if (!input.record) {
      // Scope-only evaluation. A client subject with the same_client rule must
      // never produce an unconstrained allow: constrain to the subject's client
      // when known, deny when it is missing.
      if (this.sameClientRuleActive(rules) && input.subject.userType === 'client') {
        if (input.subject.clientId) {
          return {
            allowed: true,
            scope: {
              allowAll: false,
              denied: false,
              constraints: [{ field: 'client_id', operator: 'eq', value: input.subject.clientId }],
            },
            reasons: [
              {
                stage: 'builtin',
                sourceType: 'builtin',
                code: 'builtin_client_scope',
                message: 'Client subject scoped to its own client records.',
                metadata: { clientId: input.subject.clientId },
              },
            ],
          };
        }

        return {
          allowed: false,
          scope: DENY_ALL_SCOPE,
          reasons: [
            {
              stage: 'builtin',
              sourceType: 'builtin',
              code: 'builtin_client_scope_missing',
              message: 'Client subject has no resolvable client scope; denying.',
            },
          ],
        };
      }

      return {
        allowed: true,
        scope: ALLOW_ALL_SCOPE,
        reasons: [
          {
            stage: 'builtin',
            sourceType: 'builtin',
            code: 'builtin_no_record_scope',
            message: 'No record context was provided; builtin rules did not further narrow scope.',
          },
        ],
      };
    }

    const relationshipResult = evaluateRelationshipRules(rules, input);

    if (!relationshipResult.allowed) {
      return {
        allowed: false,
        scope: DENY_ALL_SCOPE,
        reasons: relationshipResult.reasons,
      };
    }

    return {
      allowed: true,
      scope: relationshipResult.scope,
      reasons: relationshipResult.reasons,
    };
  }

  async authorizeMutation(input: AuthorizationEvaluationInput): Promise<MutationGuardResult> {
    for (const guard of this.mutationGuards) {
      const result = await guard(input);
      if (!result.allowed) {
        return result;
      }
    }

    return {
      allowed: true,
      reasons: [
        {
          stage: 'mutation',
          sourceType: 'builtin',
          code: 'mutation_guards_passed',
          message: 'Built-in mutation guards passed.',
        },
      ],
    };
  }

  async resolveFieldRedactions(input: AuthorizationEvaluationInput): Promise<FieldRedactionResult> {
    const fields = (await this.fieldRedactionResolver?.(input)) ?? [];

    return {
      fields,
      reasons:
        fields.length > 0
          ? [
              {
                stage: 'redaction',
                sourceType: 'builtin',
                code: 'builtin_redaction_applied',
                message: 'Built-in field redaction rules were applied.',
                metadata: { fields },
              },
            ]
          : [],
    };
  }
}
