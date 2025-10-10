'use server';

import { getSession } from 'server/src/lib/auth/getSession';
import crypto from 'crypto';

interface CreateLicenseCheckoutSessionResult {
  success: boolean;
  clientSecret?: string;
  sessionId?: string;
  error?: string;
}

/**
 * Creates a Stripe checkout session for purchasing additional licenses
 * Calls the nm-store API which handles Stripe customer lookup and session creation
 */
export async function createLicenseCheckoutSession(
  licenseCount: number
): Promise<CreateLicenseCheckoutSessionResult> {
  try {
    const session = await getSession();

    if (!session?.user?.tenant || !session?.user?.email) {
      return {
        success: false,
        error: 'No valid session found. Please sign in.'
      };
    }

    const nmStoreUrl = process.env.NM_STORE_URL;
    const algaAuthKey = process.env.ALGA_AUTH_KEY;

    console.log('Environment check:', {
      nmStoreUrl,
      algaAuthKeyLength: algaAuthKey?.length,
      algaAuthKeyPreview: algaAuthKey ? algaAuthKey.substring(0, 4) + '***' : 'undefined'
    });

    if (!nmStoreUrl || !algaAuthKey) {
      console.error('Missing NM_STORE_URL or ALGA_AUTH_KEY configuration');
      return {
        success: false,
        error: 'Service configuration error. Please contact support.'
      };
    }

    // Prepare the request payload
    const payload = {
      tenantId: session.user.tenant,
      email: session.user.email,
      licenseCount,
      type: 'add_licenses',
      firstName: session.user.first_name || '',
      lastName: session.user.last_name || ''
    };

    console.log('Creating license checkout session', {
      tenantId: session.user.tenant,
      email: session.user.email,
      licenseCount
    });

    // Call nm-store API to create checkout session
    const response = await fetch(`${nmStoreUrl}/api/internal/create-license-checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': algaAuthKey
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to create checkout session', {
        status: response.status,
        error: errorText
      });

      return {
        success: false,
        error: `Failed to create checkout session: ${response.status}`
      };
    }

    const data = await response.json();

    if (!data.clientSecret || !data.sessionId) {
      console.error('Invalid response from nm-store', data);
      return {
        success: false,
        error: 'Invalid response from payment service'
      };
    }

    console.log('Checkout session created successfully', {
      sessionId: data.sessionId
    });

    return {
      success: true,
      clientSecret: data.clientSecret,
      sessionId: data.sessionId
    };

  } catch (error) {
    console.error('Error creating license checkout session:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}
