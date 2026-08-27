import { isFeatureFlagEnabled, RELEASE_V1_5_FEATURE_FLAG } from '@alga-psa/core/features';

/**
 * Deny-by-default release gate for telephony server paths such as ingestion,
 * webhooks, provider actions, and artifact capture.
 */
export async function tenantHasTelephonyFeatureAccess(tenantId: string): Promise<boolean> {
  return isFeatureFlagEnabled(RELEASE_V1_5_FEATURE_FLAG, { tenantId });
}

export class TelephonyFeatureDisabledError extends Error {
  readonly code = 'telephony_feature_disabled' as const;

  constructor(tenantId: string) {
    super(`Telephony is not enabled for tenant ${tenantId}`);
    this.name = 'TelephonyFeatureDisabledError';
  }
}

export async function assertTelephonyFeatureAccess(tenantId: string): Promise<void> {
  if (!(await tenantHasTelephonyFeatureAccess(tenantId))) {
    throw new TelephonyFeatureDisabledError(tenantId);
  }
}
