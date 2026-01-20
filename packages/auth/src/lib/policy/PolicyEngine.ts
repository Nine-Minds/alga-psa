import type { IUserWithRoles, IPolicy, ICondition, IRole } from '@alga-psa/types';
import { USER_ATTRIBUTES, TICKET_ATTRIBUTES, UserAttributeKey, TicketAttributeKey } from '../attributes/EntityAttributes';

export class PolicyEngine {
  private policies: IPolicy[] = [];

  addPolicy(policy: IPolicy): void {
    this.policies.push(policy);
  }

  removePolicy(policy: IPolicy): void {
    this.policies = this.policies.filter(p => p.policy_id !== policy.policy_id);
  }

  evaluateAccess(user: IUserWithRoles, resource: any, action: string): boolean {
    for (const policy of this.policies) {
      if (policy.resource === resource.constructor.name && policy.action === action) {
        if (this.evaluateConditions(user, resource, policy.conditions)) {
          return true;
        }
      }
    }
    return false;
  }

  private evaluateConditions(user: IUserWithRoles, resource: any, conditions: ICondition[]): boolean {
    return conditions.every(condition => {
      const userAttribute = condition.userAttribute as UserAttributeKey;
      const userValue = USER_ATTRIBUTES[userAttribute].getValue(user);
      const resourceValue = TICKET_ATTRIBUTES[condition.resourceAttribute as TicketAttributeKey].getValue(resource);

      // Special handling for roles
      if (userAttribute === 'roles' as UserAttributeKey) {
        switch (condition.operator) {
          case 'contains':
            return (userValue as IRole[]).some(role => role.role_name === resourceValue as string);
          case 'not contains':
            return !(userValue as IRole[]).some(role => role.role_name === resourceValue as string);
          default:
            return false;
        }
      }

      // Regular comparisons for other attributes
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
        default:
          return false;
      }
    });
  }
}
