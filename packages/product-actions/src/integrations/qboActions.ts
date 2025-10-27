'use server';

import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { revalidatePath } from 'next/cache';
import axios from 'axios'; // Import axios
import { ISecretProvider } from '@shared/core'; 
import { WorkflowEventAttachmentModel } from 'server/src/models/workflowEventAttachment';
import { createTenantKnex } from '@server/lib/db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { getSecretProviderInstance } from '@shared/core';
import { QboClientService } from '@server/lib/qbo/qboClientService';

// Corrected QboCredentials interface (using ISO strings for dates)
interface QboCredentials {
  accessToken: string;
  refreshToken: string;
  realmId: string;
  accessTokenExpiresAt: string; // Store as ISO string
  refreshTokenExpiresAt: string; // Store as ISO string
}

// Define the expected response structure based on Sec 5.5.2
export interface QboConnectionStatus { // Exporting for use in UI components
  connected: boolean; // Added to match client expectation
  status: 'Connected' | 'Not Connected' | 'Error';
  clientName?: string;
  realmId?: string;
  errorMessage?: string; // Renamed from 'error' for clarity
}

// --- Helper Functions using ISecretProvider ---

const QBO_CREDENTIALS_SECRET_NAME = 'qbo_credentials';
const QBO_BASE_URL = process.env.QBO_API_BASE_URL || 'https://sandbox-quickbooks.api.intuit.com'; // Use sandbox by default, configure via env

export async function getTenantQboCredentials(secretProvider: ISecretProvider, tenantId: string, realmId: string): Promise<QboCredentials | null> {
  const secret = await secretProvider.getTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME);
  if (!secret) {
    console.warn(`QBO credentials secret not found for tenant ${tenantId}`);
    return null;
  }
  try {
    const allCredentials = JSON.parse(secret) as Record<string, QboCredentials>;
    if (typeof allCredentials !== 'object' || allCredentials === null) {
      console.warn(`Invalid QBO credentials structure: not an object for tenant ${tenantId}`);
      return null;
    }
    const credentials = allCredentials[realmId];
    // Basic validation for the specific realm's credentials
    if (credentials && credentials.accessToken && credentials.refreshToken && credentials.realmId === realmId && credentials.accessTokenExpiresAt && credentials.refreshTokenExpiresAt) {
      return credentials;
    }
    console.warn(`Invalid or missing QBO credentials for tenant ${tenantId}, realm ${realmId}`);
    return null;
  } catch (error) {
    console.error(`Error parsing QBO credentials for tenant ${tenantId}, realm ${realmId}:`, error);
    return null;
  }
}

async function deleteTenantQboCredentials(secretProvider: ISecretProvider, tenantId: string): Promise<void> {
  // Assuming setTenantSecret with null value effectively deletes/invalidates the secret
  await secretProvider.setTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME, null);
  console.log(`[Action] Invalidated QBO credentials secret for tenant ${tenantId}`);
}

// --- QBO API Call Helper ---

interface QboClientInfoResponse {
  ClientInfo: {
    ClientName: string;
    // Add other fields if needed
  }
}

async function getQboClientName(accessToken: string, realmId: string): Promise<string | null> {
  const url = `${QBO_BASE_URL}/v3/client/${realmId}/clientinfo/${realmId}`;
  try {
    const response = await axios.get<QboClientInfoResponse>(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
      timeout: 10000, // 10 seconds timeout
    });
    return response.data?.ClientInfo?.ClientName || null;
  } catch (error: any) {
    console.error(`Error fetching QBO Client Info for realm ${realmId}:`, error.response?.data || error.message);
    // Handle specific errors like 401 Unauthorized (token expired/invalid)
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      console.warn(`QBO API returned 401 for Client Info fetch (Realm: ${realmId}). Token may need refresh.`);
    }
    return null; // Return null on error
  }
}

// --- QBO Entity Types ---

export interface QboItem { // Exporting for use in components
  id: string; // QBO ItemRef.value
  name: string; // Qbo Item Name
}

export interface QboTaxCode { // Exporting for use in components
  id: string; // QBO TaxCodeRef.value
  name: string; // Qbo TaxCode Name
}

export interface QboTerm { // Exporting for use in components
  id: string; // QBO SalesTermRef.value
  name: string; // Qbo Term Name
}

// --- Server Actions ---

/**
 * Fetches a list of Items (Products/Services) from QuickBooks Online
 * for the current tenant's connected realm.
 * Uses QboClientService which automatically handles token refresh.
 */
