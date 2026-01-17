'use server';

import {
  getClientBillingScheduleSummaries as getClientBillingScheduleSummariesImpl,
  updateClientBillingSchedule as updateClientBillingScheduleImpl,
} from '@alga-psa/billing/actions/billingScheduleActions';

export async function getClientBillingScheduleSummaries(
  ...args: Parameters<typeof getClientBillingScheduleSummariesImpl>
): ReturnType<typeof getClientBillingScheduleSummariesImpl> {
  return getClientBillingScheduleSummariesImpl(...args);
}

export async function updateClientBillingSchedule(
  ...args: Parameters<typeof updateClientBillingScheduleImpl>
): ReturnType<typeof updateClientBillingScheduleImpl> {
  return updateClientBillingScheduleImpl(...args);
}
