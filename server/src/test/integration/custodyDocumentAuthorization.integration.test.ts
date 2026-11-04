import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Knex } from 'knex';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { seedLabelWorld, type LabelWorld } from './labelsFixtures';
import { authorizeAndRedactDocuments } from '@shared/lib/documentAuthorization';

const session = vi.hoisted(() => ({ user: null as any, db: null as any, tenant: '' }));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: async () => session.user }));
vi.mock('@/lib/db/db', () => ({ getConnection: async () => session.db }));
vi.mock('server/src/lib/db', async importOriginal => ({
  ...await importOriginal<typeof import('server/src/lib/db')>(),
  createTenantKnex: async () => ({ knex: session.db, tenant: session.tenant }),
}));
vi.mock('@alga-psa/db', async importOriginal => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex: session.db, tenant: session.tenant }),
}));
vi.mock('@alga-psa/auth', async importOriginal => ({
  ...await importOriginal<typeof import('@alga-psa/auth')>(),
  withAuth: (fn: any) => (...args: any[]) => fn(session.user, { tenant: session.tenant }, ...args),
}));
vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: (user: any, resource: string, action: string) =>
    import('@alga-psa/authorization/rbac').then(m => m.hasPermission(user, resource, action, session.db)),
}));
let db: Knex;
let world: LabelWorld;
let doc: any;
const dir = mkdtempSync(join(tmpdir(), 'custody-doc-auth-'));

