import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { NextRequest } from 'next/server';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

/**
 * Tenant-managed download-host allowlist for URL document sources, against a real database.
 * Stubbed: authentication, RBAC (switchable per permission), and the outbound network
 * (DNS answer + response). The allowlist, safeFetch policy, settings service, migration and
 * audit rows are all real.
 */
const env = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/alga-fetchhosts-it-${process.pid}`;
  process.env.STORAGE_LOCAL_BASE_PATH = dir;
  process.env.STORAGE_DEFAULT_PROVIDER = 'local';
  process.env.STORAGE_LOCAL_MAX_FILE_SIZE = '4096';
  process.env.STORAGE_LOCAL_ALLOWED_MIME_TYPES = 'image/png,text/plain,application/pdf';
  return { dir };
});

const state = vi.hoisted(() => ({
  knex: null as any,
  tenant: '',
  userId: '',
  denied: new Set<string>(),
  lookups: [] as string[],
  fetchCalls: [] as string[],
  fetchBody: new Uint8Array(),
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: state.knex, tenant: state.tenant })),
}));
vi.mock('../../lib/db/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/db/db')>()),
  getConnection: vi.fn(async () => state.knex),
}));
vi.mock('@/lib/productAccess', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getTenantProduct: vi.fn(async () => 'psa'),
}));
const rbac = vi.hoisted(() => ({
  hasPermission: async (_user: unknown, resource: string, action: string) =>
    !state.denied.has(`${resource}:${action}`),
}));
vi.mock('../../lib/auth/rbac', () => rbac);
vi.mock('@alga-psa/auth/rbac', () => rbac);
vi.mock('../../lib/api/controllers/authorizationKernel', () => ({
  authorizeApiResourceRead: vi.fn(async () => true),
}));
vi.mock('../../lib/api/controllers/ApiBaseController', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api/controllers/ApiBaseController')>();
  class Stubbed extends (actual as any).ApiBaseController {
    protected async authenticate(req: NextRequest) {
      (req as any).context = {
        userId: state.userId,
        tenant: state.tenant,
        user: { user_id: state.userId, tenant: state.tenant, user_type: 'internal' },
      };
      return req;
    }
  }
  return { ...actual, ApiBaseController: Stubbed };
});
vi.mock('../../lib/net/safeFetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/net/safeFetch')>();
  return {
    ...actual,
    safeFetch: (url: string, init: any) =>
      actual.safeFetch(url, init, {
        lookup: async (host: string) => {
          state.lookups.push(host);
          return [{ address: '93.184.216.34', family: 4 }];
        },
        fetch: async (u: string) => {
          state.fetchCalls.push(u);
          return new Response(state.fetchBody, {
            status: 200,
            headers: { 'content-type': 'image/png', 'content-length': String(state.fetchBody.length) },
          });
        },
      }),
  };
});

const HOOK_TIMEOUT = 180_000;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const CHATGPT_URL = 'https://files.oaiusercontent.com/file-abc/shot.png?sig=SECRET-QUERY-TOKEN';
const OTHER_URL = 'https://uploads.acme-corp.example/shots/screen.png?sig=SECRET-QUERY-TOKEN';

let db: Knex;
let controller: any;
let settings: typeof import('../../lib/api/services/documents/fetchHostSettings');
const tenants = new Set<string>();
const t = (table: string) => tenantDb(db, state.tenant).table(table);
const fixtureTenants = () => tenantDb(db, '__fetchhosts_fixture__').unscoped('tenants', 'fetch hosts integration fixture');
const ids = { user: uuidv4(), client: uuidv4(), contact: uuidv4() };
const ctx = () => ({ knex: db, tenant: state.tenant, user: { user_id: ids.user, tenant: state.tenant } as any });

async function postUrl(url: string) {
  const req = new NextRequest('http://localhost/api/v1/documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'k' },
    body: JSON.stringify({ entity_type: 'contact', entity_id: ids.contact, source: { type: 'url', url }, file_name: 'shot.png' }),
  });
  const res = await controller.attach()(req);
  return { status: res.status, json: await res.json() };
}
const documentCount = async () => Number((await t('documents').count<{ count: string }[]>('* as count'))[0].count);
const auditRows = () => t('audit_logs').where({ table_name: 'document_fetch_hosts' }).orderBy('timestamp', 'asc');
async function resetHosts() {
  await t('document_fetch_hosts').del();
  await t('audit_logs').where({ table_name: 'document_fetch_hosts' }).del();
}

beforeAll(async () => {
  db = await createTestDbConnection();
  state.knex = db;
  state.tenant = uuidv4();
  state.userId = ids.user;
  tenants.add(state.tenant);

  await fixtureTenants().insert({
    tenant: state.tenant,
    client_name: `Tenant ${state.tenant.slice(0, 8)}`,
    email: `t-${state.tenant.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await t('users').insert({
    tenant: state.tenant, user_id: ids.user, username: `u-${state.tenant.slice(0, 8)}`, first_name: 'Dorothy', last_name: 'Gale',
    hashed_password: 'x', email: `u-${state.tenant.slice(0, 8)}@example.com`, user_type: 'internal',
    is_inactive: false, created_at: db.fn.now(),
  });
  await t('clients').insert({
    tenant: state.tenant, client_id: ids.client, client_name: 'Acme', billing_cycle: 'monthly',
    is_tax_exempt: false, created_at: db.fn.now(), updated_at: db.fn.now(),
  });
  await t('contacts').insert({
    tenant: state.tenant, contact_name_id: ids.contact, full_name: 'Pat Doe', client_id: ids.client,
    email: 'pat@example.com', created_at: db.fn.now(), updated_at: db.fn.now(),
  });

  settings = await import('../../lib/api/services/documents/fetchHostSettings');
  const { ApiDocumentController } = await import('../../lib/api/controllers/ApiDocumentController');
  controller = new ApiDocumentController();
}, HOOK_TIMEOUT);

