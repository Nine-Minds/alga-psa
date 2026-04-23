import { hasPermission } from '../rbac';
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

async function defaultRbacEvaluator(input: AuthorizationEvaluationInput): Promise<boolean> {
  return hasPermission(
    {
      tenant: input.subject.tenant,
      user_id: input.subject.userId,
      user_type: input.subject.userType,
    },
    input.resource.type,
    input.resource.action,
    input.knex
  );
}

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
    `rbac:${input.subject.userId}:${input.resource.type}:${input.resource.action}`,
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
    return evaluateCore(input, {
      builtinProvider: this.builtinProvider,
      bundleProvider: this.bundleProvider,
      rbacEvaluator: this.rbacEvaluator,
    });
  }

  async resolveScope(input: AuthorizationEvaluationInput): Promise<AuthorizationScope> {
    const decision = await this.authorizeResource(input);
    return decision.scope;
  }

  async authorizeMutation(input: AuthorizationEvaluationInput): Promise<AuthorizationMutationDecision> {
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

export function createAuthorizationKernel(input: Partial<AuthorizationKernelFactoryInput> & Pick<AuthorizationKernelFactoryInput, 'builtinProvider'>): AuthorizationKernel {
  return new DefaultAuthorizationKernel({
    builtinProvider: input.builtinProvider,
    bundleProvider: input.bundleProvider,
    rbacEvaluator: input.rbacEvaluator ?? defaultRbacEvaluator,
  });
}
