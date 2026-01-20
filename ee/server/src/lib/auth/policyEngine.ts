import { IResource, IPolicy, ICondition, IRole, IUserWithRoles } from '@/interfaces/auth.interfaces';
import { USER_ATTRIBUTES, UserAttributeKey } from '@/lib/attributes/EntityAttributes';
import { hasPermission } from '@alga-psa/auth';
import { Policy } from './abac';

export class PolicyEngine {
  private policies: Policy[] = [];

  addPolicy(policy: IPolicy) {
    this.policies.push(new Policy(
      policy.policy_id,
      policy.policy_name,
      policy.resource,
      policy.action,
      policy.conditions
    ));
  }

  removePolicy(policy: IPolicy) {
    this.policies = this.policies.filter(p => p.policy_id !== policy.policy_id);
  }

  async evaluateAccess(user: IUserWithRoles, resource: IResource, action: string): Promise<boolean> {
    // First, check RBAC permissions
    if (!await hasPermission(user, resource.type, action)) {
      return false;
    }

    // If RBAC check passes, evaluate ABAC policies
    return this.policies
      .filter(policy => policy.resource === resource.type && policy.action === action)
      .every(policy => policy.evaluate(user, resource, action));
  }

  private evaluateCondition(condition: ICondition, user: IUserWithRoles, resource: IResource): boolean {
    const userAttribute = condition.userAttribute as UserAttributeKey;
    const userValue = USER_ATTRIBUTES[userAttribute].getValue(user);
    const resourceValue = resource.attributes.get(condition.resourceAttribute as string);

    switch (condition.operator) {
      case '==':
        return userValue === resourceValue;
      case '!=':
        return userValue !== resourceValue;
      case '>':
        return userValue > resourceValue;
      case '<':
        return userValue < resourceValue;
      case '>=':
        return userValue >= resourceValue;
      case '<=':
        return userValue <= resourceValue;
      case 'contains':
        if (userAttribute === 'roles') {
          return (userValue as IRole[]).some(role => role.role_name === resourceValue);
        }
        return Array.isArray(userValue) && userValue.includes(resourceValue);
      case 'not contains':
        if (userAttribute === 'roles') {
          return !(userValue as IRole[]).some(role => role.role_name === resourceValue);
        }
        return Array.isArray(userValue) && !userValue.includes(resourceValue);
      default:
        return false;
    }
  }
}
