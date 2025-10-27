'use server'

import { revalidatePath } from 'next/cache';
import { 
  listClientCredits, 
  getCreditDetails, 
  updateCreditExpiration, 
  manuallyExpireCredit, 
  transferCredit 
} from '@product/actions/creditActions';
import { getCurrentUser } from 'server/src/lib/auth/session';
import { ICreditTracking } from 'server/src/interfaces/billing.interfaces';

/**
 * List all credits for a client with detailed information
 * @param clientId The ID of the client
 * @param includeExpired Whether to include expired credits
 * @param page Page number for pagination
 * @param pageSize Number of items per page
 * @returns Paginated list of credits with detailed information
 */
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
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    };
  }
}

/**
 * Get detailed information about a specific credit
 * @param creditId The ID of the credit to retrieve
 * @returns Detailed credit information including transaction history
 */
export async function getCreditDetail(creditId: string) {
  try {
    const result = await getCreditDetails(creditId);
    return { success: true, data: result };
  } catch (error) {
    console.error('Error getting credit details:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    };
  }
}

/**
 * Update a credit's expiration date
 * @param creditId The ID of the credit to update
 * @param newExpirationDate The new expiration date (ISO8601 string) or null to remove expiration
 * @returns The updated credit
 */
export async function updateCreditExpirationDate(
  creditId: string,
  newExpirationDate: string | null
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Authentication required' };
    }

    const result = await updateCreditExpiration(creditId, newExpirationDate, user.user_id);
    
    // Revalidate the credits page to reflect the changes
    revalidatePath('/msp/billing/credits');
    
    return { success: true, data: result };
  } catch (error) {
    console.error('Error updating credit expiration:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    };
  }
}

/**
 * Manually expire a credit
 * @param creditId The ID of the credit to expire
 * @param reason Optional reason for manual expiration
 * @returns The expired credit
 */
export async function expireCredit(
  creditId: string,
  reason?: string
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Authentication required' };
    }

    const result = await manuallyExpireCredit(creditId, user.user_id, reason);
    
    // Revalidate the credits page to reflect the changes
    revalidatePath('/msp/billing/credits');
    
    return { success: true, data: result };
  } catch (error) {
    console.error('Error expiring credit:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    };
  }
}

/**
 * Transfer credit from one client to another
 * @param sourceCreditId The ID of the credit to transfer from
 * @param targetClientId The ID of the client to transfer to
 * @param amount The amount to transfer
 * @param reason Optional reason for the transfer
 * @returns The new credit created for the target client
 */
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

    const result = await transferCredit(
      sourceCreditId,
      targetClientId,
      amount,
      user.user_id,
      reason
    );
    
    // Revalidate the credits page to reflect the changes
    revalidatePath('/msp/billing/credits');
    
    return { success: true, data: result };
  } catch (error) {
    console.error('Error transferring credit:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    };
  }
}