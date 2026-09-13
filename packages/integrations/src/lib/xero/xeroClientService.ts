import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance, type ISecretProvider } from '@alga-psa/core/secrets';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { retireTerminalDisconnectRecord } from '../providerDisconnect/retire';
import {
  getProviderCredentialWriteDisposition,
  withProviderCredentialLock,
} from '../providerDisconnect/lock';
import { PROVIDER_XERO } from '../providerDisconnect/types';
import { normalizeXeroConnectionSelection } from './xeroRealmIdentity';
import { AppError, sanitizeProviderMessage, toSafeProviderError } from '@alga-psa/core';
import type {
  ExternalCompanyRecord,
  NormalizedCompanyPayload
} from '@alga-psa/types';

// Re-export types for dependent modules
export type { ExternalCompanyRecord, NormalizedCompanyPayload } from '@alga-psa/types';

// Env overrides exist so test environments can point at a local Xero
// provider simulator (tools/smoke-sim/accounting-provider-simulator.cjs or
// packages/emulators/xero), mirroring QBO_OAUTH_TOKEN_URL/QBO_API_BASE_URL
// for QBO and MICROSOFT_GRAPH_BASE_URL for Graph. They resolve lazily so a
// test can set them after module load; when unset every call targets the real
// Xero hosts.
const XERO_TOKEN_ENDPOINT_DEFAULT = 'https://identity.xero.com/connect/token';
const XERO_API_BASE_URL_DEFAULT = 'https://api.xero.com/api.xro/2.0';
const XERO_CONNECTIONS_URL_DEFAULT = 'https://api.xero.com/connections';
const XERO_REVOCATION_URL_DEFAULT = 'https://identity.xero.com/connect/revocation';
const XERO_CREDENTIALS_SECRET = 'xero_credentials';
const XERO_CLIENT_ID_SECRET = 'xero_client_id';
const XERO_CLIENT_SECRET_SECRET = 'xero_client_secret';
const ACCESS_TOKEN_BUFFER_SECONDS = 300;
// Minimum scope set covering shipped functionality: invoice export (POST/GET
// /Invoices), contact export (GET/POST /Contacts), read-only settings lookups
// (GET /Accounts, /Items, /TaxRates, /TrackingCategories — covered by
// accounting.settings.read), and inbound payment polling (GET /Payments —
// accounting.payments.read, read-only). No shipped flow writes payments,
// credit notes or voids, so the write scopes are deliberately absent.
const DEFAULT_XERO_SCOPES = [
  'offline_access',
  'accounting.settings.read',
  'accounting.invoices',
  'accounting.payments.read',
  'accounting.contacts'
];

/** The read-only Payments scope required for Xero inbound payment polling. */
export const XERO_PAYMENT_READ_SCOPE = 'accounting.payments.read';

// Xero still honours the pre-granular broad scopes for authorizations granted
// before the split (until its legacy cutoff). A stored connection carrying one
// of these satisfies the granular scope it covers, so existing broad-scope
// connections are never falsely flagged as missing permissions.
const XERO_LEGACY_SCOPE_EQUIVALENTS: Record<string, readonly string[]> = {
  'accounting.settings.read': ['accounting.settings'],
  // Invoice export writes (POST /Invoices), so only the read+write broad scope
  // satisfies it. `accounting.transactions.read` is read-only and must NOT
  // satisfy the invoice write requirement — a read-only legacy grant can poll
  // Payments but cannot export.
  'accounting.invoices': ['accounting.transactions'],
  [XERO_PAYMENT_READ_SCOPE]: [
    'accounting.payments',
    'accounting.transactions',
    'accounting.transactions.read'
  ],
  'accounting.contacts': []
};

/**
 * Scopes in `required` that the granted scope string does not satisfy, taking
 * legacy broad-scope equivalents into account.
 *
 * An absent/empty granted scope returns an empty list: the stored grant is
 * unknown, and guessing would block a legacy connection that may be perfectly
 * entitled. Callers use this only to produce an actionable reauthorization
 * message, never to assume a grant exists.
 */
export function computeMissingXeroScopes(
  grantedScope: string | null | undefined,
  required: readonly string[] = DEFAULT_XERO_SCOPES
): string[] {
  if (!grantedScope || grantedScope.trim() === '') {
    return [];
  }
  const granted = new Set(grantedScope.split(/\s+/).filter(Boolean));
  return required.filter((scope) => {
    if (granted.has(scope)) {
      return false;
    }
    const legacy = XERO_LEGACY_SCOPE_EQUIVALENTS[scope] ?? [];
    return !legacy.some((alternative) => granted.has(alternative));
  });
}

