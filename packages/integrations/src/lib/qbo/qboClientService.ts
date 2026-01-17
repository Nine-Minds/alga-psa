import axios from 'axios';
import { getSecretProviderInstance } from '@alga-psa/core';
import type { QboTenantCredentials } from './types';
import { AppError } from 'server/src/lib/errors';
import type { ExternalCompanyRecord, NormalizedCompanyPayload } from 'server/src/lib/services/companySync/companySync.types';

// Define QuickBooksInstance type locally
interface QuickBooksInstance {
  query: (query: string, callback: (err: any, result: any) => void) => void;
  [key: string]: any;
}

// Simple console logger
const logger = {
  debug: (...args: any[]) => console.debug('[QboClientService]', ...args),
  info: (...args: any[]) => console.info('[QboClientService]', ...args),
  warn: (...args: any[]) => console.warn('[QboClientService]', ...args),
  error: (...args: any[]) => console.error('[QboClientService]', ...args),
};

const QBO_TOKEN_ENDPOINT = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const TOKEN_EXPIRY_BUFFER_SECONDS = 300; // Refresh token 5 minutes before expiry
const QBO_CREDENTIALS_SECRET_NAME = 'qbo_credentials';

// Helper functions using proper secret provider
async function getTenantQboCredentials(tenantId: string, realmId: string): Promise<QboTenantCredentials | null> {
  const secretProvider = await getSecretProviderInstance();
  const secret = await secretProvider.getTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME);
  if (!secret) {
    logger.warn(`QBO credentials secret not found for tenant ${tenantId}`);
    return null;
  }
  
  try {
    const allCredentials = JSON.parse(secret) as Record<string, QboTenantCredentials>;
    if (typeof allCredentials !== 'object' || allCredentials === null) {
      logger.warn(`Invalid QBO credentials structure: not an object for tenant ${tenantId}`);
      return null;
    }
    
    const credentials = allCredentials[realmId];
    if (credentials && credentials.accessToken && credentials.refreshToken && credentials.realmId === realmId && credentials.accessTokenExpiresAt && credentials.refreshTokenExpiresAt) {
      return credentials;
    }
    
    logger.warn(`Invalid or missing QBO credentials for tenant ${tenantId}, realm ${realmId}`);
    return null;
  } catch (error) {
    logger.error(`Error parsing QBO credentials for tenant ${tenantId}, realm ${realmId}:`, error);
    return null;
  }
}

async function storeTenantQboCredentials(tenantId: string, credentials: QboTenantCredentials): Promise<void> {
  const secretProvider = await getSecretProviderInstance();
  
  // Get existing credentials to preserve other realms
  let allCredentials: Record<string, QboTenantCredentials> = {};
  try {
    const existingSecret = await secretProvider.getTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME);
    if (existingSecret) {
      allCredentials = JSON.parse(existingSecret);
    }
  } catch (error) {
    logger.warn(`Could not parse existing credentials for tenant ${tenantId}, starting fresh:`, error);
  }
  
  // Update credentials for this realm
  allCredentials[credentials.realmId] = credentials;
  
  // Store updated credentials
  await secretProvider.setTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME, JSON.stringify(allCredentials));
  logger.info(`Stored QBO credentials for tenant ${tenantId}, realm ${credentials.realmId}`);
}

async function getAppSecret(secretName: 'qbo'): Promise<{ clientId: string; clientSecret: string } | null> {
  const secretProvider = await getSecretProviderInstance();
  try {
    const clientId = await secretProvider.getAppSecret('qbo_client_id');
    const clientSecret = await secretProvider.getAppSecret('qbo_client_secret');
    
    if (clientId && clientSecret) {
      return { 
        clientId: typeof clientId === 'string' ? clientId : String(clientId),
        clientSecret: typeof clientSecret === 'string' ? clientSecret : String(clientSecret)
      };
    }
    logger.error('QBO Client ID or Secret not found in app secrets');
    return null;
  } catch (error) {
    logger.error('Error retrieving QBO app secrets:', error);
    return null;
  }
}

