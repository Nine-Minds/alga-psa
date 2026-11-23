import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { NextRequest } from 'next/server';
import sharp from 'sharp';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import Comment from '../../../../packages/tickets/src/models/comment';

/**
 * GET /api/v1/documents/content (the endpoint behind the `read_attachment` MCP tool) against a real database.
 * Stubbed: authentication (the caller's tenant/user are switchable), the ticket:read RBAC check, the ticket
 * read kernel and the ticket document projection (switchable per test), storage bytes, and the document-level
 * gate pair (canReadDocument / getAuthorizedDocumentById) so a denial can be forced per document. Everything
 * else is real: ticket-number resolution, tenant scoping, client-portal visibility, the comment-attachment
 * audience filter, the engine and the cursor.
 */
const state = vi.hoisted(() => ({
  knex: null as any,
  tenant: '',
  asClient: false,
  internalUser: '',
  clientUser: '',
  clientId: '',
  contactId: '',
  allowTicketRead: true,
  ticketKernelAllow: true,
  projectionDenied: new Set<string>(),
  docReadDenied: new Set<string>(),
  docKernelDenied: new Set<string>(),
  files: new Map<string, { buffer: Buffer; mime: string }>(),
  downloads: [] as string[],
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
vi.mock('../../lib/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('../../lib/api/middleware/apiContextPermission', () => ({
  hasApiContextPermission: vi.fn(async (_ctx: unknown, resource: string, action: string) =>
    resource === 'ticket' && action === 'read' ? state.allowTicketRead : true,
  ),
}));
vi.mock('../../lib/api/controllers/authorizationKernel', () => ({
  projectApiResourceRead: vi.fn(async (input: { record: object }) => (state.ticketKernelAllow ? input.record : null)),
  reprojectUnderDecision: vi.fn((_gate: unknown, record: any) => {
    if (Array.isArray(record)) return record;
    return record && state.projectionDenied.has(record.document_id) ? null : record;
  }),
}));
vi.mock('@alga-psa/documents/lib/documentPermissions', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  canReadDocument: vi.fn(async (_user: unknown, documentId: string) => !state.docReadDenied.has(documentId)),
}));
vi.mock('@alga-psa/documents/actions/documentActions', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getAuthorizedDocumentById: vi.fn(async (trx: Knex.Transaction, tenant: string, user: any, documentId: string) => {
      if (state.docKernelDenied.has(documentId)) return null;
      return actual.getAuthorizedDocumentById(trx, tenant, user, documentId);
    }),
  };
});
vi.mock('@alga-psa/storage/StorageService', () => ({
  StorageService: {
    downloadFile: vi.fn(async (fileId: string) => {
      state.downloads.push(fileId);
      const f = state.files.get(fileId);
      return f ? { buffer: f.buffer, metadata: { mime_type: f.mime } } : null;
    }),
  },
}));
vi.mock('../../lib/api/controllers/ApiBaseController', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api/controllers/ApiBaseController')>();
  class Stubbed extends (actual as any).ApiBaseController {
    protected async authenticate(req: NextRequest) {
      const user = state.asClient
        ? { user_id: state.clientUser, tenant: state.tenant, user_type: 'client', contact_id: state.contactId, clientId: state.clientId }
        : { user_id: state.internalUser, tenant: state.tenant, user_type: 'internal' };
      (req as any).context = { userId: user.user_id, tenant: state.tenant, user };
      return req;
    }
  }
  return { ...actual, ApiBaseController: Stubbed };
});

const HOOK_TIMEOUT = 180_000;
let db: Knex;
let controller: any;
const tenants: string[] = [];
const tFor = (tenant: string) => (table: string) => tenantDb(db, tenant).table(table);
const fixtureTenants = () => tenantDb(db, '__content_fixture__').unscoped('tenants', 'content read integration fixture');

interface Fixture {
  tenant: string;
  internalUser: string;
  clientUser: string;
  clientId: string;
  contactId: string;
  ticketId: string;
  ticketNumber: string;
  docs: Record<string, string>;
}

const png = (w: number, h: number, color: string) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();

/** A born-digital one-page PDF. */
const pdfBytes = () => {
  const stream = 'BT /F1 12 Tf 72 720 Td (Citrix migration checklist for the gateway) Tj ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [4 0 R] >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
};