// Provider endpoint overrides so test environments can point at the local
// provider simulator (tools/smoke-sim/accounting-provider-simulator.cjs)
// without touching production hosts. They resolve lazily so a test can set
// them after module load; when unset every call targets the real Xero hosts.
function readEndpointOverride(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}

export function getXeroTokenUrl(): string {
  return readEndpointOverride('XERO_OAUTH_TOKEN_URL', XERO_TOKEN_ENDPOINT_DEFAULT);
}

export function getXeroApiBaseUrl(): string {
  return readEndpointOverride('XERO_API_BASE_URL', XERO_API_BASE_URL_DEFAULT);
}

export function getXeroConnectionsUrl(): string {
  return readEndpointOverride('XERO_CONNECTIONS_URL', XERO_CONNECTIONS_URL_DEFAULT);
}

export function getXeroRevocationUrl(): string {
  return readEndpointOverride('XERO_REVOCATION_URL', XERO_REVOCATION_URL_DEFAULT);
}

// OAuth scope tokens are dot-separated lowercase identifiers such as
// offline_access or accounting.settings.read.
const XERO_SCOPE_TOKEN_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

export const XERO_TOKEN_URL = getXeroTokenUrl();
export const XERO_CREDENTIALS_SECRET_NAME = XERO_CREDENTIALS_SECRET;
export const XERO_CLIENT_ID_SECRET_NAME = XERO_CLIENT_ID_SECRET;
export const XERO_CLIENT_SECRET_SECRET_NAME = XERO_CLIENT_SECRET_SECRET;

const XERO_CLIENT_ID_ENV_FALLBACKS = [
  XERO_CLIENT_ID_SECRET,
  'XERO_CLIENT_ID',
  'XERO_OAUTH_CLIENT_ID',
  'NEXT_PUBLIC_XERO_CLIENT_ID'
];

const XERO_CLIENT_SECRET_ENV_FALLBACKS = [
  XERO_CLIENT_SECRET_SECRET,
  'XERO_CLIENT_SECRET',
  'XERO_OAUTH_CLIENT_SECRET'
];

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

export async function getXeroClientId(secretProvider?: ISecretProvider): Promise<string | undefined> {
  const provider = secretProvider ?? await getSecretProviderInstance();
  return resolveAppSecret(provider, XERO_CLIENT_ID_SECRET, XERO_CLIENT_ID_ENV_FALLBACKS);
}

export async function getXeroClientSecret(secretProvider?: ISecretProvider): Promise<string | undefined> {
  const provider = secretProvider ?? await getSecretProviderInstance();
  return resolveAppSecret(provider, XERO_CLIENT_SECRET_SECRET, XERO_CLIENT_SECRET_ENV_FALLBACKS);
}

