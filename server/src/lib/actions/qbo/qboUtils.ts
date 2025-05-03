// server/src/lib/actions/qbo/qboUtils.ts

// Removed WorkflowContext import
import { QboTenantCredentials, QboApiErrorResponse, QboFault, QboErrorDetail } from './types'; // Added QboFault, QboErrorDetail
// Import necessary HTTP client (e.g., axios, fetch) and secret management utilities
// Using console.log as logger per user feedback
const logger = {
  debug: (...args: any[]) => console.debug('[QBO Utils]', ...args),
  info: (...args: any[]) => console.info('[QBO Utils]', ...args),
  warn: (...args: any[]) => console.warn('[QBO Utils]', ...args),
  error: (...args: any[]) => console.error('[QBO Utils]', ...args),
};

// Placeholder for secret retrieval logic
// This needs to integrate with the pluggable secret provider (Phase 1.5)
// It should fetch tenant-specific QBO credentials (access token, refresh token, realmId)
export async function getTenantQboCredentials(tenantId: string, realmId: string): Promise<QboTenantCredentials> {
  console.warn(`[QBO Utils] Placeholder: Fetching credentials for tenant ${tenantId}, realm ${realmId}`);
  // TODO: Implement actual secret retrieval using ISecretProvider
  // Example structure:
  // const secretProvider = getSecretProvider(); // Get configured provider instance
  // const accessToken = await secretProvider.getTenantSecret(tenantId, `qbo_${realmId}_access_token`);
  // const refreshToken = await secretProvider.getTenantSecret(tenantId, `qbo_${realmId}_refresh_token`);
  // if (!accessToken || !refreshToken) {
  //   throw new Error(`QBO credentials not found for tenant ${tenantId}, realm ${realmId}`);
  // }
  // return { accessToken, refreshToken, realmId };

  // --- Placeholder ---
  if (process.env.NODE_ENV !== 'development') {
      throw new Error('Placeholder getTenantQboCredentials called outside development');
  }
  // Replace with actual dev/test credentials or mock implementation
  return {
    accessToken: process.env.QBO_DEV_ACCESS_TOKEN || 'dummy_access_token',
    refreshToken: process.env.QBO_DEV_REFRESH_TOKEN || 'dummy_refresh_token',
    realmId: realmId,
  };
  // --- End Placeholder ---
}

interface CallQboApiParams<TRequest> {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  credentials: QboTenantCredentials;
  realmId: string;
  tenantId: string;
  data?: TRequest;
  params?: Record<string, string | number>; // URL query parameters
  // Removed context: WorkflowContext;
}

