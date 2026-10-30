/**
 * alga-2026-0002683 C4 - equipment custody and ticket intake (real DB).
 *
 * Covers: the no-stock/no-money invariant (row counts across both intake modes and every step), the state
 * machine and refusals, update-vs-event semantics, the queue (record-level, closed-ticket items, tabs),
 * the guards (asset delete, location deactivation), held_by_msp -> active on return, and the append-only
 * trigger on plain Postgres.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';

const published = vi.hoisted(() => ({ events: [] as Array<{ eventType: string; payload: any }>, verifyFiles: false, committedFiles: [] as boolean[] }));
/** Assets the record-level asset read check refuses (per test). Empty = the real kernel decision (allow). */
const denied = vi.hoisted(() => ({ assetIds: new Set<string>() }));
vi.mock('@alga-psa/assets/lib/assetReadAuthorization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/assets/lib/assetReadAuthorization')>();
  return {
    ...actual,
    isAssetReadAllowed: async (...args: Parameters<typeof actual.isAssetReadAllowed>) =>
      denied.assetIds.has(args[3].asset_id) ? false : actual.isAssetReadAllowed(...args),
    filterReadableAssets: async (...args: Parameters<typeof actual.filterReadableAssets>) =>
      (await actual.filterReadableAssets(...args)).filter((a) => !denied.assetIds.has(a.asset_id)),
  };
});
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
  publishWorkflowEvent: vi.fn(async (e: any) => {
    published.events.push({ eventType: e.eventType, payload: e.payload });
    if (published.verifyFiles && e.eventType === 'FILE_UPLOADED') {
      const document = await tenantDb(db, e.ctx.tenantId).table('documents')
        .where(builder => builder.where('file_id', e.payload.fileId).orWhere('thumbnail_file_id', e.payload.fileId).orWhere('preview_file_id', e.payload.fileId))
        .first('document_id');
      published.committedFiles.push(Boolean(document));
    }
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const storage = vi.hoisted(() => ({
  files: new Map<string, Buffer>(), failOriginal: 0, originalCount: 0, failDelete: false, failDerived: false,
}));
vi.mock('@alga-psa/storage/StorageProviderFactory', async importOriginal => {
  const actual = await importOriginal<typeof import('@alga-psa/storage/StorageProviderFactory')>();
  return { ...actual, StorageProviderFactory: { createProvider: async () => ({
    upload: async (buffer: Buffer, path: string, options: { mime_type: string }) => {
      storage.files.set(path, buffer);
      if ((options.mime_type === 'image/png' && ++storage.originalCount === storage.failOriginal) ||
          (options.mime_type === 'image/jpeg' && storage.failDerived)) {
        throw new Error('provider failed after writing');
      }
      return { path, size: buffer.length, mime_type: options.mime_type };
    },
    delete: async (path: string) => {
      if (storage.failDelete) throw new Error('provider temporarily unavailable');
      storage.files.delete(path);
    },
  }) } };
});
vi.mock('@alga-psa/auth/getCurrentUser', () => ({ getCurrentUser: async () => ({
  user_id: actionAuth.userId, tenant: actionAuth.tenant, user_type: 'internal',
}) }));
// Keep real document creation, storage writes, previews, authorization and rollback; fake the provider only.
vi.mock('@alga-psa/storage/config/storage', async importOriginal => ({
  ...await importOriginal<typeof import('@alga-psa/storage/config/storage')>(),
  validateFileUpload: async () => {}, validateSystemArtifact: async () => {},
}));

const HOOK_TIMEOUT = 180_000;
const columns: Record<string, Record<string, unknown>> = {};
const actionAuth = vi.hoisted(() => ({ tenant: '', userId: '', userType: 'internal' as 'internal' | 'client', clientId: undefined as string | undefined }));

vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  return {
    ...actual,
    hasPermission: vi.fn().mockResolvedValue(true),
    checkMultiplePermissions: vi.fn(async (_user: unknown, checks: { resource: string; action: string }[]) =>
      checks.map(check => ({ ...check, granted: true }))),
    withAuth: (action: any) => async (...args: unknown[]) =>
      (await import('@alga-psa/db')).runWithTenant(actionAuth.tenant, () =>
        action({ user_id: actionAuth.userId, user_type: actionAuth.userType, clientId: actionAuth.clientId, roles: [] }, { tenant: actionAuth.tenant }, ...args)),
  };
});
// This suite isolates custody flows from RBAC; dedicated document authorization tests use real grants.
vi.mock('@alga-psa/authorization/rbac', () => ({
  hasPermission: (...args: any[]) => import('@alga-psa/auth').then(auth => (auth.hasPermission as any)(...args)),
}));
vi.mock('@alga-psa/auth/rbac', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth/rbac')>();
  return { ...actual, hasPermission: vi.fn().mockResolvedValue(true),
    checkMultiplePermissions: vi.fn(async (_user: unknown, checks: { resource: string; action: string }[]) =>
      checks.map(check => ({ ...check, granted: true }))) };
});
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: db, tenant: actionAuth.tenant }),
    withTransaction: async (knex: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) => knex.transaction(callback),
  };
});

let db: Knex;
let image: Uint8Array;
let custody: typeof import('@alga-psa/assets/actions/assetCustodyActions');
let receiveEquipment: typeof import('../../../../packages/msp-composition/src/tickets/receiveEquipmentActions').receiveEquipment;
let deleteAssetRecord: typeof import('@alga-psa/assets/actions/assetActions').deleteAssetRecord;
let listAssets: typeof import('@alga-psa/assets/actions/assetActions').listAssets;
let isCitus = false;

const cleanupTenants = new Set<string>();

const table = (tenant: string, name: string) => tenantDb(db, tenant).table(name);
const unscoped = (name: string) => tenantDb(db, '__custody_fixture__').unscoped(name, 'custody integration fixture');
const hasColumn = (name: string, column: string) => Object.prototype.hasOwnProperty.call(columns[name] ?? {}, column);

const BUILTINS = [
  { slug: 'active', label: 'Active', kind: 'deployable', display_order: 0 },
  { slug: 'held_by_msp', label: 'Held by MSP', kind: 'pending', display_order: 5 },
  { slug: 'retired', label: 'Retired', kind: 'archived', display_order: 4 },
];

/** Tables the intake must never write (design hard constraint). */
const FORBIDDEN_TABLES = [
  'stock_units', 'stock_movements', 'stock_levels', 'product_inventory_settings',
  'invoices', 'invoice_charges', 'time_entries',
];

type Fx = Awaited<ReturnType<typeof seedFixture>>;