export async function getQboItems(): Promise<QboItem[]> {
  const user = await getCurrentUser();
  if (!user?.tenant) {
    console.error('[QBO Action] User or tenant not found for getQboItems.');
    return [];
  }
  const tenantId = user.tenant;
  const secretProvider = await getSecretProviderInstance();

  try {
    const secret = await secretProvider.getTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME);
    if (!secret) {
      console.log(`[QBO Action] QBO credentials secret not found for tenant ${tenantId}. Cannot fetch Items.`);
      return [];
    }

    const allCredentials = JSON.parse(secret) as Record<string, QboCredentials>;
    if (typeof allCredentials !== 'object' || allCredentials === null) {
      console.warn(`[QBO Action] Invalid QBO credentials structure: not an object for tenant ${tenantId}`);
      return [];
    }

    // Try each realm until we find one that works
    for (const realmId in allCredentials) {
      const creds = allCredentials[realmId];
      if (!creds || !creds.accessToken || !creds.refreshToken || !creds.realmId) {
        console.warn(`[QBO Action] Invalid credentials structure for tenant ${tenantId}, realm ${realmId}`);
        continue;
      }

      try {
        console.log(`[QBO Action] Fetching Items for tenant ${tenantId}, realm ${realmId}`);
        const qboClient = await QboClientService.create(tenantId, realmId);
        
        const qboItems = await qboClient.query<any>('SELECT Id, Name FROM Item MAXRESULTS 1000');

        const mappedItems: QboItem[] = qboItems.map((item: any) => ({
          id: item.Id,
          name: item.Name,
        }));

        console.log(`[QBO Action] Found ${mappedItems.length} QBO Items for tenant ${tenantId}, realm ${realmId}.`);
        return mappedItems;

      } catch (clientError: any) {
        console.warn(`[QBO Action] Failed to fetch Items for tenant ${tenantId}, realm ${realmId}:`, clientError.message);
        continue; // Try next realm
      }
    }

    console.log(`[QBO Action] No working connections found for tenant ${tenantId} across all realms. Cannot fetch Items.`);
    return [];

  } catch (error: any) {
    console.error(`[QBO Action] Error fetching QBO Items for tenant ${tenantId}:`, error.message);
    return [];
  }
}

/**
 * Server Action to fetch the current QuickBooks Online connection status for the tenant.
 * Uses QboClientService which automatically handles token refresh.
 * Corresponds to Task 82.
 */
export async function getQboConnectionStatus(): Promise<QboConnectionStatus> {
  const secretProvider = await getSecretProviderInstance();
  const { tenant: tenantId } = await createTenantKnex();

  if (!tenantId) {
    console.error('QBO Status Action: Tenant ID not found.');
    return { status: 'Not Connected', connected: false };
  }

  try {
    const secret = await secretProvider.getTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME);
    if (!secret) {
      console.log(`QBO Status Action: QBO credentials secret not found for tenant ${tenantId}.`);
      return { status: 'Not Connected', connected: false };
    }

    const allCredentials = JSON.parse(secret) as Record<string, QboCredentials>;
    if (typeof allCredentials !== 'object' || allCredentials === null || Object.keys(allCredentials).length === 0) {
      console.warn(`QBO Status Action: Invalid or empty QBO credentials structure for tenant ${tenantId}`);
      return { status: 'Not Connected', connected: false };
    }

    // Try each realm until we find one that works
    for (const realmId in allCredentials) {
      const creds = allCredentials[realmId];
      if (!creds || !creds.accessToken || !creds.refreshToken || !creds.realmId) {
        console.warn(`QBO Status Action: Invalid credentials structure for tenant ${tenantId}, realm ${realmId}`);
        continue;
      }

      try {
        // QboClientService.create() will automatically refresh tokens if needed
        console.log(`QBO Status Action: Attempting to create client for tenant ${tenantId}, realm ${realmId}`);
        const qboClient = await QboClientService.create(tenantId, realmId);
        
        // Try to fetch client info using the client (this will use refreshed tokens)
        const clientInfoResult = await qboClient.query<any>(`SELECT ClientName FROM ClientInfo`);
        const clientName = clientInfoResult?.[0]?.ClientName || 'Unknown Client';

        console.log(`QBO Status Action: Successfully connected for tenant ${tenantId}, Realm: ${realmId}, Client: ${clientName}`);
        return {
          status: 'Connected',
          clientName: clientName,
          realmId: realmId,
          connected: true,
        };

      } catch (clientError: any) {
        console.warn(`QBO Status Action: Failed to create/test client for tenant ${tenantId}, realm ${realmId}:`, clientError.message);
        
        // Check if this is an authentication error (refresh token expired)
        if (clientError.code === 'QBO_AUTH_ERROR' || clientError.message?.includes('Please re-authenticate')) {
          console.log(`QBO Status Action: Authentication failed for realm ${realmId}, checking other realms...`);
          continue; // Try next realm
        }
        
        // For other errors, continue to try other realms
        continue;
      }
    }

    // If we get here, no realms worked
    const firstRealmId = Object.keys(allCredentials)[0];
    const firstRealm = allCredentials[firstRealmId];
    
    console.log(`QBO Status Action: No working connections found for tenant ${tenantId} across ${Object.keys(allCredentials).length} realm(s)`);
    
    return {
      status: 'Error',
      errorMessage: 'Connection expired or invalid. Please reconnect.',
      realmId: firstRealm?.realmId,
      connected: false
    };

  } catch (error: any) {
    console.error(`QBO Status Action: Error checking status for tenant ${tenantId}:`, error);
    
    // Try to extract a realmId for error context
    let realmIdOnError: string | undefined = undefined;
    if (tenantId) {
      try {
        const secretOnError = await secretProvider.getTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME);
        if (secretOnError) {
          const parsedSecretOnError = JSON.parse(secretOnError) as Record<string, QboCredentials>;
          if (typeof parsedSecretOnError === 'object' && parsedSecretOnError !== null && Object.keys(parsedSecretOnError).length > 0) {
            realmIdOnError = parsedSecretOnError[Object.keys(parsedSecretOnError)[0]].realmId;
          }
        }
      } catch (e) { /* Ignore secondary error during error handling */ }
    }
    
    return {
      status: 'Error',
      errorMessage: error.message || 'An unexpected error occurred while checking the connection status.',
      realmId: realmIdOnError,
      connected: false,
    };
  }
}

