/**
 * Behavioral coverage for the accounting catalog / mapping read boundary:
 *
 * - catalog reads (QBO + Xero) require accounting_catalog:read, not
 *   billing_settings:read, so Project Manager and custom roles are denied by
 *   default while Admin/Finance keep working;
 * - an explicitly requested realm / Xero connection that is not connected
 *   fails closed with no provider contact at all (no fallback query);
 * - a valid request touches exactly the requested realm;
 * - connection diagnostics stay on billing_settings:read with their minimal
 *   response shape;
 * - generic mapping reads demand integration + entity type + realm scope
 *   before touching the database.
 *
 * Assertions check both the response and whether the provider client was
 * created — never source strings.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const permissionRef = vi.hoisted(() => ({
  grants: new Set<string>(),
}));

const authUser = vi.hoisted(() => ({
  user_id: 'user-1',
  tenant: 'tenant-under-test',
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: (...args: any[]) => any) =>
    (...args: any[]) =>
      fn({ ...authUser, roles: [] }, { tenant: authUser.tenant }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async (_user: unknown, resource: string, action: string) =>
    permissionRef.grants.has(`${resource}:${action}`)
  ),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// ── QBO provider client + secrets ────────────────────────────────────────────

const qboCreateMock = vi.hoisted(() => vi.fn());
const qboQueryMock = vi.hoisted(() => vi.fn());
const getStoredQboCredentialsMapMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/qbo/qboClientService', () => ({
  QboClientService: { create: qboCreateMock },
  getStoredQboCredentialsMap: getStoredQboCredentialsMapMock,
  QBO_CLIENT_ID_SECRET_NAME: 'qbo_client_id',
  QBO_CLIENT_SECRET_SECRET_NAME: 'qbo_client_secret',
  getQboEnvironment: () => 'sandbox',
  getQboOAuthScopes: () => ['com.intuit.quickbooks.accounting'],
  getQboRedirectUri: async () => 'https://example.test/callback',
  resolveQboOAuthCredentials: async () => null,
}));

vi.mock('../lib/qbo/qboConnectionChangeProvider', () => ({
  notifyQboConnectionChanged: vi.fn(),
}));

const tenantSecrets = vi.hoisted(() => new Map<string, string>());

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: async (_tenant: string, name: string) => tenantSecrets.get(name) ?? null,
    setTenantSecret: vi.fn(),
    deleteTenantSecret: vi.fn(),
  }),
}));

// ── Xero provider client ─────────────────────────────────────────────────────

const xeroCreateMock = vi.hoisted(() => vi.fn());
const xeroSummariesMock = vi.hoisted(() => vi.fn());
const getStoredXeroConnectionsMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/xero/xeroClientService', () => ({
  XeroClientService: { create: xeroCreateMock },
  getStoredXeroConnections: getStoredXeroConnectionsMock,
  getXeroConnectionSummaries: xeroSummariesMock,
  XERO_CREDENTIALS_SECRET_NAME: 'xero_credentials',
  XERO_CLIENT_ID_SECRET_NAME: 'xero_client_id',
  XERO_CLIENT_SECRET_SECRET_NAME: 'xero_client_secret',
  getXeroRedirectUri: async () => 'https://example.test/xero-callback',
  getXeroOAuthScopes: () => ['accounting.settings.read'],
  resolveXeroOAuthCredentials: async () => null,
}));

// ── Database layer (mapping reads) ───────────────────────────────────────────

const withTransactionMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: authUser.tenant })),
  tenantDb: vi.fn(),
  withTransaction: withTransactionMock,
  auditLog: vi.fn(),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { getQboItems, getQboCustomers, getQboConnectionStatus } from './qboActions';
import { getXeroAccounts } from './integrations/xeroActions';
import { getExternalEntityMappings } from './externalMappingActions';

const CONNECTED_REALM = 'realm-100';
const OTHER_REALM = 'realm-200';

function seedQboCredentials(realmIds: string[]): void {
  const entries = Object.fromEntries(
    realmIds.map((realmId) => [
      realmId,
      {
        accessToken: 'access',
        refreshToken: 'refresh',
        realmId,
        accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
        refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z',
      },
    ])
  );
  tenantSecrets.set('qbo_credentials', JSON.stringify(entries));
}

function grantOnly(...grants: string[]): void {
  permissionRef.grants = new Set(grants);
}

let tenantCounter = 0;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EDITION = 'ee';
  tenantSecrets.clear();
  // Fresh tenant per test so the module-level catalog caches never bleed
  // between cases.
  tenantCounter += 1;
  authUser.tenant = `tenant-under-test-${tenantCounter}`;
  qboCreateMock.mockResolvedValue({ query: qboQueryMock });
  qboQueryMock.mockResolvedValue([]);
  xeroSummariesMock.mockResolvedValue([]);
  getStoredQboCredentialsMapMock.mockResolvedValue({});
  getStoredXeroConnectionsMock.mockResolvedValue({});
});

describe('QBO catalog permission boundary', () => {
  it('denies a user holding only billing_settings:read (Project Manager default)', async () => {
    grantOnly('billing_settings:read');
    seedQboCredentials([CONNECTED_REALM]);

    const result = await getQboItems({ realmId: CONNECTED_REALM });

    expect(isActionPermissionError(result)).toBe(true);
    expect(qboCreateMock).not.toHaveBeenCalled();
  });

  it('denies a user with no grants at all', async () => {
    grantOnly();
    seedQboCredentials([CONNECTED_REALM]);

    const result = await getQboCustomers({ realmId: CONNECTED_REALM });

    expect(isActionPermissionError(result)).toBe(true);
    expect(qboCreateMock).not.toHaveBeenCalled();
  });

  it('serves a user holding accounting_catalog:read (Admin/Finance default)', async () => {
    grantOnly('accounting_catalog:read');
    seedQboCredentials([CONNECTED_REALM]);
    qboQueryMock.mockResolvedValue([{ Id: 'item-1', Name: 'Consulting' }]);

    const result = await getQboItems({ realmId: CONNECTED_REALM });

    expect(result).toEqual([{ id: 'item-1', name: 'Consulting' }]);
    expect(qboCreateMock).toHaveBeenCalledTimes(1);
    expect(qboCreateMock).toHaveBeenCalledWith(authUser.tenant, CONNECTED_REALM);
  });

  it('enforces permission on repeated paged reads and returns only projected customer fields on every page', async () => {
    seedQboCredentials([CONNECTED_REALM]);

    grantOnly();
    await expect(getQboCustomers({ realmId: CONNECTED_REALM })).resolves.toSatisfy(isActionPermissionError);
    await expect(getQboCustomers({ realmId: CONNECTED_REALM })).resolves.toSatisfy(isActionPermissionError);
    expect(qboCreateMock).not.toHaveBeenCalled();
    expect(qboQueryMock).not.toHaveBeenCalled();

    grantOnly('accounting_catalog:read');
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      Id: `customer-${index}`,
      DisplayName: `Customer ${index}`,
      Active: true,
      PrimaryEmailAddr: { Address: `private-${index}@example.test` },
      Balance: 1234,
    }));
    qboQueryMock
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([{
        Id: 'customer-1000',
        DisplayName: 'Customer 1000',
        Active: false,
        PrimaryEmailAddr: { Address: 'private-1000@example.test' },
        Balance: 5678,
      }]);

    const result = await getQboCustomers({ realmId: CONNECTED_REALM });

    expect(result).toHaveLength(1001);
    expect(result[0]).toEqual({ id: 'customer-0', name: 'Customer 0', active: true });
    expect(result[1000]).toEqual({ id: 'customer-1000', name: 'Customer 1000', active: false });
    expect(qboQueryMock).toHaveBeenNthCalledWith(
      1,
      'SELECT Id, DisplayName, Active FROM Customer STARTPOSITION 1 MAXRESULTS 1000'
    );
    expect(qboQueryMock).toHaveBeenNthCalledWith(
      2,
      'SELECT Id, DisplayName, Active FROM Customer STARTPOSITION 1001 MAXRESULTS 1000'
    );
  });
});

describe('QBO realm scoping', () => {
  it('fails closed on an explicitly requested realm that is not connected — no provider contact', async () => {
    grantOnly('accounting_catalog:read');
    seedQboCredentials([CONNECTED_REALM]);

    const result = await getQboItems({ realmId: 'realm-that-is-not-connected' });

    expect(isActionMessageError(result)).toBe(true);
    expect(qboCreateMock).not.toHaveBeenCalled();
  });

  it('does not let a disconnected realm reach any page of the paged customer catalog', async () => {
    grantOnly('accounting_catalog:read');
    seedQboCredentials([CONNECTED_REALM]);

    const result = await getQboCustomers({ realmId: OTHER_REALM });

    expect(isActionMessageError(result)).toBe(true);
    expect(qboCreateMock).not.toHaveBeenCalled();
    expect(qboQueryMock).not.toHaveBeenCalled();
  });

  it('never falls back to another realm when the requested realm errors', async () => {
    grantOnly('accounting_catalog:read');
    seedQboCredentials([CONNECTED_REALM, OTHER_REALM]);
    qboQueryMock.mockRejectedValue(new Error('QBO_AUTH_ERROR'));

    const result = await getQboCustomers({ realmId: CONNECTED_REALM });

    expect(isActionMessageError(result)).toBe(true);
    // Exactly one client, pinned to the requested realm; the other connected
    // realm is never touched.
    expect(qboCreateMock).toHaveBeenCalledTimes(1);
    expect(qboCreateMock).toHaveBeenCalledWith(authUser.tenant, CONNECTED_REALM);
  });

  it('reports not-connected without provider contact when the tenant has no realms', async () => {
    grantOnly('accounting_catalog:read');

    const result = await getQboItems({});

    expect(isActionMessageError(result)).toBe(true);
    expect(qboCreateMock).not.toHaveBeenCalled();
  });
});

describe('QBO connection diagnostics stay separately permissioned', () => {
  it('answers a billing_settings:read holder without requiring catalog access', async () => {
    grantOnly('billing_settings:read');

    const status = await getQboConnectionStatus();

    expect(status.connected).toBe(false);
    expect(status.errorCode).not.toBe('FORBIDDEN');
    // Diagnostics shape carries connection metadata, never catalog rows.
    expect(status.connections).toEqual([]);
  });

  it('refuses diagnostics to a user without billing_settings:read', async () => {
    grantOnly('accounting_catalog:read');

    const status = await getQboConnectionStatus();

    expect(status.errorCode).toBe('FORBIDDEN');
    expect(qboCreateMock).not.toHaveBeenCalled();
  });
});

describe('Xero catalog permission and tenant scoping', () => {
  it('denies a user holding only billing_settings:read', async () => {
    grantOnly('billing_settings:read');
    xeroSummariesMock.mockResolvedValue([{ connectionId: 'conn-1', status: 'active' }]);

    const result = await getXeroAccounts('conn-1');

    expect(isActionPermissionError(result)).toBe(true);
    expect(xeroCreateMock).not.toHaveBeenCalled();
  });

  it('fails closed on a disconnected Xero connection id — no provider contact', async () => {
    grantOnly('accounting_catalog:read');
    xeroSummariesMock.mockResolvedValue([{ connectionId: 'conn-1', status: 'active' }]);

    const result = await getXeroAccounts('conn-unknown');

    expect(isActionMessageError(result)).toBe(true);
    expect(xeroCreateMock).not.toHaveBeenCalled();
  });

  it('serves an accounting_catalog:read holder from the requested connection', async () => {
    grantOnly('accounting_catalog:read');
    xeroSummariesMock.mockResolvedValue([{ connectionId: 'conn-1', status: 'active' }]);
    xeroCreateMock.mockResolvedValue({
      listAccounts: async () => [{ accountId: 'acc-1', name: 'Sales', code: '200', type: 'REVENUE' }],
    });

    const result = await getXeroAccounts('conn-1');

    expect(result).toEqual([{ id: 'acc-1', name: 'Sales', code: '200', type: 'REVENUE' }]);
    expect(xeroCreateMock).toHaveBeenCalledWith(authUser.tenant, 'conn-1');
  });
});

describe('External mapping read scope', () => {
  it('denies a user holding only billing_settings:read', async () => {
    grantOnly('billing_settings:read');

    const result = await getExternalEntityMappings({
      integrationType: 'quickbooks_online',
      algaEntityType: 'service',
      externalRealmId: CONNECTED_REALM,
    });

    expect(isActionPermissionError(result)).toBe(true);
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ algaEntityType: 'service', externalRealmId: CONNECTED_REALM }],
    [{ integrationType: 'quickbooks_online', externalRealmId: CONNECTED_REALM }],
    [{ integrationType: 'quickbooks_online', algaEntityType: 'service' }],
    [{}],
  ])('rejects an under-scoped read before any database query: %j', async (params) => {
    grantOnly('accounting_catalog:read');

    const result = await getExternalEntityMappings(params as never);

    expect(isActionMessageError(result)).toBe(true);
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it('accepts a fully scoped read, including an explicit null realm', async () => {
    grantOnly('accounting_catalog:read');
    withTransactionMock.mockResolvedValue([]);

    const result = await getExternalEntityMappings({
      integrationType: 'quickbooks_csv',
      algaEntityType: 'service',
      externalRealmId: null,
    });

    expect(result).toEqual([]);
    expect(withTransactionMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['unknown_provider', 'service', CONNECTED_REALM],
    ['quickbooks_online', 'invoice', CONNECTED_REALM],
    ['quickbooks_csv', 'service', CONNECTED_REALM],
  ])('rejects invalid provider/entity/realm scope before database or provider contact', async (
    integrationType,
    algaEntityType,
    externalRealmId
  ) => {
    grantOnly('accounting_catalog:read');
    getStoredQboCredentialsMapMock.mockResolvedValue({ [CONNECTED_REALM]: { realmId: CONNECTED_REALM } });

    const result = await getExternalEntityMappings({
      integrationType,
      algaEntityType,
      externalRealmId,
    });

    expect(isActionMessageError(result)).toBe(true);
    expect(withTransactionMock).not.toHaveBeenCalled();
    expect(qboCreateMock).not.toHaveBeenCalled();
    expect(xeroCreateMock).not.toHaveBeenCalled();
  });

  it('rejects a disconnected QBO realm before database or provider contact', async () => {
    grantOnly('accounting_catalog:read');
    getStoredQboCredentialsMapMock.mockResolvedValue({ [CONNECTED_REALM]: { realmId: CONNECTED_REALM } });

    const result = await getExternalEntityMappings({
      integrationType: 'quickbooks_online',
      algaEntityType: 'service',
      externalRealmId: OTHER_REALM,
    });

    expect(isActionMessageError(result)).toBe(true);
    expect(withTransactionMock).not.toHaveBeenCalled();
    expect(qboCreateMock).not.toHaveBeenCalled();
  });

  it('rejects a QBO realm presented as a Xero scope', async () => {
    grantOnly('accounting_catalog:read');
    getStoredQboCredentialsMapMock.mockResolvedValue({ [CONNECTED_REALM]: { realmId: CONNECTED_REALM } });
    getStoredXeroConnectionsMock.mockResolvedValue({
      'xero-connection': { xeroTenantId: OTHER_REALM },
    });

    const result = await getExternalEntityMappings({
      integrationType: 'xero',
      algaEntityType: 'service',
      externalRealmId: CONNECTED_REALM,
    });

    expect(isActionMessageError(result)).toBe(true);
    expect(withTransactionMock).not.toHaveBeenCalled();
    expect(xeroCreateMock).not.toHaveBeenCalled();
  });
});
