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

async function evaluateCore(
  input: AuthorizationEvaluationInput,
  deps: Pick<AuthorizationKernelFactoryInput, 'builtinProvider' | 'bundleProvider' | 'rbacEvaluator'>
): Promise<AuthorizationDecision> {
  const requestCache = getRequestCache(input.requestCache);

  const hasRbacAccess = await requestCache.getOrLoad(
    // A consolidated request can evaluate several tenant-qualified principals.
    // Reusing only userId would carry an MSP's grant into another workspace.
    `rbac:${JSON.stringify([input.subject, input.resource.type, input.resource.action])}`,
    () => deps.rbacEvaluator(input)
  );

  if (!hasRbacAccess) {
    return {
      allowed: false,
      scope: {
        allowAll: false,
        denied: true,
        constraints: [],
      },
      redactedFields: [],
      reasons: createRbacDeniedReasons(input),
    };
  }

  const builtinResult = await deps.builtinProvider.evaluate(input);
  const bundleResult = deps.bundleProvider
    ? await deps.bundleProvider.evaluateNarrowing(input)
    : {
        scope: {
          allowAll: true,
          denied: false,
          constraints: [],
        },
        reasons: [] as AuthorizationReason[],
      };
  const redactionResult = await deps.builtinProvider.resolveFieldRedactions(input);

  const scope = intersectAuthorizationScopes(builtinResult.scope, bundleResult.scope);

  return {
    allowed: builtinResult.allowed && !scope.denied,
    scope,
    redactedFields: [...new Set([...redactionResult.fields, ...(bundleResult.redactedFields ?? [])])],
    reasons: [
      ...createRbacAllowedReasons(input),
      ...builtinResult.reasons,
      ...bundleResult.reasons,
      ...redactionResult.reasons,
    ],
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
    const resourceDecision = await this.authorizeResource(input);
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

    const bundleMutation = this.bundleProvider
      ? await this.bundleProvider.evaluateNarrowing(input)
      : null;

    if (bundleMutation?.mutationDeniedReason) {
      return {
        allowed: false,
        reasons: [...resourceDecision.reasons, ...mutationDecision.reasons, bundleMutation.mutationDeniedReason],
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
