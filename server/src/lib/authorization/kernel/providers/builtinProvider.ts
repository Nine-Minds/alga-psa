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

export interface BuiltinProviderConfig {
  relationshipRules?: RelationshipRule[];
  mutationGuards?: Array<(input: AuthorizationEvaluationInput) => MutationGuardResult | Promise<MutationGuardResult>>;
  fieldRedactionResolver?: (input: AuthorizationEvaluationInput) => string[] | Promise<string[]>;
}

export class BuiltinAuthorizationKernelProvider implements BuiltinAuthorizationProvider {
  private readonly relationshipRules: RelationshipRule[];
  private readonly mutationGuards: Array<
    (input: AuthorizationEvaluationInput) => MutationGuardResult | Promise<MutationGuardResult>
  >;
  private readonly fieldRedactionResolver?: (input: AuthorizationEvaluationInput) => string[] | Promise<string[]>;

  constructor(config: BuiltinProviderConfig = {}) {
    this.relationshipRules = config.relationshipRules ?? [];
    this.mutationGuards = config.mutationGuards ?? [];
    this.fieldRedactionResolver = config.fieldRedactionResolver;
  }

  async evaluate(input: AuthorizationEvaluationInput): Promise<BuiltinAuthorizationResult> {
    if (!input.record) {
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

    const relationshipResult = evaluateRelationshipRules(this.relationshipRules, input);

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
