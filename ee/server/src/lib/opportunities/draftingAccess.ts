import { ADD_ONS } from '@alga-psa/types';
import { getExperimentalFeaturesForTenant } from '@alga-psa/tenancy/actions';
import { assertTenantAddOnAccess } from 'server/src/lib/tier-gating/assertAddOnAccess';

export interface OpportunityDraftingAccessDependencies {
  getFeatures(
    tenant: string,
    user: any,
  ): Promise<{ aiAssistant: boolean }>;
  assertAiAddOn(tenant: string): Promise<void>;
}

const defaultDependencies: OpportunityDraftingAccessDependencies = {
  getFeatures: getExperimentalFeaturesForTenant,
  assertAiAddOn: (tenant) => assertTenantAddOnAccess(tenant, ADD_ONS.AI_ASSISTANT),
};

function accessDenied(message: string, code: string): never {
  const error = new Error(message);
  Object.assign(error, { statusCode: 403, code });
  throw error;
}

export async function assertOpportunityDraftingAccess(
  user: any,
  tenant: string,
  dependencies: OpportunityDraftingAccessDependencies = defaultDependencies,
): Promise<void> {
  const features = await dependencies.getFeatures(tenant, user);
  if (!features.aiAssistant) {
    accessDenied('AI Assistant is not enabled for this tenant.', 'AI_ASSISTANT_DISABLED');
  }
  try {
    await dependencies.assertAiAddOn(tenant);
  } catch {
    accessDenied(
      'AI Assistant add-on access is not available for this workspace.',
      'AI_ASSISTANT_ADDON_REQUIRED',
    );
  }
}
