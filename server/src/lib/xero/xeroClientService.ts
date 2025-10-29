import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import logger from '@shared/core/logger';
import { getSecretProviderInstance } from '@alga-psa/shared/core';
import { AppError } from '../errors';

const XERO_TOKEN_ENDPOINT = 'https://identity.xero.com/connect/token';
const XERO_API_BASE_URL = 'https://api.xero.com/api.xro/2.0';
const XERO_CREDENTIALS_SECRET = 'xero_credentials';
const XERO_CLIENT_ID_SECRET = 'xero_client_id';
const XERO_CLIENT_SECRET_SECRET = 'xero_client_secret';
const ACCESS_TOKEN_BUFFER_SECONDS = 300;

export interface XeroTrackingCategoryOption {
  name: string;
  option: string;
}

export interface XeroTaxComponentPayload {
  taxComponentId?: string;
  name?: string;
  rate?: number;
  amountCents?: number | null;
}

export interface XeroInvoiceLinePayload {
  lineId: string;
  amountCents: number;
  description?: string | null;
  quantity?: number | null;
  unitAmountCents?: number | null;
  itemCode?: string | null;
  accountCode?: string | null;
  taxType?: string | null;
  taxAmountCents?: number | null;
  taxComponents?: XeroTaxComponentPayload[] | null;
  tracking?: XeroTrackingCategoryOption[] | Record<string, string> | null;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
}

export interface XeroInvoicePayload {
  invoiceId: string;
  contactId: string;
  currency?: string | null;
  reference?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  lineAmountType?: 'Exclusive' | 'Inclusive' | 'NoTax';
  amountCents: number;
  lines: XeroInvoiceLinePayload[];
  metadata?: Record<string, unknown>;
}

export interface XeroInvoiceCreateSuccess {
  status: 'success';
  invoiceId: string;
  documentId: string;
  invoiceNumber?: string;
  raw?: Record<string, unknown>;
}

export interface XeroInvoiceCreateFailure {
  status: 'error';
  documentId?: string;
  message: string;
  validationErrors?: Array<{ message: string; field?: string }>;
  raw?: unknown;
}

export interface XeroAccount {
  accountId: string;
  code?: string;
  name: string;
  type?: string;
  status?: string;
}

export interface XeroItem {
  itemId: string;
  code?: string;
  name: string;
  status?: string;
  isTrackedAsInventory?: boolean;
}

export interface XeroTaxRate {
  taxRateId: string;
  name: string;
  taxType?: string;
  status?: string;
  effectiveRate?: number | null;
  components?: Array<{ name: string; rate: number }>;
}

export interface XeroTrackingOption {
  trackingOptionId: string;
  name: string;
  status?: string;
}

export interface XeroTrackingCategory {
  trackingCategoryId: string;
  name: string;
  status?: string;
  options: XeroTrackingOption[];
}

export interface XeroConnectionSummary {
  connectionId: string;
  xeroTenantId: string;
  status?: 'connected' | 'expired';
}

interface XeroConnectionsStore {
  [connectionId: string]: XeroStoredConnection;
}

interface XeroStoredConnection {
  connectionId: string;
  xeroTenantId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt?: string;
  scope?: string;
}

interface XeroAppSecrets {
  clientId: string;
  clientSecret: string;
}

export class XeroClientService {
  private constructor(
    private readonly tenantId: string,
    private connection: XeroStoredConnection,
    private readonly connections: XeroConnectionsStore,
    private readonly appSecrets: XeroAppSecrets
  ) {}

  static async create(tenantId: string, connectionId?: string | null): Promise<XeroClientService> {
    const [connections, appSecrets] = await Promise.all([
      getTenantConnections(tenantId),
      getAppSecrets()
    ]);

    if (!connections || Object.keys(connections).length === 0) {
      throw new AppError('XERO_NOT_CONFIGURED', `No Xero connections configured for tenant ${tenantId}`);
    }

    const selectedConnection =
      (connectionId ? connections[connectionId] : undefined) ??
      connections[Object.keys(connections)[0]];

    if (!selectedConnection) {
      throw new AppError('XERO_CONNECTION_NOT_FOUND', `Xero connection ${connectionId ?? 'default'} not found`, {
        availableConnections: Object.keys(connections)
      });
    }

    const service = new XeroClientService(tenantId, selectedConnection, connections, appSecrets);
    await service.ensureAccessToken();
    logger.debug('[XeroClientService] initialized client', {
      tenantId,
      connectionId: selectedConnection.connectionId,
      xeroTenantId: selectedConnection.xeroTenantId
    });
    return service;
  }

