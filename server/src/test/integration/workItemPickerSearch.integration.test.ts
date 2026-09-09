import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const state = vi.hoisted(() => ({ db: null as Knex.Transaction | null, tenant: '', user: null as any }));
vi.mock('@alga-psa/auth', async original => {
  const actual = await original<typeof import('@alga-psa/auth')>();
  return { ...actual, withAuth: (fn: any) => (...args: any[]) => fn(state.user, { tenant: state.tenant }, ...args) };
});
vi.mock('@alga-psa/db', async original => {
  const actual = await original<typeof import('@alga-psa/db')>();
  return { ...actual, createTenantKnex: async () => ({ knex: state.db, tenant: state.tenant }) };
});
import { searchPickerWorkItems } from '@alga-psa/scheduling/actions/workItemActions';

let db: Knex;
let ticket: { ticket_id: string; ticket_number: string; title: string };
beforeAll(async () => { db = await createTestDbConnection(); }, 120_000);
afterAll(async () => { await db?.destroy(); });
beforeEach(async () => {
  state.db = await db.transaction();
  const source = await state.db('tickets as t').join('statuses as s', function () {
    this.on('s.status_id', 't.status_id').andOn('s.tenant', 't.tenant');
  }).where('s.is_closed', false).select('t.*').first();
  if (!source) throw new Error('Migrated fixture must contain an open ticket');
  state.tenant = source.tenant;
  state.user = await state.db('users').where({ tenant: state.tenant, user_type: 'internal' }).first();
  const suffix = randomUUID();
  ticket = { ticket_id: randomUUID(), ticket_number: `PICKER-${suffix}`, title: `Distinct public title ${suffix}` };
  await state.db('tickets').insert({ ...source, ...ticket });
});
afterEach(async () => { await state.db?.rollback(); state.db = null; });

it.each(['title', 'ticket_number'] as const)('finds an open ticket by its displayed %s without requiring the other field to match', async field => {
  const result = await searchPickerWorkItems({ searchTerm: ticket[field].toLowerCase(), type: 'ticket' });
  expect(result).toMatchObject({ total: 1, items: [{ work_item_id: ticket.ticket_id, ticket_number: ticket.ticket_number }] });
});

it('keeps already-added work items excluded when their ticket number matches', async () => {
  const result = await searchPickerWorkItems({ searchTerm: ticket.ticket_number, type: 'ticket', availableWorkItemIds: [ticket.ticket_id] });
  expect(result).toMatchObject({ total: 0, items: [] });
});

it('does not match a ticket number outside the authenticated tenant', async () => {
  state.tenant = randomUUID();
  const result = await searchPickerWorkItems({ searchTerm: ticket.ticket_number, type: 'ticket' });
  expect(result).toMatchObject({ total: 0, items: [] });
});