// Placeholder for making the actual QBO API call
// This needs to handle authentication (Bearer token), content type, accept headers,
// potential token refresh logic, and basic response parsing.
// It should also incorporate the tenant-scoped locking/throttling (Phase 2 requirement).
export async function callQboApi<TResponse>(args: CallQboApiParams<any>): Promise<TResponse> {
  // Destructure params, removing context
  const { method, url, credentials, data, params, tenantId, realmId } = args;

  // Use the globally defined logger or pass one if needed
  logger.debug(`[QBO Utils] Calling QBO API: ${method} ${url} for tenant ${tenantId}, realm ${realmId}`);

  // --- Locking & Throttling Placeholders (Phase 2 / Section 5.4) ---
  // TODO: Implement actual Redis client initialization and logic
  // const redisClient = getRedisClient(); // Assume a way to get a Redis client

  // 1. Concurrency Limiter (e.g., 10 concurrent requests per realm)
  const concurrencyKey = `qbo:concurrency:${tenantId}:${realmId}`;
  const maxConcurrency = 10;
  // Placeholder: Logic to acquire a concurrency slot (e.g., using INCR, checking against maxConcurrency, potentially using Lua script or a library like RedisSemaphore)
  // await acquireConcurrencySlot(redisClient, concurrencyKey, maxConcurrency);
  logger.debug(`[QBO Utils] Placeholder: Acquired concurrency slot for ${concurrencyKey}`);

  // 2. Rate Limiter (e.g., 500 requests per minute per realm)
  const rateLimitKey = `qbo:rpm:${tenantId}:${realmId}`;
  const maxRate = 500;
  const rateWindowSeconds = 60;
  // Placeholder: Logic to check/increment rate limit (e.g., using INCR with EXPIRE, potentially using leaky bucket algorithm or library)
  // await checkRateLimit(redisClient, rateLimitKey, maxRate, rateWindowSeconds);
  logger.debug(`[QBO Utils] Placeholder: Passed rate limit check for ${rateLimitKey}`);

  // 3. Optional: Entity-specific lock (if needed for specific operations like updates)
  // const entityType = 'Customer'; // Example, determine based on URL/operation
  // const entityId = data?.Id; // Example
  // let releaseEntityLock: (() => Promise<void>) | null = null;
  // if (method === 'POST' && entityId) { // Example condition for locking
  //   const entityLockKey = `qbo:lock:${tenantId}:${realmId}:${entityType}:${entityId}`;
  //   // Placeholder: Acquire distributed lock (e.g., using SETNX with expiry)
  //   // releaseEntityLock = await acquireDistributedLock(redisClient, entityLockKey);
  //   logger.debug(`[QBO Utils] Placeholder: Acquired entity lock for ${entityLockKey}`);
  // }
  // --- End Locking & Throttling Placeholders ---

  try {
    // TODO: Implement actual HTTP request using axios or fetch
    // Example using fetch:
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${credentials.accessToken}`,
      'Accept': 'application/json',
    };
    if (method === 'POST' || method === 'PUT') {
      headers['Content-Type'] = 'application/json';
    }

    const requestOptions: RequestInit = {
      method: method,
      headers: headers,
      body: data ? JSON.stringify(data) : undefined,
    };

    // Construct URL with query params if any
    const finalUrl = new URL(url);
    if (params) {
        Object.entries(params).forEach(([key, value]) => {
            finalUrl.searchParams.append(key, String(value));
        });
    }

    // --- Placeholder Response ---
    logger.warn(`[QBO Utils] Placeholder: Simulating ${method} request to ${finalUrl.toString()}`);
    // Simulate a successful response structure based on QBO patterns
    // Replace this with actual fetch call and response handling
    if (method === 'POST' && url.includes('/customer') && !url.includes('query')) {
        // Simulate create/update response
        const simulatedId = data?.Id || `qbo-cust-${Date.now()}`;
        const simulatedSyncToken = String(parseInt(data?.SyncToken || '0') + 1);
        return {
            Customer: {
                ...data,
                Id: simulatedId,
                SyncToken: simulatedSyncToken,
                MetaData: { CreateTime: new Date().toISOString(), LastUpdatedTime: new Date().toISOString() }
            },
            time: new Date().toISOString()
        } as unknown as TResponse;
    } else if (method === 'GET' && url.includes('/query')) {
         // Simulate query response
         return {
             QueryResponse: { Customer: [], totalCount: 0, startPosition: 1, maxResults: 0 },
             time: new Date().toISOString()
         } as unknown as TResponse;
    }
    // Add more simulation cases as needed for Invoice, Item lookups etc.

    throw new Error(`[QBO Utils] Placeholder: No simulation for ${method} ${url}`);
    // --- End Placeholder Response ---

    /*
    // Actual fetch implementation:
    const response = await fetch(finalUrl.toString(), requestOptions);

    if (!response.ok) {
      // Handle QBO API errors (4xx, 5xx)
      const errorBody = await response.json();
      const qboError: QboApiErrorResponse = errorBody;
      logger.error(`[QBO Utils] QBO API Error (${response.status}): ${JSON.stringify(qboError)}`);
      // TODO: Check for 401 Unauthorized and potentially trigger token refresh
      throw new Error(`QBO API Error (${response.status}): ${qboError.Fault?.Error[0]?.Message || response.statusText}`);
    }

    const responseData = await response.json();
    logger.debug(`[QBO Utils] QBO API Response: ${JSON.stringify(responseData)}`);
    return responseData as TResponse;
    */

  } catch (error) {
    // Handle network errors or other exceptions
    logger.error(`[QBO Utils] Error during QBO API call: ${error instanceof Error ? error.message : String(error)}`, error);
    throw error; // Re-throw to be handled by the action
  } finally {
    // --- Release Locks/Permits ---
    // Placeholder: Release entity lock if acquired
    // if (releaseEntityLock) {
    //   await releaseEntityLock();
    //   logger.debug(`[QBO Utils] Placeholder: Released entity lock`);
    // }
    // Placeholder: Release concurrency slot
    // await releaseConcurrencySlot(redisClient, concurrencyKey);
    logger.debug(`[QBO Utils] Placeholder: Released concurrency slot for ${concurrencyKey}`);
    // Rate limiter typically doesn't need explicit release unless using tokens
    // --- End Release ---
  }
}

// Placeholder for handling QBO API errors, potentially implementing retries
// Removed context parameter
export async function handleQboApiError(error: any, tenantId: string, realmId: string): Promise<void> {
  // Use the globally defined logger
  logger.warn(`[QBO Utils] Handling QBO API Error for tenant ${tenantId}, realm ${realmId}: ${error.message}`);

  // TODO: Implement retry logic based on error type (e.g., 429 Rate Limit)
  // Check if the error object contains QBO fault details
  const qboFault = error?.qboErrorResponse?.Fault as QboFault | undefined;
  const httpStatusCode = error?.httpStatusCode as number | undefined; // Assuming the caller attaches this

  if (httpStatusCode === 429) {
    logger.warn(`[QBO Utils] QBO Rate Limit (429) encountered for tenant ${tenantId}, realm ${realmId}. Implement backoff/retry.`);
    // TODO: Implement exponential backoff and retry mechanism
    // This might involve throwing a specific retryable error type for the workflow engine
  } else if (httpStatusCode === 401) {
     logger.error(`[QBO Utils] QBO Authentication Error (401) for tenant ${tenantId}, realm ${realmId}. Token refresh needed.`);
     // TODO: Trigger token refresh mechanism (likely outside this function, maybe via event or specific error)
  } else if (qboFault?.type === 'ValidationFault') {
     logger.error(`[QBO Utils] QBO Validation Error for tenant ${tenantId}, realm ${realmId}: ${JSON.stringify(qboFault.Error)}`);
     // These are typically non-retryable without data correction.
     // TODO: Consider creating a human task (Phase 2 / Section 5.3)
  } else if (qboFault?.Error?.some((e: QboErrorDetail) => e.code === '6240')) { // Example: Stale SyncToken - Added type for 'e'
     logger.warn(`[QBO Utils] Detected stale SyncToken (Error 6240) for tenant ${tenantId}, realm ${realmId}. Consider re-fetching entity.`);
     // This might require the workflow to re-fetch the entity and retry the update.
     // Throw a specific error type?
  } else {
    // Log other/generic errors
    logger.error(`[QBO Utils] Unhandled QBO API Error type for tenant ${tenantId}, realm ${realmId}. Status: ${httpStatusCode}, Fault: ${JSON.stringify(qboFault)}`);
  }

  // For now, just log. The calling action re-throws the original error by default.
  // Specific error types could be thrown here to signal retry/human task needs to the workflow.
}