  async createInvoices(payloads: XeroInvoicePayload[]): Promise<XeroInvoiceCreateSuccess[]> {
    if (payloads.length === 0) {
      return [];
    }

    const requestBody = {
      Invoices: payloads.map(mapInvoicePayload)
    };

    try {
      const response = await this.request<{ Invoices: Array<Record<string, any>> }>({
        method: 'POST',
        url: '/Invoices',
        data: requestBody
      });

      const invoices = Array.isArray(response?.Invoices) ? response.Invoices : [];
      return invoices.map((invoice, index) => ({
        status: 'success',
        invoiceId: invoice.InvoiceID ?? invoice.InvoiceNumber ?? invoice.InvoiceID ?? payloads[index]?.invoiceId,
        documentId: payloads[index]?.invoiceId ?? invoice.InvoiceID ?? invoice.InvoiceNumber,
        invoiceNumber: invoice.InvoiceNumber ?? undefined,
        raw: invoice
      }));
    } catch (error) {
      throw this.normalizeError(error, payloads);
    }
  }

  async listAccounts(params: { status?: 'ACTIVE' | 'ARCHIVED' } = {}): Promise<XeroAccount[]> {
    const response = await this.request<{ Accounts: Array<Record<string, any>> }>({
      method: 'GET',
      url: '/Accounts'
    });

    const accounts = Array.isArray(response?.Accounts) ? response.Accounts : [];
    return accounts
      .map((account) => ({
        accountId: account.AccountID,
        code: account.Code ?? undefined,
        name: account.Name,
        type: account.Type ?? undefined,
        status: account.Status ?? undefined
      }))
      .filter((account) => {
        if (!params.status) return true;
        return account.status === params.status;
      });
  }

  async listItems(): Promise<XeroItem[]> {
    const response = await this.request<{ Items: Array<Record<string, any>> }>({
      method: 'GET',
      url: '/Items'
    });

    const items = Array.isArray(response?.Items) ? response.Items : [];
    return items.map((item) => ({
      itemId: item.ItemID,
      code: item.Code ?? undefined,
      name: item.Name,
      status: item.Status ?? undefined,
      isTrackedAsInventory: Boolean(item.IsTrackedAsInventory)
    }));
  }

  async listTaxRates(): Promise<XeroTaxRate[]> {
    const response = await this.request<{ TaxRates: Array<Record<string, any>> }>({
      method: 'GET',
      url: '/TaxRates'
    });

    const rates = Array.isArray(response?.TaxRates) ? response.TaxRates : [];
    return rates.map((rate) => ({
      taxRateId: rate.TaxRateID,
      name: rate.Name,
      taxType: rate.TaxType ?? undefined,
      status: rate.Status ?? undefined,
      effectiveRate: typeof rate.EffectiveRate === 'number' ? rate.EffectiveRate : null,
      components: Array.isArray(rate.TaxComponents)
        ? rate.TaxComponents.map((component: Record<string, any>) => ({
            name: component.Name,
            rate: typeof component.Rate === 'number' ? component.Rate : 0
          }))
        : []
    }));
  }

  async listTrackingCategories(): Promise<XeroTrackingCategory[]> {
    const response = await this.request<{ TrackingCategories: Array<Record<string, any>> }>({
      method: 'GET',
      url: '/TrackingCategories'
    });

    const categories = Array.isArray(response?.TrackingCategories) ? response.TrackingCategories : [];
    return categories.map((category) => ({
      trackingCategoryId: category.TrackingCategoryID,
      name: category.Name,
      status: category.Status ?? undefined,
      options: Array.isArray(category.Options)
        ? category.Options.map((option: Record<string, any>) => ({
            trackingOptionId: option.TrackingOptionID,
            name: option.Name,
            status: option.Status ?? undefined
          }))
        : []
    }));
  }