async function buildFixture(label: string): Promise<Fixture> {
  const tenant = uuidv4();
  tenants.push(tenant);
  const t = tFor(tenant);
  const internalUser = uuidv4();
  const clientUser = uuidv4();
  const clientId = uuidv4();
  const contactId = uuidv4();
  const boardId = uuidv4();
  const statusId = uuidv4();
  const priorityId = uuidv4();
  const ticketId = uuidv4();
  const ticketNumber = `SR${Math.floor(100000 + Math.random() * 899999)}`;
  await fixtureTenants().insert({
    tenant, client_name: `Tenant ${label}`, email: `t-${tenant.slice(0, 8)}@example.com`, created_at: db.fn.now(), updated_at: db.fn.now(),
  });
  await t('users').insert({
    tenant, user_id: internalUser, username: `i-${tenant.slice(0, 8)}`, hashed_password: 'x',
    email: `i-${tenant.slice(0, 8)}@example.com`, user_type: 'internal', is_inactive: false, created_at: db.fn.now(),
  });
  await t('clients').insert({
    tenant, client_id: clientId, client_name: 'Acme', billing_cycle: 'monthly', is_tax_exempt: false, created_at: db.fn.now(), updated_at: db.fn.now(),
  });
  await t('contacts').insert({
    tenant, contact_name_id: contactId, full_name: 'Pat Doe', client_id: clientId, email: `pat-${tenant.slice(0, 8)}@example.com`,
    created_at: db.fn.now(), updated_at: db.fn.now(),
  });
  await t('users').insert({
    tenant, user_id: clientUser, username: `c-${tenant.slice(0, 8)}`, hashed_password: 'x',
    email: `c-${tenant.slice(0, 8)}@example.com`, user_type: 'client', contact_id: contactId, is_inactive: false, created_at: db.fn.now(),
  });
  await t('boards').insert({ tenant, board_id: boardId, board_name: 'Support', is_default: true, is_inactive: false });
  await t('priorities').insert({
    tenant, priority_id: priorityId, priority_name: 'High', item_type: 'ticket', color: '#EF4444', order_number: 10,
    created_by: internalUser, created_at: db.fn.now(), updated_at: db.fn.now(),
  });
  await t('statuses').insert({
    tenant, status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket', is_closed: false, is_default: true,
    order_number: 10, created_by: internalUser, created_at: db.fn.now(),
  });
  await t('tickets').insert({
    tenant, ticket_id: ticketId, ticket_number: ticketNumber, title: 'Install photos', client_id: clientId, contact_name_id: contactId,
    board_id: boardId, status_id: statusId, priority_id: priorityId, entered_by: internalUser, entered_at: db.fn.now(), updated_at: db.fn.now(),
  });
  return { tenant, internalUser, clientUser, clientId, contactId, ticketId, ticketNumber, docs: {} };
}

let seq = 0;
/** Attach a document to the fixture's ticket. `age` orders the associations (older first). */
async function addDoc(
  fx: Fixture,
  key: string,
  opts: { name: string; file?: { bytes: Buffer; mime: string }; markdown?: string; clientVisible?: boolean; age: number },
) {
  const t = tFor(fx.tenant);
  const documentId = uuidv4();
  let fileId: string | null = null;
  if (opts.file) {
    fileId = uuidv4();
    await t('external_files').insert({
      tenant: fx.tenant, file_id: fileId, file_name: opts.name, original_name: opts.name, mime_type: opts.file.mime,
      file_size: opts.file.bytes.length, storage_path: `/t/${fileId}`, uploaded_by_id: fx.internalUser,
    });
    state.files.set(fileId, { buffer: opts.file.bytes, mime: opts.file.mime });
  }
  await t('documents').insert({
    tenant: fx.tenant, document_id: documentId, document_name: opts.name, content: '', user_id: fx.internalUser, created_by: fx.internalUser,
    entered_at: db.fn.now(), updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, ++seq)),
    file_id: fileId, mime_type: opts.file?.mime ?? null, file_size: opts.file?.bytes.length ?? null, is_client_visible: opts.clientVisible ?? false,
  });
  if (opts.markdown) {
    await t('document_content').insert({
      tenant: fx.tenant, id: uuidv4(), document_id: documentId, content: opts.markdown, created_by_id: fx.internalUser, updated_by_id: fx.internalUser,
    });
  }
  await t('document_associations').insert({
    tenant: fx.tenant, association_id: uuidv4(), document_id: documentId, entity_id: fx.ticketId, entity_type: 'ticket',
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, opts.age)),
  });
  fx.docs[key] = documentId;
  return documentId;
}