afterAll(async () => {
  if (db) {
    for (const tenant of tenants) {
      const del = async (name: string) => tenantDb(db, tenant).table(name).del().catch(() => undefined);
      for (const name of [
        'audit_logs', 'document_fetch_hosts', 'document_associations', 'documents', 'external_files',
        'contacts', 'clients', 'users',
      ]) {
        await del(name);
      }
      await fixtureTenants().where({ tenant }).del().catch(() => undefined);
    }
    await db.destroy();
  }
  rmSync(env.dir, { recursive: true, force: true });
}, HOOK_TIMEOUT);

beforeEach(async () => {
  state.denied.clear();
  state.lookups = [];
  state.fetchCalls = [];
  state.fetchBody = new Uint8Array(PNG);
  await resetHosts();
});

describe('allowlist on POST /api/v1/documents', () => {
  it('refuses a host that is not listed: 400 FETCH_HOST_NOT_ALLOWED, no lookup, no fetch, no document', async () => {
    const before = await documentCount();
    const { status, json } = await postUrl(OTHER_URL);
    expect(status, JSON.stringify(json)).toBe(400);
    expect(json.error.code).toBe('FETCH_HOST_NOT_ALLOWED');
    expect(json.error.message).toMatch(/uploads\.acme-corp\.example/);
    expect(json.error.message).toMatch(/Settings > MCP Server/);
    expect(JSON.stringify(json)).not.toContain('SECRET-QUERY-TOKEN');
    expect(state.lookups).toHaveLength(0);
    expect(state.fetchCalls).toHaveLength(0);
    expect(await documentCount()).toBe(before);
  }, HOOK_TIMEOUT);

  it('after an admin adds the host, the same call returns 201', async () => {
    expect((await postUrl(OTHER_URL)).status).toBe(400);
    const added = await settings.addCustomFetchHost(ctx(), { hostPattern: 'uploads.acme-corp.example', note: 'Acme bucket' });
    expect(added.success).toBe(true);
    const { status, json } = await postUrl(OTHER_URL);
    expect(status, JSON.stringify(json)).toBe(201);
    expect(state.fetchCalls).toHaveLength(1);
  }, HOOK_TIMEOUT);

  it('allows the built-in ChatGPT host by default, and refuses it once the tenant disables it', async () => {
    expect((await postUrl(CHATGPT_URL)).status).toBe(201);

    expect((await settings.disableBuiltinFetchHost(ctx(), 'files.oaiusercontent.com')).success).toBe(true);
    state.fetchCalls = [];
    const refused = await postUrl(CHATGPT_URL);
    expect(refused.status).toBe(400);
    expect(refused.json.error.code).toBe('FETCH_HOST_NOT_ALLOWED');
    expect(state.fetchCalls).toHaveLength(0);

    expect((await settings.enableBuiltinFetchHost(ctx(), 'files.oaiusercontent.com')).success).toBe(true);
    expect((await postUrl(CHATGPT_URL)).status).toBe(201);
  }, HOOK_TIMEOUT);

  it('wildcard entries match subdomains only', async () => {
    await settings.addCustomFetchHost(ctx(), { hostPattern: '*.files.acme-corp.example' });
    expect((await postUrl('https://a.files.acme-corp.example/x.png')).status).toBe(201);
    expect((await postUrl('https://files.acme-corp.example/x.png')).json.error.code).toBe('FETCH_HOST_NOT_ALLOWED');
    expect((await postUrl('https://evilfiles.acme-corp.example/x.png')).json.error.code).toBe('FETCH_HOST_NOT_ALLOWED');
  }, HOOK_TIMEOUT);

  it('base64 sources are unaffected by the allowlist (even with every built-in disabled)', async () => {
    await settings.disableBuiltinFetchHost(ctx(), 'files.oaiusercontent.com');
    const req = new NextRequest('http://localhost/api/v1/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'k' },
      body: JSON.stringify({
        entity_type: 'contact', entity_id: ids.contact,
        source: { type: 'base64', content: Buffer.from('plain text').toString('base64') }, file_name: 'n.txt',
      }),
    });
    const res = await controller.attach()(req);
    expect(res.status).toBe(201);
  }, HOOK_TIMEOUT);

  it('logs the rejected hostname and never the path or query', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await postUrl(OTHER_URL);
      const lines = [...warn.mock.calls, ...err.mock.calls, ...log.mock.calls].map((c) => c.map((x) => JSON.stringify(x)).join(' ')).join('\n');
      expect(lines).toContain('uploads.acme-corp.example');
      expect(lines).not.toContain('SECRET-QUERY-TOKEN');
      expect(lines).not.toContain('/shots/screen.png');
    } finally {
      warn.mockRestore();
      err.mockRestore();
      log.mockRestore();
    }
  }, HOOK_TIMEOUT);
});

