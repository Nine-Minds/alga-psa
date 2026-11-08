import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection, wireLocalTestDbEnv } from '../actions/_dbTestUtils';
import Quote from '../models/quote';
import { mint, resolve, revoke, resetQuoteAccessRateLimiters } from './quoteAccessLinks';

// Real-database coverage for quote access links. Set TEST_DB_PORT to point at a
// non-default local Postgres (wireLocalTestDbEnv defaults to 5472).

let db: Knex;
const tenantA = uuidv4();
const tenantB = uuidv4();
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function createTenant(tenant: string, label: string) {
  await db('tenants').insert({
    tenant,
    client_name: `Quote links ${label}`,
    email: `quote-links-${label}-${tenant.slice(0, 8)}@example.invalid`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function createQuote(tenant: string, overrides: Record<string, unknown> = {}) {
  const [row] = await db('quotes')
    .insert({ tenant, title: 'Links test', status: 'sent', quote_number: `QL-${uuidv4().slice(0, 8)}`, ...overrides })
    .returning('*');
  return row;
}

const recipient = { contactId: null, email: 'signer@example.invalid' };

beforeAll(async () => {
  wireLocalTestDbEnv();
  if (process.env.TEST_DB_PORT) process.env.DB_PORT = process.env.TEST_DB_PORT;
  db = await createTestDbConnection();
  await createTenant(tenantA, 'a');
  await createTenant(tenantB, 'b');
}, 300_000);

beforeEach(() => resetQuoteAccessRateLimiters());

afterAll(async () => {
  if (!db) return;
  for (const t of [tenantA, tenantB]) {
    await db('quote_access_links').where({ tenant: t }).del();
    await db('quote_activities').where({ tenant: t }).del();
    await db('quote_items').where({ tenant: t }).del();
    await db('quotes').where({ tenant: t }).del();
    await db('tenants').where({ tenant: t }).del();
  }
  await db.destroy();
});

describe('quote access links (real DB)', () => {
  it('round-trips mint -> resolve and bumps usage', async () => {
    const quote = await createQuote(tenantA);
    const { link, token } = await mint(db, tenantA, { quote, recipient: { contactId: null, email: 'a@example.invalid' } });
    expect(link.use_count).toBe(0);

    const res = await resolve(token, { ip: '198.51.100.1' }, db);
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.tenant).toBe(tenantA);
    expect(res.quote.quote_id).toBe(quote.quote_id);
    expect(res.recipient).toEqual({ contactId: null, email: 'a@example.invalid' });
    expect(res.readOnly).toBe(false);

    await resolve(token, {}, db);
    const row = await db('quote_access_links').where({ tenant: tenantA, link_id: link.link_id }).first();
    expect(row.use_count).toBe(2);
    expect(row.last_used_at).not.toBeNull();
  });

  it('stores only the hash: no column equals the raw token', async () => {
    const quote = await createQuote(tenantA);
    const { link, token } = await mint(db, tenantA, { quote, recipient });
    const row = await db('quote_access_links').where({ tenant: tenantA, link_id: link.link_id }).first();
    expect(row.token_hash).toBe(sha256(token));
    expect(row.token_hash.trim()).toMatch(/^[0-9a-f]{64}$/);
    for (const value of Object.values(row)) {
      expect(value).not.toBe(token);
      expect(String(value)).not.toContain(token);
    }
    const cols = await db('information_schema.columns').where({ table_name: 'quote_access_links' }).pluck('column_name');
    expect(cols).not.toContain('token');
  });

  it('returns expired on the DB clock', async () => {
    const quote = await createQuote(tenantA);
    const { link, token } = await mint(db, tenantA, { quote, recipient });
    await db('quote_access_links').where({ tenant: tenantA, link_id: link.link_id }).update({ expires_at: db.raw("now() - interval '1 second'") });
    expect(await resolve(token, {}, db)).toEqual({ status: 'expired' });
  });

  it('returns revoked, and revoke is idempotent', async () => {
    const quote = await createQuote(tenantA);
    const { link, token } = await mint(db, tenantA, { quote, recipient });
    expect(await revoke(db, tenantA, { linkId: link.link_id }, 'manual')).toBe(1);
    expect(await revoke(db, tenantA, { linkId: link.link_id }, 'manual')).toBe(0);
    expect(await revoke(db, tenantA, { quoteId: quote.quote_id }, 'cancelled')).toBe(0);
    expect(await resolve(token, {}, db)).toEqual({ status: 'revoked' });
  });

  it('createRevision supersedes the old quote links', async () => {
    const quote = await createQuote(tenantA);
    const { token } = await mint(db, tenantA, { quote, recipient });
    await db.transaction((trx) => Quote.createRevision(trx, tenantA, quote.quote_id, null));
    expect(await resolve(token, {}, db)).toEqual({ status: 'superseded' });
    const row = await db('quote_access_links').where({ tenant: tenantA, quote_id: quote.quote_id }).first();
    expect(row.revoked_reason).toBe('superseded');
  });

  it('cancelling a quote revokes its links', async () => {
    const quote = await createQuote(tenantA);
    const { token } = await mint(db, tenantA, { quote, recipient });
    await db.transaction((trx) => Quote.update(trx, tenantA, quote.quote_id, { status: 'cancelled' } as any));
    expect(await resolve(token, {}, db)).toEqual({ status: 'revoked' });
  });

  it('expiring a quote on access revokes its links', async () => {
    const quote = await createQuote(tenantA, { valid_until: '2020-01-01T00:00:00Z' });
    const { token } = await mint(db, tenantA, { quote, recipient });
    await db.transaction((trx) => Quote.getById(trx, tenantA, quote.quote_id));
    expect(await resolve(token, {}, db)).toEqual({ status: 'revoked' });
  });

  it('keeps accepted quotes viewable read-only (decision does not revoke)', async () => {
    const quote = await createQuote(tenantA);
    const { token } = await mint(db, tenantA, { quote, recipient });
    await db.transaction((trx) => Quote.update(trx, tenantA, quote.quote_id, { status: 'accepted' } as any));
    const res = await resolve(token, {}, db);
    expect(res.status).toBe('ok');
    if (res.status === 'ok') expect(res.readOnly).toBe(true);
  });

  it('deleting a quote removes its links', async () => {
    const quote = await createQuote(tenantA, { status: 'draft' });
    const { token } = await mint(db, tenantA, { quote, recipient });
    await Quote.delete(db, tenantA, quote.quote_id);
    expect(await db('quote_access_links').where({ tenant: tenantA, quote_id: quote.quote_id })).toHaveLength(0);
    expect(await resolve(token, {}, db)).toEqual({ status: 'not_found' });
  });

  it('returns not_found for unknown well-formed tokens', async () => {
    expect(await resolve('z'.repeat(43), {}, db)).toEqual({ status: 'not_found' });
  });

  it('isolates tenants', async () => {
    const qa = await createQuote(tenantA);
    const qb = await createQuote(tenantB);
    const a = await mint(db, tenantA, { quote: qa, recipient });
    const b = await mint(db, tenantB, { quote: qb, recipient });

    const ra = await resolve(a.token, {}, db);
    const rb = await resolve(b.token, {}, db);
    expect(ra.status === 'ok' && ra.tenant === tenantA && ra.quote.quote_id === qa.quote_id).toBe(true);
    expect(rb.status === 'ok' && rb.tenant === tenantB && rb.quote.quote_id === qb.quote_id).toBe(true);

    expect(await revoke(db, tenantA, { quoteId: qb.quote_id }, 'manual')).toBe(0);
    expect(await revoke(db, tenantA, { linkId: b.link.link_id }, 'manual')).toBe(0);
    expect((await resolve(b.token, {}, db)).status).toBe('ok');
    expect(await revoke(db, tenantA, { quoteId: qa.quote_id }, 'manual')).toBe(1);
    expect((await resolve(b.token, {}, db)).status).toBe('ok');
  });
});
