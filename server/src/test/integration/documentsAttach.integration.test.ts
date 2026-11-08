import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { NextRequest } from 'next/server';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

/**
 * POST /api/v1/documents against a real database and the real local storage
 * provider (temp dir). Only authentication, RBAC and the outbound network are
 * stubbed: the API key is accepted, hasPermission is switchable per test, and
 * the SSRF-guarded fetch gets an injected DNS answer + response.
 */
const env = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/alga-attach-it-${process.pid}`;
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
  allow: true,
  kernelAllow: true,
  product: 'psa' as 'psa' | 'algadesk',
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
  getTenantProduct: vi.fn(async () => state.product),
}));
vi.mock('../../lib/auth/rbac', () => ({
  hasPermission: vi.fn(async () => state.allow),
}));
vi.mock('../../lib/api/controllers/authorizationKernel', () => ({
  authorizeApiResourceRead: vi.fn(async () => state.kernelAllow),
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
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
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

let db: Knex;
let controller: any;
const tenants = new Set<string>();
const t = (table: string) => tenantDb(db, state.tenant).table(table);
const fixtureTenants = () => tenantDb(db, '__attach_fixture__').unscoped('tenants', 'attach integration fixture');

const ids = {
  user: uuidv4(),
  client: uuidv4(),
  contact: uuidv4(),
  ticket: uuidv4(),
};

async function post(body: unknown) {
  const req = new NextRequest('http://localhost/api/v1/documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'k' },
    body: JSON.stringify(body),
  });
  const res = await controller.attach()(req);
  return { status: res.status, json: await res.json() };
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
    tenant: state.tenant, user_id: ids.user, username: `u-${state.tenant.slice(0, 8)}`,
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
  const boardId = uuidv4();
  const statusId = uuidv4();
  const priorityId = uuidv4();
  await t('boards').insert({ tenant: state.tenant, board_id: boardId, board_name: 'Support', is_default: true, is_inactive: false });
  await t('priorities').insert({
    tenant: state.tenant, priority_id: priorityId, priority_name: 'High', item_type: 'ticket', color: '#EF4444',
    order_number: 10, created_by: ids.user, created_at: db.fn.now(), updated_at: db.fn.now(),
  });
  await t('statuses').insert({
    tenant: state.tenant, status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket',
    is_closed: false, is_default: true, order_number: 10, created_by: ids.user, created_at: db.fn.now(),
  });
  await t('tickets').insert({
    tenant: state.tenant, ticket_id: ids.ticket, ticket_number: `T-${Date.now()}`, title: 'Printer down',
    client_id: ids.client, board_id: boardId, status_id: statusId, priority_id: priorityId,
    entered_by: ids.user, entered_at: db.fn.now(), updated_at: db.fn.now(),
  });

  const { ApiDocumentController } = await import('../../lib/api/controllers/ApiDocumentController');
  controller = new ApiDocumentController();
}, HOOK_TIMEOUT);

afterAll(async () => {
  if (db) {
    for (const tenant of tenants) {
      const del = async (name: string) => tenantDb(db, tenant).table(name).del().catch(() => undefined);
      for (const name of [
        'ticket_audit_logs', 'document_fetch_hosts', 'document_associations', 'documents', 'external_files', 'tickets', 'statuses',
        'priorities', 'boards', 'contacts', 'clients', 'users',
      ]) {
        await del(name);
      }
      await fixtureTenants().where({ tenant }).del().catch(() => undefined);
    }
    await db.destroy();
  }
  rmSync(env.dir, { recursive: true, force: true });
}, HOOK_TIMEOUT);

async function storedBytes(documentId: string): Promise<Buffer> {
  const doc = await t('documents').where({ document_id: documentId }).first();
  const file = await t('external_files').where({ file_id: doc.file_id }).first();
  return readFileSync(path.join(env.dir, file.storage_path));
}

describe('POST /api/v1/documents', () => {
  afterEach(() => {
    state.allow = true;
    state.kernelAllow = true;
    state.product = 'psa';
  });

  it('returns 403 (parity with GET /tickets/:id) when the read-authorization kernel denies the ticket', async () => {
    state.kernelAllow = false;
    const { status, json } = await post({
      entity_type: 'ticket',
      entity_id: ids.ticket,
      source: { type: 'base64', content: Buffer.from('x').toString('base64') },
      file_name: 'x.txt',
    });
    expect(status).toBe(403);
    expect(json.error.message).toMatch(/Cannot read ticket/);
  }, HOOK_TIMEOUT);

  it('returns 404 for a missing ticket', async () => {
    const { status } = await post({
      entity_type: 'ticket',
      entity_id: uuidv4(),
      source: { type: 'base64', content: Buffer.from('x').toString('base64') },
      file_name: 'x.txt',
    });
    expect(status).toBe(404);
  }, HOOK_TIMEOUT);

  it('algadesk tenant: ticket attach works, PSA-only entities get 403 PRODUCT_ACCESS_DENIED', async () => {
    state.product = 'algadesk';
    const content = Buffer.from('helpdesk note').toString('base64');
    const ok = await post({
      entity_type: 'ticket', entity_id: ids.ticket, source: { type: 'base64', content }, file_name: 'n.txt',
    });
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);

    for (const entity_type of ['project_task', 'asset']) {
      const denied = await post({
        entity_type, entity_id: uuidv4(), source: { type: 'base64', content }, file_name: 'n.txt',
      });
      expect(denied.status).toBe(403);
      expect(denied.json.error.code).toBe('PRODUCT_ACCESS_DENIED');
    }
  }, HOOK_TIMEOUT);

  it('attaches base64 content to a ticket: document, association, stored bytes, activity row', async () => {
    state.allow = true;
    const text = Buffer.from('printer logs: paper jam on tray 2');
    const { status, json } = await post({
      entity_type: 'ticket',
      entity_id: ids.ticket,
      source: { type: 'base64', content: text.toString('base64') },
      file_name: 'logs.txt',
    });
    expect(status, JSON.stringify(json)).toBe(201);
    const documentId = json.data.document_id;

    const doc = await t('documents').where({ document_id: documentId }).first();
    expect(doc).toMatchObject({ document_name: 'logs.txt', mime_type: 'text/plain', created_by: ids.user });

    const assoc = await t('document_associations').where({ document_id: documentId }).first();
    expect(assoc).toMatchObject({ entity_id: ids.ticket, entity_type: 'ticket' });

    expect((await storedBytes(documentId)).equals(text)).toBe(true);

    const activity = await t('ticket_audit_logs').where({ ticket_id: ids.ticket, entity_id: documentId }).first();
    expect(activity).toBeDefined();
    expect(activity.actor_user_id).toBe(ids.user);
  }, HOOK_TIMEOUT);

  it('attaches a URL (fetch stubbed) to a contact', async () => {
    await t('document_fetch_hosts').insert({
      tenant: state.tenant, entry_id: uuidv4(), kind: 'custom', host_pattern: 'files.example.com',
      created_by: state.userId,
    });
    state.allow = true;
    state.fetchCalls = [];
    state.fetchBody = new Uint8Array(PNG);
    const { status, json } = await post({
      entity_type: 'contact',
      entity_id: ids.contact,
      source: { type: 'url', url: 'https://files.example.com/shots/screen.png?sig=SECRET-TOKEN' },
    });
    expect(status, JSON.stringify(json)).toBe(201);
    expect(state.fetchCalls).toHaveLength(1);
    const documentId = json.data.document_id;

    const doc = await t('documents').where({ document_id: documentId }).first();
    expect(doc).toMatchObject({ document_name: 'screen.png', mime_type: 'image/png' });
    const assoc = await t('document_associations').where({ document_id: documentId }).first();
    expect(assoc).toMatchObject({ entity_id: ids.contact, entity_type: 'contact' });
    expect((await storedBytes(documentId)).equals(PNG)).toBe(true);
    expect(JSON.stringify(json)).not.toContain('SECRET-TOKEN');
  }, HOOK_TIMEOUT);

  it('returns 400 for a disallowed MIME type and stores nothing', async () => {
    state.allow = true;
    const before = Number((await t('documents').count<{ count: string }[]>('* as count'))[0].count);
    const { status, json } = await post({
      entity_type: 'ticket',
      entity_id: ids.ticket,
      source: { type: 'base64', content: Buffer.from('MZ-binary').toString('base64') },
      file_name: 'tool.exe',
      mime_type: 'application/x-msdownload',
    });
    expect(status, JSON.stringify(json)).toBe(400);
    const after = Number((await t('documents').count<{ count: string }[]>('* as count'))[0].count);
    expect(after).toBe(before);
  }, HOOK_TIMEOUT);

  it('returns 400 for an oversize file', async () => {
    state.allow = true;
    const { status, json } = await post({
      entity_type: 'ticket',
      entity_id: ids.ticket,
      source: { type: 'base64', content: Buffer.alloc(8192, 'a').toString('base64') },
      file_name: 'big.txt',
    });
    expect(status, JSON.stringify(json)).toBe(400);
  }, HOOK_TIMEOUT);

  it('returns 404 when the entity does not exist', async () => {
    state.allow = true;
    const { status, json } = await post({
      entity_type: 'ticket',
      entity_id: uuidv4(),
      source: { type: 'base64', content: Buffer.from('x').toString('base64') },
      file_name: 'a.txt',
    });
    expect(status, JSON.stringify(json)).toBe(404);
  }, HOOK_TIMEOUT);

  it('returns 403 when RBAC denies', async () => {
    state.allow = false;
    const { status, json } = await post({
      entity_type: 'ticket',
      entity_id: ids.ticket,
      source: { type: 'base64', content: Buffer.from('x').toString('base64') },
      file_name: 'a.txt',
    });
    expect(status, JSON.stringify(json)).toBe(403);
    state.allow = true;
  }, HOOK_TIMEOUT);
});
