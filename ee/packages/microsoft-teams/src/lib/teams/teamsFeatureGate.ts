import { isFeatureFlagEnabled, RELEASE_V1_5_FEATURE_FLAG } from '@alga-psa/core/features';

export class TeamsFeatureDisabledError extends Error {
  readonly code = 'feature_disabled' as const;

  constructor(message = 'Microsoft Teams integration is not enabled for this tenant') {
    super(message);
    this.name = 'TeamsFeatureDisabledError';
  }
}

export async function tenantHasTeamsFeatureAccess(
  tenantId: string,
  userId?: string | null,
): Promise<boolean> {
  return isFeatureFlagEnabled(RELEASE_V1_5_FEATURE_FLAG, {
    tenantId,
    userId: userId || undefined,
  });
}

export async function assertTeamsFeatureAccess(
  tenantId: string,
  userId?: string | null,
): Promise<void> {
  if (!(await tenantHasTeamsFeatureAccess(tenantId, userId))) {
    throw new TeamsFeatureDisabledError();
  }
}