function readTrimmedSecret(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export async function getTenantOwnedXeroClientId(
  tenantId: string,
  secretProvider?: ISecretProvider
): Promise<string | undefined> {
  const provider = secretProvider ?? await getSecretProviderInstance();
  return readTrimmedSecret(await provider.getTenantSecret(tenantId, XERO_CLIENT_ID_SECRET));
}

export async function getTenantOwnedXeroClientSecret(
  tenantId: string,
  secretProvider?: ISecretProvider
): Promise<string | undefined> {
  const provider = secretProvider ?? await getSecretProviderInstance();
  return readTrimmedSecret(await provider.getTenantSecret(tenantId, XERO_CLIENT_SECRET_SECRET));
}

export type XeroCredentialSource = 'tenant' | 'app';

export interface ResolvedXeroOAuthCredentials {
  clientId: string;
  clientSecret: string;
  source: XeroCredentialSource;
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

export async function getXeroDeploymentBaseUrl(secretProvider?: ISecretProvider): Promise<string> {
  const provider = secretProvider ?? await getSecretProviderInstance();
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (await provider.getAppSecret('NEXT_PUBLIC_BASE_URL')) ||
    process.env.NEXTAUTH_URL ||
    (await provider.getAppSecret('NEXTAUTH_URL')) ||
    'http://localhost:3000';

  return computeBaseUrl(base);
}

export type XeroOAuthScopeSource = 'default' | 'override';

export interface XeroOAuthScopeConfig {
  scopes: string[];
  source: XeroOAuthScopeSource;
  /** Override tokens rejected by validation; only present when an override was ignored. */
  invalidOverrideScopes?: string[];
}

/**
 * Resolve the OAuth scopes for new Xero authorizations.
 *
 * The XERO_OAUTH_SCOPES environment variable is an explicit deployment
 * override (space-separated scope tokens). It is honoured only when every
 * token is a well-formed scope; a malformed override is ignored in favour of
 * the defaults, with the rejected tokens surfaced in the returned config so
 * diagnostics can show them without inspecting the environment.
 */
export function getXeroOAuthScopeConfig(): XeroOAuthScopeConfig {
  const configured = readTrimmedSecret(process.env.XERO_OAUTH_SCOPES);
  if (!configured) {
    return { scopes: [...DEFAULT_XERO_SCOPES], source: 'default' };
  }

  const requested = Array.from(
    new Set(
      configured
        .split(/\s+/)
        .map((scope) => scope.trim())
        .filter(Boolean)
    )
  );
  const invalidScopes = requested.filter((scope) => !XERO_SCOPE_TOKEN_PATTERN.test(scope));

  if (requested.length === 0 || invalidScopes.length > 0) {
    logger.warn('[XeroClientService] ignoring malformed XERO_OAUTH_SCOPES override; using default scopes', {
      invalidScopes
    });
    return {
      scopes: [...DEFAULT_XERO_SCOPES],
      source: 'default',
      invalidOverrideScopes: invalidScopes
    };
  }

  return { scopes: requested, source: 'override' };
}

export function getXeroOAuthScopes(): string[] {
  return getXeroOAuthScopeConfig().scopes;
}

export function getXeroOAuthScopesString(): string {
  return getXeroOAuthScopes().join(' ');
}

export async function getXeroRedirectUri(secretProvider?: ISecretProvider): Promise<string> {
  return `${await getXeroDeploymentBaseUrl(secretProvider)}/api/integrations/xero/callback`;
}

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
  /**
   * Xero-assigned LineItemID from a prior export of the same invoice, when known.
   * Omit on a fresh create — Xero will generate and return one, which we then
   * persist on the invoice mapping for future updates. On a retry / update we
   * MUST send the Xero LineItemID for every previously-posted line, otherwise
   * Xero's upsert-by-InvoiceNumber rejects the line with "Could not find line
   * item(s) with the following id(s)".
   */
  externalLineItemId?: string | null;
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
  /**
   * Xero-assigned InvoiceID from a prior export of the same Alga invoice, when known.
   * Setting this turns the POST into an explicit update rather than an
   * upsert-by-InvoiceNumber, which is what makes retries idempotent.
   */
  externalInvoiceId?: string | null;
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
  tenantName?: string;
  status?: 'connected' | 'expired';
  /** Scope granted by Xero on the authorization that created this connection. */
  scope?: string;
  /**
   * Required scopes the granted scope does not satisfy. Empty/absent when the
   * grant is unknown (legacy stored connection without a scope) or complete.
   */
  missingScopes?: string[];
}

export interface XeroConnectionsStore {
  [connectionId: string]: XeroStoredConnection;
}

/** Tax component details from a Xero line item */
export interface XeroLineItemTaxComponent {
  name: string;
  rate: number;
  /** Tax amount in cents */
  amount: number;
}

/** Line item details from a fetched Xero invoice */
export interface XeroLineItemDetails {
  lineItemId?: string;
  description?: string;
  quantity: number;
  /** Unit amount in cents */
  unitAmount: number;
  /** Line amount in cents (before tax) */
  lineAmount: number;
  /** Tax amount in cents */
  taxAmount: number;
  taxType?: string;
  accountCode?: string;
  itemCode?: string;
  /** Detailed tax component breakdown (Xero provides this per line) */
  taxComponents?: XeroLineItemTaxComponent[];
}

/** Full invoice details from Xero including tax information */
export interface XeroInvoiceDetails {
  invoiceId: string;
  invoiceNumber?: string;
  reference?: string;
  status?: string;
  currencyCode?: string;
  /** Total amount in cents (including tax) */
  total: number;
  /** Total tax in cents */
  totalTax: number;
  /** Subtotal in cents (before tax) */
  subTotal: number;
  lineAmountTypes?: 'Exclusive' | 'Inclusive' | 'NoTax';
  lineItems: XeroLineItemDetails[];
  raw?: Record<string, unknown>;
}

/** One page of changed records returned by Xero's modified-since polling. */
export interface XeroChangedPage {
  records: Array<Record<string, any>>;
  /** True when the page was full (100 records) — request the next page. */
  hasMore: boolean;
}

export interface XeroStoredConnection {
  connectionId: string;
  xeroTenantId: string;
  tenantName?: string;
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
      getAppSecrets(tenantId)
    ]);

    if (!connections || Object.keys(connections).length === 0) {
      throw new AppError('XERO_NOT_CONFIGURED', `No Xero connections configured for tenant ${tenantId}`);
    }

    const selectedConnection = connectionId
      ? connections[connectionId] ??
        Object.values(connections).find((connection) => connection.xeroTenantId === connectionId)
      : connections[Object.keys(connections)[0]];

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

    // Invoice export is a write. A connection whose known grant is read-only
    // (e.g. legacy accounting.transactions.read) can poll but not export; fail
    // with actionable reauthorization instead of sending a request Xero will
    // reject. An unknown/absent stored scope is not guessed at.
    const missingInvoiceWrite = computeMissingXeroScopes(this.connection.scope, [
      'accounting.invoices'
    ]);
    if (missingInvoiceWrite.length > 0) {
      throw new AppError(
        'XERO_SCOPE_INSUFFICIENT',
        `This Xero connection does not have permission to write invoices (missing ${missingInvoiceWrite.join(', ')}). Reconnect Xero to grant invoice write access — refreshing the existing connection keeps its current permissions and will not add them.`,
        { missingScopes: missingInvoiceWrite, connectionId: this.connection.connectionId }
      );
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

  /**
   * Changed-invoice polling. Xero caps each page at 100 records; callers page
   * until `hasMore` is false. `modifiedAfter` is an ISO 8601 timestamp matched
   * against each record's UpdatedDateUTC.
   */
  async listChangedInvoices(modifiedAfter: string, page: number): Promise<XeroChangedPage> {
    return this.listChangedPage('/Invoices', modifiedAfter, page, { modifiedAfter });
  }

  /** Changed-payment polling (payments applied to invoices or credit notes). */
  async listChangedPayments(modifiedAfter: string, page: number): Promise<XeroChangedPage> {
    return this.listChangedPage('/Payments', modifiedAfter, page);
  }

  /** Changed-credit-note polling, including each note's current allocations. */
  async listChangedCreditNotes(modifiedAfter: string, page: number): Promise<XeroChangedPage> {
    return this.listChangedPage('/CreditNotes', modifiedAfter, page);
  }

  private async listChangedPage(
    path: string,
    modifiedAfter: string,
    page: number,
    extraParams: Record<string, unknown> = {}
  ): Promise<XeroChangedPage> {
    let response: Record<string, any>;
    try {
      response = await this.request<Record<string, any>>({
        method: 'GET',
        url: path,
        params: { page, ...extraParams },
        headers: { 'If-Modified-Since': modifiedAfter }
      });
    } catch (error) {
      // Normalize so polling callers classify 401s and expired credentials as
      // terminal auth failures instead of a generic request error.
      const normalized = this.normalizeError(error);
      // A persistent 401 on the Payments feed (the client already retried after
      // a token refresh) is the signature of a connection authorized without
      // the payment read scope. Surface the missing grant as actionable
      // reauthorization rather than a generic authentication failure. A token
      // refresh keeps the original grant, so only a fresh authorization adds
      // the scope.
      if (normalized.code === 'XERO_UNAUTHORIZED' && path === '/Payments') {
        const missingScopes = computeMissingXeroScopes(this.connection.scope, [
          XERO_PAYMENT_READ_SCOPE
        ]);
        if (missingScopes.length > 0) {
          throw new AppError(
            'XERO_SCOPE_INSUFFICIENT',
            `This Xero connection was not authorized for payments polling (missing ${missingScopes.join(', ')}). Reconnect Xero to grant the updated permissions — refreshing the existing connection keeps its current permissions and will not add them.`,
            { missingScopes, connectionId: this.connection.connectionId }
          );
        }
      }
      throw normalized;
    }

    const collectionKey = path.replace(/^\//, '');
    const records = Array.isArray(response?.[collectionKey]) ? response[collectionKey] : [];
    return { records, hasMore: records.length >= 100 };
  }

  /**
   * Fetch a single invoice by its Xero Invoice ID.
   * Returns the full invoice including line items with tax details.
   */
  async getInvoice(invoiceId: string): Promise<XeroInvoiceDetails | null> {    try {
      const response = await this.request<{ Invoices: Array<Record<string, any>> }>({
        method: 'GET',
        url: `/Invoices/${invoiceId}`
      });

      const invoice = Array.isArray(response?.Invoices) ? response.Invoices[0] : undefined;
      if (!invoice) {
        return null;
      }

      return this.mapInvoiceDetails(invoice);
    } catch (error) {
      const normalized = this.normalizeError(error);
      if (normalized.code === 'XERO_API_ERROR') {
        logger.warn('[XeroClientService] failed to fetch invoice', {
          tenantId: this.tenantId,
          connectionId: this.connection.connectionId,
          invoiceId,
          error: normalized.message
        });
        return null;
      }
      throw normalized;
    }
  }

  private mapInvoiceDetails(invoice: Record<string, any>): XeroInvoiceDetails {
    const lineItems = Array.isArray(invoice.LineItems) ? invoice.LineItems : [];

    return {
      invoiceId: invoice.InvoiceID,
      invoiceNumber: invoice.InvoiceNumber ?? undefined,
      reference: invoice.Reference ?? undefined,
      status: invoice.Status ?? undefined,
      currencyCode: invoice.CurrencyCode ?? undefined,
      total: typeof invoice.Total === 'number' ? decimalToCents(invoice.Total) : 0,
      totalTax: typeof invoice.TotalTax === 'number' ? decimalToCents(invoice.TotalTax) : 0,
      subTotal: typeof invoice.SubTotal === 'number' ? decimalToCents(invoice.SubTotal) : 0,
      lineAmountTypes: invoice.LineAmountTypes ?? 'Exclusive',
      lineItems: lineItems.map((line: Record<string, any>) => this.mapLineItemDetails(line)),
      raw: invoice
    };
  }

  private mapLineItemDetails(line: Record<string, any>): XeroLineItemDetails {
    const taxComponents = Array.isArray(line.TaxComponents)
      ? line.TaxComponents.map((component: Record<string, any>) => ({
          name: component.Name ?? '',
          rate: typeof component.Rate === 'number' ? component.Rate : 0,
          amount: typeof component.TaxAmount === 'number' ? decimalToCents(component.TaxAmount) : 0
        }))
      : undefined;

    return {
      lineItemId: line.LineItemID ?? undefined,
      description: line.Description ?? undefined,
      quantity: typeof line.Quantity === 'number' ? line.Quantity : 1,
      unitAmount: typeof line.UnitAmount === 'number' ? decimalToCents(line.UnitAmount) : 0,
      lineAmount: typeof line.LineAmount === 'number' ? decimalToCents(line.LineAmount) : 0,
      taxAmount: typeof line.TaxAmount === 'number' ? decimalToCents(line.TaxAmount) : 0,
      taxType: line.TaxType ?? undefined,
      accountCode: line.AccountCode ?? undefined,
      itemCode: line.ItemCode ?? undefined,
      taxComponents
    };
  }

  async findContactByName(name: string): Promise<ExternalCompanyRecord | null> {
    const safeName = name.replace(/"/g, '\\"');
    try {
      const response = await this.request<{ Contacts: Array<Record<string, any>> }>({
        method: 'GET',
        url: '/Contacts',
        params: {
          where: `Name=="${safeName}"`
        }
      });
      const contact = Array.isArray(response?.Contacts) ? response.Contacts[0] : undefined;
      return contact ? this.mapContactRecord(contact) : null;
    } catch (error) {
      const normalized = this.normalizeError(error);
      if (normalized.code === 'XERO_API_ERROR') {
        return null;
      }
      throw normalized;
    }
  }

  async createOrUpdateContact(payload: NormalizedCompanyPayload): Promise<ExternalCompanyRecord> {
    const contactPayload = this.buildContactPayload(payload);

    try {
      const response = await this.request<{ Contacts: Array<Record<string, any>> }>({
        method: 'POST',
        url: '/Contacts',
        data: {
          Contacts: [contactPayload]
        }
      });

      const contact = Array.isArray(response?.Contacts) ? response.Contacts[0] : undefined;
      if (!contact) {
        throw new AppError('XERO_CONTACT_CREATION_FAILED', 'Xero returned no contact data');
      }
      return this.mapContactRecord(contact);
    } catch (error) {
      const normalized = this.normalizeError(error);
      const existing = await this.safeFindContactByName(payload.name);
      if (existing) {
        return existing;
      }
      throw normalized;
    }
  }

  private buildContactPayload(payload: NormalizedCompanyPayload): Record<string, any> {
    const contact: Record<string, any> = {
      Name: payload.name
    };

    if (payload.primaryEmail) {
      contact.EmailAddress = payload.primaryEmail;
    }

    const primaryPhone =
      payload.primaryPhone ??
      payload.contacts?.find((contactItem) => contactItem.phone)?.phone ??
      null;
    if (primaryPhone) {
      contact.Phones = [
        {
          PhoneType: 'DEFAULT',
          PhoneNumber: primaryPhone
        }
      ];
    }

    if (payload.billingAddress) {
      contact.Addresses = [
        {
          AddressType: 'STREET',
          AddressLine1: payload.billingAddress.line1 ?? undefined,
          AddressLine2: payload.billingAddress.line2 ?? undefined,
          City: payload.billingAddress.city ?? undefined,
          Region: payload.billingAddress.region ?? undefined,
          PostalCode: payload.billingAddress.postalCode ?? undefined,
          Country: payload.billingAddress.country ?? undefined
        }
      ];
    }

    if (payload.taxNumber) {
      contact.TaxNumber = payload.taxNumber;
    }

    if (payload.notes) {
      contact.Notes = payload.notes;
    }

    return contact;
  }

  private mapContactRecord(contact: Record<string, any>): ExternalCompanyRecord {
    return {
      externalId: contact.ContactID ?? contact.ContactNumber ?? '',
      displayName: contact.Name ?? '',
      syncToken: contact.ContactNumber ?? undefined,
      raw: contact
    };
  }

  private async safeFindContactByName(name: string): Promise<ExternalCompanyRecord | null> {
    try {
      return await this.findContactByName(name);
    } catch (error) {
      logger.warn('[XeroClientService] failed to lookup contact after create', {
        tenantId: this.tenantId,
        connectionId: this.connection.connectionId,
        error: toSafeProviderError('xero', error, { operation: 'findContactByName' })
      });
      return null;
    }
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
        baseURL: getXeroApiBaseUrl(),
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

      const response = await axios.post(getXeroTokenUrl(), params.toString(), {
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
      // Persist through the gated upsert (not a raw store): a refresh from a
      // client instantiated before a disconnect started must not write the
      // live credential secret back while the disconnect is in flight. Only
      // the refreshed connection is passed so a concurrently updated sibling
      // connection is not clobbered with this client's stale copy. QBO's
      // refresh path does the same via upsertStoredQboCredentials.
      await upsertStoredXeroConnections(this.tenantId, {
        [this.connection.connectionId]: this.connection
      });
    } catch (error) {
      // Terminal token failures (revoked/expired refresh token, rejected
      // client) require re-authentication and must be classified as such at
      // the client boundary — the sync cycle turns them into a
      // connection-expired exception. Transient failures (network, 5xx) stay
      // retryable.
      if (isTerminalXeroTokenFailure(error)) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        const oauthError = getXeroOAuthError(error);
        throw new AppError(
          'XERO_REFRESH_FAILED',
          'Xero refresh token was rejected; re-authentication is required',
          { status, oauthError }
        );
      }
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
                message: sanitizeProviderMessage(validation.Message ?? 'Validation error'),
                field: validation.Message?.includes(':')
                  ? validation.Message.split(':')[0]?.trim()
                  : undefined
              }))
            : [];

          // Allowlisted fields only — never attach the raw provider element:
          // it carries the full invoice (customer, line items, amounts).
          return {
            documentId: invoiceNumber ?? undefined,
            validationErrors,
            message: sanitizeProviderMessage(
              validationErrors.length > 0
                ? validationErrors.map((item) => item.message).join('; ')
                : 'Validation error'
            )
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

      // Reduce the provider response to allowlisted fields; the body itself
      // can contain tokens, contact data, and invoice contents.
      const safe = toSafeProviderError('xero', error, { correlationId });
      return new AppError('XERO_API_ERROR', 'Unexpected Xero API error', {
        status,
        correlationId: safe.correlationId,
        providerErrorCode: safe.providerErrorCode,
        providerMessage: safe.message
      });
    }

    return new AppError('XERO_UNKNOWN_ERROR', 'Unknown Xero client error', {
      originalError: toSafeProviderError('xero', error)
    });
  }
}

