import { IUser, IResource, IPolicy, ICondition, IRole, IUserWithRoles } from '@/interfaces/auth.interfaces';
import { USER_ATTRIBUTES, TICKET_ATTRIBUTES, UserAttributeKey, TicketAttributeKey } from '@/lib/attributes/EntityAttributes';

export class Resource implements IResource {
  type: string;
  id: string;
  attributes: Map<string, any>;

  constructor(type: string, id: string, attributes: Record<string, any>) {
    this.type = type;
    this.id = id;
    this.attributes = new Map(Object.entries(attributes));
  }
}

export class Policy implements IPolicy {
  policy_id: string;
  policy_name: string;
  resource: string;
  action: string;
  conditions: ICondition[];

  constructor(policy_id: string, policy_name: string, resource: string, action: string, conditions: ICondition[]) {
    this.policy_id = policy_id;
    this.policy_name = policy_name;
    this.resource = resource;
    this.action = action;
    this.conditions = conditions;
  }

  evaluate(user: IUserWithRoles, resource: IResource, action: string): boolean {
    if (this.resource !== resource.type || this.action !== action) {
      return false;
    }

    return this.conditions.every(condition => this.evaluateCondition(condition, user, resource));
  }

  private evaluateCondition(condition: ICondition, user: IUserWithRoles, resource: IResource): boolean {
    const userValue = USER_ATTRIBUTES[condition.userAttribute].getValue(user);
    const resourceValue = resource.attributes.get(condition.resourceAttribute);

    switch (condition.operator) {
      case '==': return userValue === resourceValue;
      case '!=': return userValue !== resourceValue;
      case '<': return userValue < resourceValue;
      case '<=': return userValue <= resourceValue;
      case '>': return userValue > resourceValue;
      case '>=': return userValue >= resourceValue;
      case 'contains': return Array.isArray(userValue) && userValue.includes(resourceValue);
      case 'not contains': return Array.isArray(userValue) && !userValue.includes(resourceValue);
      default: throw new Error(`Unsupported operator: ${condition.operator}`);
    }
  }
}
