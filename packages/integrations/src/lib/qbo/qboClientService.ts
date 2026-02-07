import axios, { type AxiosRequestConfig } from 'axios';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import type { QboTenantCredentials } from './types';
import { AppError } from '@alga-psa/core';
import type { ExternalCompanyRecord, NormalizedCompanyPayload } from '@alga-psa/types';

const logger = {
  debug: (...args: any[]) => console.debug('[QboClientService]', ...args),
  info: (...args: any[]) => console.info('[QboClientService]', ...args),
  warn: (...args: any[]) => console.warn('[QboClientService]', ...args),
  error: (...args: any[]) => console.error('[QboClientService]', ...args)
};

const QBO_TOKEN_ENDPOINT = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QBO_SANDBOX_API_BASE = 'https://sandbox-quickbooks.api.intuit.com/v3/company';
const QBO_PRODUCTION_API_BASE = 'https://quickbooks.api.intuit.com/v3/company';
const TOKEN_EXPIRY_BUFFER_SECONDS = 300;
const QBO_CREDENTIALS_SECRET_NAME = 'qbo_credentials';
const QBO_MINOR_VERSION = process.env.QBO_MINOR_VERSION?.trim() || null;

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
    if (
      credentials &&
      credentials.accessToken &&
      credentials.refreshToken &&
      credentials.realmId === realmId &&
      credentials.accessTokenExpiresAt &&
      credentials.refreshTokenExpiresAt
    ) {
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

  let allCredentials: Record<string, QboTenantCredentials> = {};
  try {
    const existingSecret = await secretProvider.getTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME);
    if (existingSecret) {
      allCredentials = JSON.parse(existingSecret);
    }
  } catch (error) {
    logger.warn(`Could not parse existing credentials for tenant ${tenantId}, starting fresh:`, error);
  }

  allCredentials[credentials.realmId] = credentials;

  await secretProvider.setTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME, JSON.stringify(allCredentials));
  logger.info(`Stored QBO credentials for tenant ${tenantId}, realm ${credentials.realmId}`);
}