const TERMINAL_XERO_OAUTH_ERRORS = new Set([
  'invalid_grant',
  'invalid_client',
  'unauthorized_client'
]);

function getXeroOAuthError(error: unknown): string | undefined {
  if (!axios.isAxiosError(error)) {
    return undefined;
  }
  const data = error.response?.data as Record<string, unknown> | undefined;
  return typeof data?.error === 'string' ? data.error : undefined;
}

/**
 * Whether a failed refresh can never succeed without re-authentication.
 * Revoked/expired refresh tokens and rejected clients surface as OAuth errors
 * or a 400/401 from the token endpoint; everything else (network, 5xx) stays
 * retryable.
 */
function isTerminalXeroTokenFailure(error: unknown): boolean {
  if (error instanceof AppError) {
    return ['XERO_REFRESH_EXPIRED', 'XERO_UNAUTHORIZED', 'XERO_REFRESH_FAILED'].includes(error.code);
  }
  if (!axios.isAxiosError(error)) {
    return false;
  }
  const oauthError = getXeroOAuthError(error);
  if (oauthError && TERMINAL_XERO_OAUTH_ERRORS.has(oauthError)) {
    return true;
  }
  const status = error.response?.status;
  return status === 400 || status === 401;
}

export async function getXeroConnectionSummaries(tenantId: string): Promise<XeroConnectionSummary[]> {
  const connections = await getTenantConnections(tenantId);
  const summaries: XeroConnectionSummary[] = [];

  for (const connection of Object.values(connections)) {
    const expiresAt = new Date(connection.accessTokenExpiresAt).getTime();
    const missingScopes = computeMissingXeroScopes(connection.scope);
    summaries.push({
      connectionId: connection.connectionId,
      xeroTenantId: connection.xeroTenantId,
      tenantName: connection.tenantName,
      status: Date.now() < expiresAt ? 'connected' : 'expired',
      scope: connection.scope,
      ...(missingScopes.length > 0 ? { missingScopes } : {})
    });
  }

  return summaries;
}