async function seedFixture() {
  const tenantId = randomUUID();
  cleanupTenants.add(tenantId);
  await unscoped('tenants').insert({
    tenant: tenantId,
    ...(hasColumn('tenants', 'company_name') ? { company_name: 'Custody PSA' } : { client_name: 'Custody PSA' }),
    email: `${tenantId}@example.com`,
    ...(hasColumn('tenants', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('tenants', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });
  const mkUser = async (name: string) => {
    const userId = randomUUID();
    await table(tenantId, 'users').insert({
      tenant: tenantId, user_id: userId, username: `${name}-${userId.slice(0, 8)}`, hashed_password: 'x',
      first_name: name, last_name: 'Tech',
      ...(hasColumn('users', 'email') ? { email: `${name}-${userId.slice(0, 8)}@example.com` } : {}),
      ...(hasColumn('users', 'user_type') ? { user_type: 'internal' } : {}),
      ...(hasColumn('users', 'is_inactive') ? { is_inactive: false } : {}),
      ...(hasColumn('users', 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn('users', 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });
    return userId;
  };
  const userId = await mkUser('Alex');
  const otherUserId = await mkUser('Sam');
  const mkClient = async (name: string) => {
    const clientId = randomUUID();
    await table(tenantId, 'clients').insert({
      tenant: tenantId, client_id: clientId, client_name: name,
      ...(hasColumn('clients', 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn('clients', 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });
    return clientId;
  };
  const clientId = await mkClient('Joymode');
  const otherClientId = await mkClient('Other Co');
  await table(tenantId, 'asset_statuses').insert(
    BUILTINS.map((s) => ({ tenant: tenantId, ...s, is_builtin: true, is_active: true }))
  );
  const mkLocation = async (name: string, active = true) => {
    const locationId = randomUUID();
    await table(tenantId, 'stock_locations').insert({
      tenant: tenantId, location_id: locationId, name, location_type: 'office', is_default: false, is_active: active,
    });
    return locationId;
  };
  const mainOffice = await mkLocation('Main Office');
  const annex = await mkLocation('Annex');
  const closedLocation = await mkLocation('Old Closet', false);

  const mkTicket = async (client: string, number: string) => {
    const ticketId = randomUUID();
    await table(tenantId, 'tickets').insert({
      tenant: tenantId, ticket_id: ticketId, ticket_number: number, client_id: client, title: `Ticket ${number}`,
    });
    return ticketId;
  };
  const ticketId = await mkTicket(clientId, `T-${tenantId.slice(0, 6)}-1`);
  const otherClientTicketId = await mkTicket(otherClientId, `T-${tenantId.slice(0, 6)}-3`);

  actionAuth.tenant = tenantId;
  actionAuth.userId = userId;
  return { tenantId, userId, otherUserId, clientId, otherClientId, mainOffice, annex, closedLocation, ticketId, otherClientTicketId, mkTicket };
}

async function counts(tenant: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of FORBIDDEN_TABLES) {
    const [{ count }] = await table(tenant, name).count('* as count');
    out[name] = Number(count);
  }
  return out;
}

async function newAsset(fx: Fx, over: Record<string, unknown> = {}) {
  const assetId = randomUUID();
  await table(fx.tenantId, 'assets').insert({
    tenant: fx.tenantId, asset_id: assetId, asset_type: 'unknown', client_id: fx.clientId,
    asset_tag: `TAG-${assetId.slice(0, 6)}`, name: 'Fixture device', status: 'active', location: '',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over,
  });
  return assetId;
}

const unwrap = <T,>(r: any): T => {
  if (!r?.success) throw new Error(`expected success, got ${JSON.stringify(r)}`);
  return r.data as T;
};

const intake = (fx: Fx, over: Record<string, unknown> = {}) => ({
  ticket_id: fx.ticketId,
  new_asset: { name: 'Dell WD19 dock', asset_type: 'unknown', manufacturer: 'Dell', model: 'WD19', serial_number: 'SVC1234567' },
  purpose: 'repair',
  location_id: fx.mainOffice,
  bin: 'Shelf B3',
  next_action_party: 'vendor',
  next_action_note: 'waiting on vendor, follow up in 5 days',
  // Far future so the default intake is never overdue, whatever day the suite runs.
  follow_up_on: '2099-10-29',
  accessories: [{ label: 'Power adapter', quantity: 1 }],
  ...over,
});

async function cleanupTenant(tenant: string) {
  const del = async (name: string) => table(tenant, name).del().catch(() => undefined);
  if (!isCitus) {
    await db.raw('ALTER TABLE asset_custody_events DISABLE TRIGGER USER').catch(() => undefined);
  }
  for (const name of [
    'file_upload_session_files', 'file_upload_sessions', 'asset_custody_events', 'asset_custody', 'asset_history', 'asset_associations', 'document_associations', 'documents', 'external_files', 'document_folders', 'assets', 'tickets',
    'asset_type_registry', 'stock_locations', 'asset_statuses', 'tenant_settings', 'clients', 'users',
  ]) await del(name);
  if (!isCitus) await db.raw('ALTER TABLE asset_custody_events ENABLE TRIGGER USER').catch(() => undefined);
  await unscoped('tenants').where({ tenant }).del().catch(() => undefined);
}

describe('equipment custody (integration)', () => {
  beforeEach(() => {
    storage.files.clear(); storage.failOriginal = 0; storage.originalCount = 0; storage.failDelete = false; storage.failDerived = false;
    actionAuth.userType = 'internal'; actionAuth.clientId = undefined;
    published.verifyFiles = false; published.committedFiles = [];
  });
  beforeAll(async () => {
    const sharp = (await import('sharp')).default;
    image = new Uint8Array(await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#aaa' } }).png().toBuffer());
    wireLocalTestDbEnv();
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ runSeeds: false });
    for (const name of ['tenants', 'users', 'clients']) {
      columns[name] = await tenantDb(db, '__custody_schema__').unscoped(name, 'schema introspection').columnInfo();
    }
    isCitus = Boolean((await db.raw("select 1 from pg_extension where extname = 'citus'")).rows.length);
    custody = await import('@alga-psa/assets/actions/assetCustodyActions');
    ({ deleteAssetRecord, listAssets } = await import('@alga-psa/assets/actions/assetActions'));
    ({ receiveEquipment } = await import('../../../../packages/msp-composition/src/tickets/receiveEquipmentActions'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const tenant of cleanupTenants) await cleanupTenant(tenant);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  const photoForm = (count = 2) => {
    const form = new FormData();
    for (let i = 0; i < count; i++) form.append('photos', new File([new Uint8Array(image)], `dock-${i}.png`, { type: 'image/png' }));
    return form;
  };

  it('receives two private photos through the upload action and shows them on ticket, asset and history', async () => {
    const fx = await seedFixture();
    await table(fx.tenantId, 'document_folders').insert({ tenant: fx.tenantId, folder_name: 'Attachments', folder_path: '/Tickets/Attachments', entity_id: fx.ticketId, entity_type: 'ticket', is_client_visible: true });
    published.verifyFiles = true;
    const result = unwrap<any>(await receiveEquipment(intake(fx), photoForm()));
    published.verifyFiles = false;
    expect(published.committedFiles).toHaveLength(6);
    expect(published.committedFiles.every(Boolean)).toBe(true);
    const ids = result.event.document_ids;
    expect(ids).toHaveLength(2);
    const { getAssetDocuments } = await import('@alga-psa/assets/actions/assetDocumentActions');
    expect((await getAssetDocuments(result.asset.asset_id) as any[]).map(doc => doc.document_id).sort()).toEqual([...ids].sort());
    const { getDocument } = await import('@alga-psa/documents/actions/documentActions');
    for (const id of ids) {
      expect(await getDocument(id)).toMatchObject({ is_client_visible: false });
      expect(await table(fx.tenantId, 'document_associations').where({ document_id: id })).toHaveLength(2);
    }
    const events = unwrap<any[]>(await custody.listCustodyEvents(result.asset.asset_id));
    expect(events[0].document_ids).toEqual(ids);
    expect(await table(fx.tenantId, 'file_upload_sessions')).toHaveLength(0);
    const retainedFiles = storage.files.size;
    expect(retainedFiles).toBe(6);
    const { recoverFileUploads } = await import('@alga-psa/storage/fileUploadTransaction');
    await recoverFileUploads(db, fx.tenantId);
    expect(storage.files.size).toBe(retainedFiles);
  });

  it('rolls back partial uploads and cleans originals and derived files without deleting existing documents', async () => {
    const fx = await seedFixture();
    const unrelated = randomUUID();
    await table(fx.tenantId, 'documents').insert({ tenant: fx.tenantId, document_id: unrelated, document_name: 'Existing', user_id: fx.userId, created_by: fx.userId });
    storage.failOriginal = 2;
    const eventsBeforeFailure = published.events.length;
    await expect(receiveEquipment(intake(fx), photoForm())).rejects.toThrow('provider failed after writing');
    expect(await table(fx.tenantId, 'documents').select('document_id')).toEqual([{ document_id: unrelated }]);
    expect(await table(fx.tenantId, 'document_associations')).toHaveLength(0);
    expect(await table(fx.tenantId, 'asset_custody_events')).toHaveLength(0);
    expect(await table(fx.tenantId, 'file_upload_sessions')).toHaveLength(0);
    expect(await table(fx.tenantId, 'external_files')).toHaveLength(0);
    expect(storage.files.size).toBe(0);
    expect(published.events).toHaveLength(eventsBeforeFailure);
    const refused = await receiveEquipment(intake(fx, { document_ids: [unrelated] }), photoForm());
    expect(refused).toMatchObject({ success: false });
    expect(await table(fx.tenantId, 'documents').where({ document_id: unrelated })).toHaveLength(1);
  });

  it('persists failed cleanup for maintenance and recovers after a provider outage', async () => {
    const fx = await seedFixture();
    storage.failDelete = true;
    const refused = await receiveEquipment(intake(fx, { location_id: fx.closedLocation }), photoForm());
    expect(refused).toMatchObject({ success: false });
    expect(await table(fx.tenantId, 'documents')).toHaveLength(0);
    expect(await table(fx.tenantId, 'document_associations')).toHaveLength(0);
    expect(await table(fx.tenantId, 'asset_custody_events')).toHaveLength(0);
    const pending = await table(fx.tenantId, 'file_upload_sessions').first();
    expect(pending).toMatchObject({ attempts: 1, last_error: 'provider temporarily unavailable' });
    expect(storage.files.size).toBeGreaterThan(0);
    storage.failDelete = false;
    await table(fx.tenantId, 'file_upload_sessions').update({ expires_at: new Date(0) });
    const { recoverFileUploads } = await import('@alga-psa/storage/fileUploadTransaction');
    await recoverFileUploads(db, fx.tenantId);
    await recoverFileUploads(db, fx.tenantId);
    expect(await table(fx.tenantId, 'file_upload_sessions')).toHaveLength(0);
    expect(await table(fx.tenantId, 'external_files')).toHaveLength(0);
    expect(storage.files.size).toBe(0);
  });

  it('uploads private photos on every custody step and rolls failed steps back', async () => {
    const fx = await seedFixture();
    const received = unwrap<any>(await receiveEquipment(intake(fx)));
    const { recordCustodyEventWithPhotos } = await import('../../../../packages/msp-composition/src/assets/custodyPhotoActions');
    const events = [
      { event_type: 'moved', location_id: fx.annex },
      { event_type: 'handed_off', to_holder_user_id: fx.otherUserId },
      { event_type: 'shipped', counterparty: 'Depot' },
      { event_type: 'received', location_id: fx.mainOffice },
      { event_type: 'returned' },
    ];
    for (const event of events) {
      const result = unwrap<any>(await recordCustodyEventWithPhotos(received.custody.custody_id, event, photoForm(1)));
      expect(result.event.document_ids).toHaveLength(1);
      expect(await table(fx.tenantId, 'document_associations').where({ entity_type: 'asset', entity_id: received.asset.asset_id, document_id: result.event.document_ids[0] })).toHaveLength(1);
    }
    const fileCount = storage.files.size;
    expect(await recordCustodyEventWithPhotos(received.custody.custody_id, events[0], photoForm(1))).toMatchObject({ success: false });
    expect(storage.files.size).toBe(fileCount);
    expect(await table(fx.tenantId, 'documents')).toHaveLength(5);
  });

  it('cleans unretained preview writes after a successful receive without deleting originals', async () => {
    const fx = await seedFixture();
    storage.failDerived = true;
    const received = unwrap<any>(await receiveEquipment(intake(fx), photoForm()));
    expect(received.event.document_ids).toHaveLength(2);
    expect(storage.files.size).toBe(2);
    expect(await table(fx.tenantId, 'external_files')).toHaveLength(2);
    expect(await table(fx.tenantId, 'file_upload_sessions')).toHaveLength(0);
  });

  it('recovers interrupted uploads while skipping active sessions and other tenants', async () => {
    const fx = await seedFixture();
    const other = await seedFixture();
    const ids = [];
    for (const tenant of [fx.tenantId, other.tenantId]) {
      const sessionId = randomUUID();
      const fileId = randomUUID();
      const path = `/${tenant}/${fileId}.png`;
      storage.files.set(path, Buffer.from('interrupted write'));
      await table(tenant, 'file_upload_sessions').insert({ tenant, session_id: sessionId, expires_at: new Date(0) });
      await table(tenant, 'file_upload_session_files').insert({ tenant, session_id: sessionId, file_id: fileId, storage_path: path });
      ids.push({ tenant, sessionId, path });
    }
    const { recoverFileUploads } = await import('@alga-psa/storage/fileUploadTransaction');
    const lock = await db.transaction();
    try {
      await tenantDb(lock, fx.tenantId).table('file_upload_sessions').where({ session_id: ids[0].sessionId }).forNoKeyUpdate().first();
      await recoverFileUploads(db, fx.tenantId);
      expect(storage.files.has(ids[0].path)).toBe(true);
    } finally { await lock.rollback(); }
    await recoverFileUploads(db, fx.tenantId);
    expect(storage.files.has(ids[0].path)).toBe(false);
    expect(storage.files.has(ids[1].path)).toBe(true);
    await recoverFileUploads(db, other.tenantId);
    expect(storage.files.size).toBe(0);
  });

  it('hides intake photos from client document lists, asset documents and custody history', async () => {
    const fx = await seedFixture();
    const received = unwrap<any>(await receiveEquipment(intake(fx), photoForm()));
    const publicId = randomUUID();
    await table(fx.tenantId, 'documents').insert({ tenant: fx.tenantId, document_id: publicId, document_name: 'Public guide', user_id: fx.userId, created_by: fx.userId, is_client_visible: true });
    for (const entity of [{ entity_id: fx.ticketId, entity_type: 'ticket' }, { entity_id: received.asset.asset_id, entity_type: 'asset' }]) {
      await table(fx.tenantId, 'document_associations').insert({ tenant: fx.tenantId, document_id: publicId, ...entity });
    }
    actionAuth.userId = fx.otherUserId;
    actionAuth.userType = 'client';
    actionAuth.clientId = fx.clientId;
    const { getAssetDocuments } = await import('@alga-psa/assets/actions/assetDocumentActions');
    const { getDocumentsByEntity, getDocument, getDocumentThumbnailUrl } = await import('@alga-psa/documents/actions/documentActions');
    const portal = await getDocumentsByEntity(fx.ticketId, 'ticket');
    expect(portal).toHaveProperty('documents');
    expect((portal as any).documents.map((doc: any) => doc.document_id)).toEqual([publicId]);
    expect((await getAssetDocuments(received.asset.asset_id) as any[]).map(doc => doc.document_id)).toEqual([publicId]);
    const events = unwrap<any[]>(await custody.listCustodyEvents(received.asset.asset_id));
    expect(events[0].document_ids).toEqual([]);
    for (const id of received.event.document_ids) {
      expect(await getDocument(id)).toHaveProperty('permissionError');
      expect(await getDocumentThumbnailUrl(id)).toBeNull();
    }
  });

  it('rejects oversized uploads and denied document creation before writing storage', async () => {
    const fx = await seedFixture();
    const form = new FormData();
    form.append('photos', new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }));
    expect(await receiveEquipment(intake(fx), form)).toMatchObject({ success: false });
    expect(await receiveEquipment(intake(fx), photoForm(21))).toMatchObject({ success: false });
    const invalid = new FormData(); invalid.append('photos', 'not a file');
    expect(await receiveEquipment(intake(fx), invalid)).toMatchObject({ success: false });
    const { hasPermission } = await import('@alga-psa/auth');
    try {
      vi.mocked(hasPermission).mockImplementation(async (_user, resource, action) => !(resource === 'document' && action === 'create'));
      expect(await receiveEquipment(intake(fx), photoForm())).toMatchObject({ success: false });
    } finally { vi.mocked(hasPermission).mockResolvedValue(true); }
    expect(storage.files.size).toBe(0);
    expect(await table(fx.tenantId, 'file_upload_sessions')).toHaveLength(0);
  });

  it('associates both intake photos atomically and preserves ticket links', async () => {
    const fx = await seedFixture();
    const ids = [randomUUID(), randomUUID()];
    for (const id of ids) {
      await table(fx.tenantId, 'documents').insert({ tenant: fx.tenantId, document_id: id, document_name: 'photo', user_id: fx.userId, created_by: fx.userId, is_client_visible: false });
      await table(fx.tenantId, 'document_associations').insert({ tenant: fx.tenantId, document_id: id, entity_type: 'ticket', entity_id: fx.ticketId });
    }
    const { receiveEquipmentForTicket } = await import('@alga-psa/assets/lib/custody/receiveEquipment');
    const input = intake(fx, { document_ids: ids }) as any;
    await expect(db.transaction(async trx => {
      await receiveEquipmentForTicket(trx, fx.tenantId, fx.userId, input);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await table(fx.tenantId, 'document_associations').where({ entity_type: 'asset' })).toHaveLength(0);
    expect(await table(fx.tenantId, 'asset_custody_events')).toHaveLength(0);
    const result = await db.transaction(trx => receiveEquipmentForTicket(trx, fx.tenantId, fx.userId, input));
    expect(result.event.document_ids).toEqual(ids);
    const links = await table(fx.tenantId, 'document_associations').whereIn('document_id', ids);
    expect(links.filter((row: any) => row.entity_type === 'ticket')).toHaveLength(2);
    expect(links.filter((row: any) => row.entity_type === 'asset' && row.entity_id === result.asset.asset_id)).toHaveLength(2);
    expect((await table(fx.tenantId, 'documents').whereIn('document_id', ids)).every((row: any) => !row.is_client_visible)).toBe(true);

    const existingId = await newAsset(fx);
    const existing = await db.transaction(trx => receiveEquipmentForTicket(trx, fx.tenantId, fx.userId, {
      ...input, new_asset: undefined, asset_id: existingId,
    }));
    expect(existing.event.document_ids).toEqual(ids);
    expect(await table(fx.tenantId, 'document_associations').where({ entity_type: 'asset', entity_id: existingId })).toHaveLength(2);

    const foreign = await seedFixture();
    const foreignId = randomUUID();
    await table(foreign.tenantId, 'documents').insert({ tenant: foreign.tenantId, document_id: foreignId, document_name: 'other.jpg', user_id: foreign.userId, created_by: foreign.userId, is_client_visible: false });
    await table(fx.tenantId, 'asset_custody_events').insert({
      tenant: fx.tenantId, asset_id: existingId, custody_id: existing.custody.custody_id,
      event_type: 'moved', occurred_at: new Date(), recorded_at: new Date(), actor_user_id: fx.userId,
      document_ids: JSON.stringify([ids[0], randomUUID(), foreignId]),
    });
    await table(fx.tenantId, 'document_associations').where({ entity_type: 'asset', entity_id: existingId }).del();
    const migration = await import('../../../migrations/20261028051434_backfill_custody_photo_asset_associations.cjs');
    await migration.up(db);
    await migration.up(db);
    expect((await table(fx.tenantId, 'document_associations').where({ entity_type: 'asset', entity_id: existingId })).map((row: any) => row.document_id).sort()).toEqual([...ids].sort());
  });

  it('filters custody documents on the shared read path and refuses unavailable IDs on writes', async () => {
    const fx = await seedFixture();
    const id = randomUUID();
    await table(fx.tenantId, 'documents').insert({ tenant: fx.tenantId, document_id: id, document_name: 'condition.jpg', user_id: fx.userId, created_by: fx.userId, is_client_visible: false });
    const { receiveEquipmentForTicket } = await import('@alga-psa/assets/lib/custody/receiveEquipment');
    const received = await db.transaction(trx => receiveEquipmentForTicket(trx, fx.tenantId, fx.userId, intake(fx, { document_ids: [id] }) as any));
    const { listCustodyEventsService, recordCustodyEventService } = await import('@alga-psa/assets/lib/custody/service');
    const { getAssetDocuments } = await import('@alga-psa/assets/actions/assetDocumentActions');
    const { hasPermission } = await import('@alga-psa/auth');
    const principal = { user_id: fx.userId, user_type: 'internal', roles: [] } as const;
    try {
      const visible = await listCustodyEventsService(db, fx.tenantId, principal, received.asset.asset_id);
      expect(visible[0].document_ids).toEqual([id]);
      expect((await getAssetDocuments(received.asset.asset_id) as any[]).map(doc => doc.document_id)).toEqual([id]);
      vi.mocked(hasPermission).mockImplementation(async (_user, resource) => resource !== 'document');
      const hidden = await listCustodyEventsService(db, fx.tenantId, principal, received.asset.asset_id);
      expect(hidden[0].document_ids).toEqual([]);
      expect(await getAssetDocuments(received.asset.asset_id)).toHaveProperty('permissionError');
      await expect(recordCustodyEventService(db, fx.tenantId, principal, received.custody.custody_id, {
        event_type: 'shipped', counterparty: 'Vendor', document_ids: [id],
      } as any)).rejects.toThrow('documents are unavailable');
      vi.mocked(hasPermission).mockResolvedValue(true);
      denied.assetIds.add(received.asset.asset_id);
      expect(await getAssetDocuments(received.asset.asset_id)).toHaveProperty('permissionError');
      denied.assetIds.delete(received.asset.asset_id);
      await expect(recordCustodyEventService(db, fx.tenantId, principal, received.custody.custody_id, {
        event_type: 'shipped', counterparty: 'Vendor', document_ids: [randomUUID()],
      } as any)).rejects.toThrow('documents are unavailable');
      expect(await table(fx.tenantId, 'asset_custody_events').where({ asset_id: received.asset.asset_id })).toHaveLength(1);
      const foreign = await seedFixture();
      const foreignDocument = randomUUID();
      await table(foreign.tenantId, 'documents').insert({ tenant: foreign.tenantId, document_id: foreignDocument, document_name: 'foreign.jpg', user_id: foreign.userId, created_by: foreign.userId, is_client_visible: false });
      const foreignAsset = await newAsset(foreign);
      actionAuth.tenant = fx.tenantId; actionAuth.userId = fx.userId;
      expect(await getAssetDocuments(foreignAsset)).toHaveProperty('permissionError');
      await expect(recordCustodyEventService(db, fx.tenantId, principal, received.custody.custody_id, {
        event_type: 'shipped', counterparty: 'Vendor', document_ids: [foreignDocument],
      } as any)).rejects.toThrow('documents are unavailable');
      const shipped = await recordCustodyEventService(db, fx.tenantId, principal, received.custody.custody_id, {
        event_type: 'shipped', counterparty: 'Vendor', document_ids: [id],
      } as any);
      expect(shipped.event.document_ids).toEqual([id]);
      expect(await table(fx.tenantId, 'document_associations').where({ entity_type: 'asset', entity_id: received.asset.asset_id, document_id: id })).toHaveLength(1);
    } finally {
      denied.assetIds.delete(received.asset.asset_id);
      vi.mocked(hasPermission).mockResolvedValue(true);
    }
  });

  it('never writes stock, money or time across both intake modes and every step (hard invariant)', async () => {
    const fx = await seedFixture();
    const before = await counts(fx.tenantId);

    // Mode 1: a brand-new minimal asset.
    const created = unwrap<any>(await receiveEquipment(intake(fx)));
    expect(created.createdAsset).toBe(true);
    expect(created.asset.asset_tag).toMatch(/-EQ1$/);
    const row = await table(fx.tenantId, 'assets').where({ asset_id: created.asset.asset_id }).first();
    expect(row).toMatchObject({ status: 'held_by_msp', ownership: 'client', client_id: fx.clientId });
    expect(row.stock_unit_id ?? null).toBeNull();
    expect(row.service_id ?? null).toBeNull();

    // Mode 2: an existing asset, received back-to-back after the first goes out.
    const existing = await newAsset(fx);
    const second = unwrap<any>(await receiveEquipment({ ...intake(fx), new_asset: undefined, asset_id: existing, bin: 'Shelf C1' }));
    expect(second.createdAsset).toBe(false);

    const c1 = created.custody.custody_id;
    unwrap(await custody.moveCustody(c1, { bin: 'Shelf C1' }));
    unwrap(await custody.handOffCustody(c1, { to_holder_user_id: fx.otherUserId }));
    unwrap(await custody.shipCustody(c1, { counterparty: 'Dell' }));
    unwrap(await custody.receiveBackCustody(c1, { location_id: fx.annex, bin: 'Dock 2' }));
    unwrap(await custody.returnCustodyToClient(c1, {}));
    unwrap(await custody.returnCustodyToClient(second.custody.custody_id, {}));

    expect(await counts(fx.tenantId)).toEqual(before);
    // The assets of this intake did not gain stock/service links either.
    const linked = await table(fx.tenantId, 'assets').whereNotNull('stock_unit_id').count('* as count').first();
    expect(Number((linked as any).count)).toBe(0);
  });

  it('refuses a client mismatch, an inactive location and a second open episode', async () => {
    const fx = await seedFixture();
    // tickets.client_id is NOT NULL in this schema, so "ticket has no client" is a defensive check only
    // (covered by the unit test of openCustody's guard order); the reachable refusals follow.
    const existing = await newAsset(fx);
    const mismatch: any = await receiveEquipment({ ...intake(fx, { ticket_id: fx.otherClientTicketId }), new_asset: undefined, asset_id: existing });
    expect(mismatch).toMatchObject({ success: false, error: { code: 'client_mismatch' } });

    const inactive: any = await receiveEquipment(intake(fx, { location_id: fx.closedLocation }));
    expect(inactive).toMatchObject({ success: false, error: { code: 'location_inactive' } });
    // Failed intakes leave nothing behind, including the new asset.
    expect(await table(fx.tenantId, 'assets').where({ name: 'Dell WD19 dock' })).toHaveLength(0);

    const ok = unwrap<any>(await receiveEquipment({ ...intake(fx), new_asset: undefined, asset_id: existing }));
    const again: any = await receiveEquipment({ ...intake(fx), new_asset: undefined, asset_id: existing });
    expect(again).toMatchObject({ success: false, error: { code: 'open_episode_exists' } });
    expect(again.error.message).toContain('Main Office');
    expect(ok.custody.state).toBe('in_office');
  });

  it('enforces the state machine and records one append-only event per step', async () => {
    const fx = await seedFixture();
    const r = unwrap<any>(await receiveEquipment(intake(fx)));
    const id = r.custody.custody_id;

    expect(await custody.receiveBackCustody(id, { location_id: fx.annex, bin: null })).toMatchObject({ success: false, error: { code: 'invalid_transition' } });
    expect(await custody.moveCustody(id, { bin: 'Shelf B3' })).toMatchObject({ success: false, error: { code: 'no_change' } });
    expect(await custody.moveCustody(id, { location_id: fx.closedLocation })).toMatchObject({ success: false, error: { code: 'location_inactive' } });

    unwrap(await custody.moveCustody(id, { bin: 'Shelf C1' }));
    const shipped = unwrap<any>(await custody.shipCustody(id, { counterparty: 'Dell' }));
    expect(shipped.custody).toMatchObject({ state: 'with_vendor', location_id: null, bin: null, next_action_party: 'vendor' });
    expect(await custody.moveCustody(id, { bin: 'X' })).toMatchObject({ success: false, error: { code: 'invalid_transition' } });
    unwrap(await custody.receiveBackCustody(id, { location_id: fx.annex, bin: 'Dock 2' }));
    const returned = unwrap<any>(await custody.returnCustodyToClient(id, {}));
    expect(returned.custody).toMatchObject({ state: 'closed', close_reason: 'returned_to_client' });
    expect(await custody.moveCustody(id, { bin: 'Y' })).toMatchObject({ success: false, error: { code: 'episode_closed' } });

    const events = unwrap<any[]>(await custody.listCustodyEvents(r.asset.asset_id));
    expect(events.map((e) => e.event_type)).toEqual(['received', 'moved', 'shipped', 'received', 'returned']);
    expect(events[0]).toMatchObject({ to_location_name: 'Main Office', to_bin: 'Shelf B3' });
    expect(events[1]).toMatchObject({ from_bin: 'Shelf B3', to_bin: 'Shelf C1' });

    const history = await table(fx.tenantId, 'asset_history').where({ asset_id: r.asset.asset_id }).whereLike('change_type', 'custody_%');
    expect(history.map((h: any) => h.change_type).sort()).toEqual(
      ['custody_moved', 'custody_received', 'custody_received', 'custody_returned', 'custody_shipped'].sort()
    );
    expect(published.events.filter((e) => e.eventType === 'ASSET_CUSTODY_CHANGED').length).toBeGreaterThanOrEqual(5);
  });

  it('writes non-physical edits as custody_updated history, not events, and keeps follow_up_on a calendar date', async () => {
    const fx = await seedFixture();
    const r = unwrap<any>(await receiveEquipment(intake(fx)));
    expect(r.custody.follow_up_on).toBe('2099-10-29');
    const id = r.custody.custody_id;
    const eventsBefore = await table(fx.tenantId, 'asset_custody_events').where({ custody_id: id });

    const upd = unwrap<any>(await custody.updateCustody(id, { next_action_party: 'client', follow_up_on: '2026-11-02', next_action_note: 'client to approve' }));
    expect(upd.custody).toMatchObject({ next_action_party: 'client', follow_up_on: '2026-11-02' });
    expect(await table(fx.tenantId, 'asset_custody_events').where({ custody_id: id })).toHaveLength(eventsBefore.length);
    const h = await table(fx.tenantId, 'asset_history').where({ asset_id: r.asset.asset_id, change_type: 'custody_updated' });
    expect(h).toHaveLength(1);
    expect(JSON.stringify(h[0].changes)).not.toContain('client to approve');
    expect(await custody.updateCustody(id, { follow_up_on: '2026-02-31' } as any)).toMatchObject({ success: false, error: { code: 'validation' } });
  });

  it('keeps the queue keyed off the open episode (closed ticket still listed), with tabs and filters', async () => {
    const fx = await seedFixture();
    // "a" must never be overdue regardless of the wall clock; "b" is always overdue.
    const a = unwrap<any>(await receiveEquipment(intake(fx, { follow_up_on: '2999-12-31' })));
    const b = unwrap<any>(await receiveEquipment(intake(fx, { new_asset: { name: 'Laptop' }, next_action_party: 'client', follow_up_on: '2020-01-01', bin: null })));
    // The ticket "closes": the queue must not care, and neither must the status column.
    await table(fx.tenantId, 'assets').where({ asset_id: a.asset.asset_id }).update({ status: 'retired' });

    const all = unwrap<any>(await custody.listCustodyQueue({}));
    expect(all.total).toBe(2);
    expect(all.tabCounts).toMatchObject({ all_open: 2, waiting_on_vendor: 1, waiting_on_client: 1, overdue: 1 });
    expect(unwrap<any>(await custody.listCustodyQueue({ tab: 'overdue' })).rows.map((r: any) => r.asset_id)).toEqual([b.asset.asset_id]);
    expect(unwrap<any>(await custody.listCustodyQueue({ location_id: fx.annex })).total).toBe(0);

    unwrap(await custody.returnCustodyToClient(a.custody.custody_id, {}));
    expect(unwrap<any>(await custody.listCustodyQueue({})).total).toBe(1);
    // Returned item with a non-held_by_msp status keeps it (retired is not overwritten).
    expect((await table(fx.tenantId, 'assets').where({ asset_id: a.asset.asset_id }).first()).status).toBe('retired');
  });

  it('moves held_by_msp back to active on return and filters the asset list by custody and ownership', async () => {
    const fx = await seedFixture();
    const r = unwrap<any>(await receiveEquipment(intake(fx)));
    const other = await newAsset(fx);
    const held: any = await listAssets({ in_custody: true } as any);
    expect(held.assets.map((a: any) => a.asset_id)).toEqual([r.asset.asset_id]);
    const notHeld: any = await listAssets({ in_custody: false } as any);
    expect(notHeld.assets.map((a: any) => a.asset_id)).toEqual([other]);

    unwrap(await custody.returnCustodyToClient(r.custody.custody_id, {}));
    expect((await table(fx.tenantId, 'assets').where({ asset_id: r.asset.asset_id }).first()).status).toBe('active');
    expect(published.events.some((e) => e.eventType === 'ASSET_UPDATED' && e.payload?.assetId === r.asset.asset_id)).toBe(true);
    const owned: any = await listAssets({ ownership: 'msp' } as any);
    expect(owned.assets).toHaveLength(0);
  });

  it('guards asset delete and location deactivation while an episode is open', async () => {
    const fx = await seedFixture();
    const r = unwrap<any>(await receiveEquipment(intake(fx)));
    await expect(
      deleteAssetRecord(db, fx.tenantId, fx.userId, r.asset.asset_id, { suppressRevalidate: true })
    ).rejects.toThrow(/in custody/);
    expect(await table(fx.tenantId, 'assets').where({ asset_id: r.asset.asset_id })).toHaveLength(1);

    const { deactivateStockLocation } = await import('@alga-psa/inventory/actions/stockLocationActions');
    await expect(deactivateStockLocation(fx.mainOffice)).rejects.toThrow(/client equipment in custody/);
    expect((await table(fx.tenantId, 'stock_locations').where({ location_id: fx.mainOffice }).first()).is_active).toBe(true);

    unwrap(await custody.returnCustodyToClient(r.custody.custody_id, {}));
    const ok: any = await deactivateStockLocation(fx.mainOffice);
    expect(ok.is_active).toBe(false);
  });

  it('exposes only id, name and type from listCustodyLocations and lists previously used bins', async () => {
    const fx = await seedFixture();
    unwrap(await receiveEquipment(intake(fx)));
    const locs = unwrap<any[]>(await custody.listCustodyLocations());
    expect(locs.map((l) => l.name).sort()).toEqual(['Annex', 'Main Office']);
    for (const l of locs) expect(Object.keys(l).sort()).toEqual(['is_default', 'location_id', 'location_type', 'name']);
    expect(unwrap<string[]>(await custody.listCustodyBins(fx.mainOffice))).toEqual(['Shelf B3']);
  });

  it('rejects UPDATE and DELETE on asset_custody_events on plain Postgres', async () => {
    if (isCitus) return; // Citus: no triggers on distributed tables; enforced by app discipline (documented).
    const fx = await seedFixture();
    const r = unwrap<any>(await receiveEquipment(intake(fx)));
    await expect(
      table(fx.tenantId, 'asset_custody_events').where({ custody_id: r.custody.custody_id }).update({ note: 'tamper' })
    ).rejects.toThrow(/append-only/i);
    await expect(table(fx.tenantId, 'asset_custody_events').where({ custody_id: r.custody.custody_id }).del()).rejects.toThrow(/append-only/i);
  });

  it('Dell scenario: receive, shelve, print the work-tag facts, move, then read timeline and queue', async () => {
    const fx = await seedFixture();
    const ctx = { tenant: fx.tenantId, user: { user_id: fx.userId, user_type: 'internal', roles: [] } as any, baseUrl: 'https://psa.example.com' };
    const { getTicketLinkedAssetLabelParts } = await import('@alga-psa/assets/lib/ticketLinkedAssetLabels');

    const r = unwrap<any>(await receiveEquipment(intake(fx)));
    const assetId = r.asset.asset_id;

    // Print: the shelf and who acts next are on the tag; the free-text note never is.
    const writes = async () => ({
      events: Number((await table(fx.tenantId, 'asset_custody_events').count('* as c').first() as any).c),
      episodes: Number((await table(fx.tenantId, 'asset_custody').count('* as c').first() as any).c),
      history: Number((await table(fx.tenantId, 'asset_history').count('* as c').first() as any).c),
    });
    const beforePrint = await writes();
    const first = (await getTicketLinkedAssetLabelParts(ctx as any, [{ recordId: fx.ticketId }]))[0];
    expect(first).toMatchObject({ assetId, custodyLocation: 'Main Office / Shelf B3', nextAction: 'Waiting on vendor, Oct 29' });
    expect(JSON.stringify(first)).not.toMatch(/follow up in 5 days|waiting on vendor, follow/i);
    expect(await writes()).toEqual(beforePrint); // printing writes nothing

    // Move to Shelf C1: the tag follows.
    unwrap(await custody.moveCustody(r.custody.custody_id, { bin: 'Shelf C1' }));
    const second = (await getTicketLinkedAssetLabelParts(ctx as any, [{ recordId: fx.ticketId }]))[0];
    expect(second?.custodyLocation).toBe('Main Office / Shelf C1');

    // Both positions and the move are on the timeline and the queue shows the item.
    const events = unwrap<any[]>(await custody.listCustodyEvents(assetId));
    expect(events.map((e) => [e.event_type, e.to_bin])).toEqual([['received', 'Shelf B3'], ['moved', 'Shelf C1']]);
    expect(events[1].from_bin).toBe('Shelf B3');
    const queue = unwrap<any>(await custody.listCustodyQueue({}));
    expect(queue.rows.map((x: any) => [x.asset_id, x.bin])).toEqual([[assetId, 'Shelf C1']]);
    expect(queue.rows[0].ticket_id ?? fx.ticketId).toBe(fx.ticketId);
  });

  it('waiting_on_client requires the item to be in the office (tab counts and rows)', async () => {
    const fx = await seedFixture();
    const inOffice = unwrap<any>(await receiveEquipment(intake(fx, { new_asset: { name: 'Held for pickup', asset_type: 'unknown' }, next_action_party: 'client', follow_up_on: null })));
    const atVendor = unwrap<any>(await receiveEquipment(intake(fx, { new_asset: { name: 'Sent out', asset_type: 'unknown' }, next_action_party: 'client', follow_up_on: null })));
    unwrap(await custody.shipCustody(atVendor.custody.custody_id, { counterparty: 'Dell' }));
    unwrap(await custody.updateCustody(atVendor.custody.custody_id, { next_action_party: 'client' }));
    const shipped = (await table(fx.tenantId, 'asset_custody').where({ custody_id: atVendor.custody.custody_id }).first());
    expect(shipped).toMatchObject({ state: 'with_vendor', next_action_party: 'client' });

    const queue = unwrap<any>(await custody.listCustodyQueue({ tab: 'waiting_on_client' }));
    expect(queue.rows.map((r: any) => r.asset_id)).toEqual([inOffice.asset.asset_id]);
    expect(queue.tabCounts).toMatchObject({ all_open: 2, in_office: 1, waiting_on_client: 1, waiting_on_vendor: 1 });
  });

  it('"today" for overdue is the caller local date: user time zone, then tenant time zone, then UTC', async () => {
    const fx = await seedFixture();
    const { resolveCustodyToday } = await import('@alga-psa/assets/lib/custody/service');
    const { matchesQueueTab } = await import('@alga-psa/assets/lib/custody/queries');
    // 23:30 UTC on the 23rd: already the 24th in Auckland, still the 23rd in UTC.
    const now = new Date('2026-10-23T23:30:00Z');

    expect(await resolveCustodyToday(db, fx.tenantId, fx.userId, now)).toBe('2026-10-23'); // no tz anywhere: UTC

    await table(fx.tenantId, 'tenant_settings').insert({ tenant: fx.tenantId, settings: { timezone: 'Pacific/Auckland' } });
    expect(await resolveCustodyToday(db, fx.tenantId, fx.userId, now)).toBe('2026-10-24'); // tenant tz

    await table(fx.tenantId, 'users').where({ user_id: fx.userId }).update({ timezone: 'America/Los_Angeles' });
    expect(await resolveCustodyToday(db, fx.tenantId, fx.userId, now)).toBe('2026-10-23'); // user tz wins over tenant tz

    await table(fx.tenantId, 'users').where({ user_id: fx.userId }).update({ timezone: 'Pacific/Auckland' });
    const today = await resolveCustodyToday(db, fx.tenantId, fx.userId, now);
    expect(today).toBe('2026-10-24');

    // End to end through the queue query: follow_up_on = 2026-10-23 is "today" in UTC but yesterday for this user.
    const r = unwrap<any>(await receiveEquipment(intake(fx, { follow_up_on: '2026-10-23' })));
    const { listCustodyQueueService } = await import('@alga-psa/assets/lib/custody/service');
    const user = { user_id: fx.userId, user_type: 'internal', roles: [] } as any;
    const local = await listCustodyQueueService(db, fx.tenantId, user, { tab: 'overdue' }, { today });
    expect(local.rows.map((x: any) => x.asset_id)).toEqual([r.asset.asset_id]);
    const utc = await listCustodyQueueService(db, fx.tenantId, user, { tab: 'overdue' }, { today: now.toISOString().slice(0, 10) });
    expect(utc.total).toBe(0);
    expect(matchesQueueTab(local.rows[0], 'overdue', today)).toBe(true);
  });

  it('generates distinct tags for concurrent receives on one ticket, with no stock rows', async () => {
    const fx = await seedFixture();
    const { receiveEquipmentForTicket } = await import('@alga-psa/assets/lib/custody/receiveEquipment');
    const before = await counts(fx.tenantId);
    const ticket = await table(fx.tenantId, 'tickets').where({ ticket_id: fx.ticketId }).first();
    const run = (name: string) =>
      db.transaction(async (trx) => {
        const result = await receiveEquipmentForTicket(trx, fx.tenantId, fx.userId, intake(fx, { new_asset: { name, asset_type: 'unknown' } }) as any);
        // Hold the transaction open briefly so the two overlap and the ticket row lock is what serialises them.
        await new Promise((resolve) => setTimeout(resolve, 150));
        return result;
      });
    const [one, two] = await Promise.all([run('Dock A'), run('Dock B')]);
    expect([one.asset.asset_tag, two.asset.asset_tag].sort()).toEqual([`${ticket.ticket_number}-EQ1`, `${ticket.ticket_number}-EQ2`]);
    expect(await counts(fx.tenantId)).toEqual(before);
  });

  it('receives a New item of a tenant type with a Required field, with no attributes and no stock rows', async () => {
    const fx = await seedFixture();
    await table(fx.tenantId, 'asset_type_registry').insert({
      tenant: fx.tenantId, slug: 'rack_server', name: 'Rack Server', icon: null, is_builtin: false, display_order: 0,
      fields_schema: JSON.stringify([{ key: 'rack_unit', label: 'Rack Unit', kind: 'number', required: true }]),
    });
    const stockFor = async () => ({
      units: Number((await table(fx.tenantId, 'stock_units').where({ client_id: fx.clientId }).count('* as count').first() as any).count),
      movements: Number((await table(fx.tenantId, 'stock_movements').where({ source_doc_id: fx.ticketId }).count('* as count').first() as any).count),
    });
    const before = await stockFor();
    const r = unwrap<any>(await receiveEquipment(intake(fx, { new_asset: { name: 'DL380', asset_type: 'rack_server' } })));
    const row = await table(fx.tenantId, 'assets').where({ asset_id: r.asset.asset_id }).first();
    expect(row).toMatchObject({ status: 'held_by_msp', ownership: 'client', client_id: fx.clientId, asset_type: 'rack_server' });
    const open = await table(fx.tenantId, 'asset_custody').where({ asset_id: r.asset.asset_id }).whereNull('closed_at');
    expect(open).toHaveLength(1);
    expect(await stockFor()).toEqual(before);
    expect(before).toEqual({ units: 0, movements: 0 });
  });

  it('still rejects an invalid supplied attribute, without an attributes.* path in the message', async () => {
    const fx = await seedFixture();
    await table(fx.tenantId, 'asset_type_registry').insert({
      tenant: fx.tenantId, slug: 'rack_server', name: 'Rack Server', icon: null, is_builtin: false, display_order: 0,
      fields_schema: JSON.stringify([{ key: 'rack_unit', label: 'Rack Unit', kind: 'number', required: true }]),
    });
    const { toCustodyResult } = await import('@alga-psa/assets/lib/custody/actionResult');
    const { createAssetInTransaction } = await import('@alga-psa/assets/actions/assetActions');
    // Receive's input cannot carry attributes, so exercise the same call options directly: required is relaxed,
    // but a supplied wrong-typed value is still validated.
    const invalid = await toCustodyResult(() =>
      db.transaction((trx) =>
        createAssetInTransaction(trx, fx.tenantId, fx.userId, {
          asset_type: 'rack_server', client_id: fx.clientId, asset_tag: `BAD-${randomUUID().slice(0, 6)}`, name: 'Bad',
          status: 'held_by_msp', attributes: { rack_unit: 'not-a-number' },
        } as any, { requireCustomAttributes: false })
      )
    );
    expect(invalid.success).toBe(false);
    if (invalid.success) return;
    expect(invalid.error.message).not.toContain('attributes.');
    expect(invalid.error.messageKey).toMatch(/^msp\/assets:errors\.asset\.missingField/);
  });

  it('skips a generated tag already used by an unrelated asset in the tenant', async () => {
    const fx = await seedFixture();
    const ticket = await table(fx.tenantId, 'tickets').where({ ticket_id: fx.ticketId }).first();
    // Different case, different client: the numeric-suffix scan misses it, the tenant-wide check must not.
    await newAsset(fx, { client_id: fx.otherClientId, asset_tag: `${ticket.ticket_number}-eq1`.toLowerCase() });
    const r = unwrap<any>(await receiveEquipment(intake(fx)));
    expect(r.asset.asset_tag).toBe(`${ticket.ticket_number}-EQ2`);
  });

  it('record-level filtering: an unreadable asset is dropped from the queue (rows and counts), label parts and reads', async () => {
    const fx = await seedFixture();
    const ctx = { tenant: fx.tenantId, user: { user_id: fx.userId, user_type: 'internal', roles: [] } as any, baseUrl: 'https://x.test' };
    const { getTicketLinkedAssetLabelParts } = await import('@alga-psa/assets/lib/ticketLinkedAssetLabels');
    const a = unwrap<any>(await receiveEquipment(intake(fx)));
    const b = unwrap<any>(await receiveEquipment(intake(fx, { new_asset: { name: 'Second item' }, bin: 'Shelf D4' })));

    // Two held items on one ticket, none picked: a count and the earliest follow-up (no party, no note).
    const both = (await getTicketLinkedAssetLabelParts(ctx as any, [{ recordId: fx.ticketId }]))[0];
    expect(both).toMatchObject({ custodyLocation: '2 items held', nextAction: 'Follow up Oct 29' });

    denied.assetIds.add(a.asset.asset_id);
    try {
      const queue = unwrap<any>(await custody.listCustodyQueue({}));
      expect(queue.rows.map((x: any) => x.asset_id)).toEqual([b.asset.asset_id]);
      expect(queue.total).toBe(1);
      expect(queue.tabCounts.all_open).toBe(1);

      const parts = (await getTicketLinkedAssetLabelParts(ctx as any, [{ recordId: fx.ticketId }]))[0];
      expect(parts?.custodyLocation).toBe('Main Office / Shelf D4');
      expect(JSON.stringify(parts)).not.toContain('Shelf B3');

      expect(await custody.getAssetCustody(a.asset.asset_id)).toMatchObject({ success: false, error: { code: 'not_found' } });
      expect(await custody.moveCustody(a.custody.custody_id, { bin: 'Z' })).toMatchObject({ success: false, error: { code: 'not_found' } });
      // Held-equipment chip on the ticket drops it too.
      expect(unwrap<any[]>(await custody.listHeldEquipment(fx.ticketId)).map((c) => c.asset_id)).toEqual([b.asset.asset_id]);
    } finally {
      denied.assetIds.clear();
    }
  });

  it('work tag with three held items: picked, batch and unpicked prints show the right custody and write nothing', async () => {
    const fx = await seedFixture();
    const caller = { user: { user_id: fx.userId, user_type: 'internal', roles: [] } as any, tenant: fx.tenantId, baseUrl: 'https://psa.example.com' };
    const { getTicketLinkedAssetLabelParts } = await import('@alga-psa/assets/lib/ticketLinkedAssetLabels');
    const { printLabels } = await import('../../lib/labels/printLabels');

    const NOTE = 'NOTE-must-never-print-' + randomUUID().slice(0, 6);
    const bins = ['Shelf A1', 'Shelf B3', 'Shelf C2'];
    const dates = ['2026-11-02', '2026-10-29', '2026-12-01'];
    const assetIds: string[] = [];
    for (const [i, bin] of bins.entries()) {
      const r = unwrap<any>(
        await receiveEquipment(intake(fx, { new_asset: { name: `Item ${i}`, serial_number: `SERIAL-00${i}-WXYZ` }, bin, follow_up_on: dates[i], next_action_note: NOTE }))
      );
      assetIds.push(r.asset.asset_id);
    }

    // The ticket provider has its own record-level checks (covered in labelsProviders); here the ticket is readable.
    const captured: any[] = [];
    const deps: any = {
      providers: {
        'ticket-work-tag': {
          entityType: 'ticket', labelClass: 'ticket-work-tag',
          getLabelViewModels: async (_c: unknown, ids: string[]) =>
            ids.map((id) => ({
              labelClass: 'ticket-work-tag', entityType: 'ticket', recordId: id, url: `https://psa.example.com/msp/tickets/${id}`,
              identifier: 'TIC-1', code128Value: null, title: 'Dock', clientName: null, detail: null, secondaryIdentifier: null, serialSuffix: null,
            })),
        },
      },
      renderPdf: async (_t: string, items: any[]) => {
        captured.push(...items);
        return { pdf: Buffer.from('%PDF'), labels: items.length, sheets: items.length };
      },
      resolveTemplate: async () => ({ ok: true, templateCode: 'standard-ticket-work-tag', templateAst: null }),
      getLinkedAssetParts: (context: any, subjects: any) => getTicketLinkedAssetLabelParts(context, subjects),
      describeClientError: () => null,
    };
    const print = async (labels: Array<{ recordId: string; linkedAssetId?: string }>) => {
      captured.length = 0;
      const result = await printLabels(deps, caller, { labelClass: 'ticket-work-tag', labels });
      expect(result).toMatchObject({ ok: true, skipped: 0 });
      return captured.map((c) => c.viewModel);
    };

    const watched = [...FORBIDDEN_TABLES, 'asset_custody', 'asset_custody_events', 'asset_history'];
    const counts = async () => {
      const out: Record<string, number> = {};
      for (const name of watched) {
        out[name] = Number(((await table(fx.tenantId, name).count('* as c').first().catch(() => ({ c: 0 }))) as any).c);
      }
      return out;
    };
    const before = await counts();

    // 1. Picked: one label, that item's shelf and next action.
    const picked = await print([{ recordId: fx.ticketId, linkedAssetId: assetIds[1] }]);
    expect(picked).toHaveLength(1);
    expect(picked[0]).toMatchObject({ custodyLocation: 'Main Office / Shelf B3', nextAction: 'Waiting on vendor, Oct 29' });

    // 2. Batch: three labels, each with its own shelf.
    const batch = await print(assetIds.map((linkedAssetId) => ({ recordId: fx.ticketId, linkedAssetId })));
    expect(batch.map((v) => v.custodyLocation)).toEqual(bins.map((b) => `Main Office / ${b}`));
    expect(batch.map((v) => v.nextAction)).toEqual(['Waiting on vendor, Nov 2', 'Waiting on vendor, Oct 29', 'Waiting on vendor, Dec 1']);

    // 3. Unpicked: the count and the earliest follow-up.
    const unpicked = await print([{ recordId: fx.ticketId }]);
    expect(unpicked[0]).toMatchObject({ custodyLocation: '3 items held', nextAction: 'Follow up Oct 29' });

    // The internal note is never in what would be rendered, and printing wrote nothing.
    expect(JSON.stringify([picked, batch, unpicked])).not.toContain(NOTE);
    expect(await counts()).toEqual(before);
  });

  it('the asset identity label view model never carries custody', async () => {
    // Identity labels come from the assets provider, which must have no custody dependency at all.
    const src = (await import('node:fs')).readFileSync(
      new URL('../../../../packages/assets/src/lib/labelViewModelProvider.ts', import.meta.url),
      'utf8'
    );
    expect(src).not.toMatch(/custody/i);
  });

  it('migration: ownership defaults to client with a CHECK, held_by_msp is seeded for existing tenants, and up() is idempotent', async () => {
    const { createRequire } = await import('node:module');
    const migration = createRequire(import.meta.url)('../../../migrations/20261024100000_create_asset_custody.cjs');
    const fx = await seedFixture();
    await table(fx.tenantId, 'asset_statuses').where({ slug: 'held_by_msp' }).del();

    const assetId = randomUUID();
    await table(fx.tenantId, 'assets').insert({
      tenant: fx.tenantId, asset_id: assetId, asset_type: 'unknown', client_id: fx.clientId, asset_tag: 'LEGACY-1',
      name: 'Legacy device', status: 'active', location: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    expect((await table(fx.tenantId, 'assets').where({ asset_id: assetId }).first()).ownership).toBe('client');
    await expect(table(fx.tenantId, 'assets').where({ asset_id: assetId }).update({ ownership: 'other' })).rejects.toThrow(/ownership/i);

    await migration.up(db);
    await migration.up(db);
    const rows = await table(fx.tenantId, 'asset_statuses').where({ slug: 'held_by_msp' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'pending', is_builtin: true });
    expect((await table(fx.tenantId, 'assets').where({ asset_id: assetId }).first()).ownership).toBe('client');
  });
});
