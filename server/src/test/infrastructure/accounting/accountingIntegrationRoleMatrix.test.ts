import { vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

// ---------------------------------------------------------------------------
// Hoisted remote-boundary mocks. The accounting actions under test reach the
// remote provider only through these seams; the tests assert that permission
// denials happen BEFORE any seam is touched.
// ---------------------------------------------------------------------------

const remote = vi.hoisted(() => {
  const tenantSecrets = new Map<string, string>();
  return {
    tenantSecrets,
    qboClientCreateCalls: { count: 0 },
    getStoredQboCredentialsMap: vi.fn(async () => ({}) as Record<string, unknown>),
    getDefaultQboRealmId: vi.fn(async () => null),
    resolveQboOAuthCredentials: vi.fn(async () => ({
      clientId: 'matrix-client-id',
      clientSecret: 'matrix-client-secret',
      source: 'tenant' as const,
    })),
    getQboRedirectUri: vi.fn(async () => 'https://example.test/api/integrations/qbo/callback'),
    getQboOAuthScopesString: vi.fn(() => 'com.intuit.quickbooks.accounting openid profile email'),
    upsertStoredQboCredentials: vi.fn(async () => undefined),
    getTenantSecret: vi.fn(async (tenant: string, key: string) => tenantSecrets.get(`${tenant}:${key}`) ?? null),
    setTenantSecret: vi.fn(async (tenant: string, key: string, value: string) => {
      tenantSecrets.set(`${tenant}:${key}`, value);
    }),
    deleteTenantSecret: vi.fn(async (tenant: string, key: string) => {
      tenantSecrets.delete(`${tenant}:${key}`);
    }),
  };
});

// The withAuth/getSession/getCurrentUser seam. `@alga-psa/auth/rbac` is NOT
// mocked: the role matrix must read real role_permissions from the database.
vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: remote.getTenantSecret,
    setTenantSecret: remote.setTenantSecret,
    deleteTenantSecret: remote.deleteTenantSecret,
    getAppSecret: async () => undefined,
  }),
  getSecret: async () => undefined,
}));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    QboClientService: {
      create: vi.fn(async () => {
        remote.qboClientCreateCalls.count += 1;
        throw new Error('remote boundary must not be reached');
      }),
    },
    getStoredQboCredentialsMap: remote.getStoredQboCredentialsMap,
    getDefaultQboRealmId: remote.getDefaultQboRealmId,
    resolveQboOAuthCredentials: remote.resolveQboOAuthCredentials,
    getQboRedirectUri: remote.getQboRedirectUri,
    getQboOAuthScopesString: remote.getQboOAuthScopesString,
    upsertStoredQboCredentials: remote.upsertStoredQboCredentials,
  };
});

