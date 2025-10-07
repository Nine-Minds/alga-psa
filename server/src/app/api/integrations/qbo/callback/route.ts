export const dynamic = 'force-dynamic';

// server/src/app/api/integrations/qbo/callback/route.ts
// server/src/app/api/integrations/qbo/callback/route.ts
import { NextResponse } from 'next/server';
import axios from 'axios';
import { URLSearchParams } from 'url';
// --- Import Actual Implementations ---
import { createTenantKnex } from '../../../../../lib/db'; // Added DB import
import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import { ISecretProvider } from '@alga-psa/shared/core';
import { getSecretProviderInstance } from '@alga-psa/shared/core/secretProvider'; // Corrected import path
import { createWorkflowEventAttachment } from '../../../../../lib/actions/workflow-event-attachment-actions'; // Added action import
import { EventCatalogModel } from '../../../../../models/eventCatalog'; // Added model import
// TODO: Import actual CSRF token validation logic
// import { getAndVerifyCsrfToken } from '../../../../../lib/auth/csrf'; // Hypothetical path

// --- Constants ---
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QBO_CLIENT_ID_SECRET_NAME = 'qbo_client_id';
const QBO_CLIENT_SECRET_SECRET_NAME = 'qbo_client_secret';
const QBO_REDIRECT_URI = process.env.QBO_REDIRECT_URI || 'http://localhost:3000/api/integrations/qbo/callback';
const QBO_CREDENTIALS_SECRET_NAME = 'qbo_credentials'; // For storing tenant credentials

// --- Configuration ---
// Using process.env.APP_BASE_URL assuming it's set correctly for the server environment.
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
// Define UI redirect URLs relative to APP_BASE_URL
const SUCCESS_REDIRECT_URL = `/msp/settings?tab=integrations&qbo_status=success`; // Task 83: Redirect back to settings
const FAILURE_REDIRECT_URL = `/msp/settings?tab=integrations&qbo_status=failure&error=`; // Task 83: Redirect back to settings