export class QboClientService {
  private qbo: QuickBooksInstance | null = null; // Use the instance type
  private tenantId: string;
  private realmId: string;
  private credentials!: QboTenantCredentials; // Use the correct type

  private constructor(tenantId: string, realmId: string) {
    this.tenantId = tenantId;
    this.realmId = realmId;
  }

  /**
   * Factory method to create and initialize the QBO client service.
   * Handles token retrieval and refresh.
   * NOTE: Requires realmId upfront because getTenantQboCredentials needs it.
   * Consider how realmId is obtained before calling this (e.g., from a tenant config table).
   */
  public static async create(tenantId: string, realmId: string): Promise<QboClientService> {
    // Pass both tenantId and realmId as required by the function signature
    const credentials = await getTenantQboCredentials(tenantId, realmId);
    if (!credentials) { // Simplified check, realmId is implicitly checked by the call succeeding
      throw new AppError('QBO_SETUP_INCOMPLETE', `QBO credentials not found for tenant ${tenantId}, realm ${realmId}`);
    }

    // Ensure realmId from credentials matches the one provided (consistency check)
    if (credentials.realmId !== realmId) {
        logger.warn({ tenantId, providedRealmId: realmId, credentialRealmId: credentials.realmId }, "RealmID mismatch between input and stored credentials");
        // Decide on behavior: throw error or trust credentials? For now, trust credentials.
        realmId = credentials.realmId;
    }


    const service = new QboClientService(tenantId, realmId); // Use the potentially corrected realmId
    await service.initialize(credentials);
    return service;
  }

  private async initialize(initialCredentials: QboTenantCredentials): Promise<void> {
    this.credentials = initialCredentials;

    if (this.isTokenExpired()) {
      logger.info({ tenantId: this.tenantId, realmId: this.realmId }, 'QBO access token expired or nearing expiry, refreshing...');
      try {
        await this.refreshToken();
      } catch (error) {
        logger.error({ tenantId: this.tenantId, realmId: this.realmId, error }, 'Failed to refresh QBO token');
        // If refresh fails, we might still try with the old token,
        // or throw immediately depending on desired behavior.
        // For now, we'll let the QBO call fail if the token is truly expired.
        // If the refresh itself failed (e.g., invalid refresh token), throw.
        if (axios.isAxiosError(error) && error.response?.status === 400) {
           // 400 often means invalid grant (bad refresh token)
           throw new AppError('QBO_AUTH_ERROR', 'Failed to refresh QBO token. Please re-authenticate.', { originalError: error });
        }
        // Rethrow other refresh errors
        throw new AppError('QBO_REFRESH_FAILED', 'An error occurred during QBO token refresh.', { originalError: error });
      }
    }

    const qboAppSecrets = await getAppSecret('qbo'); // Assuming 'qbo' is the key for QBO secrets
    if (!qboAppSecrets || !qboAppSecrets.clientId || !qboAppSecrets.clientSecret) {
        throw new AppError('CONFIG_ERROR', 'QBO Client ID or Secret not configured.');
    }

    // Determine environment (sandbox/production) - this might come from config or credentials
    const environment = process.env.NODE_ENV === 'production' ? 'production' : 'sandbox'; // Example logic

    logger.debug({ tenantId: this.tenantId, realmId: this.realmId, environment }, 'Initializing QBO client');

    // Dynamically import node-quickbooks to handle ES module compatibility
    // @ts-ignore - node-quickbooks lacks type definitions
    const QuickBooks = (await import('node-quickbooks')).default;
    
    this.qbo = new QuickBooks(
      qboAppSecrets.clientId,
      qboAppSecrets.clientSecret,
      this.credentials.accessToken,
      false, // no token secret for OAuth 2.0
      this.realmId,
      environment === 'sandbox', // useSandbox
      false, // debug
      null, // minorversion
      '2.0', // oauth version
      this.credentials.refreshToken
    );
    
    logger.debug({ tenantId: this.tenantId, realmId: this.realmId, hasQueryMethod: typeof this.qbo?.query, qboInstance: this.qbo }, 'QBO client initialized');
  }

