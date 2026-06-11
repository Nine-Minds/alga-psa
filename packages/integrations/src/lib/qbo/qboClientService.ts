import axios, { type AxiosRequestConfig } from 'axios';
import { getSecretProviderInstance, type ISecretProvider } from '@alga-psa/core/secrets';
import type { QboTenantCredentials } from './types';
import { AppError } from '@alga-psa/core';
import type {
  AccountingChangeSet,
  AccountingExternalChange,
  AccountingExternalChangeEntity,
  ExternalCompanyRecord,
  NormalizedCompanyPayload
} from '@alga-psa/types';

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
const QBO_CREDENTIALS_SECRET = 'qbo_credentials';
const QBO_CLIENT_ID_SECRET = 'qbo_client_id';
const QBO_CLIENT_SECRET_SECRET = 'qbo_client_secret';
const QBO_MINOR_VERSION = process.env.QBO_MINOR_VERSION?.trim() || null;
const DEFAULT_QBO_SCOPES = ['com.intuit.quickbooks.accounting'];

export const QBO_TOKEN_URL = QBO_TOKEN_ENDPOINT;
export const QBO_CREDENTIALS_SECRET_NAME = QBO_CREDENTIALS_SECRET;
export const QBO_CLIENT_ID_SECRET_NAME = QBO_CLIENT_ID_SECRET;
export const QBO_CLIENT_SECRET_SECRET_NAME = QBO_CLIENT_SECRET_SECRET;

const QBO_CLIENT_ID_ENV_FALLBACKS = [
  QBO_CLIENT_ID_SECRET,
  'QBO_CLIENT_ID',
  'QBO_OAUTH_CLIENT_ID'
];

const QBO_CLIENT_SECRET_ENV_FALLBACKS = [
  QBO_CLIENT_SECRET_SECRET,
  'QBO_CLIENT_SECRET',
  'QBO_OAUTH_CLIENT_SECRET'
];

