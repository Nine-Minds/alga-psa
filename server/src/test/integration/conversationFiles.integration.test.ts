/**
 * TC L0c: the owner-qualified conversation file engine against a real Postgres with the real
 * migration applied (scratch database; FAILS when the dev server is unreachable).
 * Two tenants, two synthetic owner types and an in-memory storage prove the engine is
 * owner-neutral: draft -> publish -> copy -> authorized read, for any owning record.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  CONVERSATION_FILE_MAX_BYTES, CONVERSATION_FILE_MAX_COUNT, abandonConversationFilePublication, cleanupConversationFiles, describeConversationFile,
  prepareConversationFilePublication, publishConversationFilePublication, readConversationFile, registerConversationFileOwner,
  registerConversationFileRetention, rehydrateConversationFile, unregisterConversationFileOwner, unregisterConversationFileRetention,
  uploadConversationFile, type ConversationFileStorage,
} from '@alga-psa/conversations/files';
import { tenantDeletionOrder } from '@alga-psa/db/tenantTableManifest';

const require = createRequire(import.meta.url);
const migration = require('../../../migrations/20261109120000_create_conversation_files.cjs');
const connection = {
  host: process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT === '6432' ? 5432 : process.env.DB_PORT || 5432),
  user: process.env.DB_USER_ADMIN || 'postgres',
  password: process.env.DB_PASSWORD_ADMIN || process.env.DB_PASSWORD || '',
};
const scratch = `conv_files_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
let admin: Knex | undefined, db: Knex;
let reachable = false;

const memoryStorage = () => {
  const objects = new Map<string, Uint8Array>();
  const storage: ConversationFileStorage & { objects: Map<string, Uint8Array>; failDelete: boolean } = {
    objects, failDelete: false,
    async upload(path, content) { objects.set(path, new Uint8Array(content)); },
    async download(path) { const o = objects.get(path); if (!o) throw new Error('missing'); return o; },
    async delete(path) { if (storage.failDelete) throw new Error('boom'); objects.delete(path); },
  };
  return storage;
};
const bytes = (text: string) => new TextEncoder().encode(text);

const T1 = randomUUID(), T2 = randomUUID();
const alice = { tenant: T1, userId: randomUUID() }, bob = { tenant: T1, userId: randomUUID() }, carol = { tenant: T2, userId: randomUUID() };
// Synthetic owners: "widget" records are readable/writable by listed users; "gadget" by others.
const widgetA = randomUUID(), widgetB = randomUUID(), gadget = randomUUID();
const access = new Map<string, Set<string>>();
const grant = (owner: string, ...users: string[]) => access.set(owner, new Set(users));
const adapter = { canRead: async (_t: unknown, a: { userId: string }, id: string) => access.get(id)?.has(a.userId) ?? false, canWrite: async (_t: unknown, a: { userId: string }, id: string) => access.get(id)?.has(a.userId) ?? false };

beforeAll(async () => {
  try {
    admin = knexFactory({ client: 'pg', connection: { ...connection, database: 'postgres' }, pool: { min: 0, max: 1 } });
    await admin.raw('select 1');
    await admin.raw(`CREATE DATABASE ${scratch}`);
    db = knexFactory({ client: 'pg', connection: { ...connection, database: scratch }, pool: { min: 0, max: 4 } });
    await db.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto').catch(() => undefined);
    await db.schema.createTable('tenants', t => { t.uuid('tenant').primary(); });
    await migration.up(db);
    reachable = true;
  } catch (error) {
    // Never skip silently: an unreachable database is a blocker, not a pass.
    throw new Error(`conversation files integration: database unreachable (${(error as Error).message})`);
  }
}, 60000);
afterAll(async () => {
  await db?.destroy();
  if (admin && reachable) await admin.raw(`DROP DATABASE IF EXISTS ${scratch}`).catch(() => undefined);
  await admin?.destroy();
});
beforeEach(() => {
  registerConversationFileOwner('widget', adapter);
  registerConversationFileOwner('gadget', adapter);
  grant(widgetA, alice.userId, bob.userId); grant(widgetB, alice.userId); grant(gadget, alice.userId);
  grant(widgetA + '-other', carol.userId);
});
afterEach(() => { unregisterConversationFileOwner('widget'); unregisterConversationFileOwner('gadget'); unregisterConversationFileRetention('editor'); });

const must = (fn: () => Promise<void>) => fn;
const files = (tenant: string) => db('conversation_files').where({ tenant });
const receipts = (tenant: string) => db('conversation_file_publications').where({ tenant });
async function stage(storage: ReturnType<typeof memoryStorage>, text = 'hello', owner = widgetA, ownerType = 'widget', actor = alice) {
  return uploadConversationFile(db, actor, { ownerType, ownerId: owner }, { fileId: randomUUID(), fileName: 'a.txt', mimeType: 'text/plain', content: bytes(text) }, storage);
}
const rejects = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });

describe('conversation file engine', () => {
  it('prepare -> publish -> authorized read; receipts round-trip', must(async () => {
    await db('tenants').insert([{ tenant: T1 }, { tenant: T2 }]).onConflict('tenant').ignore();
    const storage = memoryStorage();
    const src = await stage(storage, 'draft bytes');
    // A draft upload is readable by its uploader only.
    expect((await readConversationFile(db, alice, src.fileId, storage)).content).toEqual(bytes('draft bytes'));
    await rejects(readConversationFile(db, bob, src.fileId, storage), 'FILE_NOT_FOUND');

    const op = randomUUID();
    const receipt = await prepareConversationFilePublication(db, alice, { ownerType: 'widget', ownerId: widgetB }, op, [src.fileId], storage);
    expect(receipt.status).toBe('prepared');
    expect((await receipts(T1).where({ operation_id: op }).first()).status).toBe('prepared');
    const copyId = receipt.manifest[0].fileId;
    expect(copyId).not.toBe(src.fileId);
    // Unreadable while prepared, readable once published (by an authorized reader of the destination).
    await rejects(readConversationFile(db, alice, copyId, storage), 'FILE_NOT_FOUND');
    const published = await db.transaction(trx => publishConversationFilePublication(trx, alice, op));
    expect(published.status).toBe('published');
    const row = await receipts(T1).where({ operation_id: op }).first();
    expect(row.status).toBe('published'); expect(row.published_at).toBeTruthy();
    expect((await readConversationFile(db, alice, copyId, storage)).content).toEqual(bytes('draft bytes'));
    await rejects(readConversationFile(db, bob, copyId, storage), 'FILE_NOT_FOUND'); // bob cannot read widgetB
    // Another owner type proves neutrality.
    const g = await stage(storage, 'gadget file', gadget, 'gadget');
    expect((await readConversationFile(db, alice, g.fileId, storage)).file.ownerType).toBe('gadget');
    // Copy to a different owner needs canRead(source) and canWrite(destination).
    await rejects(prepareConversationFilePublication(db, bob, { ownerType: 'widget', ownerId: widgetA }, randomUUID(), [g.fileId], storage), 'FILE_NOT_FOUND');
    await rejects(prepareConversationFilePublication(db, alice, { ownerType: 'widget', ownerId: randomUUID() }, randomUUID(), [src.fileId], storage), 'FILE_NOT_FOUND');
  }));

  it('cross-tenant and cross-owner reads are rejected', must(async () => {
    const storage = memoryStorage();
    const f = await stage(storage);
    grant(widgetA, carol.userId);
    await rejects(readConversationFile(db, carol, f.fileId, storage), 'FILE_NOT_FOUND'); // same file id, other tenant
    // Owner type changes authority: unregistered type fails closed.
    await files(T1).where({ file_id: f.fileId }).update({ owner_type: 'unknown_type' });
    await rejects(readConversationFile(db, alice, f.fileId, storage), 'FILE_NOT_FOUND');
    // Different owner id: alice has no grant on it.
    await files(T1).where({ file_id: f.fileId }).update({ owner_type: 'widget', owner_id: randomUUID() });
    await rejects(readConversationFile(db, alice, f.fileId, storage), 'FILE_NOT_FOUND');
    // Different owner type, same id, no grant under that type's rules.
    await files(T1).where({ file_id: f.fileId }).update({ owner_type: 'gadget', owner_id: widgetA });
    registerConversationFileOwner('gadget', { canRead: async () => false, canWrite: async () => false });
    await rejects(readConversationFile(db, alice, f.fileId, storage), 'FILE_NOT_FOUND');
  }));

  it('duplicate operation id returns the original receipt; conflicting reuse is rejected', must(async () => {
    const storage = memoryStorage();
    const a = await stage(storage, 'one'), b = await stage(storage, 'two');
    const op = randomUUID(), dest = { ownerType: 'widget', ownerId: widgetB };
    const first = await prepareConversationFilePublication(db, alice, dest, op, [a.fileId], storage);
    const again = await prepareConversationFilePublication(db, alice, dest, op, [a.fileId], storage);
    expect(again).toEqual(first);
    expect(await files(T1).where({ publication_operation_id: op })).toHaveLength(1);
    await db.transaction(trx => publishConversationFilePublication(trx, alice, op));
    expect(await prepareConversationFilePublication(db, alice, dest, op, [a.fileId], storage)).toMatchObject({ operationId: op, status: 'published', requestHash: first.requestHash });
    await rejects(prepareConversationFilePublication(db, alice, dest, op, [b.fileId], storage), 'FILE_OPERATION_CONFLICT');
    await rejects(prepareConversationFilePublication(db, alice, { ownerType: 'widget', ownerId: widgetA }, op, [a.fileId], storage), 'FILE_OPERATION_CONFLICT');
  }));

  it('enforces 20 files and 25 MiB (boundaries pass)', must(async () => {
    const storage = memoryStorage();
    const ids = Array.from({ length: CONVERSATION_FILE_MAX_COUNT + 1 }, () => randomUUID());
    await rejects(prepareConversationFilePublication(db, alice, { ownerType: 'widget', ownerId: widgetB }, randomUUID(), ids, storage), 'FILE_LIMIT_EXCEEDED');
    const exact = new Uint8Array(CONVERSATION_FILE_MAX_BYTES);
    const ok = await uploadConversationFile(db, alice, { ownerType: 'widget', ownerId: widgetA }, { fileId: randomUUID(), fileName: 'max.bin', mimeType: 'application/octet-stream', content: exact }, storage);
    expect(ok.size).toBe(CONVERSATION_FILE_MAX_BYTES);
    await rejects(uploadConversationFile(db, alice, { ownerType: 'widget', ownerId: widgetA }, { fileId: randomUUID(), fileName: 'big.bin', mimeType: 'application/octet-stream', content: new Uint8Array(CONVERSATION_FILE_MAX_BYTES + 1) }, storage), 'INVALID_FILE');
    // exactly 20 sources pass
    const twenty: string[] = [];
    for (let i = 0; i < CONVERSATION_FILE_MAX_COUNT; i++) twenty.push((await stage(storage, `f${i}`)).fileId);
    const receipt = await prepareConversationFilePublication(db, alice, { ownerType: 'widget', ownerId: widgetB }, randomUUID(), twenty, storage);
    expect(receipt.manifest).toHaveLength(CONVERSATION_FILE_MAX_COUNT);
    // The DB enforces the size bound even if the code is bypassed.
    await expect(db('conversation_files').insert({ tenant: T1, file_id: randomUUID(), owner_type: 'widget', owner_id: widgetA, actor_user_id: alice.userId, file_name: 'x',
      mime_type: 'text/plain', file_size: CONVERSATION_FILE_MAX_BYTES + 1, content_hash: 'a'.repeat(64), request_hash: 'b'.repeat(64), storage_path: 'p' })).rejects.toThrow(/size_check/);
  }));

  it('digest descriptors rehydrate and verify; tampering is rejected', must(async () => {
    const storage = memoryStorage();
    const f = await stage(storage, 'digest me');
    const row = await files(T1).where({ file_id: f.fileId }).first();
    const descriptor = describeConversationFile(row);
    expect(Object.keys(descriptor).sort()).toEqual(['contentHash', 'fileId', 'fileName', 'mimeType', 'size', 'tenant']);
    expect((await rehydrateConversationFile(db, descriptor, storage, alice)).content).toEqual(bytes('digest me'));
    await rejects(rehydrateConversationFile(db, { ...descriptor, contentHash: createHash('sha256').update('x').digest('hex') }, storage, alice), 'FILE_CONTENT_MISMATCH');
    await rejects(rehydrateConversationFile(db, descriptor, storage, bob), 'FILE_NOT_FOUND'); // not a standing capability
    storage.objects.set(row.storage_path, bytes('tampered!!'));
    await rejects(rehydrateConversationFile(db, descriptor, storage, alice), 'FILE_CONTENT_MISMATCH');
    await rejects(readConversationFile(db, alice, f.fileId, storage), 'FILE_CONTENT_MISMATCH');
  }));

  it('abandon then cleanup removes bytes and rows; spares claimed editor files and accepted copies; retries failed purges', must(async () => {
    const storage = memoryStorage();
    const src = await stage(storage, 'src');
    const abandonedOp = randomUUID(), publishedOp = randomUUID();
    const dest = { ownerType: 'widget', ownerId: widgetB };
    const ab = await prepareConversationFilePublication(db, alice, dest, abandonedOp, [src.fileId], storage);
    const pub = await prepareConversationFilePublication(db, alice, dest, publishedOp, [src.fileId], storage);
    await db.transaction(trx => publishConversationFilePublication(trx, alice, publishedOp));
    await abandonConversationFilePublication(db, alice, abandonedOp);
    await rejects(abandonConversationFilePublication(db, alice, publishedOp), 'FILE_OPERATION_CONFLICT');
    const abPath = (await files(T1).where({ file_id: ab.manifest[0].fileId }).first()).storage_path;
    expect(storage.objects.has(abPath)).toBe(true);

    // First sweep fails on storage: attempts and backoff are recorded.
    storage.failDelete = true;
    const failed = await cleanupConversationFiles(db, T1, p => storage.delete(p));
    expect(failed.failedFiles).toBeGreaterThanOrEqual(1);
    const stuck = await files(T1).where({ file_id: ab.manifest[0].fileId }).first();
    expect(stuck.cleanup_attempts).toBe(1); expect(stuck.cleanup_error_code).toBe('file_cleanup_failed'); expect(stuck.purged_at).toBeNull();
    storage.failDelete = false;
    expect((await cleanupConversationFiles(db, T1, p => storage.delete(p))).purgedFiles).toBe(0); // still backing off
    const later = new Date(Date.now() + 2 * 3600_000);
    const ok = await cleanupConversationFiles(db, T1, p => storage.delete(p), 100, later);
    expect(ok.purgedFiles).toBeGreaterThanOrEqual(1); expect(ok.completedReceipts).toBeGreaterThanOrEqual(1);
    expect(storage.objects.has(abPath)).toBe(false);
    expect((await files(T1).where({ file_id: ab.manifest[0].fileId }).first()).purged_at).toBeTruthy();
    expect((await receipts(T1).where({ operation_id: abandonedOp }).first()).cleanup_completed_at).toBeTruthy();
    // The accepted (published) copy is untouched, even much later.
    const keepPath = (await files(T1).where({ file_id: pub.manifest[0].fileId }).first()).storage_path;
    const muchLater = new Date(Date.now() + 30 * 86_400_000);
    // Selected editor files are claimed by a retention hook; unclaimed stale uploads expire.
    const selected = await stage(storage, 'selected'), stale = await stage(storage, 'stale');
    registerConversationFileRetention('editor', async (_t, _tenant, ids) => new Set(ids.filter(id => id === selected.fileId)));
    const sweep = await cleanupConversationFiles(db, T1, p => storage.delete(p), 100, muchLater);
    expect(sweep.discardedFiles).toBeGreaterThanOrEqual(1);
    expect((await files(T1).where({ file_id: selected.fileId }).first()).discarded_at).toBeNull();
    expect((await files(T1).where({ file_id: stale.fileId }).first()).discarded_at).toBeTruthy();
    expect(storage.objects.has(keepPath)).toBe(true);
    expect((await files(T1).where({ file_id: pub.manifest[0].fileId }).first()).discarded_at).toBeNull();
    expect((await receipts(T1).where({ operation_id: publishedOp }).first()).status).toBe('published');
  }));

  it('tenant deletion in manifest order removes both tables rows', must(async () => {
    const order = tenantDeletionOrder();
    expect(order.indexOf('conversation_files')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('conversation_files')).toBeLessThan(order.indexOf('conversation_file_publications'));
    const storage = memoryStorage();
    const f = await stage(storage);
    await prepareConversationFilePublication(db, alice, { ownerType: 'widget', ownerId: widgetB }, randomUUID(), [f.fileId], storage);
    for (const table of order.filter(t => t === 'conversation_files' || t === 'conversation_file_publications')) await db(table).where({ tenant: T1 }).del();
    expect(await files(T1)).toHaveLength(0);
    expect(await receipts(T1)).toHaveLength(0);
  }));
});