/**
 * Resolve the connection id the tenant has selected as the live Xero default.
 *
 * The persisted `tenant_settings.accountingSync.defaultRealm` is the single
 * selection that outbound sync already honours, so settings/catalog/mapping
 * must read the same value. It may name the connection id directly or, for a
 * connection created before the canonical identity moved to the connection id,
 * the organisation id owned by exactly one connection. When the persisted
 * value is absent, stale, or ambiguously owned, fall back to the first stored
 * connection — never to another provider's selection.
 */
export async function resolveDefaultXeroConnectionId(tenantId: string): Promise<string | null> {
  const connections = await getTenantConnections(tenantId);
  const connectionIds = Object.keys(connections);
  if (connectionIds.length === 0) {
    return null;
  }

  let persisted: string | null = null;
  try {
    const { knex } = await createTenantKnex(tenantId);
    const row = await tenantDb(knex, tenantId).table('tenant_settings')
      .select('settings')
      .first();
    const candidate = row?.settings?.accountingSync?.defaultRealm;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      persisted = candidate.trim();
    }
  } catch (error) {
    logger.warn('[XeroClientService] failed to read persisted Xero default; using first connection', {
      tenantId,
      errorName: error instanceof Error ? error.name : 'unknown'
    });
    return connectionIds[0];
  }

  if (persisted) {
    const normalized = normalizeXeroConnectionSelection(connections, persisted);
    if (normalized) {
      return normalized;
    }
  }

  return connectionIds[0];
}