let A: Fixture;
let B: Fixture;

const act = (fx: Fixture, mode: 'internal' | 'client' = 'internal') => {
  state.tenant = fx.tenant;
  state.asClient = mode === 'client';
  state.internalUser = fx.internalUser;
  state.clientUser = fx.clientUser;
  state.clientId = fx.clientId;
  state.contactId = fx.contactId;
};

async function get(params: Record<string, string | undefined>) {
  const url = new URL('http://localhost/api/v1/documents/content');
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  const res = await controller.readContent()(new NextRequest(url, { headers: { 'x-api-key': 'k' } }));
  const json = await res.json();
  return { status: res.status, json, header: json?.data?.header, blocks: (json?.data?.blocks ?? []) as Array<{ type: string; [k: string]: any }> };
}

const servedNames = (r: { header: any }) => r.header.served.map((s: { name: string }) => s.name);

beforeAll(async () => {
  db = await createTestDbConnection();
  state.knex = db;
  A = await buildFixture('A');
  B = await buildFixture('B');

  const PNG_SMALL = await png(60, 40, '#cc2211');
  await addDoc(A, 'photo', { name: 'IMG_0001.png', file: { bytes: PNG_SMALL, mime: 'image/png' }, clientVisible: true, age: 1 });
  await addDoc(A, 'pdf', { name: 'Install Guide.pdf', file: { bytes: pdfBytes(), mime: 'application/pdf' }, clientVisible: false, age: 2 });
  await addDoc(A, 'note', { name: 'Call notes', markdown: 'Customer wants the VPN fixed.', clientVisible: true, age: 3 });
  await addDoc(A, 'photo2', { name: 'IMG_0002.png', file: { bytes: await png(61, 41, '#2211cc'), mime: 'image/png' }, clientVisible: true, age: 4 });
  await addDoc(B, 'photo', { name: 'OTHER_TENANT.png', file: { bytes: PNG_SMALL, mime: 'image/png' }, clientVisible: true, age: 1 });

  // An attachment of an internal note: hidden from client-portal readers by the comment-attachment audience filter.
  const internalDoc = await addDoc(A, 'internalNoteAttachment', {
    name: 'INTERNAL_ONLY.png', file: { bytes: await png(62, 42, '#11cc22'), mime: 'image/png' }, clientVisible: true, age: 5,
  });
  const commentId = await Comment.insert(db, A.tenant, {
    ticket_id: A.ticketId, user_id: A.internalUser, author_type: 'internal', is_resolution: false, is_internal: true, note: 'internal note',
  } as any);
  await tFor(A.tenant)('ticket_comment_attachments').insert({
    tenant: A.tenant, ticket_id: A.ticketId, document_id: internalDoc, created_by: A.internalUser, comment_id: commentId,
    state: 'attached', expires_at: new Date(Date.now() + 86_400_000),
  });

  controller = new (await import('../../lib/api/controllers/ApiDocumentController')).ApiDocumentController();
}, HOOK_TIMEOUT);

afterAll(async () => {
  if (db) {
    for (const tenant of tenants) {
      const del = async (name: string) => tenantDb(db, tenant).table(name).del().catch(() => undefined);
      for (const name of [
        'ticket_comment_attachments', 'comments', 'document_content', 'document_associations', 'documents', 'external_files',
        'tickets', 'statuses', 'priorities', 'boards', 'users', 'contacts', 'clients',
      ]) {
        await del(name);
      }
      await fixtureTenants().where({ tenant }).del().catch(() => undefined);
    }
    await db.destroy();
  }
}, HOOK_TIMEOUT);

// Tests run in random order: every test starts as an internal user of tenant A with every gate open.
beforeEach(() => act(A));

afterEach(() => {
  act(A);
  state.allowTicketRead = true;
  state.ticketKernelAllow = true;
  state.projectionDenied.clear();
  state.docReadDenied.clear();
  state.docKernelDenied.clear();
  state.downloads.length = 0;
  delete process.env.ATTACHMENT_CONTENT_BUDGET_OVERRIDE;
});