/**
 * Disconnects the QuickBooks Online integration for the current tenant
 * by deleting stored credentials and optionally revoking the token with Intuit.
 * Corresponds to Task 84.
 */
export async function disconnectQbo(): Promise<{ success: boolean; error?: string }> {
  let tenantId: string | null = null;
  // Get the secret provider instance
  const secretProvider = await getSecretProviderInstance();

  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.tenant) {
      console.error('QBO Disconnect Action: Tenant ID not found in current user session.');
      return { success: false, error: 'User or tenant not found' };
    }
    tenantId = currentUser.tenant;

    console.log(`QBO Disconnect Action: Initiating disconnect for tenant ${tenantId}`);

    // --- Delete specific workflow event attachments using the model method ---
    try {
        const { knex } = await createTenantKnex(); // Get Knex instance for the tenant context

        console.log(`QBO Disconnect Action: Attempting to delete QBO sync workflow event attachments for tenant ${tenantId} via model`);

        // Define the specific workflows and events to target for deletion
        const qboWorkflowEventMap: Record<string, string[]> = {
            'Invoice Sync': ['INVOICE_CREATED', 'INVOICE_UPDATED'],
            'Customer Sync': ['CLIENT_CREATED', 'CLIENT_UPDATED'],
        };

        // Call the static method on the model wrapped in withTransaction
        const deletedCount = await withTransaction(knex, async (trx: Knex.Transaction) => {
            return await WorkflowEventAttachmentModel.deleteSystemWorkflowAttachmentsForTenant(
                trx,
                tenantId!,
                qboWorkflowEventMap
            );
        });

        console.log(`QBO Disconnect Action: Model deleted ${deletedCount} QBO sync workflow event attachments for tenant ${tenantId}`);

    } catch (dbError: any) {
        // Log the error but don't prevent credential deletion
        console.error(`QBO Disconnect Action: Error deleting workflow event attachments via model for tenant ${tenantId}:`, dbError.message);
        // Optionally, you could return a partial success/warning here if needed
    }
    // --- End delete workflow event attachments ---


    // Retrieve credentials *before* deleting if revocation is needed.
    // Read the raw secret content to check if revocation might be possible, but don't parse for specific realm
    const rawSecretContent = await secretProvider.getTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME);
    // TODO: If revocation is implemented, parse rawSecretContent to find tokens to revoke.
    // For now, we just need to know if *any* credentials existed.
    const credentialsExist = !!rawSecretContent;

    // If revocation were implemented, you'd parse rawSecretContent here to get all refresh/access tokens
    // For example:
    // let tokensToRevoke: { refreshToken?: string, accessToken?: string, realmId: string }[] = [];
    // if (rawSecretContent) {
    //   try {
    //     const allCreds = JSON.parse(rawSecretContent) as Record<string, QboCredentials>;
    //     if (typeof allCreds === 'object' && allCreds !== null) {
    //       tokensToRevoke = Object.values(allCreds).map(c => ({ refreshToken: c.refreshToken, accessToken: c.accessToken, realmId: c.realmId }));
    //     }
    //   } catch (parseError) {
    //     console.warn(`QBO Disconnect Action: Could not parse credentials for revocation for tenant ${tenantId}`, parseError);
    //   }
    // }
    // For now, we'll simulate based on the existence check for logging purposes
    const refreshTokenToRevoke = credentialsExist ? "dummy_refresh_token_if_any_existed" : undefined; // Placeholder
    const accessTokenToRevoke = credentialsExist ? "dummy_access_token_if_any_existed" : undefined; // Placeholder


    // Delete stored credentials using the ISecretProvider helper
    await deleteTenantQboCredentials(secretProvider, tenantId);
    console.log(`QBO Disconnect Action: Credentials deleted for tenant ${tenantId}`);

    // TODO: (Optional but Recommended) Implement call to Intuit's token revocation endpoint.
    // This requires the refresh token (or access token) and app credentials (client ID/secret).
    // Example:
    // if (refreshTokenToRevoke || accessTokenToRevoke) {
    //   try {
    //     const tokenToUse = refreshTokenToRevoke || accessTokenToRevoke; // Prefer refresh token
    //     const clientId = await secretProvider.getAppSecret('qbo_client_id');
    //     const clientSecret = await secretProvider.getAppSecret('qbo_client_secret');
    //     if (clientId && clientSecret && tokenToUse) {
    //        await revokeQboToken(clientId, clientSecret, tokenToUse); // Hypothetical function using axios
    //        console.log(`QBO Disconnect Action: Token successfully revoked with Intuit for tenant ${tenantId}`);
    //     } else {
    //        console.warn(`QBO Disconnect Action: Missing credentials for token revocation for tenant ${tenantId}`);
    //     }
    //   } catch (revocationError: any) {
    //     // Log the error but don't necessarily fail the whole disconnect operation,
    //     // as local credentials are deleted. Maybe return a partial success/warning?
    //     console.warn(`QBO Disconnect Action: Failed to revoke token with Intuit for tenant ${tenantId}: ${revocationError.message}`);
    //   }
    // }

    // Revalidate the path where the QBO connection UI is displayed to trigger a refresh
    const integrationsPath = '/settings/integrations'; // Example path, adjust as needed
    revalidatePath(integrationsPath);
    console.log(`QBO Disconnect Action: Revalidated path ${integrationsPath} for tenant ${tenantId}`);

    return { success: true };

  } catch (error: any) {
    console.error(`QBO Disconnect Action: Error disconnecting for tenant ${tenantId || 'UNKNOWN'}`, error);
    return { success: false, error: error.message || 'An unexpected error occurred during disconnection.' };
  }
}