function readTrimmedSecret(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function resolveEnvSecret(candidateKeys: string[]): string | undefined {
  for (const key of candidateKeys) {
    const value = typeof process !== 'undefined' ? process.env?.[key] : undefined;
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

async function resolveAppSecret(
  secretProvider: ISecretProvider,
  secretName: string,
  envKeys: string[]
): Promise<string | undefined> {
  const secretValue = await secretProvider.getAppSecret(secretName);
  if (typeof secretValue === 'string' && secretValue.trim().length > 0) {
    return secretValue.trim();
  }
  return resolveEnvSecret(envKeys);
}

export async function getQboClientId(secretProvider?: ISecretProvider): Promise<string | undefined> {
  const provider = secretProvider ?? await getSecretProviderInstance();
  return resolveAppSecret(provider, QBO_CLIENT_ID_SECRET, QBO_CLIENT_ID_ENV_FALLBACKS);
}

export async function getQboClientSecret(secretProvider?: ISecretProvider): Promise<string | undefined> {
  const provider = secretProvider ?? await getSecretProviderInstance();
  return resolveAppSecret(provider, QBO_CLIENT_SECRET_SECRET, QBO_CLIENT_SECRET_ENV_FALLBACKS);
}

export async function getTenantOwnedQboClientId(
  tenantId: string,
  secretProvider?: ISecretProvider
): Promise<string | undefined> {
  const provider = secretProvider ?? await getSecretProviderInstance();
  return readTrimmedSecret(await provider.getTenantSecret(tenantId, QBO_CLIENT_ID_SECRET));
}

export async function getTenantOwnedQboClientSecret(
  tenantId: string,
  secretProvider?: ISecretProvider
): Promise<string | undefined> {
  const provider = secretProvider ?? await getSecretProviderInstance();
  return readTrimmedSecret(await provider.getTenantSecret(tenantId, QBO_CLIENT_SECRET_SECRET));
}

export type QboCredentialSource = 'tenant' | 'app';

export interface ResolvedQboOAuthCredentials {
  clientId: string;
  clientSecret: string;
  source: QboCredentialSource;
}

export async function resolveQboOAuthCredentials(
  tenantId: string,
  secretProvider?: ISecretProvider
): Promise<ResolvedQboOAuthCredentials> {
  const provider = secretProvider ?? await getSecretProviderInstance();
  const [tenantClientId, tenantClientSecret] = await Promise.all([
    getTenantOwnedQboClientId(tenantId, provider),
    getTenantOwnedQboClientSecret(tenantId, provider)
  ]);

  if (tenantClientId && tenantClientSecret) {
    return {
      clientId: tenantClientId,
      clientSecret: tenantClientSecret,
      source: 'tenant'
    };
  }

  if (tenantClientId || tenantClientSecret) {
    throw new AppError(
      'QBO_CONFIG_MISSING',
      'QuickBooks client ID and client secret must both be configured for this tenant before connecting.'
    );
  }

  const [appClientId, appClientSecret] = await Promise.all([
    getQboClientId(provider),
    getQboClientSecret(provider)
  ]);

  if (!appClientId || !appClientSecret) {
    throw new AppError(
      'QBO_CONFIG_MISSING',
      'QuickBooks client credentials are not configured for this tenant or the application fallback.'
    );
  }

  return {
    clientId: appClientId,
    clientSecret: appClientSecret,
    source: 'app'
  };
}

export type QboEnvironment = 'sandbox' | 'production';

export function getQboEnvironment(): QboEnvironment {
  const configured = readTrimmedSecret(process.env.QBO_ENVIRONMENT)?.toLowerCase();
  if (configured === 'sandbox' || configured === 'production') {
    return configured;
  }
  if (configured) {
    logger.warn(`Ignoring invalid QBO_ENVIRONMENT value "${configured}"; expected "sandbox" or "production"`);
  }
  return process.env.NODE_ENV === 'production' ? 'production' : 'sandbox';
}

function computeBaseUrl(envValue?: string | null): string {
  const raw = (envValue || '').trim();
  if (!raw) {
    return 'http://localhost:3000';
  }

  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return 'http://localhost:3000';
  }
}

export async function getQboDeploymentBaseUrl(secretProvider?: ISecretProvider): Promise<string> {
  const provider = secretProvider ?? await getSecretProviderInstance();
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (await provider.getAppSecret('NEXT_PUBLIC_BASE_URL')) ||
    process.env.NEXTAUTH_URL ||
    (await provider.getAppSecret('NEXTAUTH_URL')) ||
    'http://localhost:3000';

  return computeBaseUrl(base);
}

export async function getQboRedirectUri(secretProvider?: ISecretProvider): Promise<string> {
  const provider = secretProvider ?? await getSecretProviderInstance();
  const override =
    readTrimmedSecret(process.env.QBO_REDIRECT_URI) ??
    readTrimmedSecret(await provider.getAppSecret('QBO_REDIRECT_URI'));
  if (override) {
    return override;
  }
  return `${await getQboDeploymentBaseUrl(provider)}/api/integrations/qbo/callback`;
}

export function getQboOAuthScopes(): string[] {
  const configured = readTrimmedSecret(process.env.QBO_OAUTH_SCOPES);
  if (!configured) {
    return DEFAULT_QBO_SCOPES;
  }

  return configured
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export function getQboOAuthScopesString(): string {
  return getQboOAuthScopes().join(' ');
}

export async function getStoredQboCredentialsMap(tenantId: string): Promise<Record<string, QboTenantCredentials>> {
  const secretProvider = await getSecretProviderInstance();
  const secret = await secretProvider.getTenantSecret(tenantId, QBO_CREDENTIALS_SECRET);
  if (!secret) {
    return {};
  }

  try {
    const allCredentials = JSON.parse(secret) as Record<string, QboTenantCredentials>;
    if (typeof allCredentials !== 'object' || allCredentials === null) {
      logger.warn(`Invalid QBO credentials structure: not an object for tenant ${tenantId}`);
      return {};
    }
    return allCredentials;
  } catch (error) {
    logger.error(`Error parsing QBO credentials for tenant ${tenantId}:`, error);
    return {};
  }
}

export async function getDefaultQboRealmId(tenantId: string): Promise<string | null> {
  const allCredentials = await getStoredQboCredentialsMap(tenantId);
  const firstRealmId = Object.keys(allCredentials)[0];
  return firstRealmId ?? null;
}

function isValidQboCredentials(credentials: QboTenantCredentials | undefined, realmId: string): credentials is QboTenantCredentials {
  return Boolean(
    credentials &&
    credentials.accessToken &&
    credentials.refreshToken &&
    credentials.realmId === realmId &&
    credentials.accessTokenExpiresAt &&
    credentials.refreshTokenExpiresAt
  );
}

async function getTenantQboCredentials(tenantId: string, realmId: string): Promise<QboTenantCredentials | null> {
  const allCredentials = await getStoredQboCredentialsMap(tenantId);
  const credentials = allCredentials[realmId];
  if (isValidQboCredentials(credentials, realmId)) {
    return credentials;
  }

  logger.warn(`Invalid or missing QBO credentials for tenant ${tenantId}, realm ${realmId}`);
  return null;
}

export async function upsertStoredQboCredentials(tenantId: string, credentials: QboTenantCredentials): Promise<void> {
  const secretProvider = await getSecretProviderInstance();
  const allCredentials = await getStoredQboCredentialsMap(tenantId);

  allCredentials[credentials.realmId] = credentials;

  await secretProvider.setTenantSecret(tenantId, QBO_CREDENTIALS_SECRET, JSON.stringify(allCredentials));
  logger.info(`Stored QBO credentials for tenant ${tenantId}, realm ${credentials.realmId}`);
}

export class QboClientService {
  private tenantId: string;
  private realmId: string;
  private credentials!: QboTenantCredentials;

  private constructor(tenantId: string, realmId: string) {
    this.tenantId = tenantId;
    this.realmId = realmId;
  }

  public static async create(tenantId: string, realmId?: string | null): Promise<QboClientService> {
    if (!realmId) {
      realmId = await getDefaultQboRealmId(tenantId);
      if (!realmId) {
        throw new AppError('QBO_SETUP_INCOMPLETE', `No QuickBooks Online connections configured for tenant ${tenantId}`);
      }
    }

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

    await resolveQboOAuthCredentials(this.tenantId);

    logger.debug(
      {
        tenantId: this.tenantId,
        realmId: this.realmId,
        environment: getQboEnvironment(),
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
    const { clientId, clientSecret } = await resolveQboOAuthCredentials(this.tenantId);

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

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
      await upsertStoredQboCredentials(this.tenantId, this.credentials);

      logger.info({ tenantId: this.tenantId, realmId: this.realmId }, 'Successfully refreshed QBO token.');
    } catch (error) {
      logger.error({ tenantId: this.tenantId, realmId: this.realmId, error }, 'Error refreshing QBO token');
      throw error;
    }
  }

  private isProductionEnvironment(): boolean {
    return getQboEnvironment() === 'production';
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

  /**
   * QuickBooks Change Data Capture: every Customer/Payment/Invoice/CreditMemo
   * changed (or deleted) since the given ISO timestamp, in one call.
   * QBO caps CDC at 1000 rows per entity; `truncated` signals the caller to
   * poll again soon with the same cursor.
   */
  public async fetchChanges(since: string): Promise<AccountingChangeSet> {
    const CDC_ENTITIES: AccountingExternalChangeEntity[] = ['Customer', 'Payment', 'Invoice', 'CreditMemo', 'RefundReceipt'];
    const url = this.buildCompanyUrl('/cdc');

    const data = await this.requestQbo<any>(
      {
        method: 'GET',
        url,
        params: this.getDefaultParams({
          entities: CDC_ENTITIES.join(','),
          changedSince: since
        })
      },
      'changeDataCapture'
    );

    const changes: AccountingExternalChange[] = [];
    let truncated = false;

    const cdcResponses = Array.isArray(data?.CDCResponse) ? data.CDCResponse : [];
    for (const cdcResponse of cdcResponses) {
      const queryResponses = Array.isArray(cdcResponse?.QueryResponse) ? cdcResponse.QueryResponse : [];
      for (const queryResponse of queryResponses) {
        for (const entityType of CDC_ENTITIES) {
          const rows = queryResponse?.[entityType];
          if (!Array.isArray(rows)) {
            continue;
          }
          if (rows.length >= 1000) {
            truncated = true;
          }
          for (const row of rows) {
            if (!row?.Id) {
              continue;
            }
            changes.push({
              entityType,
              externalId: String(row.Id),
              syncToken: row.SyncToken !== undefined && row.SyncToken !== null ? String(row.SyncToken) : undefined,
              deleted: row.status === 'Deleted',
              updatedAt: row.MetaData?.LastUpdatedTime,
              payload: row
            });
          }
        }
      }
    }

    logger.debug(
      { tenantId: this.tenantId, realmId: this.realmId, since, count: changes.length, truncated },
      'QBO change data capture fetched'
    );

    return { changes, truncated, fetchedAt: new Date().toISOString() };
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

  /**
   * Void a QBO Invoice (sets DocStatus=Voided in place).
   */
  public async voidInvoice(id: string, syncToken: string): Promise<any> {
    const url = this.buildCompanyUrl('/invoice');
    logger.debug({ tenantId: this.tenantId, realmId: this.realmId, id }, 'Voiding QBO Invoice');
    const payload = await this.requestQbo<any>(
      {
        method: 'POST',
        url,
        data: { Id: id, SyncToken: syncToken },
        params: this.getDefaultParams({ operation: 'void' }),
        headers: { 'Content-Type': 'application/json' }
      },
      'voidInvoice',
      'Invoice'
    );
    return this.extractEntityPayload<any>(payload, 'Invoice');
  }

  /**
   * Delete a QBO CreditMemo (QBO has no void for credit memos; delete is the
   * equivalent operation).
   */
  public async deleteCreditMemo(id: string, syncToken: string): Promise<any> {
    const url = this.buildCompanyUrl('/creditmemo');
    logger.debug({ tenantId: this.tenantId, realmId: this.realmId, id }, 'Deleting QBO CreditMemo');
    const payload = await this.requestQbo<any>(
      {
        method: 'POST',
        url,
        data: { Id: id, SyncToken: syncToken },
        params: this.getDefaultParams({ operation: 'delete' }),
        headers: { 'Content-Type': 'application/json' }
      },
      'deleteCreditMemo',
      'CreditMemo'
    );
    return this.extractEntityPayload<any>(payload, 'CreditMemo');
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

export async function getQboClient(tenantId: string, realmId?: string | null): Promise<QboClientService> {
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
