import { TicketAttributeKey, UserAttributeKey } from '@/lib/attributes/EntityAttributes';
import { IPolicy, ICondition } from '@/interfaces/auth.interfaces';

export class PolicyEngine {
  constructor() {
    throw new Error('PolicyEngine is only available in Enterprise Edition');
  }

  addPolicy(policy: IPolicy): void {
    throw new Error('PolicyEngine is only available in Enterprise Edition');
  }
}

export const parsePolicy = async (policyString: string): Promise<IPolicy> => {
  throw new Error('Policy parsing is only available in Enterprise Edition');
};