  private async request<T>(config: AxiosRequestConfig, retry = true): Promise<T> {
    await this.ensureAccessToken();
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.connection.accessToken}`,
      'Xero-tenant-id': this.connection.xeroTenantId,
      ...config.headers
    };

    try {
      const response = await axios.request<T>({
        baseURL: XERO_API_BASE_URL,
        ...config,
        headers
      });
      return response.data;
    } catch (error) {
      if (retry && axios.isAxiosError(error) && error.response?.status === 401) {
        logger.warn('[XeroClientService] 401 received, attempting token refresh', {
          tenantId: this.tenantId,
          connectionId: this.connection.connectionId
        });
        await this.refreshAccessToken(true);
        return this.request<T>(config, false);
      }
      throw error;
    }
  }

  private async ensureAccessToken(forceRefresh = false): Promise<void> {
    if (forceRefresh || this.isAccessTokenExpired()) {
      if (this.isRefreshTokenExpired()) {
        throw new AppError('XERO_REFRESH_EXPIRED', 'Xero refresh token expired; re-authentication required', {
          tenantId: this.tenantId,
          connectionId: this.connection.connectionId
        });
      }
      await this.refreshAccessToken();
    }
  }

  private isAccessTokenExpired(): boolean {
    const expiresAt = new Date(this.connection.accessTokenExpiresAt).getTime();
    return Date.now() >= expiresAt - ACCESS_TOKEN_BUFFER_SECONDS * 1000;
    }

  private isRefreshTokenExpired(): boolean {
    if (!this.connection.refreshTokenExpiresAt) {
      return false;
    }
    return Date.now() >= new Date(this.connection.refreshTokenExpiresAt).getTime();
  }

  private async refreshAccessToken(force = false): Promise<void> {
    if (!force && !this.isAccessTokenExpired()) {
      return;
    }

    logger.info('[XeroClientService] refreshing access token', {
      tenantId: this.tenantId,
      connectionId: this.connection.connectionId
    });

    try {
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.connection.refreshToken,
        client_id: this.appSecrets.clientId,
        client_secret: this.appSecrets.clientSecret
      });

      const response = await axios.post(XERO_TOKEN_ENDPOINT, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const data = response.data ?? {};
      const now = Date.now();
      const accessTokenExpiresIn = typeof data.expires_in === 'number' ? data.expires_in : 1800;
      const refreshTokenExpiresIn = typeof data.refresh_token_expires_in === 'number' ? data.refresh_token_expires_in : 60 * 60 * 24 * 90;

      this.connection = {
        ...this.connection,
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? this.connection.refreshToken,
        accessTokenExpiresAt: new Date(now + accessTokenExpiresIn * 1000).toISOString(),
        refreshTokenExpiresAt: new Date(now + refreshTokenExpiresIn * 1000).toISOString(),
        scope: data.scope ?? this.connection.scope
      };

      this.connections[this.connection.connectionId] = this.connection;
      await storeTenantConnections(this.tenantId, this.connections);
    } catch (error) {
      const normalized = this.normalizeError(error);
      if (normalized.code === 'XERO_API_ERROR') {
        normalized.message = 'Failed to refresh Xero access token';
      }
      throw normalized;
    }
  }

  private normalizeError(error: unknown, payloads?: XeroInvoicePayload[]): AppError {
    if (error instanceof AppError) {
      return error;
    }

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const data = axiosError.response?.data as Record<string, any> | undefined;
      const correlationId = axiosError.response?.headers?.['xero-correlation-id'];

      if (status === 400 && data && Array.isArray(data.Elements)) {
        const elements = data.Elements.map((element: Record<string, any>, index: number) => {
          const invoiceNumber =
            element?.Invoice?.InvoiceNumber ??
            payloads?.[index]?.invoiceId ??
            element?.Invoice?.InvoiceID ??
            null;
          const validationErrors = Array.isArray(element?.ValidationErrors)
            ? element.ValidationErrors.map((validation: Record<string, any>) => ({
                message: validation.Message ?? 'Validation error',
                field: validation.Message?.includes(':')
                  ? validation.Message.split(':')[0]?.trim()
                  : undefined
              }))
            : [];

          return {
            documentId: invoiceNumber ?? undefined,
            validationErrors,
            message:
              validationErrors.length > 0
                ? validationErrors.map((item) => item.message).join('; ')
                : 'Validation error',
            raw: element
          };
        });

        return new AppError('XERO_VALIDATION_ERROR', 'Xero rejected one or more invoices', {
          status,
          correlationId,
          errors: elements
        });
      }

      if (status === 401) {
        return new AppError('XERO_UNAUTHORIZED', 'Xero authentication failed', {
          status,
          correlationId
        });
      }

      return new AppError('XERO_API_ERROR', 'Unexpected Xero API error', {
        status,
        correlationId,
        raw: data
      });
    }

    return new AppError('XERO_UNKNOWN_ERROR', 'Unknown Xero client error', {
      originalError: error
    });
  }
}

export async function getXeroConnectionSummaries(tenantId: string): Promise<XeroConnectionSummary[]> {
  const connections = await getTenantConnections(tenantId);
  const summaries: XeroConnectionSummary[] = [];

  for (const connection of Object.values(connections)) {
    const expiresAt = new Date(connection.accessTokenExpiresAt).getTime();
    summaries.push({
      connectionId: connection.connectionId,
      xeroTenantId: connection.xeroTenantId,
      status: Date.now() < expiresAt ? 'connected' : 'expired'
    });
  }

  return summaries;
}

async function getTenantConnections(tenantId: string): Promise<XeroConnectionsStore> {
  const secretProvider = await getSecretProviderInstance();
  const secret = await secretProvider.getTenantSecret(tenantId, XERO_CREDENTIALS_SECRET);
  if (!secret) {
    return {};
  }

  try {
    const parsed = typeof secret === 'string' ? JSON.parse(secret) : secret;
    if (parsed && typeof parsed === 'object') {
      return parsed as XeroConnectionsStore;
    }
  } catch (error) {
    logger.error('[XeroClientService] failed to parse stored credentials', { tenantId, error });
  }
  return {};
}

async function storeTenantConnections(tenantId: string, connections: XeroConnectionsStore): Promise<void> {
  const secretProvider = await getSecretProviderInstance();
  await secretProvider.setTenantSecret(tenantId, XERO_CREDENTIALS_SECRET, JSON.stringify(connections));
}

async function getAppSecrets(): Promise<XeroAppSecrets> {
  const secretProvider = await getSecretProviderInstance();
  const [clientId, clientSecret] = await Promise.all([
    secretProvider.getAppSecret(XERO_CLIENT_ID_SECRET),
    secretProvider.getAppSecret(XERO_CLIENT_SECRET_SECRET)
  ]);

  if (!clientId || !clientSecret) {
    throw new AppError('XERO_CONFIG_MISSING', 'Xero client credentials not configured');
  }

  return {
    clientId: String(clientId),
    clientSecret: String(clientSecret)
  };
}

function mapInvoicePayload(payload: XeroInvoicePayload): Record<string, unknown> {
  const invoiceNumber = payload.reference ?? payload.invoiceId;
  const lineItems = payload.lines.map((line) => mapInvoiceLine(line));

  const invoice: Record<string, unknown> = {
    Type: 'ACCREC',
    InvoiceNumber: invoiceNumber,
    Reference: payload.reference ?? undefined,
    Date: formatDate(payload.invoiceDate),
    DueDate: formatDate(payload.dueDate),
    CurrencyCode: payload.currency ?? undefined,
    LineAmountTypes: payload.lineAmountType ?? 'Exclusive',
    Contact: {
      ContactID: payload.contactId
    },
    LineItems: lineItems
  };

  return pruneUndefined(invoice);
}

function mapInvoiceLine(line: XeroInvoiceLinePayload): Record<string, unknown> {
  const quantity = typeof line.quantity === 'number' ? line.quantity : 1;
  const unitAmount =
    typeof line.unitAmountCents === 'number' ? centsToDecimal(line.unitAmountCents) : undefined;
  const lineAmount = centsToDecimal(line.amountCents);
  const tracking = normalizeTracking(line.tracking);

  const payload: Record<string, unknown> = {
    LineItemID: line.lineId,
    Description: buildLineDescription(line),
    Quantity: quantity,
    UnitAmount: unitAmount ?? (quantity !== 0 ? Number((lineAmount ?? 0) / quantity) : undefined),
    LineAmount: lineAmount,
    ItemCode: line.itemCode ?? undefined,
    AccountCode: line.accountCode ?? undefined,
    TaxType: line.taxType ?? undefined,
    TaxAmount:
      typeof line.taxAmountCents === 'number' ? centsToDecimal(line.taxAmountCents) : undefined,
    Tracking: tracking && tracking.length > 0 ? tracking : undefined
  };

  return pruneUndefined(payload);
}

function normalizeTracking(
  tracking: XeroTrackingCategoryOption[] | Record<string, string> | null | undefined
): Array<{ Name: string; Option: string }> | undefined {
  if (!tracking) {
    return undefined;
  }

  if (Array.isArray(tracking)) {
    return tracking
      .filter((entry) => entry && entry.name && entry.option)
      .map((entry) => ({
        Name: entry.name,
        Option: entry.option
      }));
  }

  if (typeof tracking === 'object') {
    return Object.entries(tracking)
      .filter(([name, option]) => Boolean(name) && Boolean(option))
      .map(([name, option]) => ({
        Name: name,
        Option: String(option)
      }));
  }

  return undefined;
}

function centsToDecimal(value: number): number {
  return Math.round(value) / 100;
}

function formatDate(value?: string | null): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString().split('T')[0];
}

function pruneUndefined<T extends Record<string, unknown>>(input: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null) {
      result[key] = value;
    }
  }
  return result as T;
}

function buildLineDescription(line: XeroInvoiceLinePayload): string | undefined {
  const base = line.description ?? undefined;
  if (!line.servicePeriodStart && !line.servicePeriodEnd) {
    return base;
  }

  const parts = [base].filter(Boolean) as string[];
  const servicePeriod: string[] = [];
  if (line.servicePeriodStart) {
    servicePeriod.push(`From ${line.servicePeriodStart}`);
  }
  if (line.servicePeriodEnd) {
    servicePeriod.push(`To ${line.servicePeriodEnd}`);
  }
  if (servicePeriod.length > 0) {
    parts.push(servicePeriod.join(' '));
  }
  return parts.join(' — ');
}