async function getAppSecrets(): Promise<{ clientId: string; clientSecret: string } | null> {
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
  private tenantId: string;
  private realmId: string;
  private credentials!: QboTenantCredentials;

  private constructor(tenantId: string, realmId: string) {
    this.tenantId = tenantId;
    this.realmId = realmId;
  }

  public static async create(tenantId: string, realmId: string): Promise<QboClientService> {
    const credentials = await getTenantQboCredentials(tenantId, realmId);
    if (!credentials) {
      throw new AppError('QBO_SETUP_INCOMPLETE', `QBO credentials not found for tenant ${tenantId}, realm ${realmId}`);
    }

    if (credentials.realmId !== realmId) {
      logger.warn({ tenantId, providedRealmId: realmId, credentialRealmId: credentials.realmId }, 'RealmID mismatch between input and stored credentials');
      realmId = credentials.realmId;
    }

    const service = new QboClientService(tenantId, realmId);
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
        if (axios.isAxiosError(error) && error.response?.status === 400) {
          throw new AppError('QBO_AUTH_ERROR', 'Failed to refresh QBO token. Please re-authenticate.', { originalError: error });
        }
        throw new AppError('QBO_REFRESH_FAILED', 'An error occurred during QBO token refresh.', { originalError: error });
      }
    }

    const qboAppSecrets = await getAppSecrets();
    if (!qboAppSecrets || !qboAppSecrets.clientId || !qboAppSecrets.clientSecret) {
      throw new AppError('CONFIG_ERROR', 'QBO Client ID or Secret not configured.');
    }

    logger.debug(
      {
        tenantId: this.tenantId,
        realmId: this.realmId,
        environment: this.isProductionEnvironment() ? 'production' : 'sandbox',
        minorVersion: QBO_MINOR_VERSION
      },
      'QBO client initialized'
    );
  }

  private isTokenExpired(): boolean {
    if (!this.credentials.accessTokenExpiresAt) {
      return true;
    }
    const now = Date.now();
    const expiryTime = new Date(this.credentials.accessTokenExpiresAt).getTime();
    return now >= expiryTime - TOKEN_EXPIRY_BUFFER_SECONDS * 1000;
  }

  private async refreshToken(): Promise<void> {
    const qboAppSecrets = await getAppSecrets();
    if (!qboAppSecrets || !qboAppSecrets.clientId || !qboAppSecrets.clientSecret) {
      throw new AppError('CONFIG_ERROR', 'QBO Client ID or Secret not configured for token refresh.');
    }

    const basicAuth = Buffer.from(`${qboAppSecrets.clientId}:${qboAppSecrets.clientSecret}`).toString('base64');

    try {
      const response = await axios.post(
        QBO_TOKEN_ENDPOINT,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.credentials.refreshToken
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            Authorization: `Basic ${basicAuth}`
          }
        }
      );

      const newTokens = response.data;
      const now = Date.now();
      const newCredentialsUpdate: Partial<QboTenantCredentials> = {
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token,
        accessTokenExpiresAt: new Date(now + newTokens.expires_in * 1000).toISOString(),
        refreshTokenExpiresAt: new Date(now + newTokens.x_refresh_token_expires_in * 1000).toISOString()
      };

      this.credentials = { ...this.credentials, ...newCredentialsUpdate };
      await storeTenantQboCredentials(this.tenantId, this.credentials);

      logger.info({ tenantId: this.tenantId, realmId: this.realmId }, 'Successfully refreshed QBO token.');
    } catch (error) {
      logger.error({ tenantId: this.tenantId, realmId: this.realmId, error }, 'Error refreshing QBO token');
      throw error;
    }
  }

  private isProductionEnvironment(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  private getApiBaseUrl(): string {
    return this.isProductionEnvironment() ? QBO_PRODUCTION_API_BASE : QBO_SANDBOX_API_BASE;
  }

  private buildCompanyUrl(path: string): string {
    return `${this.getApiBaseUrl()}/${this.realmId}${path}`;
  }

  private getDefaultParams(extraParams?: Record<string, string>): Record<string, string> {
    return {
      ...(QBO_MINOR_VERSION ? { minorversion: QBO_MINOR_VERSION } : {}),
      ...(extraParams ?? {})
    };
  }

  private normalizeEntityType(entityType: string): string {
    return entityType.toLowerCase();
  }

  private extractEntityPayload<T>(payload: any, entityType: string): T {
    if (payload && typeof payload === 'object' && payload[entityType]) {
      return payload[entityType] as T;
    }
    return payload as T;
  }

  private async requestQbo<T>(
    config: AxiosRequestConfig,
    operation: string,
    entityType?: string,
    attempt = 0
  ): Promise<T> {
    try {
      const response = await axios.request<T>({
        ...config,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.credentials.accessToken}`,
          ...(config.headers ?? {})
        }
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;

        if (status === 401 && attempt === 0) {
          await this.refreshToken();
          return this.requestQbo<T>(config, operation, entityType, attempt + 1);
        }

        if (status === 404) {
          throw new AppError('QBO_NOT_FOUND', `QBO ${entityType ?? 'entity'} not found.`, {
            originalError: error,
            qboOperation: operation,
            qboEntityType: entityType
          });
        }

        const payload = error.response?.data ?? error;
        throw this.mapQboError(payload, operation, entityType);
      }

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError('QBO_API_ERROR', 'QuickBooks request failed.', {
        originalError: error,
        qboOperation: operation,
        qboEntityType: entityType
      });
    }
  }

  public async query<T>(selectQuery: string): Promise<T[]> {
    logger.debug(
      { tenantId: this.tenantId, realmId: this.realmId, query: selectQuery },
      'Executing QBO query'
    );

    if (selectQuery.toUpperCase().includes('COMPANYINFO')) {
      return this.getClientInfo<T>();
    }

    return this.executeQueryRequest<T>(selectQuery);
  }

  private async executeQueryRequest<T>(selectQuery: string): Promise<T[]> {
    const url = this.buildCompanyUrl('/query');

    const data = await this.requestQbo<any>(
      {
        method: 'GET',
        url,
        params: this.getDefaultParams({ query: selectQuery })
      },
      'query'
    );

    const queryResponse = data?.QueryResponse;
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
  }

  private async getClientInfo<T>(): Promise<T[]> {
    const url = this.buildCompanyUrl(`/companyinfo/${this.realmId}`);

    const data = await this.requestQbo<any>(
      {
        method: 'GET',
        url,
        params: this.getDefaultParams()
      },
      'getCompanyInfo'
    );

    const companyInfo = data?.CompanyInfo ?? data;
    return companyInfo ? ([companyInfo] as T[]) : [];
  }

  public async create<T>(entityType: string, data: any): Promise<T> {
    const normalizedEntityType = this.normalizeEntityType(entityType);
    const url = this.buildCompanyUrl(`/${normalizedEntityType}`);

    logger.debug({ tenantId: this.tenantId, realmId: this.realmId, entityType }, `Creating QBO ${entityType}`);

    const payload = await this.requestQbo<any>(
      {
        method: 'POST',
        url,
        data,
        params: this.getDefaultParams(),
        headers: {
          'Content-Type': 'application/json'
        }
      },
      'create',
      entityType
    );

    return this.extractEntityPayload<T>(payload, entityType);
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

  public async update<T>(entityType: string, data: { Id: string; SyncToken: string; [key: string]: any }): Promise<T> {
    if (!data.Id || !data.SyncToken) {
      throw new AppError('QBO_INVALID_INPUT', `Update operation for ${entityType} requires Id and SyncToken.`);
    }

    const normalizedEntityType = this.normalizeEntityType(entityType);
    const url = this.buildCompanyUrl(`/${normalizedEntityType}`);

    logger.debug({ tenantId: this.tenantId, realmId: this.realmId, entityType }, `Updating QBO ${entityType}`);

    const payload = await this.requestQbo<any>(
      {
        method: 'POST',
        url,
        data,
        params: this.getDefaultParams({ operation: 'update' }),
        headers: {
          'Content-Type': 'application/json'
        }
      },
      'update',
      entityType
    );

    return this.extractEntityPayload<T>(payload, entityType);
  }

  public async read<T>(entityType: string, id: string): Promise<T | null> {
    const normalizedEntityType = this.normalizeEntityType(entityType);
    const url = this.buildCompanyUrl(`/${normalizedEntityType}/${id}`);

    logger.debug({ tenantId: this.tenantId, realmId: this.realmId, entityType, id }, `Reading QBO ${entityType}`);

    try {
      const payload = await this.requestQbo<any>(
        {
          method: 'GET',
          url,
          params: this.getDefaultParams()
        },
        'read',
        entityType
      );

      return this.extractEntityPayload<T>(payload, entityType);
    } catch (error) {
      const isNotFound =
        error instanceof AppError &&
        (error.code === 'QBO_NOT_FOUND' || error.code === 'QBO_API_ERROR') &&
        error.message.toLowerCase().includes('not found');

      if (isNotFound) {
        logger.warn({ tenantId: this.tenantId, realmId: this.realmId, entityType, id }, `QBO ${entityType} with ID ${id} not found.`);
        return null;
      }

      throw error;
    }
  }

  private mapQboError(err: any, operation: string, entityType?: string): AppError {
    let message = `QBO API Error during ${operation}`;
    if (entityType) {
      message += ` on ${entityType}`;
    }
    let code = 'QBO_API_ERROR';

    const qboError =
      err?.Fault?.Error?.[0] ??
      err?.fault?.error?.[0] ??
      null;

    if (qboError) {
      message += `: ${qboError.Message ?? 'Unknown QBO Error'} (Code: ${qboError.code ?? 'N/A'}, Detail: ${qboError.Detail ?? 'N/A'})`;

      if (qboError.code === '6240') {
        code = 'QBO_STALE_OBJECT';
        message = `QBO ${entityType || 'entity'} has been updated since it was last read. Please refresh and try again. (SyncToken mismatch)`;
      } else if (qboError.code?.startsWith('2')) {
        code = 'QBO_VALIDATION_ERROR';
      } else if (qboError.code?.startsWith('4') || qboError.code?.startsWith('5')) {
        code = 'QBO_AUTH_ERROR';
      } else if (qboError.code === '610') {
        code = 'QBO_NOT_FOUND';
        message = `QBO ${entityType || 'entity'} not found.`;
      }
    } else if (typeof err?.message === 'string') {
      message += `: ${err.message}`;
      if (err.message.toLowerCase().includes('not found')) {
        code = 'QBO_NOT_FOUND';
      }
    } else {
      message += ': An unknown error occurred.';
    }

    return new AppError(code, message, {
      originalError: err,
      qboOperation: operation,
      qboEntityType: entityType
    });
  }
}

export async function getQboClient(tenantId: string, realmId: string): Promise<QboClientService> {
  try {
    return await QboClientService.create(tenantId, realmId);
  } catch (error) {
    logger.error({ tenantId, realmId, error }, 'Failed to create QBO client service instance');
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('QBO_INIT_FAILED', 'Failed to initialize QuickBooks Online connection.', { originalError: error });
  }
}
