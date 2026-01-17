'use server';

import {
  getClientBillingCycleAnchor as getClientBillingCycleAnchorImpl,
  previewBillingPeriodsForSchedule as previewBillingPeriodsForScheduleImpl,
  previewClientBillingPeriods as previewClientBillingPeriodsImpl,
  updateClientBillingCycleAnchor as updateClientBillingCycleAnchorImpl,
} from '@alga-psa/billing/actions/billingCycleAnchorActions';

export type { BillingCyclePeriodPreview } from '@alga-psa/billing/actions/billingCycleAnchorActions';

export async function getClientBillingCycleAnchor(
  ...args: Parameters<typeof getClientBillingCycleAnchorImpl>
): ReturnType<typeof getClientBillingCycleAnchorImpl> {
  return getClientBillingCycleAnchorImpl(...args);
}

export async function updateClientBillingCycleAnchor(
  ...args: Parameters<typeof updateClientBillingCycleAnchorImpl>
): ReturnType<typeof updateClientBillingCycleAnchorImpl> {
  return updateClientBillingCycleAnchorImpl(...args);
}

export async function previewBillingPeriodsForSchedule(
  ...args: Parameters<typeof previewBillingPeriodsForScheduleImpl>
): ReturnType<typeof previewBillingPeriodsForScheduleImpl> {
  return previewBillingPeriodsForScheduleImpl(...args);
}

export async function previewClientBillingPeriods(
  ...args: Parameters<typeof previewClientBillingPeriodsImpl>
): ReturnType<typeof previewClientBillingPeriodsImpl> {
  return previewClientBillingPeriodsImpl(...args);
}