export async function getDefaultXeroTenantId(tenantId: string): Promise<string | null> {
  const connections = await getTenantConnections(tenantId);
  const defaultConnection = Object.values(connections)[0];
  return defaultConnection?.xeroTenantId ?? null;
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
    // Parse errors can quote the stored secret payload; log only the error type.
    logger.error('[XeroClientService] failed to parse stored credentials', {
      tenantId,
      errorName: error instanceof Error ? error.name : 'unknown'
    });
  }
  return {};
}

async function storeTenantConnections(tenantId: string, connections: XeroConnectionsStore): Promise<void> {
  const secretProvider = await getSecretProviderInstance();
  await secretProvider.setTenantSecret(tenantId, XERO_CREDENTIALS_SECRET, JSON.stringify(connections));
}

export async function getStoredXeroConnections(tenantId: string): Promise<XeroConnectionsStore> {
  return getTenantConnections(tenantId);
}

export async function upsertStoredXeroConnections(
  tenantId: string,
  updates: XeroConnectionsStore,
  options: { prioritize?: string[]; authorizationFlowStartedAt?: string } = {}
): Promise<XeroConnectionsStore> {
  const { knex } = await createTenantKnex(tenantId);

  // The gate check and secret write hold the shared credential-write lock (see
  // providerDisconnect/lock.ts), which disconnect initiation also holds while
  // persisting its record and invalidating outstanding flows. Active records
  // block every write; a finalized record is retired only for an OAuth flow
  // provably started after finalization. Record-read failures fail closed.
  return withProviderCredentialLock(knex, tenantId, PROVIDER_XERO, async (trx) => {
    const disposition = await getProviderCredentialWriteDisposition(
      trx,
      tenantId,
      PROVIDER_XERO,
      options.authorizationFlowStartedAt,
    ).catch(() => 'disconnect_in_progress' as const);
    if (disposition === 'disconnect_in_progress') {
      throw new AppError(
        'XERO_DISCONNECT_IN_PROGRESS',
        'Xero is being disconnected. Finish or finalize the disconnect before connecting again.'
      );
    }
    if (disposition === 'stale_authorization') {
      throw new AppError(
        'XERO_STALE_AUTHORIZATION',
        'This Xero authorization started before the last disconnect completed. Start the connection again.'
      );
    }

    // Reconnect after a completed (or force-finalized) disconnect: retire the
    // stale terminal disconnect record BEFORE the new connection becomes visible
    // to the rest of the system, so the next disconnect starts a fresh cycle
    // instead of short-circuiting on the old finalized row. A pending disconnect
    // record is deliberately left alone — reconnect during an in-flight cycle is
    // blocked upstream. The disconnect service independently treats a terminal
    // record with live credentials as stale (defense in depth).
    await retireTerminalDisconnectRecord(tenantId, PROVIDER_XERO, trx);

    // Read-merge-write inside the lock so concurrent upserts serialize instead
    // of losing entries to a stale read.
    const existing = await getTenantConnections(tenantId);
    const merged: XeroConnectionsStore = { ...existing, ...updates };

    if (options.prioritize?.length) {
      const prioritizedEntries: XeroConnectionsStore = {};
      for (const id of options.prioritize) {
        if (merged[id]) {
          prioritizedEntries[id] = merged[id];
        }
      }
      for (const [id, connection] of Object.entries(merged)) {
        if (!(id in prioritizedEntries)) {
          prioritizedEntries[id] = connection;
        }
      }
      await storeTenantConnections(tenantId, prioritizedEntries);
      return prioritizedEntries;
    }

    await storeTenantConnections(tenantId, merged);
    return merged;
  });
}

