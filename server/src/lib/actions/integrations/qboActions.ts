'use server';

import { getCurrentUser } from '../user-actions/userActions';
import { revalidatePath } from 'next/cache';
import axios from 'axios'; // Import axios
import { ISecretProvider } from 'server/src/lib/secrets'; // Assuming path - Removed getSecretProvider as it's not exported
import { WorkflowEventAttachmentModel } from 'server/src/models/workflowEventAttachment';
import { createTenantKnex } from '../../db';

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
  companyName?: string;
  realmId?: string;
  errorMessage?: string; // Renamed from 'error' for clarity
}

// --- Helper Functions using ISecretProvider ---

const QBO_CREDENTIALS_SECRET_NAME = 'qbo_credentials';
const QBO_BASE_URL = process.env.QBO_API_BASE_URL || 'https://sandbox-quickbooks.api.intuit.com'; // Use sandbox by default, configure via env

async function getTenantQboCredentials(secretProvider: ISecretProvider, tenantId: string): Promise<QboCredentials | null> {
  const secret = await secretProvider.getTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME);
  if (!secret) {
    return null;
  }
  try {
    // Assuming credentials are stored as a JSON string
    const credentials = JSON.parse(secret) as QboCredentials;
    // Basic validation
    if (credentials && credentials.accessToken && credentials.refreshToken && credentials.realmId && credentials.accessTokenExpiresAt && credentials.refreshTokenExpiresAt) {
      return credentials;
    }
    console.warn(`Invalid QBO credentials structure found for tenant ${tenantId}`);
    return null;
  } catch (error) {
    console.error(`Error parsing QBO credentials for tenant ${tenantId}:`, error);
    return null;
  }
}

async function deleteTenantQboCredentials(secretProvider: ISecretProvider, tenantId: string): Promise<void> {
  // Assuming setTenantSecret with null value effectively deletes/invalidates the secret
  await secretProvider.setTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME, null);
  console.log(`[Action] Invalidated QBO credentials secret for tenant ${tenantId}`);
}

// --- QBO API Call Helper ---

interface QboCompanyInfoResponse {
  CompanyInfo: {
    CompanyName: string;
    // Add other fields if needed
  }
}

