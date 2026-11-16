import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { knex, type Knex } from 'knex';

/**
 * T004 (alga-2026-0003227): the opener-marker backfill, run against a real Postgres.
 *
 * Hermetic: `comments` and `tickets` are TEMP tables carrying only the columns the migration
 * touches. Temp tables come first on the search_path, so the unqualified names in the migration
 * SQL resolve to them and no real data or schema is read or written. Needs only a reachable
 * Postgres (DB_HOST/DB_PORT/DB_USER_ADMIN/DB_PASSWORD_ADMIN/DB_NAME_SERVER); skipped otherwise.
 * Citus co-location is not exercised here; every statement joins on tenant by construction.
 */
const require = createRequire(import.meta.url);
const MIGRATION = require(path.resolve(__dirname, '..', '20261115130000_backfill_email_opener_comment_marker.cjs'));

let db: Knex | undefined;
let reachable = false;

const TENANT = '00000000-0000-0000-0000-0000000000a1';
const OTHER_TENANT = '00000000-0000-0000-0000-0000000000a2';
const BASE = new Date('2026-11-01T10:00:00.000Z');
const at = (seconds: number) => new Date(BASE.getTime() + seconds * 1000);

let seq = 0;
const uuid = () => `10000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`;

async function ticket(over: Record<string, unknown> = {}) {
  const row = { tenant: TENANT, ticket_id: uuid(), ticket_origin: 'inbound_email', entered_at: BASE, email_metadata: { messageId: 'msg-1' }, ...over };
  await db!('tickets').insert({ ...row, email_metadata: row.email_metadata == null ? null : JSON.stringify(row.email_metadata) });
  return row.ticket_id as string;
}

async function comment(ticketId: string, over: Record<string, unknown> = {}) {
  const id = uuid();
  await db!('comments').insert({
    tenant: TENANT,
    comment_id: id,
    ticket_id: ticketId,
    parent_comment_id: null,
    deleted_at: null,
    created_at: BASE,
    metadata: JSON.stringify({ responseSource: 'inbound_email', email: { messageId: 'other' } }),
    ...over,
    ...(over.metadata && typeof over.metadata !== 'string' ? { metadata: JSON.stringify(over.metadata) } : {}),
  });
  return id;
}

async function marked(): Promise<Set<string>> {
  const rows = await db!('comments').whereRaw(`metadata->>'opensTicket' = 'true'`).select('comment_id');
  return new Set(rows.map((r: { comment_id: string }) => r.comment_id));
}

beforeAll(async () => {
  const connection = knex({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER_ADMIN || 'postgres',
      password: process.env.DB_PASSWORD_ADMIN || 'postgres',
      database: process.env.DB_NAME_SERVER || 'postgres',
    },
    pool: { min: 1, max: 1 }, // temp tables live on one session
  });
  try {
    await connection.raw('SELECT 1');
    reachable = true;
    db = connection;
  } catch {
    await connection.destroy().catch(() => undefined);
    return;
  }
  await db.raw(`CREATE TEMP TABLE tickets (tenant uuid, ticket_id uuid, ticket_origin text, entered_at timestamptz, email_metadata jsonb)`);
  await db.raw(`CREATE TEMP TABLE comments (tenant uuid, comment_id uuid, ticket_id uuid, parent_comment_id uuid, deleted_at timestamptz, created_at timestamptz, metadata jsonb)`);
}, 30_000);

afterAll(async () => {
  await db?.destroy().catch(() => undefined);
});

beforeEach(async () => {
  if (!db) return;
  await db.raw('TRUNCATE comments, tickets');
});