describe('asset-associated document authorization', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    process.env.STORAGE_DEFAULT_PROVIDER = 'local'; process.env.STORAGE_LOCAL_BASE_PATH = dir;
    db = await createTestDbConnection({ runSeeds: false });
    world = await seedLabelWorld(db, dir);
    session.db = db; session.tenant = world.tenant; session.user = world.tech;
    const permission_id = randomUUID();
    await db('permissions').insert({ tenant: world.tenant, permission_id, resource: 'document', action: 'read', msp: true, client: false });
    const roleId = (await db('user_roles').where({ tenant: world.tenant, user_id: world.tech.user_id }).first()).role_id;
    await db('role_permissions').insert({ tenant: world.tenant, role_id: roleId, permission_id });
    const document_id = randomUUID();
    await db('documents').insert({ tenant: world.tenant, document_id, document_name: 'private condition', user_id: world.tech.user_id, created_by: world.tech.user_id, is_client_visible: false });
    await db('document_associations').insert([
      { tenant: world.tenant, document_id, entity_type: 'asset', entity_id: world.assets.b1 },
      { tenant: world.tenant, document_id, entity_type: 'ticket', entity_id: world.tickets.a1 },
    ]);
    const file = await db('external_files').where({ tenant: world.tenant, file_id: world.logoFileId }).first();
    const fileIds = [randomUUID(), randomUUID(), randomUUID()];
    for (const file_id of fileIds) {
      await db('external_files').insert({ tenant: world.tenant, file_id, file_name: file.file_name,
        original_name: file.original_name, mime_type: file.mime_type, file_size: file.file_size,
        storage_path: file.storage_path, uploaded_by_id: world.tech.user_id, is_deleted: false });
    }
    await db('documents').where({ tenant: world.tenant, document_id }).update({
      file_id: fileIds[0], thumbnail_file_id: fileIds[1], preview_file_id: fileIds[2], mime_type: 'image/png',
    });
    doc = await db('documents').where({ tenant: world.tenant, document_id }).first();
  }, 180_000);
  afterAll(async () => { await db?.destroy(); rmSync(dir, { recursive: true, force: true }); });
  const read = (user: any, tenant = world.tenant) => db.transaction(trx => authorizeAndRedactDocuments(trx, tenant, user, [doc]));

  it('allows a user with document and asset access', async () => {
    expect(await read(world.tech)).toHaveLength(1);
  });
  it('refuses a user without asset access', async () => {
    expect(await read(world.noPerm)).toEqual([]);
  });
  it('honours a verified mailbox grant for a roleless recipient but never for an asset-linked document', async () => {
    // Callers own document RBAC; a verified recipient has no roles, only the lifecycle grant.
    const document_id = randomUUID();
    await db('documents').insert({ tenant: world.tenant, document_id, document_name: 'public reply', user_id: world.tech.user_id, created_by: world.tech.user_id, is_client_visible: true });
    await db('document_associations').insert({ tenant: world.tenant, document_id, entity_type: 'ticket', entity_id: world.tickets.a1 });
    const ticketDoc = await db('documents').where({ tenant: world.tenant, document_id }).first();
    const recipient = { tenant: world.tenant, user_id: randomUUID(), user_type: 'client', clientId: world.clientA,
      email: 'mailbox@example.com', is_inactive: false } as any;
    const granted = (documents: any[]) => db.transaction(trx =>
      authorizeAndRedactDocuments(trx, world.tenant, recipient, documents, async () => true));
    expect((await granted([ticketDoc])).map(d => d.document_id)).toEqual([document_id]);
    await db('documents').where({ tenant: world.tenant, document_id: doc.document_id }).update({ is_client_visible: true });
    try {
      expect(await granted([{ ...doc, is_client_visible: true }])).toEqual([]);
    } finally {
      await db('documents').where({ tenant: world.tenant, document_id: doc.document_id }).update({ is_client_visible: false });
    }
  });
  it('refuses asset permission denial despite document and ticket access', async () => {
    const roleId = (await db('user_roles').where({ tenant: world.tenant, user_id: world.noPerm.user_id }).first()).role_id;
    const permission = await db('permissions').where({ tenant: world.tenant, resource: 'document', action: 'read' }).first();
    const ticketPermission = await db('permissions').where({ tenant: world.tenant, resource: 'ticket', action: 'read' }).first();
    await db('role_permissions').insert([
      { tenant: world.tenant, role_id: roleId, permission_id: permission.permission_id },
      { tenant: world.tenant, role_id: roleId, permission_id: ticketPermission.permission_id },
    ]);
    try {
      expect(await read(world.noPerm)).toEqual([]);
    } finally {
      await db('role_permissions').where({ tenant: world.tenant, role_id: roleId }).del();
    }
  });
  it('refuses the real asset bundle record denial even with both permissions and ticket association', async () => {
    expect(await read(world.restricted)).toEqual([]);
  });
  it('serves the authenticated helper URLs through their handlers and refuses a narrowed asset', async () => {
    const { getDocumentThumbnailUrl, getDocumentPreviewUrl } = await import('@alga-psa/documents/actions/documentActions');
    const thumbnail = (await import('../../app/api/documents/[documentId]/thumbnail/route')).GET;
    const preview = (await import('../../app/api/documents/[documentId]/preview/route')).GET;
    for (const [url, handler] of [[await getDocumentThumbnailUrl(doc.document_id), thumbnail], [await getDocumentPreviewUrl(doc.document_id), preview]] as const) {
      expect(typeof url).toBe('string');
      const match = (url as string).match(/^\/api\/documents\/([^/]+)\/(thumbnail|preview)$/);
      expect(match).not.toBeNull();
      const response = await handler(new NextRequest(`http://localhost${url}`), { params: Promise.resolve({ documentId: match![1] }) });
      expect(response.status).toBe(200);
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
    }
    session.user = world.restricted;
    try {
      expect(await getDocumentThumbnailUrl(doc.document_id)).toBeNull();
      for (const handler of [thumbnail, preview]) {
        const response = await handler(new NextRequest('http://localhost/'), { params: Promise.resolve({ documentId: doc.document_id }) });
        expect(response.status).toBe(404);
      }
    } finally { session.user = world.tech; }
  });

  it('authorizes original view by file and document IDs and preserves public tenant logos', async () => {
    const view = (await import('../../app/api/documents/view/[fileId]/route')).GET;
    const call = (id: string) => view(new NextRequest(`http://localhost/api/documents/view/${id}`), { params: Promise.resolve({ fileId: id }) });
    try {
      session.user = world.tech;
      for (const id of [doc.file_id, doc.document_id]) {
        const response = await call(id);
        expect(response.status).toBe(200);
        expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
      }
      for (const user of [world.noPerm, world.restricted]) {
        session.user = user;
        for (const id of [doc.file_id, doc.document_id]) {
          const response = await call(id);
          expect(response.status).toBe(403);
          expect((await response.text())).not.toContain('private condition');
        }
      }
      const logo = await db('documents').where({ tenant: world.tenant, file_id: world.logoFileId }).first();
      await db('document_associations').insert({ tenant: world.tenant, document_id: logo.document_id,
        entity_type: 'tenant', entity_id: world.tenant, is_entity_logo: true });
      session.user = null;
      expect((await call(world.logoFileId)).status).toBe(200);
      await db('document_associations').where({ tenant: world.tenant, document_id: logo.document_id, entity_type: 'tenant' }).del();
      await db('document_associations').insert({ tenant: world.tenant, document_id: doc.document_id,
        entity_type: 'tenant', entity_id: world.tenant, is_entity_logo: true });
      expect((await call(doc.file_id)).status).toBe(401);
    } finally { session.user = world.tech; }
  });

  it('refuses metadata and binary handlers without asset read despite document and ticket permissions', async () => {
    const roleId = (await db('user_roles').where({ tenant: world.tenant, user_id: world.noPerm.user_id }).first()).role_id;
    const permissions = await db('permissions').where({ tenant: world.tenant, action: 'read' }).whereIn('resource', ['document', 'ticket']);
    await db('role_permissions').insert(permissions.map(p => ({ tenant: world.tenant, role_id: roleId, permission_id: p.permission_id })));
    session.user = world.noPerm;
    try {
      const actions = await import('@alga-psa/documents/actions/documentActions');
      expect(await actions.getDocumentThumbnailUrl(doc.document_id)).toBeNull();
      expect(await actions.getDocumentPreviewUrl(doc.document_id)).toBeNull();
      expect(await actions.getDocument(doc.document_id)).toHaveProperty('permissionError');
      const thumbnail = (await import('../../app/api/documents/[documentId]/thumbnail/route')).GET;
      const preview = (await import('../../app/api/documents/[documentId]/preview/route')).GET;
      const download = (await import('../../app/api/documents/[documentId]/download/route')).GET;
      for (const handler of [thumbnail, preview, download]) {
        const response = await handler(new NextRequest('http://localhost/'), { params: Promise.resolve({ documentId: doc.document_id }) });
        expect(response.status).toBe(404);
      }
      const view = (await import('../../app/api/documents/view/[fileId]/route')).GET;
      for (const id of [doc.file_id, doc.document_id]) {
        const response = await view(new NextRequest('http://localhost/'), { params: Promise.resolve({ fileId: id }) });
        expect(response.status).toBe(403);
      }
    } finally {
      session.user = world.tech;
      await db('role_permissions').where({ tenant: world.tenant, role_id: roleId }).del();
    }
  });

});