export async function resolveXeroOAuthCredentials(
  tenantId: string,
  secretProvider?: ISecretProvider
): Promise<ResolvedXeroOAuthCredentials> {
  const provider = secretProvider ?? await getSecretProviderInstance();
  const [tenantClientId, tenantClientSecret] = await Promise.all([
    getTenantOwnedXeroClientId(tenantId, provider),
    getTenantOwnedXeroClientSecret(tenantId, provider)
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
      'XERO_CONFIG_MISSING',
      'Xero client ID and client secret must both be configured for this tenant before connecting.'
    );
  }

  const [appClientId, appClientSecret] = await Promise.all([
    getXeroClientId(provider),
    getXeroClientSecret(provider)
  ]);

  if (!appClientId || !appClientSecret) {
    throw new AppError(
      'XERO_CONFIG_MISSING',
      'Xero client credentials are not configured for this tenant or the application fallback.'
    );
  }

  return {
    clientId: appClientId,
    clientSecret: appClientSecret,
    source: 'app'
  };
}

async function getAppSecrets(tenantId: string, secretProvider?: ISecretProvider): Promise<XeroAppSecrets> {
  const resolved = await resolveXeroOAuthCredentials(tenantId, secretProvider);
  return {
    clientId: resolved.clientId,
    clientSecret: resolved.clientSecret
  };
}

