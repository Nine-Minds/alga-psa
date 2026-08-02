import { isEnterprise } from 'server/src/lib/features';
import { IPolicy } from 'server/src/interfaces/auth.interfaces';

// Re-export EE components conditionally
export const PolicyManagement = async () => {
  const { default: EditionPolicyManagement } = await import(
    '@enterprise/components/settings/policy/PolicyManagement'
  );
  return EditionPolicyManagement;
};

// Re-export other EE policy functionality
export const parsePolicy = async (policyString: string): Promise<IPolicy> => {
  if (isEnterprise) {
    const { parsePolicy } = await import('@alga-psa/product-auth-ee');
    return parsePolicy(policyString);
  }
  throw new Error('Policy parsing is an Enterprise Edition feature');
};
