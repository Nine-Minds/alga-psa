/**
 * Ghost-usage report integration tests against the real local `server` DB.
 * Every DB test runs inside a transaction that is ALWAYS rolled back, so the
 * dev database is never mutated.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import knexLib, { Knex } from 'knex';
import {
  getGhostUsageAiSettings,
  parseGhostClassification,
  queryGhostUsageReport,
  selectClassifiableCandidates,
  setGhostUsageAiEnabledSetting,
  setGhostUsageReviewDisposition,
  upsertGhostUsageReview,
} from './ghostUsage';
import { getInventoryTestDatabaseConnection } from '../test-utils/inventoryTestDatabase';

const databaseConnection = getInventoryTestDatabaseConnection();

let knex: Knex;
let TENANT: string;
let CLIENT: string;
let SERVICE: string;
let USER: string;

const CLOSED_AT = '2031-01-15T12:00:00.000Z';
const CLOSED_LATER = '2031-01-16T12:00:00.000Z';
const FILTERS = { closedFrom: '2031-01-01', closedTo: '2031-01-31' };

beforeAll(async () => {
  if (!databaseConnection) return;
  knex = knexLib({
    client: 'pg',
    connection: databaseConnection,
    pool: { min: 1, max: 4 },
  });
  TENANT = (await knex('tenants').select('tenant').first()).tenant;
  CLIENT = (await knex('clients').where({ tenant: TENANT }).first())?.client_id;
  SERVICE = (await knex('service_catalog').where({ tenant: TENANT }).orderBy('service_id').first())?.service_id;
  USER = (await knex('users').where({ tenant: TENANT }).first())?.user_id;

  if (!CLIENT || !SERVICE || !USER) {
    throw new Error('ghostUsage tests require seeded client, service_catalog, and user rows');
  }
});

afterAll(async () => {
  await knex?.destroy();
});

async function inTx(fn: (trx: Knex.Transaction) => Promise<void>) {
  const trx = await knex.transaction();
  try {
    await fn(trx);
  } finally {
    await trx.rollback();
  }
}

function shortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

async function makeScope(trx: Knex.Transaction, label = shortId()) {
  const boardId = randomUUID();
  const closedStatusId = randomUUID();
  const openStatusId = randomUUID();

  await trx('boards').insert({
    tenant: TENANT,
    board_id: boardId,
    board_name: `Ghost Board ${label}`,
    is_inactive: false,
    display_order: 0,
  });

  await trx('statuses').insert([
    {
      tenant: TENANT,
      status_id: closedStatusId,
      name: `Ghost Closed ${label}`,
      status_type: 'ticket',
      order_number: 1,
      created_by: USER,
      is_closed: true,
      is_default: false,
      board_id: boardId,
    },
    {
      tenant: TENANT,
      status_id: openStatusId,
      name: `Ghost Open ${label}`,
      status_type: 'ticket',
      order_number: 2,
      created_by: USER,
      is_closed: false,
      is_default: false,
      board_id: boardId,
    },
  ]);

  return { boardId, closedStatusId, openStatusId };
}

async function makeTicket(
  trx: Knex.Transaction,
  scope: { boardId: string; closedStatusId: string; openStatusId: string },
  overrides: Partial<{
    title: string;
    board_id: string;
    status_id: string;
    is_closed: boolean;
    closed_at: string;
  }> = {},
): Promise<string> {
  const ticketId = randomUUID();
  await trx('tickets').insert({
    tenant: TENANT,
    ticket_id: ticketId,
    ticket_number: `GHOST-${shortId()}`,
    title: overrides.title ?? `Ghost ticket ${shortId()}`,
    board_id: overrides.board_id ?? scope.boardId,
    client_id: CLIENT,
    status_id: overrides.status_id ?? scope.closedStatusId,
    entered_by: USER,
    closed_by: USER,
    assigned_to: USER,
    entered_at: '2031-01-01T09:00:00.000Z',
    is_closed: overrides.is_closed ?? true,
    closed_at: overrides.closed_at ?? CLOSED_AT,
  });
  return ticketId;
}

async function addTicketMaterial(trx: Knex.Transaction, ticketId: string): Promise<void> {
  await trx('ticket_materials').insert({
    tenant: TENANT,
    ticket_material_id: randomUUID(),
    ticket_id: ticketId,
    client_id: CLIENT,
    service_id: SERVICE,
    quantity: 1,
    rate: 0,
    currency_code: 'USD',
    is_billed: false,
  });
}

describe.skipIf(!databaseConnection)('ghost usage report queries', () => {
  it('T036: material-less closed hardware tickets are candidates until ticket_materials exists', async () => {
    await inTx(async (trx) => {
      const scope = await makeScope(trx);
      const ticketId = await makeTicket(trx, scope);

      const before = await queryGhostUsageReport(trx, TENANT, { ...FILTERS, boardIds: [scope.boardId] });
      expect(before.candidates.map((row) => row.ticket_id)).toContain(ticketId);
      expect(before.funnel.candidates).toBe(1);
      expect(before.funnel.with_consumption).toBe(0);

      await addTicketMaterial(trx, ticketId);

      const after = await queryGhostUsageReport(trx, TENANT, { ...FILTERS, boardIds: [scope.boardId] });
      expect(after.candidates.map((row) => row.ticket_id)).not.toContain(ticketId);
      expect(after.funnel.candidates).toBe(0);
      expect(after.funnel.with_consumption).toBe(1);
      expect(after.funnel.with_consumption).toBe(after.funnel.hardware_scoped - after.funnel.candidates);
    });
  });

  it('T037: open status is excluded, but stale tickets.is_closed=false with closed status is counted', async () => {
    await inTx(async (trx) => {
      const scope = await makeScope(trx);
      const openTicketId = await makeTicket(trx, scope, {
        status_id: scope.openStatusId,
        is_closed: false,
      });
      const staleClosedTicketId = await makeTicket(trx, scope, {
        status_id: scope.closedStatusId,
        is_closed: false,
      });

      const report = await queryGhostUsageReport(trx, TENANT, { ...FILTERS, boardIds: [scope.boardId] });
      const ids = report.candidates.map((row) => row.ticket_id);
      expect(ids).not.toContain(openTicketId);
      expect(ids).toContain(staleClosedTicketId);
      expect(report.funnel.candidates).toBe(1);
    });
  });

  it('T038: board scoping narrows hardware scope and funnel counts reconcile', async () => {
    await inTx(async (trx) => {
      const boardA = await makeScope(trx, `A-${shortId()}`);
      const boardB = await makeScope(trx, `B-${shortId()}`);
      const billedTicketId = await makeTicket(trx, boardA);
      await addTicketMaterial(trx, billedTicketId);
      await makeTicket(trx, boardA, { closed_at: CLOSED_LATER });
      await makeTicket(trx, boardB);

      const noFilter = await queryGhostUsageReport(trx, TENANT, FILTERS);
      const boardFilter = await queryGhostUsageReport(trx, TENANT, { ...FILTERS, boardIds: [boardA.boardId] });

      expect(boardFilter.funnel.hardware_scoped).toBeLessThanOrEqual(noFilter.funnel.hardware_scoped);
      for (const funnel of [noFilter.funnel, boardFilter.funnel]) {
        expect(funnel.closed_in_scope).toBeGreaterThanOrEqual(funnel.hardware_scoped);
        expect(funnel.hardware_scoped).toBeGreaterThanOrEqual(funnel.candidates);
        expect(funnel.with_consumption).toBe(funnel.hardware_scoped - funnel.candidates);
      }
    });
  });

  it('T042: review dispositions split candidates, worklist, and suppressed rows', async () => {
    await inTx(async (trx) => {
      const scope = await makeScope(trx);
      const ticketId = await makeTicket(trx, scope);

      await upsertGhostUsageReview(trx, TENANT, {
        ticket_id: ticketId,
        ai_classification: 'hardware_missing',
        ai_confidence: 0.91,
        ai_reason: 'Drive replacement mentioned',
        ai_model: 'test-model',
      });

      const review = await trx('ghost_usage_reviews')
        .where({ tenant: TENANT, ticket_id: ticketId })
        .first();
      expect(review?.review_id).toBeTruthy();

      expect(await setGhostUsageReviewDisposition(trx, TENANT, USER, review.review_id, 'confirmed')).toBe(true);

      const confirmed = await queryGhostUsageReport(trx, TENANT, { ...FILTERS, boardIds: [scope.boardId] });
      expect(confirmed.candidates.map((row) => row.ticket_id)).not.toContain(ticketId);
      expect(confirmed.worklist.map((row) => row.ticket_id)).toContain(ticketId);

      expect(await setGhostUsageReviewDisposition(trx, TENANT, USER, review.review_id, 'dismissed')).toBe(true);

      const dismissed = await queryGhostUsageReport(trx, TENANT, { ...FILTERS, boardIds: [scope.boardId] });
      expect(dismissed.candidates.map((row) => row.ticket_id)).not.toContain(ticketId);
      expect(dismissed.worklist.map((row) => row.ticket_id)).not.toContain(ticketId);

      await upsertGhostUsageReview(trx, TENANT, {
        ticket_id: ticketId,
        ai_classification: 'unclear',
        ai_confidence: 0.22,
        ai_reason: 'Updated reason',
        ai_model: 'test-model-2',
      });

      const afterReupsert = await trx('ghost_usage_reviews')
        .where({ tenant: TENANT, ticket_id: ticketId })
        .first();
      expect(afterReupsert.ai_reason).toBe('Updated reason');
      expect(afterReupsert.disposition).toBe('dismissed');
    });
  });

  it('T043: classifiable selection skips every ticket with an existing review and honors limit', async () => {
    await inTx(async (trx) => {
      const scope = await makeScope(trx);
      const reviewedTicketId = await makeTicket(trx, scope);
      const unreviewedOlderId = await makeTicket(trx, scope);
      const unreviewedNewerId = await makeTicket(trx, scope, { closed_at: CLOSED_LATER });

      await upsertGhostUsageReview(trx, TENANT, {
        ticket_id: reviewedTicketId,
        ai_classification: 'no_hardware',
        ai_confidence: 0.8,
        ai_reason: 'No parts',
        ai_model: 'test-model',
      });

      const all = await selectClassifiableCandidates(trx, TENANT, { ...FILTERS, boardIds: [scope.boardId] }, 10);
      expect(all).toEqual([unreviewedNewerId, unreviewedOlderId]);
      expect(all).not.toContain(reviewedTicketId);

      const limited = await selectClassifiableCandidates(trx, TENANT, { ...FILTERS, boardIds: [scope.boardId] }, 1);
      expect(limited).toEqual([unreviewedNewerId]);
    });
  });
});

describe('ghost usage action and parsing contracts', () => {
  it('T039: getGhostUsageReport action enforces inventory:read in source', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../actions/ghostUsageActions.ts'), 'utf8');
    const start = source.indexOf('export const getGhostUsageReport');
    const end = source.indexOf('/** §17.6');
    const body = source.slice(start, end);
    expect(body).toMatch(/hasPermission\(\s*_user\s*,\s*['"]inventory['"]\s*,\s*['"]read['"]\s*\)/);
  });

  it('T041: parses tolerant first-object AI classification JSON', () => {
    expect(parseGhostClassification('before {"classification":"hardware_missing","confidence":87,"reason":"drive replaced"} after')).toEqual({
      classification: 'hardware_missing',
      confidence: 0.87,
      reason: 'drive replaced',
    });
    expect(parseGhostClassification('{"classification":"banana","confidence":1,"reason":"bad"}')).toBeNull();
    expect(parseGhostClassification('no json here')).toBeNull();
    expect(parseGhostClassification('```json\n{"classification":"unclear","confidence":0.42,"reason":"not enough detail"}\n```')).toEqual({
      classification: 'unclear',
      confidence: 0.42,
      reason: 'not enough detail',
    });
  });
});

describe.skipIf(!databaseConnection)('ghost usage AI settings', () => {
  it('defaults disabled, enables nested setting, and preserves unrelated settings', async () => {
    await inTx(async (trx) => {
      await trx('tenant_settings')
        .insert({
          tenant: TENANT,
          settings: null,
          updated_at: trx.fn.now(),
        })
        .onConflict('tenant')
        .merge({
          settings: null,
          updated_at: trx.fn.now(),
        });

      expect(await getGhostUsageAiSettings(trx, TENANT)).toEqual({ enabled: false });

      await trx('tenant_settings')
        .where({ tenant: TENANT })
        .update({
          settings: JSON.stringify({
            billing: { unrelated: true },
            inventory: { keepMe: 'yes' },
          }),
          updated_at: trx.fn.now(),
        });

      expect(await setGhostUsageAiEnabledSetting(trx, TENANT, true)).toEqual({ enabled: true });
      expect(await getGhostUsageAiSettings(trx, TENANT)).toEqual({ enabled: true });

      const row = await trx('tenant_settings')
        .where({ tenant: TENANT })
        .first<{ settings: Record<string, any> | string | null }>();
      const settings = typeof row?.settings === 'string' ? JSON.parse(row.settings) : row?.settings;
      expect(settings.billing.unrelated).toBe(true);
      expect(settings.inventory.keepMe).toBe('yes');
      expect(settings.inventory.ghostUsageAi.enabled).toBe(true);
    });
  });
});
