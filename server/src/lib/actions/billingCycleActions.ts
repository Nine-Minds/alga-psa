'use server';

import {
  canCreateNextBillingCycle as canCreateNextBillingCycleImpl,
  createNextBillingCycle as createNextBillingCycleImpl,
  getAllBillingCycles as getAllBillingCyclesImpl,
  getBillingCycle as getBillingCycleImpl,
  getInvoicedBillingCycles as getInvoicedBillingCyclesImpl,
  getInvoicedBillingCyclesPaginated as getInvoicedBillingCyclesPaginatedImpl,
  getNextBillingCycleStatusForClients as getNextBillingCycleStatusForClientsImpl,
  hardDeleteBillingCycle as hardDeleteBillingCycleImpl,
  removeBillingCycle as removeBillingCycleImpl,
  updateBillingCycle as updateBillingCycleImpl,
} from '@alga-psa/billing/actions/billingCycleActions';

export async function getBillingCycle(
  ...args: Parameters<typeof getBillingCycleImpl>
): ReturnType<typeof getBillingCycleImpl> {
  return getBillingCycleImpl(...args);
}

export async function updateBillingCycle(
  ...args: Parameters<typeof updateBillingCycleImpl>
): ReturnType<typeof updateBillingCycleImpl> {
  return updateBillingCycleImpl(...args);
}

export async function canCreateNextBillingCycle(
  ...args: Parameters<typeof canCreateNextBillingCycleImpl>
): ReturnType<typeof canCreateNextBillingCycleImpl> {
  return canCreateNextBillingCycleImpl(...args);
}

export async function getNextBillingCycleStatusForClients(
  ...args: Parameters<typeof getNextBillingCycleStatusForClientsImpl>
): ReturnType<typeof getNextBillingCycleStatusForClientsImpl> {
  return getNextBillingCycleStatusForClientsImpl(...args);
}

export async function createNextBillingCycle(
  ...args: Parameters<typeof createNextBillingCycleImpl>
): ReturnType<typeof createNextBillingCycleImpl> {
  return createNextBillingCycleImpl(...args);
}

export async function removeBillingCycle(
  ...args: Parameters<typeof removeBillingCycleImpl>
): ReturnType<typeof removeBillingCycleImpl> {
  return removeBillingCycleImpl(...args);
}

export async function hardDeleteBillingCycle(
  ...args: Parameters<typeof hardDeleteBillingCycleImpl>
): ReturnType<typeof hardDeleteBillingCycleImpl> {
  return hardDeleteBillingCycleImpl(...args);
}

export async function getInvoicedBillingCycles(
  ...args: Parameters<typeof getInvoicedBillingCyclesImpl>
): ReturnType<typeof getInvoicedBillingCyclesImpl> {
  return getInvoicedBillingCyclesImpl(...args);
}

export async function getInvoicedBillingCyclesPaginated(
  ...args: Parameters<typeof getInvoicedBillingCyclesPaginatedImpl>
): ReturnType<typeof getInvoicedBillingCyclesPaginatedImpl> {
  return getInvoicedBillingCyclesPaginatedImpl(...args);
}

export async function getAllBillingCycles(
  ...args: Parameters<typeof getAllBillingCyclesImpl>
): ReturnType<typeof getAllBillingCyclesImpl> {
  return getAllBillingCyclesImpl(...args);
}