describe('backfill email opener comment marker migration', () => {
  it('is skipped when no Postgres is reachable', (ctx) => {
    if (!reachable) ctx.skip();
    expect(db).toBeDefined();
  });

  it('marks the Message-ID match, not an earlier non-matching comment', async (ctx) => {
    if (!reachable) return ctx.skip();
    const t = await ticket();
    const early = await comment(t, { created_at: at(1), metadata: { responseSource: 'inbound_email', email: { messageId: 'unrelated' } } });
    const match = await comment(t, { created_at: at(30), metadata: { responseSource: 'inbound_email', email: { messageId: 'msg-1' } } });
    await MIGRATION.up(db);
    const set = await marked();
    expect(set.has(match)).toBe(true);
    expect(set.has(early)).toBe(false); // a Message-ID match suppresses the time-window fallback
    expect(set.size).toBe(1);
    // attachmentCount stays absent, other metadata is preserved
    const row = await db!('comments').where({ comment_id: match }).first();
    expect(row.metadata).toEqual({ responseSource: 'inbound_email', email: { messageId: 'msg-1' }, opensTicket: true });
  });

  it('falls back to the earliest root inbound comment within 120s when nothing matches', async (ctx) => {
    if (!reachable) return ctx.skip();
    const t = await ticket({ email_metadata: { messageId: 'no-comment-has-this' } });
    const first = await comment(t, { created_at: at(5), metadata: { responseSource: 'inbound_email' } });
    const second = await comment(t, { created_at: at(20), metadata: { responseSource: 'inbound_email' } });
    const noMessageId = await ticket({ email_metadata: null });
    const viaEmailKey = await comment(noMessageId, { created_at: at(60), metadata: { email: { fromAddress: 'a@b.example' } } });
    await MIGRATION.up(db);
    const set = await marked();
    expect(set.has(first)).toBe(true);
    expect(set.has(second)).toBe(false);
    expect(set.has(viaEmailKey)).toBe(true);
    expect(set.size).toBe(2);
  });

  it('leaves late comments, replies, deleted, non-email provenance and non-email tickets untouched', async (ctx) => {
    if (!reachable) return ctx.skip();
    const late = await ticket({ email_metadata: { messageId: 'x' } });
    await comment(late, { created_at: at(600), metadata: { responseSource: 'inbound_email' } }); // > 120s after ticket
    const replies = await ticket({ email_metadata: { messageId: 'x' } });
    const root = await comment(replies, { created_at: at(500), metadata: { responseSource: 'inbound_email' } });
    await comment(replies, { created_at: at(10), parent_comment_id: root, metadata: { responseSource: 'inbound_email' } });
    const deleted = await ticket({ email_metadata: { messageId: 'x' } });
    await comment(deleted, { created_at: at(5), deleted_at: at(50), metadata: { responseSource: 'inbound_email' } });
    const manual = await ticket({ email_metadata: { messageId: 'x' } });
    await comment(manual, { created_at: at(5), metadata: { responseSource: 'client_portal' } });
    for (const origin of ['manual', 'client_portal', 'api', null]) {
      const other = await ticket({ ticket_origin: origin, email_metadata: { messageId: 'msg-1' } });
      await comment(other, { created_at: at(5), metadata: { responseSource: 'inbound_email', email: { messageId: 'msg-1' } } });
    }
    await MIGRATION.up(db);
    expect((await marked()).size).toBe(0);
  });

  it('does not match across tenants', async (ctx) => {
    if (!reachable) return ctx.skip();
    const t = await ticket();
    await comment(t, { tenant: OTHER_TENANT, created_at: at(5), metadata: { responseSource: 'inbound_email', email: { messageId: 'msg-1' } } });
    await MIGRATION.up(db);
    expect((await marked()).size).toBe(0);
  });

  it('marks at most one comment per ticket, skips tickets already marked, and a re-run is a no-op', async (ctx) => {
    if (!reachable) return ctx.skip();
    const dup = await ticket();
    await comment(dup, { created_at: at(5), metadata: { responseSource: 'inbound_email', email: { messageId: 'msg-1' } } });
    await comment(dup, { created_at: at(6), metadata: { responseSource: 'inbound_email', email: { messageId: 'msg-1' } } });
    const already = await ticket({ email_metadata: { messageId: 'zzz' } });
    const written = await comment(already, { created_at: at(50), metadata: { responseSource: 'inbound_email', opensTicket: true, attachmentCount: 3 } });
    const earlier = await comment(already, { created_at: at(2), metadata: { responseSource: 'inbound_email' } });

    await MIGRATION.up(db);
    const afterFirst = await db!('comments').orderBy('comment_id').select('comment_id', 'metadata');
    const set = await marked();
    expect(set.size).toBe(2); // one on `dup`, the pre-existing marker on `already`
    expect(set.has(earlier)).toBe(false);
    expect((await db!('comments').where({ comment_id: written }).first()).metadata.attachmentCount).toBe(3);

    await MIGRATION.up(db);
    expect(await db!('comments').orderBy('comment_id').select('comment_id', 'metadata')).toEqual(afterFirst);
  });

  it('down removes the marker and nothing else', async (ctx) => {
    if (!reachable) return ctx.skip();
    const t = await ticket();
    const id = await comment(t, { created_at: at(5), metadata: { responseSource: 'inbound_email', email: { messageId: 'msg-1' } } });
    await MIGRATION.up(db);
    expect((await marked()).has(id)).toBe(true);
    await MIGRATION.down(db);
    const row = await db!('comments').where({ comment_id: id }).first();
    expect(row.metadata).toEqual({ responseSource: 'inbound_email', email: { messageId: 'msg-1' } });
  });
});
