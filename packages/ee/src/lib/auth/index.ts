export interface ICondition {
  type?: string;
  value?: unknown;
}

export interface IPolicy {
  name?: string;
  conditions?: ICondition[];
}

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