  private isTokenExpired(): boolean {
    if (!this.credentials.accessTokenExpiresAt) {
      return true; // Assume expired if expiry time is missing
    }
    const now = Date.now();
    const expiryTime = new Date(this.credentials.accessTokenExpiresAt).getTime();
    return now >= expiryTime - TOKEN_EXPIRY_BUFFER_SECONDS * 1000;
  }

  private async refreshToken(): Promise<void> {
    const qboAppSecrets = await getAppSecret('qbo');
     if (!qboAppSecrets || !qboAppSecrets.clientId || !qboAppSecrets.clientSecret) {
        throw new AppError('CONFIG_ERROR', 'QBO Client ID or Secret not configured for token refresh.');
    }

    const clientId = qboAppSecrets.clientId;
    const clientSecret = qboAppSecrets.clientSecret;
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    try {
      const response = await axios.post(
        QBO_TOKEN_ENDPOINT,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.credentials.refreshToken,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            Authorization: `Basic ${basicAuth}`,
          },
        }
      );

      const newTokens = response.data;
      const now = Date.now();
      // Use Partial<QboTenantCredentials> for the intermediate object
      const newCredentialsUpdate: Partial<QboTenantCredentials> = {
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token,
        accessTokenExpiresAt: new Date(now + newTokens.expires_in * 1000).toISOString(),
        refreshTokenExpiresAt: new Date(now + newTokens.x_refresh_token_expires_in * 1000).toISOString(),
        // realmId should not change during refresh, so no need to include it here
      };

      // Update credentials in memory by merging
      this.credentials = { ...this.credentials, ...newCredentialsUpdate };

      // Store the updated credentials securely (ensure the stored object matches QboTenantCredentials)
      await storeTenantQboCredentials(this.tenantId, this.credentials);