// --- Handler ---

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state'); // Contains base64url encoded { tenantId, csrf }
  const realmId = searchParams.get('realmId');
  const qboError = searchParams.get('error');

  const failureRedirect = (errorCode: string, message?: string) => {
    const url = new URL(FAILURE_REDIRECT_URL + encodeURIComponent(errorCode), APP_BASE_URL);
    if (message) {
      url.searchParams.append('message', message);
    }
    console.log(`Redirecting to failure URL: ${url.toString()}`);
    return NextResponse.redirect(url);
  };

  const successRedirect = () => {
    const url = new URL(SUCCESS_REDIRECT_URL, APP_BASE_URL);
    console.log(`Redirecting to success URL: ${url.toString()}`);
    return NextResponse.redirect(url);
  };

  if (qboError) {
    console.error('QBO Callback: Intuit returned an error:', qboError);
    return failureRedirect('qbo_error', qboError);
  }

  if (!code || !state || !realmId) {
    console.error('QBO Callback: Missing code, state, or realmId in callback query parameters.');
    return failureRedirect('missing_params');
  }

  let tenantId: string | null = null;
  // Get the secret provider instance
  const secretProvider = await getSecretProviderInstance();

  try {
    // 1. Validate State Parameter (CSRF Protection - Task 83)
    let decodedStatePayload: { tenantId: string; csrf: string };
    try {
      const stateJson = Buffer.from(state, 'base64url').toString('utf-8');
      decodedStatePayload = JSON.parse(stateJson);
      tenantId = decodedStatePayload.tenantId; // Assign tenantId early for logging/cleanup
      if (!tenantId || !decodedStatePayload.csrf) {
        throw new Error('Invalid state payload structure.');
      }
      console.log(`QBO Callback: Decoded state for tenant ${tenantId}`);
    } catch (err) {
      console.error('QBO Callback: Failed to decode or parse state parameter:', err);
      return failureRedirect('invalid_state');
    }

    // TODO: Implement actual CSRF token validation using getAndVerifyCsrfToken(tenantId, decodedStatePayload.csrf)
    // This function should retrieve the stored token, compare it, and delete it if valid.
    // const isValidCsrf = await getAndVerifyCsrfToken(tenantId, decodedStatePayload.csrf);
    const isValidCsrf = true; // Placeholder: Assume valid for now
    if (!isValidCsrf) {
      console.error(`QBO Callback: CSRF token mismatch or validation failed for tenant ${tenantId}.`);
      return failureRedirect('csrf_mismatch');
    }
    console.log(`QBO Callback: CSRF token validated (placeholder) for tenant ${tenantId}.`);


    // 2. Exchange Authorization Code for Tokens (Task 83)
    const clientId = await secretProvider.getAppSecret(QBO_CLIENT_ID_SECRET_NAME);
    const clientSecret = await secretProvider.getAppSecret(QBO_CLIENT_SECRET_SECRET_NAME);

    if (!clientId || !clientSecret) {
      console.error(`QBO Callback: Missing QBO Client ID or Secret in secrets.`);
      return failureRedirect('config_error');
    }

    const authHeader = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: QBO_REDIRECT_URI, // Use the environment variable
    });

    console.log(`QBO Callback: Exchanging code for token for tenant ${tenantId}, realm ${realmId}...`);
    const tokenResponse = await axios.post(QBO_TOKEN_URL, tokenParams.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Authorization': authHeader,
      },
      timeout: 15000, // Increased timeout for token exchange
    });

    const {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: accessTokenExpiresIn, // seconds
      x_refresh_token_expires_in: refreshTokenExpiresIn, // seconds
    } = tokenResponse.data;

    if (!accessToken || !refreshToken) {
      console.error(`QBO Callback: Missing tokens in QBO response for tenant ${tenantId}. Response:`, tokenResponse.data);
      return failureRedirect('token_exchange_failed');
    }
    console.log(`QBO Callback: Tokens received for tenant ${tenantId}, realm ${realmId}.`);

    // 3. Calculate Expiry Timestamps (Store as ISO strings)
    const now = Date.now();
    // Subtract a small buffer (e.g., 5 minutes) to refresh before actual expiry
    const accessTokenExpiresAt = new Date(now + (accessTokenExpiresIn - 300) * 1000).toISOString();
    const refreshTokenExpiresAt = new Date(now + refreshTokenExpiresIn * 1000).toISOString();

    // 4. Securely Store Credentials (including realmId) using ISecretProvider (Task 83)
    //    Read existing credentials, update/add the current realm, and save back.
    let existingCredentials: Record<string, any> = {};
    try {
      const existingSecret = await secretProvider.getTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME);
      if (existingSecret) {
        existingCredentials = JSON.parse(existingSecret);
        if (typeof existingCredentials !== 'object' || existingCredentials === null) {
           console.warn(`QBO Callback: Existing secret '${QBO_CREDENTIALS_SECRET_NAME}' for tenant ${tenantId} is not a valid object. Overwriting with new structure.`);
           existingCredentials = {};
        }
      }
    } catch (e: any) {
      // Handle JSON parse error or other read errors gracefully by starting fresh
      console.warn(`QBO Callback: Could not read/parse existing secret '${QBO_CREDENTIALS_SECRET_NAME}' for tenant ${tenantId}. Initializing new structure. Error: ${e.message}`);
      existingCredentials = {};
    }

    // Prepare the credentials object for the current realm
    const newRealmCredentials = {
      accessToken,
      refreshToken,
      realmId: realmId, // Include realmId within the object as well for consistency
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
    };

    // Add/Update the credentials for the current realmId in the main object
    existingCredentials[realmId] = newRealmCredentials;

    // Save the updated multi-realm credentials object
    await secretProvider.setTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME, JSON.stringify(existingCredentials, null, 2)); // Pretty print for readability

    console.log(`QBO Callback: Successfully stored/updated QBO credentials for tenant ${tenantId}, realm ${realmId} within the multi-scope secret.`);

    // --- BEGIN: Add Workflow Event Attachments using Action ---
    try {
      console.log(`QBO Callback: Attempting to add workflow event attachments via action for tenant ${tenantId}...`);
      const { knex, tenant: contextTenant } = await createTenantKnex(); // Corrected: No argument needed

      // Ensure the tenant from context matches the state parameter tenantId for safety
      if (!contextTenant || contextTenant !== tenantId) {
        console.error(`QBO Callback: Tenant mismatch! State tenant: ${tenantId}, Context tenant: ${contextTenant}. Aborting attachment creation.`);
        throw new Error('Tenant context mismatch during attachment creation.'); // Or handle more gracefully
      }

      // Define target workflows and events
      const invoiceSyncWorkflowName = 'qboInvoiceSyncWorkflow';
      const customerSyncWorkflowName = 'qboCustomerSyncWorkflow';
      const eventWorkflowMap: Record<string, string> = {
        'INVOICE_CREATED': invoiceSyncWorkflowName,
        'INVOICE_UPDATED': invoiceSyncWorkflowName,
        'CLIENT_CREATED': customerSyncWorkflowName,
        'CLIENT_UPDATED': customerSyncWorkflowName,
      };

      // Fetch system workflow registration IDs based on the correct names
      const { systemWorkflows, events } = await withTransaction(knex, async (trx: Knex.Transaction) => {
        const systemWorkflows = await trx('system_workflow_registrations')
          .select('registration_id', 'name')
          .whereIn('name', [invoiceSyncWorkflowName, customerSyncWorkflowName]); // Uses updated names

        // Get event IDs (Assuming EventCatalogModel handles tenant context or we use knex directly)
        const eventTypes = Object.keys(eventWorkflowMap);
        // Use direct Knex query assuming event_catalog is tenant-specific as per model interactions
        const events = await trx('system_event_catalog') // Changed table name
          .select('event_id', 'event_type')
          // Removed tenant filter
          .whereIn('event_type', eventTypes);

        return { systemWorkflows, events };
      });

      const systemWorkflowIdMap = systemWorkflows.reduce((acc, wf) => {
        acc[wf.name] = wf.registration_id; // Map name to registration_id
        return acc;
      }, {} as Record<string, string>);

      // Warn if expected system workflow registrations are not found
      if (!systemWorkflowIdMap[invoiceSyncWorkflowName]) { // Checks for 'qboInvoiceSyncWorkflow' ID
        console.warn(`QBO Callback: System workflow registration '${invoiceSyncWorkflowName}' not found. Skipping related attachments for tenant ${tenantId}.`);
      }
      if (!systemWorkflowIdMap[customerSyncWorkflowName]) { // Checks for 'qboCustomerSyncWorkflow' ID
        console.warn(`QBO Callback: System workflow registration '${customerSyncWorkflowName}' not found. Skipping related attachments for tenant ${tenantId}.`);
      }

      const eventIdMap = events.reduce((acc, ev) => {
        acc[ev.event_type] = ev.event_id;
        return acc;
      }, {} as Record<string, string>);

      // Create attachments using the action
      for (const eventType of eventIdMap) {
        const workflowName = eventWorkflowMap[eventType];
        const workflowId = systemWorkflowIdMap[workflowName]; // Use the map with registration_ids
        const eventId = eventIdMap[eventType];

        if (!workflowId) {
          console.log(`QBO Callback: Skipping attachment for event type '${eventType}' due to missing workflow '${workflowName}' for tenant ${tenantId}.`);
          continue;
        }
        if (!eventId) {
          console.log(`QBO Callback: Skipping attachment for event type '${eventType}' as event was not found in catalog for tenant ${tenantId}.`);
          // Consider if this should be an error or just a warning. If events are expected, it might be an error.
          continue;
        }

        try {
          console.log(`QBO Callback: Calling createWorkflowEventAttachment for tenant ${tenantId}, Event '${eventType}' (ID: ${eventId}) -> Workflow '${workflowName}' (ID: ${workflowId})`);
          await createWorkflowEventAttachment({
            tenant: tenantId,
            event_type: eventType, // Use event_type instead of event_id
            workflow_id: workflowId, // Pass the system workflow registration_id here
            is_active: true, // Default to active
            // 'name' and 'description' are optional in ICreateWorkflowEventAttachment
          });
          console.log(`QBO Callback: Successfully processed attachment request for tenant ${tenantId}: Event '${eventType}' -> Workflow '${workflowName}'. Action handles idempotency.`);
        } catch (actionError: any) {
          // Log specific error from the action, but continue processing others
          console.error(`QBO Callback: Error creating attachment for tenant ${tenantId}, Event '${eventType}' -> Workflow '${workflowName}':`, actionError.message || actionError);
        }
      }

      console.log(`QBO Callback: Finished processing workflow event attachments for tenant ${tenantId}.`);

    } catch (attachmentError: any) {
      // Log the error but don't fail the entire callback, as token storage succeeded.
      console.error(`QBO Callback: General error during workflow event attachment processing for tenant ${tenantId}:`, attachmentError);
      // Optionally: Send an alert or log to a monitoring system
    }
    // --- END: Add Workflow Event Attachments using Action ---


    // 5. Redirect to Success Page (Task 83)
    return successRedirect();

  } catch (error: any) {
    console.error(`QBO Callback: Error during processing for tenant ${tenantId || 'UNKNOWN'}:`, error);
    // Log specific axios errors if available
    if (axios.isAxiosError(error)) {
        console.error('QBO Callback: Axios error details:', {
            message: error.message,
            code: error.code,
            status: error.response?.status,
            data: error.response?.data,
            headers: error.response?.headers,
            config: { // Log relevant config details, avoid logging secrets
                url: error.config?.url,
                method: error.config?.method,
                headers: error.config?.headers ? { ...error.config.headers, Authorization: '[REDACTED]' } : undefined, // Redact auth header
                timeout: error.config?.timeout,
            }
        });
    } else {
        // Log generic error details
        console.error('QBO Callback: Generic error details:', {
            message: error.message,
            stack: error.stack,
        });
    }
    // Redirect to Failure Page
    const errorCode = error.response?.data?.error || 'callback_processing_error';
    const errorMessage = error.response?.data?.error_description || 'An unexpected error occurred during the callback process.';
    return failureRedirect(errorCode, errorMessage);
  }
}