describe('managing the list', () => {
  it('denies add, remove, disable and enable without document:manage_fetch_hosts, and changes nothing', async () => {
    const added = await settings.addCustomFetchHost(ctx(), { hostPattern: 'keep.acme-corp.example' });
    if (!added.success) throw new Error('setup failed');
    await resetAudit();

    state.denied.add('document:manage_fetch_hosts');
    // document:create is held, and must not be enough.
    expect(state.denied.has('document:create')).toBe(false);

    const results = [
      await settings.addCustomFetchHost(ctx(), { hostPattern: 'new.acme-corp.example' }),
      await settings.removeCustomFetchHost(ctx(), added.entryId),
      await settings.disableBuiltinFetchHost(ctx(), 'files.oaiusercontent.com'),
      await settings.enableBuiltinFetchHost(ctx(), 'files.oaiusercontent.com'),
    ];
    for (const r of results) expect(r).toMatchObject({ success: false, code: 'PERMISSION_DENIED' });

    expect(await t('document_fetch_hosts').count<{ count: string }[]>('* as count')).toEqual([{ count: '1' }]);
    expect(await auditRows()).toHaveLength(0);
  }, HOOK_TIMEOUT);

  async function resetAudit() {
    await t('audit_logs').where({ table_name: 'document_fetch_hosts' }).del();
  }

  it('writes exactly one audit row per change, with before/after and the note', async () => {
    const added = await settings.addCustomFetchHost(ctx(), { hostPattern: ' Uploads.Acme-Corp.example ', note: 'Acme bucket' });
    if (!added.success) throw new Error(added.error);
    expect(added.hostPattern).toBe('uploads.acme-corp.example');

    let rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      operation: 'document_fetch_host.added',
      table_name: 'document_fetch_hosts',
      record_id: added.entryId,
      user_id: ids.user,
    });
    expect(rows[0].changed_data.before).toBeNull();
    expect(rows[0].changed_data.after).toMatchObject({ host_pattern: 'uploads.acme-corp.example', kind: 'custom', note: 'Acme bucket' });
    expect(rows[0].details).toEqual({ note: 'Acme bucket' });

    await settings.disableBuiltinFetchHost(ctx(), 'files.oaiusercontent.com');
    await settings.enableBuiltinFetchHost(ctx(), 'files.oaiusercontent.com');
    const removed = await settings.removeCustomFetchHost(ctx(), added.entryId);
    expect(removed.success).toBe(true);

    rows = await auditRows();
    expect(rows.map((r: any) => r.operation)).toEqual([
      'document_fetch_host.added',
      'document_fetch_host.builtin_disabled',
      'document_fetch_host.builtin_enabled',
      'document_fetch_host.removed',
    ]);
    const last = rows[3];
    expect(last.record_id).toBe(added.entryId);
    expect(last.changed_data.before).toMatchObject({ host_pattern: 'uploads.acme-corp.example' });
    expect(last.changed_data.after).toBeNull();
    const disabled = rows[1];
    expect(disabled.changed_data.before).toBeNull();
    expect(disabled.changed_data.after).toMatchObject({ kind: 'builtin_disabled', host_pattern: 'files.oaiusercontent.com' });
  }, HOOK_TIMEOUT);

  it('refuses invalid and duplicate entries without writing an audit row', async () => {
    const bad = await settings.addCustomFetchHost(ctx(), { hostPattern: '*.s3.amazonaws.com' });
    expect(bad).toMatchObject({ success: false, code: 'INVALID' });
    expect((bad as any).error).toMatch(/bucket or site host/);

    expect((await settings.addCustomFetchHost(ctx(), { hostPattern: 'dup.acme-corp.example' })).success).toBe(true);
    expect(await settings.addCustomFetchHost(ctx(), { hostPattern: 'dup.acme-corp.example' })).toMatchObject({ success: false, code: 'DUPLICATE' });
    expect(await auditRows()).toHaveLength(1);
  }, HOOK_TIMEOUT);

  it('lists built-ins and custom entries with the display name of who added them', async () => {
    await settings.addCustomFetchHost(ctx(), { hostPattern: 'list.acme-corp.example', note: 'n' });
    const res = await settings.listFetchHostSettings(ctx());
    if (!res.success) throw new Error(res.error);
    expect(res.settings.canManage).toBe(true);
    expect(res.settings.builtin).toEqual([expect.objectContaining({ pattern: 'files.oaiusercontent.com', enabled: true })]);
    expect(res.settings.custom).toEqual([
      expect.objectContaining({ hostPattern: 'list.acme-corp.example', note: 'n', addedBy: 'Dorothy Gale' }),
    ]);
    expect(JSON.stringify(res.settings.custom)).not.toContain(ids.user);

    state.denied.add('document:manage_fetch_hosts');
    const ro = await settings.listFetchHostSettings(ctx());
    if (!ro.success) throw new Error(ro.error);
    expect(ro.settings.canManage).toBe(false);
  }, HOOK_TIMEOUT);

  it('rolls the change back when the audit insert fails', async () => {
    // A real database-level failure on exactly this setting's audit rows.
    await db.raw(`
      CREATE OR REPLACE FUNCTION fetch_hosts_it_fail_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.table_name = 'document_fetch_hosts' THEN RAISE EXCEPTION 'forced audit failure'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql`);
    await db.raw('CREATE TRIGGER fetch_hosts_it_fail_audit_trg BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fetch_hosts_it_fail_audit()');
    try {
      await expect(settings.addCustomFetchHost(ctx(), { hostPattern: 'rolledback.acme-corp.example' })).rejects.toThrow(/forced audit failure/);
      await expect(settings.disableBuiltinFetchHost(ctx(), 'files.oaiusercontent.com')).rejects.toThrow(/forced audit failure/);
      expect(await t('document_fetch_hosts').select('*')).toHaveLength(0);
      // ...so the effective allowlist is unchanged and the host is still refused.
      expect((await postUrl(OTHER_URL)).status).toBe(400);
      expect((await postUrl(CHATGPT_URL)).status).toBe(201);
    } finally {
      await db.raw('DROP TRIGGER IF EXISTS fetch_hosts_it_fail_audit_trg ON audit_logs');
      await db.raw('DROP FUNCTION IF EXISTS fetch_hosts_it_fail_audit()');
    }
  }, HOOK_TIMEOUT);
});

describe('migration', () => {
  it('created the table with the unique key and the permission catalog entry', async () => {
    await settings.addCustomFetchHost(ctx(), { hostPattern: 'uniq.acme-corp.example' });
    await expect(
      t('document_fetch_hosts').insert({ tenant: state.tenant, kind: 'custom', host_pattern: 'uniq.acme-corp.example' }),
    ).rejects.toThrow(/document_fetch_hosts_tenant_kind_host_unique|duplicate key/);
    const perm = await db('permissions').where({ resource: 'document', action: 'manage_fetch_hosts' }).first();
    expect(perm).toBeDefined();
  }, HOOK_TIMEOUT);
});