describe('GET /api/v1/documents/content', () => {
  it('reads every attachment of a ticket by ticket number, in stable association order, as native blocks', async () => {
    act(A);
    const r = await get({ entity_type: 'ticket', entity_id: A.ticketNumber });
    expect(r.status).toBe(200);
    expect(r.header.entity).toEqual({ type: 'ticket', id: A.ticketId, label: A.ticketNumber });
    expect(servedNames(r)).toEqual(['IMG_0001.png', 'Install Guide.pdf', 'Call notes', 'IMG_0002.png', 'INTERNAL_ONLY.png']);
    expect(r.header.next_cursor).toBeNull();
    expect(r.header.limits_applied).toEqual([]);
    const types = r.blocks.map((b) => b.type);
    expect(types.filter((t) => t === 'image')).toHaveLength(3);
    expect(types).toContain('resource'); // the PDF original
    const text = r.blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    expect(text).toContain('Citrix migration checklist for the gateway');
    expect(text).toContain('Customer wants the VPN fixed.');
    // The same ticket by UUID answers identically.
    const byId = await get({ entity_type: 'ticket', entity_id: A.ticketId.toUpperCase() });
    expect(servedNames(byId)).toEqual(servedNames(r));
  });

  it('resolves the ticket number case-insensitively', async () => {
    const r = await get({ entity_type: 'ticket', entity_id: A.ticketNumber.toLowerCase() });
    expect(r.status).toBe(200);
    expect(r.header.entity.id).toBe(A.ticketId);
  });

  it('reads a single attachment by document_id and loads only its bytes', async () => {
    const r = await get({ entity_type: 'ticket', entity_id: A.ticketNumber, document_id: A.docs.photo2 });
    expect(r.status).toBe(200);
    expect(servedNames(r)).toEqual(['IMG_0002.png']);
    expect(r.blocks.filter((b) => b.type === 'image')).toHaveLength(1);
    expect(state.downloads).toHaveLength(1);
  });

  it('paginates with next_cursor: every attachment exactly once, then a stale cursor answers 409', async () => {
    process.env.ATTACHMENT_CONTENT_BUDGET_OVERRIDE = JSON.stringify({ maxImages: 1 });
    const first = await get({ entity_type: 'ticket', entity_id: A.ticketNumber });
    expect(first.status).toBe(200);
    expect(first.header.limits_applied).toEqual(['max_images']);
    expect(first.header.next_cursor).toEqual(expect.any(String));
    expect(servedNames(first)).toEqual(['IMG_0001.png', 'Install Guide.pdf', 'Call notes']);

    const seen = [...servedNames(first)];
    let cursor: string | null = first.header.next_cursor;
    let guard = 0;
    while (cursor && guard++ < 10) {
      const next = await get({ entity_type: 'ticket', entity_id: A.ticketNumber, cursor });
      expect(next.status).toBe(200);
      seen.push(...servedNames(next));
      cursor = next.header.next_cursor;
    }
    expect(seen).toEqual(['IMG_0001.png', 'Install Guide.pdf', 'Call notes', 'IMG_0002.png', 'INTERNAL_ONLY.png']);

    // A cursor issued before an attachment changed is stale.
    const again = await get({ entity_type: 'ticket', entity_id: A.ticketNumber });
    const staleCursor = again.header.next_cursor as string;
    await tFor(A.tenant)('documents').where({ document_id: A.docs.photo2 }).update({ updated_at: new Date('2027-01-01T00:00:00Z') });
    try {
      const stale = await get({ entity_type: 'ticket', entity_id: A.ticketNumber, cursor: staleCursor });
      expect(stale.status).toBe(409);
      expect(stale.json.error.code).toBe('CURSOR_STALE');
      expect(stale.json.error.message).toContain('call read_attachment again without a cursor');
    } finally {
      await tFor(A.tenant)('documents').where({ document_id: A.docs.photo2 }).update({ updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 59)) });
    }
  });

  it('pages a ticket with 120 attachments to the end: all 200s, every cursor within the 8192 cap, each document exactly once', async () => {
    const MAX_CURSOR_LENGTH = 8192; // the cap in schemas/documentContentRead.ts
    const C = await buildFixture('C-many');
    const total = 120;
    const ids: string[] = [];
    for (let i = 0; i < total; i++) {
      ids.push(
        await addDoc(C, `t${i}`, {
          name: `note-${String(i).padStart(3, '0')}.txt`,
          file: { bytes: Buffer.from(`attachment number ${i}: ${'x'.repeat(150)}`), mime: 'text/plain' },
          age: i + 1,
        }),
      );
    }
    act(C);
    // Small text budget so a call serves only a few files: 120 attachments need many pages.
    process.env.ATTACHMENT_CONTENT_BUDGET_OVERRIDE = JSON.stringify({ maxTextChars: 700 });
    const served: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r = await get({ entity_type: 'ticket', entity_id: C.ticketNumber, cursor: cursor ?? undefined });
      expect(r.status).toBe(200);
      served.push(...(r.header.served as Array<{ document_id: string }>).map((s) => s.document_id));
      cursor = r.header.next_cursor;
      if (cursor) expect(cursor.length).toBeLessThanOrEqual(MAX_CURSOR_LENGTH);
      pages++;
    } while (cursor && pages < 500);
    expect(cursor).toBeNull();
    expect(pages).toBeGreaterThan(5); // paging really happened
    expect(new Set(served).size).toBe(served.length); // no duplicates
    expect([...served].sort()).toEqual([...ids].sort()); // no gaps
  }, 120_000);

  it('rejects a malformed cursor (400) and a cursor from another read', async () => {
    const bad = await get({ entity_type: 'ticket', entity_id: A.ticketNumber, cursor: 'not-a-cursor' });
    expect(bad.status).toBe(400);
    process.env.ATTACHMENT_CONTENT_BUDGET_OVERRIDE = JSON.stringify({ maxImages: 1 });
    const first = await get({ entity_type: 'ticket', entity_id: A.ticketNumber });
    const other = await get({ entity_type: 'ticket', entity_id: A.ticketNumber, document_id: A.docs.photo, cursor: first.header.next_cursor });
    expect(other.status).toBe(400);
  });

  it('validates the query: unknown entity_type, missing entity_id, bad document_id', async () => {
    expect((await get({ entity_type: 'asset', entity_id: 'x' })).status).toBe(400);
    expect((await get({ entity_type: 'ticket' })).status).toBe(400);
    expect((await get({ entity_type: 'ticket', entity_id: A.ticketNumber, document_id: 'nope' })).status).toBe(400);
  });

  // ---- the denial and visibility matrix -------------------------------------------------------

  it("another tenant's ticket answers 404, by UUID and by number (existence is not confirmed)", async () => {
    act(A);
    expect((await get({ entity_type: 'ticket', entity_id: B.ticketId })).status).toBe(404);
    expect((await get({ entity_type: 'ticket', entity_id: B.ticketNumber })).status).toBe(404);
    expect((await get({ entity_type: 'ticket', entity_id: 'SR000000' })).status).toBe(404);
    act(B);
    const own = await get({ entity_type: 'ticket', entity_id: B.ticketNumber });
    expect(own.status).toBe(200);
    expect(servedNames(own)).toEqual(['OTHER_TENANT.png']);
  });

  it('without ticket:read answers 403 and serves nothing', async () => {
    state.allowTicketRead = false;
    const r = await get({ entity_type: 'ticket', entity_id: A.ticketNumber });
    expect(r.status).toBe(403);
    expect(state.downloads).toHaveLength(0);
  });

  it('a ticket the read kernel denies answers 404 (not 403) and serves nothing', async () => {
    state.ticketKernelAllow = false;
    const r = await get({ entity_type: 'ticket', entity_id: A.ticketNumber });
    expect(r.status).toBe(404);
    expect(state.downloads).toHaveLength(0);
  });

  it('a document the ticket projection redacts away is left out of the whole read and 404s by id', async () => {
    state.projectionDenied.add(A.docs.pdf);
    const all = await get({ entity_type: 'ticket', entity_id: A.ticketNumber });
    expect(servedNames(all)).not.toContain('Install Guide.pdf');
    const one = await get({ entity_type: 'ticket', entity_id: A.ticketNumber, document_id: A.docs.pdf });
    expect(one.status).toBe(404);
  });

  it('document-level denial (canReadDocument or the document kernel): omitted from the whole read, 404 when explicit, no bytes read', async () => {
    state.docReadDenied.add(A.docs.photo);
    state.docKernelDenied.add(A.docs.pdf);
    const all = await get({ entity_type: 'ticket', entity_id: A.ticketNumber });
    expect(all.status).toBe(200);
    expect(servedNames(all)).toEqual(['Call notes', 'IMG_0002.png', 'INTERNAL_ONLY.png']);
    expect(JSON.stringify(all.json)).not.toContain('IMG_0001');
    expect(all.header.omitted).toEqual([]); // silently left out: no hint that they exist
    expect(state.downloads).toHaveLength(2);
    for (const key of ['photo', 'pdf']) {
      const one = await get({ entity_type: 'ticket', entity_id: A.ticketNumber, document_id: A.docs[key] });
      expect(one.status).toBe(404);
    }
  });

  it('client-portal visibility and the comment-attachment audience are respected', async () => {
    act(A, 'client');
    const r = await get({ entity_type: 'ticket', entity_id: A.ticketNumber });
    expect(r.status).toBe(200);
    // Not client-visible (the PDF) and the internal note's attachment are absent; client-visible ones remain.
    expect(servedNames(r)).toEqual(['IMG_0001.png', 'Call notes', 'IMG_0002.png']);
    const hidden = await get({ entity_type: 'ticket', entity_id: A.ticketNumber, document_id: A.docs.internalNoteAttachment });
    expect(hidden.status).toBe(404);
    const hiddenPdf = await get({ entity_type: 'ticket', entity_id: A.ticketNumber, document_id: A.docs.pdf });
    expect(hiddenPdf.status).toBe(404);
  });

  it('MSP staff still see the internal note attachment', async () => {
    act(A, 'internal');
    const r = await get({ entity_type: 'ticket', entity_id: A.ticketNumber, document_id: A.docs.internalNoteAttachment });
    expect(r.status).toBe(200);
  });

  it('an unreadable attachment is reported under omitted with a reason, not as an error', async () => {
    const zip = Buffer.from('PK\u0003\u0004 not really a zip but sniffed as one');
    act(A);
    const id = await addDoc(A, 'blob', { name: 'survey.xlsx', file: { bytes: Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), zip]), mime: 'application/vnd.ms-excel' }, age: 6 });
    const r = await get({ entity_type: 'ticket', entity_id: A.ticketNumber, document_id: id });
    expect(r.status).toBe(200);
    expect(r.header.omitted).toEqual([expect.objectContaining({ name: 'survey.xlsx', reason: 'unsupported_type' })]);
    expect(r.blocks.map((b) => b.type)).toEqual(['text', 'resource_link']);
    await tFor(A.tenant)('document_associations').where({ document_id: id }).del();
    await tFor(A.tenant)('documents').where({ document_id: id }).del();
  });

  it('the endpoint is absent from the generated MCP and chat registries, and present in the OpenAPI spec', () => {
    const root = path.resolve(__dirname, '../../../..');
    for (const file of ['server/src/lib/mcp/registry.generated.ts', 'ee/server/src/chat/registry/apiRegistry.generated.ts']) {
      expect(fs.readFileSync(path.join(root, file), 'utf8')).not.toContain('/api/v1/documents/content');
    }
    const spec = JSON.parse(fs.readFileSync(path.join(root, 'sdk/docs/openapi/alga-openapi.ce.json'), 'utf8'));
    expect(spec.paths['/api/v1/documents/content'].get.extensions['x-chat-exclude']).toBe(true);
  });

  it('the readable entity types of the adapters match the schema and the tool definition', async () => {
    const { readableEntityTypes } = await import('../../lib/api/services/documents/entityAdapters');
    const { READABLE_ENTITY_TYPES } = await import('../../lib/api/schemas/documentContentRead');
    const { READ_ATTACHMENT_ENTITY_TYPES } = await import('@alga-psa/agent-tooling');
    expect([...readableEntityTypes()].sort()).toEqual([...READABLE_ENTITY_TYPES].sort());
    expect([...READ_ATTACHMENT_ENTITY_TYPES].sort()).toEqual([...READABLE_ENTITY_TYPES].sort());
  });
});