      logger.info({ tenantId: this.tenantId, realmId: this.realmId }, 'Successfully refreshed QBO token.');

    } catch (error) {
      logger.error({ tenantId: this.tenantId, realmId: this.realmId, error }, 'Error refreshing QBO token');
      // Let the caller handle the error (rethrow)
      throw error;
    }
  }

  private getClient(): QuickBooksInstance { // Use the instance type
    if (!this.qbo) {
      // This should ideally not happen if create() is used correctly
      throw new AppError('QBO_CLIENT_NOT_INITIALIZED', 'QBO client has not been initialized.');
    }
    logger.debug({ tenantId: this.tenantId, realmId: this.realmId, hasQueryMethod: typeof this.qbo.query, clientMethods: Object.getOwnPropertyNames(this.qbo) }, 'Getting QBO client');
    return this.qbo;
  }

  // --- API Methods ---

  /**
   * Executes a QBO query using the appropriate method based on the query type.
   * @param selectQuery The QBO SQL-like query string (e.g., "SELECT Id, Name FROM Item")
   * @returns Promise resolving to an array of entities
   */
  public async query<T>(selectQuery: string): Promise<T[]> {
    const client = this.getClient();

    logger.debug(
      { tenantId: this.tenantId, realmId: this.realmId, query: selectQuery },
      'Executing QBO query'
    );

    if (selectQuery.toUpperCase().includes('COMPANYINFO')) {
      return this.getClientInfo<T>();
    }

    return this.executeQueryRequest<T>(client, selectQuery);
  }

  private async executeQueryRequest<T>(
    client: QuickBooksInstance,
    selectQuery: string,
    attempt = 0
  ): Promise<T[]> {
    const endpoint =
      typeof (client as any).endpoint === 'string'
        ? (client as any).endpoint
        : 'https://sandbox-quickbooks.api.intuit.com/v3/company/';
    const minorversion = (client as any).minorversion;
    const url = `${endpoint}${this.realmId}/query`;

    const params: Record<string, string> = {
      query: selectQuery
    };

    if (minorversion) {
      params.minorversion = String(minorversion);
    }

    // keep SDK instance aligned with refreshed credentials
    (client as any).token = this.credentials.accessToken;
    (client as any).refreshToken = this.credentials.refreshToken;

    try {
      const response = await axios.get(url, {
        params,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.credentials.accessToken}`
        }
      });

      const queryResponse = response.data?.QueryResponse;
      if (!queryResponse || typeof queryResponse !== 'object') {
        return [];
      }

      const entityKey = Object.keys(queryResponse).find((key) =>
        Array.isArray(queryResponse[key])
      );
      if (!entityKey) {
        return [];
      }

      const results = Array.isArray(queryResponse[entityKey])
        ? (queryResponse[entityKey] as T[])
        : [];

      logger.debug(
        {
          tenantId: this.tenantId,
          realmId: this.realmId,
          entityKey,
          count: results.length
        },
        'QBO query succeeded'
      );

      return results;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 401 && attempt === 0) {
          await this.refreshToken();
          return this.executeQueryRequest<T>(client, selectQuery, attempt + 1);
        }

        const payload = error.response?.data ?? error;
        throw this.mapQboError(payload, 'query');
      }

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError('QBO_API_ERROR', 'QuickBooks query failed.', {
        originalError: error,
        qboOperation: 'query'
      });
    }
  }

  /**
   * Gets client information using the specific QBO method.
   */
  private async getClientInfo<T>(): Promise<T[]> {
    const client = this.getClient();
    
    return new Promise((resolve, reject) => {
      (client as any).getCompanyInfo(this.realmId, (err: any, result: any) => {
        if (err) {
          logger.error({ tenantId: this.tenantId, realmId: this.realmId, error: err }, 'QBO getCompanyInfo failed');
          reject(this.mapQboError(err, 'getCompanyInfo'));
        } else {
          const companyInfo = result?.CompanyInfo || result;
          if (companyInfo) {
            resolve([companyInfo] as T[]);
          } else {
            resolve([]);
          }
        }
      });
    });
  }

  /**
   * Creates a new entity in QBO.
   * @param entityType The type of entity (e.g., 'Invoice', 'Customer')
   * @param data The data for the new entity
   * @returns Promise resolving to the created entity
   */
  public async create<T>(entityType: string, data: any): Promise<T> {
    const client = this.getClient();
    // Use string index signature for dynamic method access
    const createMethodName = `create${entityType}`;

    if (typeof client[createMethodName] !== 'function') {
      throw new AppError('QBO_METHOD_NOT_FOUND', `QBO client method ${createMethodName} not found.`);
    }

    logger.debug({ tenantId: this.tenantId, realmId: this.realmId, entityType, data }, `Creating QBO ${entityType}`);

    return new Promise((resolve, reject) => {
      // Cast client to any to bypass strict type checking for dynamic method call
      (client as any)[createMethodName](data, (err: any, result: T) => {
        if (err) {
          logger.error({ tenantId: this.tenantId, realmId: this.realmId, error: err, entityType, data }, `QBO create ${entityType} failed`);
          reject(this.mapQboError(err, 'create', entityType));
        } else {
          resolve(result);
        }
      });
    });
  }

  async findCustomerByDisplayName(displayName: string): Promise<ExternalCompanyRecord | null> {
    const escaped = displayName.replace(/'/g, "''");
    const results = await this.query<any>(`SELECT Id, DisplayName, SyncToken, PrimaryEmailAddr FROM Customer WHERE DisplayName = '${escaped}'`);
    const customer = Array.isArray(results) && results.length > 0 ? this.unwrapCustomer(results[0]) : null;
    return customer ? this.mapCustomerRecord(customer) : null;
  }

  async createOrUpdateCustomer(payload: NormalizedCompanyPayload): Promise<ExternalCompanyRecord> {
    const existing = await this.findCustomerByDisplayName(payload.name);
    const customerPayload = this.buildCustomerPayload(payload);

    if (existing) {
      const syncToken =
        existing.syncToken ?? (await this.fetchCustomerSyncToken(existing.externalId));
      if (!syncToken) {
        return existing;
      }

      const updated = await this.update<any>('Customer', {
        ...customerPayload,
        Id: existing.externalId,
        SyncToken: syncToken
      });
      return this.mapCustomerRecord(this.unwrapCustomer(updated));
    }

    const created = await this.create<any>('Customer', customerPayload);
    return this.mapCustomerRecord(this.unwrapCustomer(created));
  }

  private buildCustomerPayload(payload: NormalizedCompanyPayload): Record<string, any> {
    const primaryPhone =
      payload.primaryPhone ??
      payload.contacts?.find((contact) => contact.phone)?.phone ??
      null;

    const customer: Record<string, any> = {
      DisplayName: payload.name,
      CompanyName: payload.name
    };

    if (payload.primaryEmail) {
      customer.PrimaryEmailAddr = { Address: payload.primaryEmail };
    }

    if (primaryPhone) {
      customer.PrimaryPhone = { FreeFormNumber: primaryPhone };
    }

    if (payload.billingAddress) {
      customer.BillAddr = {
        Line1: payload.billingAddress.line1 ?? undefined,
        Line2: payload.billingAddress.line2 ?? undefined,
        City: payload.billingAddress.city ?? undefined,
        Country: payload.billingAddress.country ?? undefined,
        CountrySubDivisionCode: payload.billingAddress.region ?? undefined,
        PostalCode: payload.billingAddress.postalCode ?? undefined
      };
    }

    if (payload.notes) {
      customer.Notes = payload.notes;
    }

    return customer;
  }

  private async fetchCustomerSyncToken(customerId: string): Promise<string | null> {
    const customer = await this.read<any>('Customer', customerId);
    const record = this.unwrapCustomer(customer);
    return record?.SyncToken ?? null;
  }

  private unwrapCustomer(record: any): any {
    if (!record) {
      return record;
    }
    return record.Customer ?? record;
  }

  private mapCustomerRecord(customer: Record<string, any>): ExternalCompanyRecord {
    return {
      externalId: customer.Id ?? '',
      displayName: customer.DisplayName ?? '',
      syncToken: customer.SyncToken ?? undefined,
      raw: customer
    };
  }

  /**
   * Updates an existing entity in QBO.
   * Requires Id and SyncToken in the data object.
   * @param entityType The type of entity (e.g., 'Invoice', 'Customer')
   * @param data The data for the update (must include Id and SyncToken)
   * @returns Promise resolving to the updated entity
   */
  public async update<T>(entityType: string, data: { Id: string; SyncToken: string; [key: string]: any }): Promise<T> {
    const client = this.getClient();
    // Use string index signature for dynamic method access
    const updateMethodName = `update${entityType}`;

    if (typeof client[updateMethodName] !== 'function') {
      throw new AppError('QBO_METHOD_NOT_FOUND', `QBO client method ${updateMethodName} not found.`);
    }
    if (!data.Id || !data.SyncToken) {
        throw new AppError('QBO_INVALID_INPUT', `Update operation for ${entityType} requires Id and SyncToken.`);
    }

    logger.debug({ tenantId: this.tenantId, realmId: this.realmId, entityType, data }, `Updating QBO ${entityType}`);

    return new Promise((resolve, reject) => {
       // Cast client to any to bypass strict type checking for dynamic method call
      (client as any)[updateMethodName](data, (err: any, result: T) => {
        if (err) {
          logger.error({ tenantId: this.tenantId, realmId: this.realmId, error: err, entityType, data }, `QBO update ${entityType} failed`);
          reject(this.mapQboError(err, 'update', entityType));
        } else {
          resolve(result);
        }
      });
    });
  }

   /**
   * Reads a specific entity from QBO by its ID.
   * @param entityType The type of entity (e.g., 'Invoice', 'Customer')
   * @param id The ID of the entity to read
   * @returns Promise resolving to the entity or null if not found
   */
  public async read<T>(entityType: string, id: string): Promise<T | null> {
    const client = this.getClient();
     // Use string index signature for dynamic method access
    const readMethodName = `get${entityType}`;

    if (typeof client[readMethodName] !== 'function') {
        throw new AppError('QBO_METHOD_NOT_FOUND', `QBO client method ${readMethodName} not found.`);
    }

    logger.debug({ tenantId: this.tenantId, realmId: this.realmId, entityType, id }, `Reading QBO ${entityType}`);

    return new Promise((resolve, reject) => {
        // Cast client to any to bypass strict type checking for dynamic method call
        (client as any)[readMethodName](id, (err: any, result: T) => {
            if (err) {
                // Handle "not found" specifically - QBO might return an error for this
                // Check error structure based on potential node-quickbooks variations
                const qboError = err?.Fault?.Error?.[0];
                const isNotFound = qboError?.code === '6240' || // Sometimes used for not found? Check QBO docs.
                                 qboError?.code === '610' || // Object Not Found
                                 qboError?.Message?.includes('Object Not Found') ||
                                 err?.message?.includes('not found'); // General check

                if (isNotFound) {
                    logger.warn({ tenantId: this.tenantId, realmId: this.realmId, entityType, id }, `QBO ${entityType} with ID ${id} not found.`);
                    resolve(null); // Return null if not found
                } else {
                    logger.error({ tenantId: this.tenantId, realmId: this.realmId, error: err, entityType, id }, `QBO read ${entityType} failed`);
                    reject(this.mapQboError(err, 'read', entityType));
                }
            } else {
                resolve(result);
            }
        });
    });
  }


  /**
   * Maps QBO SDK errors to application errors.
   */
  private mapQboError(err: any, operation: string, entityType?: string): AppError {
    let message = `QBO API Error during ${operation}`;
    if (entityType) message += ` on ${entityType}`;
    let code: string = 'QBO_API_ERROR';

    // node-quickbooks error structure can vary. Sometimes it's err.Fault.Error[0]
    const qboError = err?.Fault?.Error?.[0];
    if (qboError) {
        // Use optional chaining for safer access
        message += `: ${qboError.Message ?? 'Unknown QBO Error'} (Code: ${qboError.code ?? 'N/A'}, Detail: ${qboError.Detail ?? 'N/A'})`;
        // Potentially map specific QBO error codes to AppError codes
        if (qboError.code === '6240') { // Example: Stale SyncToken
            code = 'QBO_STALE_OBJECT';
            message = `QBO ${entityType || 'entity'} has been updated since it was last read. Please refresh and try again. (SyncToken mismatch)`;
        } else if (qboError.code?.startsWith('2')) { // Validation errors often start with 2xxx
            code = 'QBO_VALIDATION_ERROR';
        } else if (qboError.code?.startsWith('4') || qboError.code?.startsWith('5')) { // Auth/Authz errors
            code = 'QBO_AUTH_ERROR';
        } else if (qboError.code === '610') { // Object Not Found
             code = 'QBO_NOT_FOUND';
             message = `QBO ${entityType || 'entity'} not found.`;
        }
    } else if (err instanceof Error) {
        message += `: ${err.message}`;
    } else {
        message += ': An unknown error occurred.';
    }

    return new AppError(code, message, { originalError: err, qboOperation: operation, qboEntityType: entityType });
  }
}

// Helper function to get an initialized client instance
// This simplifies usage in actions
// Requires realmId upfront
export async function getQboClient(tenantId: string, realmId: string): Promise<QboClientService> {
    try {
        // Pass realmId to create method
        return await QboClientService.create(tenantId, realmId);
    } catch (error) {
        logger.error({ tenantId, realmId, error }, "Failed to create QBO client service instance");
        // Rethrow or handle as appropriate for the application context
        if (error instanceof AppError) {
            throw error;
        }
        throw new AppError('QBO_INIT_FAILED', 'Failed to initialize QuickBooks Online connection.', { originalError: error });
    }
}
