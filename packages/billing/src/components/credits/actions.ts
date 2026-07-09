'use server';

import { revalidatePath } from 'next/cache';
import {
  getCreditDetails,
  listClientCredits,
  manuallyExpireCredit,
  transferCredit,
  updateCreditExpiration,
} from '../../actions/creditActions';
import { getCurrentUserAsync } from '../../lib/authHelpers';

function returnedCreditActionError(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const candidate = error as { actionError?: unknown; permissionError?: unknown };
  if (typeof candidate.permissionError === 'string') {
    return candidate.permissionError;
  }
  if (typeof candidate.actionError === 'string') {
    return candidate.actionError;
  }
  return null;
}

function creditActionErrorMessage(error: unknown, fallback: string): string {
  const returned = returnedCreditActionError(error);
  if (returned) {
    return returned;
  }

  if (!(error instanceof Error)) {
    return fallback;
  }

  const { message } = error;
  if (message.startsWith('Permission denied:')) {
    return message;
  }

  if (message === 'Authentication required') {
    return message;
  }

  if (/^Credit with ID .+ not found$/.test(message)) {
    return 'Credit not found';
  }

  if (/^Source credit with ID .+ not found$/.test(message)) {
    return 'Source credit not found';
  }

  if (/^Target client with ID .+ not found$/.test(message)) {
    return 'Target client not found';
  }

  if (/^Original transaction for credit .+ not found$/.test(message)) {
    return 'The credit transaction could not be found';
  }

  if (/^Insufficient remaining amount .+ for transfer of .+$/.test(message)) {
    return 'Insufficient remaining amount for transfer';
  }

  const expectedMessages = new Set([
    'Cannot update expiration date for an expired credit',
    'Cannot expire a credit with no remaining amount',
    'Cannot transfer from an expired credit',
    'Credit is already expired',
    'Insufficient credit balance',
    'Transfer amount must be greater than zero',
  ]);

  return expectedMessages.has(message) ? message : fallback;
}

export async function listCredits(
  clientId: string,
  includeExpired: boolean = false,
  page: number = 1,
  pageSize: number = 20
) {
  try {
    const result = await listClientCredits(clientId, includeExpired, page, pageSize);
    const returned = returnedCreditActionError(result);
    if (returned) {
      return { success: false, error: returned };
    }
    return { success: true, data: result };
  } catch (error) {
    console.error('Error listing credits:', error);
    return {
      success: false,
      error: creditActionErrorMessage(error, 'Failed to list credits'),
    };
  }
}

export async function getCreditDetail(creditId: string) {
  try {
    const result = await getCreditDetails(creditId);
    const returned = returnedCreditActionError(result);
    if (returned) {
      return { success: false, error: returned };
    }
    return { success: true, data: result };
  } catch (error) {
    console.error('Error getting credit details:', error);
    return {
      success: false,
      error: creditActionErrorMessage(error, 'Failed to load credit details'),
    };
  }
}

export async function updateCreditExpirationDate(creditId: string, newExpirationDate: string | null) {
  try {
    const user = await getCurrentUserAsync();
    if (!user) {
      return { success: false, error: 'Authentication required' };
    }

    const result = await updateCreditExpiration(creditId, newExpirationDate, user.user_id);
    const returned = returnedCreditActionError(result);
    if (returned) {
      return { success: false, error: returned };
    }
    revalidatePath('/msp/billing/credits');
    return { success: true, data: result };
  } catch (error) {
    console.error('Error updating credit expiration:', error);
    return {
      success: false,
      error: creditActionErrorMessage(error, 'Failed to update credit expiration'),
    };
  }
}

export async function expireCredit(creditId: string, reason?: string) {
  try {
    const user = await getCurrentUserAsync();
    if (!user) {
      return { success: false, error: 'Authentication required' };
    }

    const result = await manuallyExpireCredit(creditId, user.user_id, reason);
    const returned = returnedCreditActionError(result);
    if (returned) {
      return { success: false, error: returned };
    }
    revalidatePath('/msp/billing/credits');
    return { success: true, data: result };
  } catch (error) {
    console.error('Error expiring credit:', error);
    return {
      success: false,
      error: creditActionErrorMessage(error, 'Failed to expire credit'),
    };
  }
}

export async function transferCreditToClient(
  sourceCreditId: string,
  targetClientId: string,
  amount: number,
  reason?: string
) {
  try {
    const user = await getCurrentUserAsync();
    if (!user) {
      return { success: false, error: 'Authentication required' };
    }

    if (amount <= 0) {
      return { success: false, error: 'Transfer amount must be greater than zero' };
    }

    const result = await transferCredit(sourceCreditId, targetClientId, amount, user.user_id, reason);
    const returned = returnedCreditActionError(result);
    if (returned) {
      return { success: false, error: returned };
    }
    revalidatePath('/msp/billing/credits');
    return { success: true, data: result };
  } catch (error) {
    console.error('Error transferring credit:', error);
    return {
      success: false,
      error: creditActionErrorMessage(error, 'Failed to transfer credit'),
    };
  }
}
