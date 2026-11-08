import type {
  AuthorizationKernel,
  AuthorizationKernelFactoryInput,
  RbacEvaluator,
} from '../kernel/contracts';
import { createAuthorizationKernel } from '../kernel/engine';
import { hasPermission } from '../rbac';
import { getAuthorizationRbacPermission } from '../bundles/resourceActions';

export const defaultRbacEvaluator: RbacEvaluator = async (input) => {
  const permission = getAuthorizationRbacPermission(input.resource.type, input.resource.action);
  return hasPermission(
    {
      tenant: input.subject.tenant,
      user_id: input.subject.userId,
      user_type: input.subject.userType,
    },
    permission.resource,
    permission.action,
    input.knex
  );
};

export function createAuthorizationKernelWithDefaultRbac(
  input: Omit<AuthorizationKernelFactoryInput, 'rbacEvaluator'> & Partial<Pick<AuthorizationKernelFactoryInput, 'rbacEvaluator'>>
): AuthorizationKernel {
  return createAuthorizationKernel({
    ...input,
    rbacEvaluator: input.rbacEvaluator ?? defaultRbacEvaluator,
  });
}