vi.mock('axios', () => ({
  default: {
    post: vi.fn(async () => ({
      data: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        x_refresh_token_expires_in: 8640000,
      },
    })),
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(() => undefined),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
// Imports (after the mocks).
// ---------------------------------------------------------------------------

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../test-utils/dbConfig';
import { currentUserRef } from '../../../../test-utils/authModuleMock';
import { createClient, createUser } from '../../../../test-utils/testDataFactory';
import { saveQboCredentials, disconnectQbo, getQboAccounts } from '@alga-psa/integrations/actions/qboActions';
import { createExternalEntityMapping } from '@alga-psa/integrations/actions/externalMappingActions';
import {
  runAccountingSyncNow,
  setDefaultQboRealm,
} from '@alga-psa/billing/actions/accountingSyncActions';
import { voidInvoice } from '@alga-psa/billing/actions/voidInvoiceActions';
import { GET as qboConnect } from '@alga-psa/integrations/routes/api/integrations/qbo/connect';
import {
  QBO_OAUTH_STATE_COOKIE,
  createQboOAuthState,
  getQboStateSigningSecret,
} from '@alga-psa/integrations/lib/qbo/qboOAuthState';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let db: Knex;
let tenantId: string;
let adminUserId: string;
let financeUserId: string;
let pmUserId: string;
let customUserId: string;
let noPermUserId: string;

async function createUserWithRole(username: string, roleName: string): Promise<string> {
  const userId = await createUser(db, tenantId, { username, user_type: 'internal' });
  const role = await tenantDb(db, tenantId).table('roles')
    .where({ role_name: roleName, msp: true })
    .first('role_id');
  await tenantDb(db, tenantId).table('user_roles').insert({
    tenant: tenantId,
    user_id: userId,
    role_id: role.role_id,
  });
  return userId;
}

async function createCustomRoleUser(username: string): Promise<string> {
  const roleId = randomUUID();
  await tenantDb(db, tenantId).table('roles').insert({
    tenant: tenantId,
    role_id: roleId,
    role_name: 'Accounting Reviewer',
    description: 'Matrix custom role: catalog_read + exports_execute only',
    msp: true,
    client: false,
  });
  const permissions = await tenantDb(db, tenantId).table('permissions')
    .where({ tenant: tenantId, resource: 'accounting_integrations' })
    .whereIn('action', ['catalog_read', 'exports_execute'])
    .select('permission_id');
  await tenantDb(db, tenantId).table('role_permissions').insert(
    permissions.map((permission) => ({
      tenant: tenantId,
      role_id: roleId,
      permission_id: permission.permission_id,
    }))
  );

  const userId = await createUser(db, tenantId, { username, user_type: 'internal' });
  await tenantDb(db, tenantId).table('user_roles').insert({
    tenant: tenantId,
    user_id: userId,
    role_id: roleId,
  });
  return userId;
}

function runAs(userId: string): void {
  currentUserRef.user = {
    ...currentUserRef.user,
    user_id: userId,
    tenant: tenantId,
    user_type: 'internal',
  };
}

async function seedClient(name: string): Promise<string> {
  return createClient(db, tenantId, name, {
    billing_cycle: 'monthly',
    is_tax_exempt: true,
  });
}

async function seedLocalInvoice(clientId: string): Promise<string> {
  const invoiceId = randomUUID();
  const now = new Date().toISOString();
  await db('invoices').insert({
    tenant: tenantId,
    invoice_id: invoiceId,
    client_id: clientId,
    invoice_number: `LOCAL-${invoiceId.slice(0, 8)}`,
    invoice_date: now,
    due_date: now,
    subtotal: 10000,
    tax: 0,
    total_amount: 10000,
    status: 'sent',
    credit_applied: 0,
    currency_code: 'USD',
    is_manual: false,
    is_prepayment: false,
    invoice_type: 'standard',
    finalized_at: now,
  });
  return invoiceId;
}

async function seedExportedInvoice(clientId: string): Promise<string> {
  const invoiceId = randomUUID();
  const now = new Date().toISOString();
  await db('invoices').insert({
    tenant: tenantId,
    invoice_id: invoiceId,
    client_id: clientId,
    invoice_number: `MATRIX-${invoiceId.slice(0, 8)}`,
    invoice_date: now,
    due_date: now,
    subtotal: 10000,
    tax: 0,
    total_amount: 10000,
    status: 'sent',
    credit_applied: 0,
    currency_code: 'USD',
    is_manual: false,
    is_prepayment: false,
    invoice_type: 'standard',
    finalized_at: now,
  });
  await tenantDb(db, tenantId).table('tenant_external_entity_mappings').insert({
    tenant: tenantId,
    integration_type: 'quickbooks_online',
    alga_entity_type: 'invoice',
    alga_entity_id: invoiceId,
    external_entity_id: `QBO-INV-${invoiceId.slice(0, 8)}`,
    external_realm_id: 'realm-1',
    sync_status: 'synced',
  });
  return invoiceId;
}

async function readAuditRows(operation: string, userId?: string): Promise<Array<Record<string, unknown>>> {
  return db.transaction(async (trx) => {
    await trx.raw("select set_config('app.current_tenant', ?, true)", [tenantId]);
    const query = tenantDb(trx, tenantId).table('audit_logs').where({ operation });
    if (userId) query.andWhere({ user_id: userId });
    return query.orderBy('timestamp', 'desc').limit(5);
  });
}

describe('accounting integration capability role matrix', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection();
    const tenantRow = await db('tenants').first();
    if (!tenantRow?.tenant) {
      throw new Error('Seeded test database has no tenant');
    }
    tenantId = tenantRow.tenant as string;
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    // Set unconditionally: a NEXTAUTH_SECRET loaded from the environment would
    // otherwise diverge from the literal the callback tests sign their OAuth
    // state with, and state validation would reject before the capability gate.
    process.env.NEXTAUTH_SECRET = 'matrix-test-secret-at-least-32-chars-long';

    adminUserId = await createUserWithRole('matrix-admin', 'Admin');
    financeUserId = await createUserWithRole('matrix-finance', 'Finance');
    pmUserId = await createUserWithRole('matrix-pm', 'Project Manager');
    customUserId = await createCustomRoleUser('matrix-custom');
    noPermUserId = await createUser(db, tenantId, { username: 'matrix-noperm', user_type: 'internal' });
  }, 300000);

  afterAll(async () => {
    await db?.destroy();
  }, 30000);

  beforeEach(() => {
    remote.qboClientCreateCalls.count = 0;
    // The secret-provider spies are module-level and shared across the whole
    // file: clear their call history between tests so the denial assertions
    // (`not.toHaveBeenCalled`) never see calls made by an earlier allow test.
    remote.getTenantSecret.mockClear();
    remote.setTenantSecret.mockClear();
    remote.deleteTenantSecret.mockClear();
    remote.getStoredQboCredentialsMap.mockClear();
    remote.getDefaultQboRealmId.mockClear();
    remote.resolveQboOAuthCredentials.mockClear();
    remote.getQboRedirectUri.mockClear();
    remote.upsertStoredQboCredentials.mockClear();
    remote.getStoredQboCredentialsMap.mockResolvedValue({});
    remote.getDefaultQboRealmId.mockResolvedValue(null);
  });

  describe('connect (OAuth connect route)', () => {
    it('allows Admin and denies everyone without connections_manage, before any remote call', async () => {
      const admin = await (await db('users').where({ user_id: adminUserId }).first());
      runAs(adminUserId);
      const adminResponse = await qboConnect();
      expect(adminResponse.status).toBe(307);
      expect(adminResponse.headers.get('location')).toContain('appcenter.intuit.com/connect/oauth2');

      for (const userId of [financeUserId, pmUserId, customUserId, noPermUserId]) {
        runAs(userId);
        const response = await qboConnect();
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: 'Forbidden' });
      }

      expect(remote.qboClientCreateCalls.count).toBe(0);
    });
  });

  describe('credential save (saveQboCredentials)', () => {
    it('denies Finance, PM, custom (no connections_manage) and no-permission users without touching secrets or audit', async () => {
      for (const userId of [financeUserId, pmUserId, customUserId, noPermUserId]) {
        runAs(userId);
        const result = await saveQboCredentials({ clientId: 'id', clientSecret: 'secret' });
        expect(result).toMatchObject({ success: false });
        expect(result.error).toMatch(/permission/i);
        expect(remote.setTenantSecret).not.toHaveBeenCalled();
      }
      expect(remote.qboClientCreateCalls.count).toBe(0);
    });

    it('allows Admin, persists credentials, and writes a value-free audit entry', async () => {
      runAs(adminUserId);
      remote.tenantSecrets.clear();
      const result = await saveQboCredentials({ clientId: 'id-1', clientSecret: 'secret-1' });
      expect(result).toEqual({ success: true });
      expect(remote.setTenantSecret).toHaveBeenCalledWith(tenantId, 'qbo_client_id', 'id-1');

      const auditRows = await readAuditRows('accounting_credentials_saved', adminUserId);
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({ operation: 'accounting_credentials_saved' });
      const details = auditRows[0].details as Record<string, unknown>;
      expect(JSON.stringify(details)).not.toContain('id-1');
      expect(JSON.stringify(details)).not.toContain('secret-1');
    });
  });

  describe('catalog read (getQboAccounts)', () => {
    it('denies PM and no-permission users with a permission error and no remote call', async () => {
      for (const userId of [pmUserId, noPermUserId]) {
        runAs(userId);
        const result = await getQboAccounts();
        expect(isActionPermissionError(result)).toBe(true);
      }
      expect(remote.qboClientCreateCalls.count).toBe(0);
    });

    it('allows Admin, Finance, and the custom reviewer (catalog_read) without a permission error', async () => {
      for (const userId of [adminUserId, financeUserId, customUserId]) {
        runAs(userId);
        const result = await getQboAccounts();
        expect(isActionPermissionError(result)).toBe(false);
      }
      expect(remote.qboClientCreateCalls.count).toBe(0);
    });
  });

  describe('mapping change (createExternalEntityMapping)', () => {
    it('denies PM and the custom reviewer (no mappings_manage)', async () => {
      const clientId = await seedClient('Matrix Mapping Client');
      for (const userId of [pmUserId, customUserId, noPermUserId]) {
        runAs(userId);
        const result = await createExternalEntityMapping({
          integration_type: 'quickbooks_online',
          alga_entity_type: 'client',
          alga_entity_id: clientId,
          external_entity_id: 'QBO-CUST-X',
          external_realm_id: 'realm-1',
        });
        expect(isActionPermissionError(result)).toBe(true);
      }
    });

    it('allows Admin and Finance (mappings_manage) and writes a value-free audit entry', async () => {
      const clientId = await seedClient('Matrix Mapping Client 2');
      for (const userId of [adminUserId, financeUserId]) {
        runAs(userId);
        const result = await createExternalEntityMapping({
          integration_type: 'quickbooks_online',
          alga_entity_type: 'client',
          alga_entity_id: `${clientId}-${userId.slice(0, 8)}`,
          external_entity_id: `QBO-CUST-${userId.slice(0, 8)}`,
          external_realm_id: 'realm-1',
        });
        expect(isActionPermissionError(result)).toBe(false);
        expect((result as { id?: string }).id).toBeTruthy();
      }

      const auditRows = await readAuditRows('accounting_mapping_created');
      expect(auditRows.length).toBeGreaterThanOrEqual(2);
      for (const row of auditRows) {
        const details = row.details as Record<string, unknown>;
        expect(JSON.stringify(details)).not.toContain('secret');
      }
    });
  });

  describe('export execution (runAccountingSyncNow)', () => {
    it('allows Admin, Finance, and the custom reviewer (exports_execute); denies PM and no-permission', async () => {
      for (const userId of [adminUserId, financeUserId, customUserId]) {
        runAs(userId);
        const result = await runAccountingSyncNow();
        expect(result).toMatchObject({ ran: false, status: 'skipped' });
      }

      for (const userId of [pmUserId, noPermUserId]) {
        runAs(userId);
        await expect(runAccountingSyncNow()).rejects.toThrow('Forbidden');
      }
      expect(remote.qboClientCreateCalls.count).toBe(0);
    });
  });

  describe('realm change (setDefaultQboRealm)', () => {
    it('denies Finance, PM, custom, and no-permission users', async () => {
      for (const userId of [financeUserId, pmUserId, customUserId, noPermUserId]) {
        runAs(userId);
        const result = await setDefaultQboRealm('realm-1');
        expect(result).toEqual({ success: false, error: 'You do not have permission to update accounting sync settings.' });
      }
    });

    it('allows Admin against a connected realm and writes a value-free audit entry', async () => {
      remote.getStoredQboCredentialsMap.mockResolvedValue({
        'realm-1': { accessToken: 'x', refreshToken: 'y', realmId: 'realm-1' },
      } as Record<string, unknown>);
      runAs(adminUserId);
      const result = await setDefaultQboRealm('realm-1');
      expect(result).toEqual({ success: true });

      const auditRows = await readAuditRows('accounting_default_realm_changed', adminUserId);
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({ operation: 'accounting_default_realm_changed' });
      const details = auditRows[0].details as Record<string, unknown>;
      expect(JSON.stringify(details)).not.toContain('accessToken');
    });
  });

  describe('disconnect (disconnectQbo)', () => {
    it('denies Finance, PM, custom, and no-permission users', async () => {
      for (const userId of [financeUserId, pmUserId, customUserId, noPermUserId]) {
        runAs(userId);
        const result = await disconnectQbo();
        expect(result).toMatchObject({ success: false });
        expect(result.error).toMatch(/permission/i);
        expect(remote.deleteTenantSecret).not.toHaveBeenCalled();
      }
    });

    it('allows Admin, deletes the stored credentials, and writes a value-free audit entry', async () => {
      const leakedToken = 'disconnect-access-token-xyz';
      remote.tenantSecrets.set(`${tenantId}:qbo_credentials`, JSON.stringify({ 'realm-1': { accessToken: leakedToken } }));
      runAs(adminUserId);
      const result = await disconnectQbo();
      expect(result).toEqual({ success: true });

      const auditRows = await readAuditRows('accounting_disconnected', adminUserId);
      expect(auditRows).toHaveLength(1);
      const details = auditRows[0].details as Record<string, unknown>;
      expect(JSON.stringify(details)).not.toContain(leakedToken);
    });
  });

  describe('remote destructive action (voiding an exported invoice)', () => {
    it('denies Finance (has invoice:update but not remote_mutate) without voiding', async () => {
      const clientId = await seedClient('Matrix Void Client');
      const invoiceId = await seedExportedInvoice(clientId);

      runAs(financeUserId);
      const result = await voidInvoice(invoiceId, 'Matrix remote-mutate denial');
      expect(result).toEqual({
        success: false,
        error: 'Permission denied: voiding invoices that sync to the accounting integration requires the accounting remote-mutate permission.',
      });

      const invoice = await db('invoices').where({ invoice_id: invoiceId, tenant: tenantId }).first();
      expect(invoice.status).toBe('sent');
      expect(remote.qboClientCreateCalls.count).toBe(0);
    });

    it('lets Finance void an unmapped (purely local) invoice without remote_mutate', async () => {
      const clientId = await seedClient('Matrix Local Void Client');
      const invoiceId = await seedLocalInvoice(clientId);

      runAs(financeUserId);
      const result = await voidInvoice(invoiceId, 'Matrix local void');
      expect(result).toEqual({ success: true });

      const invoice = await db('invoices').where({ invoice_id: invoiceId, tenant: tenantId }).first();
      expect(invoice.status).toBe('cancelled');
      expect(remote.qboClientCreateCalls.count).toBe(0);
    });

    it('allows Admin (remote_mutate) to void an exported invoice', async () => {
      const clientId = await seedClient('Matrix Void Client 2');
      const invoiceId = await seedExportedInvoice(clientId);

      runAs(adminUserId);
      const result = await voidInvoice(invoiceId, 'Matrix admin void');
      expect(result).toEqual({ success: true });

      const invoice = await db('invoices').where({ invoice_id: invoiceId, tenant: tenantId }).first();
      expect(invoice.status).toBe('cancelled');
      expect(remote.qboClientCreateCalls.count).toBe(0);
    });
  });

  describe('OAuth callback refuses users who lost connections_manage', () => {
    async function buildCallbackRequest(): Promise<Request> {
      const signingSecret = await getQboStateSigningSecret();
      const { stateParam, cookieValue } = createQboOAuthState({ tenantId, secret: signingSecret ?? '' });
      const url = `https://example.test/api/integrations/qbo/callback?code=abc&state=${stateParam}&realmId=realm-1`;
      return new Request(url, {
        headers: { cookie: `${QBO_OAUTH_STATE_COOKIE}=${encodeURIComponent(cookieValue)}` },
      });
    }

    it('redirects a Finance session to the failure path with qbo_error=forbidden', async () => {
      const request = await buildCallbackRequest();

      runAs(financeUserId);
      const { GET: qboCallback } = await import('@alga-psa/integrations/routes/api/integrations/qbo/callback');
      const response = await qboCallback(request);
      expect(response.status).toBe(307);
      const location = response.headers.get('location') ?? '';
      expect(location).toContain('qbo_status=failure');
      expect(location).toContain('qbo_error=forbidden');
    });

    it('lets an Admin session complete and records an accounting_connected audit entry', async () => {
      const request = await buildCallbackRequest();

      runAs(adminUserId);
      const { GET: qboCallback } = await import('@alga-psa/integrations/routes/api/integrations/qbo/callback');
      const response = await qboCallback(request);
      expect(response.status).toBe(307);
      const location = response.headers.get('location') ?? '';
      expect(location).toContain('qbo_status=success');

      const auditRows = await readAuditRows('accounting_connected', adminUserId);
      expect(auditRows).toHaveLength(1);
    });
  });
});
