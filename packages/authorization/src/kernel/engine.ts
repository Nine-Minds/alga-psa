import type {
  AuthorizationDecision,
  AuthorizationEvaluationInput,
  AuthorizationKernel,
  AuthorizationKernelFactoryInput,
  AuthorizationMutationDecision,
  AuthorizationReason,
  AuthorizationScope,
  RbacEvaluator,
} from './contracts';
import { prerequisiteActionsFor } from './actionAliases';
import { getRequestCache } from './requestCache';
import { intersectAuthorizationScopes } from './scope';

function createRbacDeniedReasons(input: AuthorizationEvaluationInput): AuthorizationReason[] {
  return [
    {
      stage: 'rbac',
      sourceType: 'system',
      code: 'rbac_denied',
      message: 'RBAC denied access for this resource action.',
      metadata: {
        resource: input.resource.type,
        action: input.resource.action,
      },
    },
  ];
}

function createRbacAllowedReasons(input: AuthorizationEvaluationInput): AuthorizationReason[] {
  return [
    {
      stage: 'rbac',
      sourceType: 'system',
      code: 'rbac_allowed',
      message: 'RBAC allowed access; narrowing checks will now run.',
      metadata: {
        resource: input.resource.type,
        action: input.resource.action,
      },
    },
  ];
}

type RuleProviders = Pick<AuthorizationKernelFactoryInput, 'builtinProvider' | 'bundleProvider'>;

interface RecordRulesResult extends Pick<AuthorizationDecision, 'allowed' | 'scope' | 'redactedFields' | 'reasons'> {
  /** Set when a bundle guard refuses the mutation carried by the input; null otherwise. */
  mutationDeniedReason: AuthorizationReason | null;
}

interface CoreEvaluation {
  decision: AuthorizationDecision;
  mutationDeniedReason: AuthorizationReason | null;
}

/**
 * The record-level rules for one resource action: built-in relationship rules
 * intersected with bundle narrowing. RBAC is not consulted here; this is what a
 * subject's rules say about the record, independent of the coarse permission.
 */
async function evaluateRecordRules(
  input: AuthorizationEvaluationInput,
  deps: RuleProviders
): Promise<RecordRulesResult> {
  const builtinResult = await deps.builtinProvider.evaluate(input);
  const bundleResult = deps.bundleProvider
    ? await deps.bundleProvider.evaluateNarrowing(input)
    : null;

  const scope = intersectAuthorizationScopes(
    builtinResult.scope,
    bundleResult?.scope ?? { allowAll: true, denied: false, constraints: [] }
  );

  return {
    allowed: builtinResult.allowed && !scope.denied,
    scope,
    redactedFields: [...(bundleResult?.redactedFields ?? [])],
    reasons: [...builtinResult.reasons, ...(bundleResult?.reasons ?? [])],
    mutationDeniedReason: bundleResult?.mutationDeniedReason ?? null,
  };
}

/**
 * Evaluates the subject's record rules for every action the requested action
 * presupposes (see `prerequisiteActionsFor`). Returns the reasons for the first
 * prerequisite that denies, or null when all of them allow. Only the verdict
 * matters: a prerequisite's scope and redactions do not shape the mutation.
 */
async function findDeniedPrerequisite(
  input: AuthorizationEvaluationInput,
  deps: RuleProviders
): Promise<AuthorizationReason[] | null> {
  for (const requiredAction of prerequisiteActionsFor(input.resource.action)) {
    const { mutation: _mutation, ...recordInput } = input;
    const required = await evaluateRecordRules(
      { ...recordInput, resource: { ...input.resource, action: requiredAction } },
      deps
    );
    if (!required.allowed) {
      return [
        ...required.reasons,
        {
          stage: 'mutation',
          sourceType: 'system',
          code: 'prerequisite_action_denied',
          message: `The subject's ${requiredAction} rules deny this record, so ${input.resource.action} is refused.`,
          metadata: {
            resource: input.resource.type,
            action: input.resource.action,
            requiredAction,
          },
        },
      ];
    }
  }
  return null;
}

async function evaluateCore(
  input: AuthorizationEvaluationInput,
  deps: Pick<AuthorizationKernelFactoryInput, 'builtinProvider' | 'bundleProvider' | 'rbacEvaluator'>
): Promise<CoreEvaluation> {
  const requestCache = getRequestCache(input.requestCache);

  const hasRbacAccess = await requestCache.getOrLoad(
    // A consolidated request can evaluate several tenant-qualified principals.
    // Reusing only userId would carry an MSP's grant into another workspace.
    `rbac:${JSON.stringify([input.subject, input.resource.type, input.resource.action])}`,
    () => deps.rbacEvaluator(input)
  );

  if (!hasRbacAccess) {
    return {
      decision: {
        allowed: false,
        scope: {
          allowAll: false,
          denied: true,
          constraints: [],
        },
        redactedFields: [],
        reasons: createRbacDeniedReasons(input),
      },
      mutationDeniedReason: null,
    };
  }

  const rules = await evaluateRecordRules(input, deps);
  const redactionResult = await deps.builtinProvider.resolveFieldRedactions(input);

  return {
    decision: {
      allowed: rules.allowed,
      scope: rules.scope,
      redactedFields: [...new Set([...redactionResult.fields, ...rules.redactedFields])],
      reasons: [
        ...createRbacAllowedReasons(input),
        ...rules.reasons,
        ...redactionResult.reasons,
      ],
    },
    mutationDeniedReason: rules.mutationDeniedReason,
  };
}