function mapInvoicePayload(payload: XeroInvoicePayload): Record<string, unknown> {
  const invoiceNumber = payload.reference ?? payload.invoiceId;
  const lineItems = payload.lines.map((line) => mapInvoiceLine(line));

  const invoice: Record<string, unknown> = {
    Type: 'ACCREC',
    InvoiceID: payload.externalInvoiceId ?? undefined,
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
    // Only send LineItemID for lines we know Xero already has (from a prior export).
    // Sending our Alga UUID as LineItemID tricks Xero into treating the line as
    // one it already knows and, on retry, triggers a validation error because
    // the ID doesn't match any line in the existing draft.
    LineItemID: line.externalLineItemId ?? undefined,
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

function decimalToCents(value: number): number {
  return Math.round(value * 100);
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
  const servicePeriodStart = formatDate(line.servicePeriodStart) ?? line.servicePeriodStart ?? null;
  const servicePeriodEnd = formatDate(line.servicePeriodEnd) ?? line.servicePeriodEnd ?? null;

  if (!servicePeriodStart && !servicePeriodEnd) {
    return base;
  }

  const parts = [base].filter(Boolean) as string[];
  parts.push(buildServicePeriodDescription(servicePeriodStart, servicePeriodEnd));
  return parts.join(' — ');
}

function buildServicePeriodDescription(
  servicePeriodStart: string | null,
  servicePeriodEnd: string | null
): string {
  if (servicePeriodStart && servicePeriodEnd) {
    if (servicePeriodStart === servicePeriodEnd) {
      return `Service date: ${servicePeriodStart}`;
    }

    return `Service period: ${servicePeriodStart} to ${servicePeriodEnd}`;
  }

  if (servicePeriodStart) {
    return `Service period starts: ${servicePeriodStart}`;
  }

  return `Service period ends: ${servicePeriodEnd}`;
}