/**
 * Fetches a list of TaxCodes from QuickBooks Online
 * for the current tenant's connected realm.
 */
export async function getQboTaxCodes(): Promise<QboTaxCode[]> {
  const user = await getCurrentUser();
  if (!user?.tenant) {
    console.error('[QBO Action] User or tenant not found for getQboTaxCodes.');
    return [];
  }
  const tenantId = user.tenant;
  const secretProvider = await getSecretProviderInstance();

  try {
    const secret = await secretProvider.getTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME);
    if (!secret) {
      console.log(`[QBO Action] QBO credentials secret not found for tenant ${tenantId}. Cannot fetch TaxCodes.`);
      return [];
    }

    const allCredentials = JSON.parse(secret) as Record<string, QboCredentials>;
    if (typeof allCredentials !== 'object' || allCredentials === null) {
      console.warn(`[QBO Action] Invalid QBO credentials structure: not an object for tenant ${tenantId}`);
      return [];
    }

    let validRealmId: string | null = null;
    let validAccessToken: string | null = null;

    for (const realmId in allCredentials) {
      const creds = allCredentials[realmId];
      if (creds && creds.accessToken && creds.accessTokenExpiresAt && creds.realmId === realmId) {
        if (new Date(creds.accessTokenExpiresAt) > new Date()) {
          validRealmId = creds.realmId;
          validAccessToken = creds.accessToken;
          break;
        } else {
          console.warn(`[QBO Action] Access token expired for tenant ${tenantId}, realm ${realmId}.`);
        }
      }
    }

    if (!validRealmId || !validAccessToken) {
      console.log(`[QBO Action] No valid (non-expired) QBO credentials found for tenant ${tenantId} across all realms. Cannot fetch TaxCodes.`);
      return [];
    }

    console.log(`[QBO Action] Fetching TaxCodes for tenant ${tenantId}, realm ${validRealmId}`);

    const query = 'SELECT Id, Name FROM TaxCode MAXRESULTS 1000';
    const queryUrl = `${QBO_BASE_URL}/v3/client/${validRealmId}/query?query=${encodeURIComponent(query)}`;

    const response = await axios.get(queryUrl, {
        headers: {
            'Authorization': `Bearer ${validAccessToken}`,
            'Accept': 'application/json',
        },
        timeout: 15000,
    });

    const qboTaxCodes = response.data?.QueryResponse?.TaxCode || [];

    const mappedTaxCodes: QboTaxCode[] = qboTaxCodes.map((tc: any) => ({
      id: tc.Id,
      name: tc.Name,
    }));

    console.log(`[QBO Action] Found ${mappedTaxCodes.length} QBO TaxCodes for tenant ${tenantId}, realm ${validRealmId}.`);
    return mappedTaxCodes;

  } catch (error: any) {
    console.error(`[QBO Action] Error fetching QBO TaxCodes for tenant ${tenantId}:`, error.response?.data || error.message);
     if (axios.isAxiosError(error) && error.response?.status === 401) {
        console.warn(`[QBO Action] QBO API returned 401 for TaxCode query (Tenant: ${tenantId}). Token may need refresh.`);
    }
    return [];
  }
}