function tagReasons(reasons: AuthorizationReason[], subjectUserId: string): AuthorizationReason[] {
  return reasons.map((reason) => ({ ...reason, subjectUserId }));
}

function combineDecisions(
  primary: AuthorizationDecision,
  joint: AuthorizationDecision,
  primaryUserId: string,
  jointUserId: string
): AuthorizationDecision {
  return {
    allowed: primary.allowed && joint.allowed,
    scope:
      primary.scope.allowAll && joint.scope.allowAll
        ? { ...primary.scope }
        : intersectAuthorizationScopes(primary.scope, joint.scope),
    redactedFields: [...new Set([...primary.redactedFields, ...joint.redactedFields])],
    reasons: [...tagReasons(primary.reasons, primaryUserId), ...tagReasons(joint.reasons, jointUserId)],
  };
}

function combineMutationDecisions(
  primary: AuthorizationMutationDecision,
  joint: AuthorizationMutationDecision,
  primaryUserId: string,
  jointUserId: string
): AuthorizationMutationDecision {
  return {
    allowed: primary.allowed && joint.allowed,
    reasons: [...tagReasons(primary.reasons, primaryUserId), ...tagReasons(joint.reasons, jointUserId)],
  };
}

class DefaultAuthorizationKernel implements AuthorizationKernel {
  private readonly builtinProvider: AuthorizationKernelFactoryInput['builtinProvider'];
  private readonly bundleProvider: AuthorizationKernelFactoryInput['bundleProvider'];
  private readonly rbacEvaluator: RbacEvaluator;

  constructor(input: AuthorizationKernelFactoryInput) {
    this.builtinProvider = input.builtinProvider;
    this.bundleProvider = input.bundleProvider;
    this.rbacEvaluator = input.rbacEvaluator;
  }

  async authorizeResource(input: AuthorizationEvaluationInput): Promise<AuthorizationDecision> {
    if (input.jointSubject) {
      return this.authorizeJointly(input, (subjectInput) => this.authorizeResource(subjectInput), combineDecisions);
    }
    return (await this.evaluate(input)).decision;
  }

  private evaluate(input: AuthorizationEvaluationInput): Promise<CoreEvaluation> {
    return evaluateCore(input, {
      builtinProvider: this.builtinProvider,
      bundleProvider: this.bundleProvider,
      rbacEvaluator: this.rbacEvaluator,
    });
  }

  /**
   * Evaluates the primary and the joint subject independently through the
   * single-subject path (same record, resource and mutation input) and combines
   * the two results. Both are always evaluated so the reasons record the rules
   * run for each subject.
   */
  private async authorizeJointly<T>(
    input: AuthorizationEvaluationInput,
    evaluate: (subjectInput: AuthorizationEvaluationInput) => Promise<T>,
    combine: (primary: T, joint: T, primaryUserId: string, jointUserId: string) => T
  ): Promise<T> {
    const { jointSubject, ...primaryInput } = input;
    const primary = await evaluate(primaryInput);
    const joint = await evaluate({ ...primaryInput, subject: jointSubject! });
    return combine(primary, joint, input.subject.userId, jointSubject!.userId);
  }

  async resolveScope(input: AuthorizationEvaluationInput): Promise<AuthorizationScope> {
    const decision = await this.authorizeResource(input);
    return decision.scope;
  }

  async authorizeMutation(input: AuthorizationEvaluationInput): Promise<AuthorizationMutationDecision> {
    if (input.jointSubject) {
      return this.authorizeJointly(input, (subjectInput) => this.authorizeMutation(subjectInput), combineMutationDecisions);
    }
    const prerequisiteDenial = await findDeniedPrerequisite(input, {
      builtinProvider: this.builtinProvider,
      bundleProvider: this.bundleProvider,
    });
    if (prerequisiteDenial) {
      return {
        allowed: false,
        reasons: prerequisiteDenial,
      };
    }

    // One evaluation of the requested action yields both the record decision and
    // any bundle guard on the mutation, so the subject's rules are loaded once.
    const { decision: resourceDecision, mutationDeniedReason } = await this.evaluate(input);
    if (!resourceDecision.allowed) {
      return {
        allowed: false,
        reasons: resourceDecision.reasons,
      };
    }

    const mutationDecision = await this.builtinProvider.authorizeMutation(input);
    if (!mutationDecision.allowed) {
      return {
        allowed: false,
        reasons: [...resourceDecision.reasons, ...mutationDecision.reasons],
      };
    }

    if (mutationDeniedReason) {
      return {
        allowed: false,
        reasons: [...resourceDecision.reasons, ...mutationDecision.reasons, mutationDeniedReason],
      };
    }

    return {
      allowed: true,
      reasons: [...resourceDecision.reasons, ...mutationDecision.reasons],
    };
  }

  async resolveFieldRedactions(input: AuthorizationEvaluationInput): Promise<string[]> {
    const decision = await this.authorizeResource(input);
    return decision.redactedFields;
  }

  async explainDecision(input: AuthorizationEvaluationInput): Promise<AuthorizationReason[]> {
    const decision = await this.authorizeResource(input);
    return decision.reasons;
  }
}

export function createAuthorizationKernel(input: AuthorizationKernelFactoryInput): AuthorizationKernel {
  return new DefaultAuthorizationKernel(input);
}
