'use server';

import { getServerSession } from "next-auth/next";
import { options as authOptions } from 'server/src/app/api/auth/[...nextauth]/options';
import { getLicenseUsage, type LicenseUsage } from '../license/get-license-usage';

/**
 * Server action to get the current license usage for the session tenant
 * @returns License usage information or error
 */
export async function getLicenseUsageAction(): Promise<{ 
  success: boolean; 
  data?: LicenseUsage; 
  error?: string 
}> {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.tenant) {
      return { 
        success: false, 
        error: 'No tenant in session' 
      };
    }
    
    const usage = await getLicenseUsage(session.user.tenant);
    
    return {
      success: true,
      data: usage,
    };
  } catch (error) {
    console.error('Error getting license usage:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get license usage',
    };
  }
}