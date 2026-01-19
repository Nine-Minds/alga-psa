'use server';

import { revalidatePath } from 'next/cache';
import {
  getCreditDetails,
  listClientCredits,
  manuallyExpireCredit,
  transferCredit,
  updateCreditExpiration,
} from '../../actions/creditActions';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';

export async function listCredits(
  clientId: string,
  includeExpired: boolean = false,
  page: number = 1,
  pageSize: number = 20
) {
  try {
    const result = await listClientCredits(clientId, includeExpired, page, pageSize);
    return { success: true, data: result };
  } catch (error) {
    console.error('Error listing credits:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

export async function getCreditDetail(creditId: string) {
  try {
    const result = await getCreditDetails(creditId);
    return { success: true, data: result };
  } catch (error) {
    console.error('Error getting credit details:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

export async function updateCreditExpirationDate(creditId: string, newExpirationDate: string | null) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Authentication required' };
    }

    const result = await updateCreditExpiration(creditId, newExpirationDate, user.user_id);
    revalidatePath('/msp/billing/credits');
    return { success: true, data: result };
  } catch (error) {
    console.error('Error updating credit expiration:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

export async function expireCredit(creditId: string, reason?: string) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Authentication required' };
    }

    const result = await manuallyExpireCredit(creditId, user.user_id, reason);
    revalidatePath('/msp/billing/credits');
    return { success: true, data: result };
  } catch (error) {
    console.error('Error expiring credit:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
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
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Authentication required' };
    }

    if (amount <= 0) {
      return { success: false, error: 'Transfer amount must be greater than zero' };
    }

    const result = await transferCredit(sourceCreditId, targetClientId, amount, user.user_id, reason);
    revalidatePath('/msp/billing/credits');
    return { success: true, data: result };
  } catch (error) {
    console.error('Error transferring credit:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}