/**
 * Fetches a list of Terms from QuickBooks Online
 * for the current tenant's connected realm.
 */
export async function getQboTerms(): Promise<QboTerm[]> {
  const user = await getCurrentUser();
  if (!user?.tenant) {
    console.error('[QBO Action] User or tenant not found for getQboTerms.');
    return [];
  }
  const tenantId = user.tenant;
  const secretProvider = await getSecretProviderInstance();

  try {
    const secret = await secretProvider.getTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME);
    if (!secret) {
      console.log(`[QBO Action] QBO credentials secret not found for tenant ${tenantId}. Cannot fetch Terms.`);
      return [];
    }

    const allCredentials = JSON.parse(secret) as Record<string, QboCredentials>;
    if (typeof allCredentials !== 'object' || allCredentials === null) {
      console.warn(`[QBO Action] Invalid QBO credentials structure: not an object for tenant ${tenantId}`);
      return [];
    }

    let validRealmId: string | null = null;
    let validAccessToken: string | null = null;

    for (const realmId in allCredentials) {
      const creds = allCredentials[realmId];
      if (creds && creds.accessToken && creds.accessTokenExpiresAt && creds.realmId === realmId) {
        if (new Date(creds.accessTokenExpiresAt) > new Date()) {
          validRealmId = creds.realmId;
          validAccessToken = creds.accessToken;
          break;
        } else {
          console.warn(`[QBO Action] Access token expired for tenant ${tenantId}, realm ${realmId}.`);
        }
      }
    }

    if (!validRealmId || !validAccessToken) {
      console.log(`[QBO Action] No valid (non-expired) QBO credentials found for tenant ${tenantId} across all realms. Cannot fetch Terms.`);
      return [];
    }

    console.log(`[QBO Action] Fetching Terms for tenant ${tenantId}, realm ${validRealmId}`);

    const query = 'SELECT Id, Name FROM Term MAXRESULTS 1000';
    const queryUrl = `${QBO_BASE_URL}/v3/client/${validRealmId}/query?query=${encodeURIComponent(query)}`;

    const response = await axios.get(queryUrl, {
        headers: {
            'Authorization': `Bearer ${validAccessToken}`,
            'Accept': 'application/json',
        },
        timeout: 15000,
    });

    const qboTerms = response.data?.QueryResponse?.Term || [];

    const mappedTerms: QboTerm[] = qboTerms.map((term: any) => ({
      id: term.Id,
      name: term.Name,
    }));

    console.log(`[QBO Action] Found ${mappedTerms.length} QBO Terms for tenant ${tenantId}, realm ${validRealmId}.`);
    return mappedTerms;

  } catch (error: any) {
    console.error(`[QBO Action] Error fetching QBO Terms for tenant ${tenantId}:`, error.response?.data || error.message);
     if (axios.isAxiosError(error) && error.response?.status === 401) {
        console.warn(`[QBO Action] QBO API returned 401 for Term query (Tenant: ${tenantId}). Token may need refresh.`);
    }
    return [];
  }
}