async function getQboCompanyName(accessToken: string, realmId: string): Promise<string | null> {
  const url = `${QBO_BASE_URL}/v3/company/${realmId}/companyinfo/${realmId}`;
  try {
    const response = await axios.get<QboCompanyInfoResponse>(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
      timeout: 10000, // 10 seconds timeout
    });
    return response.data?.CompanyInfo?.CompanyName || null;
  } catch (error: any) {
    console.error(`Error fetching QBO Company Info for realm ${realmId}:`, error.response?.data || error.message);
    // Handle specific errors like 401 Unauthorized (token expired/invalid)
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      console.warn(`QBO API returned 401 for Company Info fetch (Realm: ${realmId}). Token may need refresh.`);
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
 */
export async function getQboItems(): Promise<QboItem[]> {
  const user = await getCurrentUser();
  if (!user?.tenant) {
    console.error('[QBO Action] User or tenant not found for getQboItems.');
    return [];
  }
  const tenantId = user.tenant;
  // TODO: Obtain secretProvider instance (e.g., via dependency injection or factory)
  const secretProvider: ISecretProvider = {} as any; // Placeholder: Assume provider is available

  try {
    const credentials = await getTenantQboCredentials(secretProvider, tenantId); // Use helper
    if (!credentials?.realmId || !credentials.accessToken || !credentials.accessTokenExpiresAt) {
      console.log(`[QBO Action] No valid QBO credentials found for tenant ${tenantId}. Cannot fetch Items.`);
      return [];
    }

    // Check expiry (simple check, add buffer)
    if (new Date(credentials.accessTokenExpiresAt) < new Date()) {
        console.warn(`[QBO Action] Access token expired for tenant ${tenantId}. Refresh needed.`);
        // TODO: Implement refresh logic here or indicate error
        return []; // Cannot proceed without refresh
    }

    console.log(`[QBO Action] Fetching Items for tenant ${tenantId}, realm ${credentials.realmId}`);

    const query = 'SELECT Id, Name FROM Item MAXRESULTS 1000';
    const queryUrl = `${QBO_BASE_URL}/v3/company/${credentials.realmId}/query?query=${encodeURIComponent(query)}`;

    const response = await axios.get(queryUrl, {
        headers: {
            'Authorization': `Bearer ${credentials.accessToken}`,
            'Accept': 'application/json',
        },
        timeout: 15000, // Longer timeout for queries
    });

    const qboItems = response.data?.QueryResponse?.Item || [];

    const mappedItems: QboItem[] = qboItems.map((item: any) => ({
      id: item.Id,
      name: item.Name,
    }));

    console.log(`[QBO Action] Found ${mappedItems.length} QBO Items for tenant ${tenantId}.`);
    return mappedItems;

  } catch (error: any) {
    console.error(`[QBO Action] Error fetching QBO Items for tenant ${tenantId}:`, error.response?.data || error.message);
    if (axios.isAxiosError(error) && error.response?.status === 401) {
        console.warn(`[QBO Action] QBO API returned 401 for Item query (Tenant: ${tenantId}). Token may need refresh.`);
    }
    return [];
  }
}

/**
 * Server Action to fetch the current QuickBooks Online connection status for the tenant.
 * Corresponds to Task 82.
 */
export async function getQboConnectionStatus(): Promise<QboConnectionStatus> {
  let tenantId: string | null = null;
  // TODO: Obtain secretProvider instance (e.g., via dependency injection or factory)
  const secretProvider: ISecretProvider = {} as any; // Placeholder: Assume provider is available

  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.tenant) {
      console.error('QBO Status Action: Tenant ID not found in current user session.');
      return { status: 'Not Connected', connected: false };
    }
    tenantId = currentUser.tenant;

    const credentials = await getTenantQboCredentials(secretProvider, tenantId); // Use helper

    if (!credentials?.accessToken || !credentials.realmId || !credentials.refreshToken || !credentials.accessTokenExpiresAt) {
       console.log(`QBO Status Action: No active connection found for tenant ${tenantId}`);
       return { status: 'Not Connected', connected: false };
    }

    // Check if token is expired or near expiry
    const isTokenPotentiallyValid = new Date(credentials.accessTokenExpiresAt) > new Date(Date.now() + 5 * 60 * 1000); // Check if valid for next 5 mins

    if (!isTokenPotentiallyValid) {
       // TODO: Implement token refresh logic here.
       // For now, report as error needing reconnection if expired.
       console.warn(`QBO Status Action: Access token expired or nearing expiry for tenant ${tenantId}. Refresh needed.`);
       return {
           status: 'Error',
           errorMessage: 'Connection expired. Please reconnect.', // Or "Needs Refresh"
           realmId: credentials.realmId,
           connected: false
       };
    }

    // Attempt to fetch company name to verify connection is active
    const companyName = await getQboCompanyName(credentials.accessToken, credentials.realmId);

    if (companyName !== null) { // Check for null, as empty string might be a valid name
      console.log(`QBO Status Action: Connected for tenant ${tenantId}, Realm: ${credentials.realmId}, Company: ${companyName}`);
      return {
        status: 'Connected',
        companyName: companyName,
        realmId: credentials.realmId,
        connected: true,
      };
    } else {
      // Fetching company info failed. Could be transient API issue or invalid token despite expiry check.
      console.error(`QBO Status Action: Failed to fetch company info for tenant ${tenantId} (Realm: ${credentials.realmId}). Token might be invalid or API unavailable.`);
      return {
        status: 'Error',
        errorMessage: 'Failed to verify connection with QuickBooks. Please try reconnecting.',
        realmId: credentials.realmId, // Still useful to return realmId if known
        connected: false,
      };
    }

  } catch (error: any) {
    console.error(`QBO Status Action: Error fetching status for tenant ${tenantId || 'UNKNOWN'}`, error);
    let realmIdOnError: string | undefined = undefined;
    if (tenantId) {
        try {
            // Attempt to read realmId directly without full credential parsing if error occurred early
            // Ensure secretProvider is available in this scope if needed, or handle error differently
            // const credsOnError = await getTenantQboCredentials(secretProvider, tenantId);
            // realmIdOnError = credsOnError?.realmId;
        } catch (e) { /* Ignore secondary error */ }
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
  // TODO: Obtain secretProvider instance (e.g., via dependency injection or factory)
  const secretProvider: ISecretProvider = {} as any; // Placeholder: Assume provider is available

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
            'Customer Sync': ['COMPANY_CREATED', 'COMPANY_UPDATED'],
        };

        // Call the static method on the model
        const deletedCount = await WorkflowEventAttachmentModel.deleteSystemWorkflowAttachmentsForTenant(
            knex,
            tenantId,
            qboWorkflowEventMap
        );

        console.log(`QBO Disconnect Action: Model deleted ${deletedCount} QBO sync workflow event attachments for tenant ${tenantId}`);

    } catch (dbError: any) {
        // Log the error but don't prevent credential deletion
        console.error(`QBO Disconnect Action: Error deleting workflow event attachments via model for tenant ${tenantId}:`, dbError.message);
        // Optionally, you could return a partial success/warning here if needed
    }
    // --- End delete workflow event attachments ---


    // Retrieve credentials *before* deleting if revocation is needed.
    const credentials = await getTenantQboCredentials(secretProvider, tenantId);
    const refreshTokenToRevoke = credentials?.refreshToken;
    const accessTokenToRevoke = credentials?.accessToken; // Revocation might work with access token too

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
  // TODO: Obtain secretProvider instance (e.g., via dependency injection or factory)
  const secretProvider: ISecretProvider = {} as any; // Placeholder: Assume provider is available

  try {
    const credentials = await getTenantQboCredentials(secretProvider, tenantId); // Use helper
    if (!credentials?.realmId || !credentials.accessToken || !credentials.accessTokenExpiresAt) {
      console.log(`[QBO Action] No valid QBO credentials found for tenant ${tenantId}. Cannot fetch TaxCodes.`);
      return [];
    }

    if (new Date(credentials.accessTokenExpiresAt) < new Date()) {
        console.warn(`[QBO Action] Access token expired for tenant ${tenantId}. Refresh needed.`);
        // TODO: Implement refresh logic
        return [];
    }

    console.log(`[QBO Action] Fetching TaxCodes for tenant ${tenantId}, realm ${credentials.realmId}`);

    const query = 'SELECT Id, Name FROM TaxCode MAXRESULTS 1000';
    const queryUrl = `${QBO_BASE_URL}/v3/company/${credentials.realmId}/query?query=${encodeURIComponent(query)}`;

    const response = await axios.get(queryUrl, {
        headers: {
            'Authorization': `Bearer ${credentials.accessToken}`,
            'Accept': 'application/json',
        },
        timeout: 15000,
    });

    const qboTaxCodes = response.data?.QueryResponse?.TaxCode || [];

    const mappedTaxCodes: QboTaxCode[] = qboTaxCodes.map((tc: any) => ({
      id: tc.Id,
      name: tc.Name,
    }));

    console.log(`[QBO Action] Found ${mappedTaxCodes.length} QBO TaxCodes for tenant ${tenantId}.`);
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
  // TODO: Obtain secretProvider instance (e.g., via dependency injection or factory)
  const secretProvider: ISecretProvider = {} as any; // Placeholder: Assume provider is available

  try {
    const credentials = await getTenantQboCredentials(secretProvider, tenantId); // Use helper
    if (!credentials?.realmId || !credentials.accessToken || !credentials.accessTokenExpiresAt) {
      console.log(`[QBO Action] No valid QBO credentials found for tenant ${tenantId}. Cannot fetch Terms.`);
      return [];
    }

    if (new Date(credentials.accessTokenExpiresAt) < new Date()) {
        console.warn(`[QBO Action] Access token expired for tenant ${tenantId}. Refresh needed.`);
        // TODO: Implement refresh logic
        return [];
    }

    console.log(`[QBO Action] Fetching Terms for tenant ${tenantId}, realm ${credentials.realmId}`);

    const query = 'SELECT Id, Name FROM Term MAXRESULTS 1000';
    const queryUrl = `${QBO_BASE_URL}/v3/company/${credentials.realmId}/query?query=${encodeURIComponent(query)}`;

    const response = await axios.get(queryUrl, {
        headers: {
            'Authorization': `Bearer ${credentials.accessToken}`,
            'Accept': 'application/json',
        },
        timeout: 15000,
    });

    const qboTerms = response.data?.QueryResponse?.Term || [];

    const mappedTerms: QboTerm[] = qboTerms.map((term: any) => ({
      id: term.Id,
      name: term.Name,
    }));

    console.log(`[QBO Action] Found ${mappedTerms.length} QBO Terms for tenant ${tenantId}.`);
    return mappedTerms;

  } catch (error: any) {
    console.error(`[QBO Action] Error fetching QBO Terms for tenant ${tenantId}:`, error.response?.data || error.message);
     if (axios.isAxiosError(error) && error.response?.status === 401) {
        console.warn(`[QBO Action] QBO API returned 401 for Term query (Tenant: ${tenantId}). Token may need refresh.`);
    }
    return [];
  }
}