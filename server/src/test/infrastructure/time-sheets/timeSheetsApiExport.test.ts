import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'node:crypto';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { NextRequest } from 'next/server';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../test-utils/dbConfig';
import { createUser } from '../../../../test-utils/testDataFactory';
import { ApiTimeSheetController } from '../../../lib/api/controllers/ApiTimeSheetController';

// GET /api/v1/time-sheets/export used to build its query object with Object.fromEntries(searchParams):
// one string per key, last repeated value wins. Every z.array filter (approval_statuses, user_ids,
// period_ids, fields) therefore failed with 400 "Expected array, received string", and a repeated
// `fields=` projection was silently truncated. Service-level tests cannot see this — it lives in the
// controller — so these tests drive real NextRequests through ApiTimeSheetController.export().
//
// Everything downstream is real: the committed test database (no wrapping transaction, so the
// controller's own connection pools see the fixture), API-key validation, the API user lookup, the
// product gate, and database-backed RBAC on the seeded Admin role. Only the Redis-backed event-bus
// publishers are mocked.

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

type Status = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED';

interface Sheet {
  id: string;
  user_id: string;
  period_id: string;
  approval_status: Status;
}

const EXPORT_URL = 'https://example.test/api/v1/time-sheets/export';
const SEARCH_URL = 'https://example.test/api/v1/time-sheets/search';
const APPROVED_SHEETS_FOR_KEY_OWNER = 28; // > the 25-row page size list() defaults to

describe('GET /api/v1/time-sheets/export query filters (REST API, alga-2026-0002763)', () => {
  let db: Knex;
  let tenantId: string;
  let keyOwnerId: string;
  let otherUserId: string;
  let apiKey: string;
  let controller: ApiTimeSheetController;

  const periodIds: string[] = [];
  const sheets: Sheet[] = [];

  const table = (name: string) => tenantDb(db, tenantId).table(name);

  const addPeriod = async (start: Date) => {
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    const id = uuidv4();
    await table('time_periods').insert({
      period_id: id,
      tenant: tenantId,
      start_date: start.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10),
    });
    periodIds.push(id);
    return id;
  };

  const addSheet = async (user_id: string, period_id: string, approval_status: Status) => {
    const id = uuidv4();
    await table('time_sheets').insert({ tenant: tenantId, id, user_id, period_id, approval_status });
    const sheet = { id, user_id, period_id, approval_status };
    sheets.push(sheet);
    return sheet;
  };

  /** Fixture rows matching a predicate, as the set of ids the export must return. */
  const idsWhere = (predicate: (sheet: Sheet) => boolean) =>
    new Set(sheets.filter(predicate).map((sheet) => sheet.id));

  const request = (url: string, query: string, headers: Record<string, string> = { 'x-api-key': apiKey }) =>
    new NextRequest(`${url}?${query}`, { headers });

  const exportRows = async (query: string): Promise<any[]> => {
    const response = await controller.export()(request(EXPORT_URL, query));
    expect(response.status).toBe(200);
    const body = await response.json();
    return body.data;
  };

  const exportIds = async (query: string) => new Set((await exportRows(query)).map((row: any) => row.id));

  const expectValidationError = async (query: string) => {
    const response = await controller.export()(request(EXPORT_URL, query));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    return body;
  };

  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection();

    // The seeded MSP Admin role carries time_sheet:read; the key owner gets it so RBAC stays real.
    const adminRole = await db('roles').where({ role_name: 'Admin', msp: true }).first();
    if (!adminRole) throw new Error('seeded MSP Admin role not found');
    tenantId = adminRole.tenant;

    keyOwnerId = await createUser(db, tenantId, { first_name: 'Export', last_name: 'KeyOwner' });
    otherUserId = await createUser(db, tenantId, { first_name: 'Export', last_name: 'Other' });
    await table('user_roles').insert({ tenant: tenantId, user_id: keyOwnerId, role_id: adminRole.role_id });

    apiKey = crypto.randomBytes(24).toString('hex');
    await table('api_keys').insert({
      api_key_id: uuidv4(),
      tenant: tenantId,
      user_id: keyOwnerId,
      api_key: crypto.createHash('sha256').update(apiKey).digest('hex'),
      description: 'time-sheet export regression test',
      active: true,
    });

    // 30 weekly periods. Key owner: p0 DRAFT, p1 SUBMITTED, p2..p29 APPROVED (28 rows, > one page).
    // Other user: p0 APPROVED, p1 DRAFT — rows every single-user / single-period filter must exclude.
    const firstStart = new Date('2027-01-04T00:00:00.000Z');
    for (let week = 0; week < 30; week += 1) {
      const start = new Date(firstStart);
      start.setUTCDate(start.getUTCDate() + week * 7);
      await addPeriod(start);
    }
    await addSheet(keyOwnerId, periodIds[0], 'DRAFT');
    await addSheet(keyOwnerId, periodIds[1], 'SUBMITTED');
    for (const periodId of periodIds.slice(2)) {
      await addSheet(keyOwnerId, periodId, 'APPROVED');
    }
    await addSheet(otherUserId, periodIds[0], 'APPROVED');
    await addSheet(otherUserId, periodIds[1], 'DRAFT');

    controller = new ApiTimeSheetController();
  }, 300_000);

  afterAll(async () => {
    if (!db) return;
    try {
      await table('time_sheets').whereIn('id', sheets.map((sheet) => sheet.id)).delete();
      await table('time_periods').whereIn('period_id', periodIds).delete();
      await table('api_keys').where({ user_id: keyOwnerId }).delete();
      await table('user_roles').whereIn('user_id', [keyOwnerId, otherUserId]).delete();
      await table('users').whereIn('user_id', [keyOwnerId, otherUserId]).delete();
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });

  it('rejects a request without an API key (the auth path under test is real)', async () => {
    const response = await controller.export()(request(EXPORT_URL, 'format=json', {}));
    expect(response.status).toBe(401);
  });

  it('returns every matching row, not the first page of 25', async () => {
    // The dev seeds give this tenant time sheets of their own, so the unfiltered export is a
    // superset of the fixture; scoping to the two fixture users pins the exact set.
    const unfiltered = await exportIds('format=json');
    for (const id of idsWhere(() => true)) expect(unfiltered.has(id)).toBe(true);
    expect(unfiltered.size).toBeGreaterThan(25);

    const fixtureOnly = await exportIds(`format=json&user_ids=${keyOwnerId},${otherUserId}`);
    expect(fixtureOnly).toEqual(idsWhere(() => true));
    expect(fixtureOnly.size).toBe(APPROVED_SHEETS_FOR_KEY_OWNER + 4);
  });

  describe('approval_statuses', () => {
    it('keeps only the requested status and still returns more than 25 rows', async () => {
      const rows = await exportRows('format=json&approval_statuses=APPROVED');
      expect(new Set(rows.map((row) => row.id))).toEqual(idsWhere((sheet) => sheet.approval_status === 'APPROVED'));
      expect(rows.length).toBe(APPROVED_SHEETS_FOR_KEY_OWNER + 1);
      expect(rows.length).toBeGreaterThan(25);
      expect(rows.every((row) => row.approval_status === 'APPROVED')).toBe(true);
    });

    it('accepts a comma-separated list and a repeated key as the same union', async () => {
      const expected = idsWhere((sheet) => sheet.approval_status === 'DRAFT' || sheet.approval_status === 'SUBMITTED');
      expect(expected.size).toBe(3);
      const users = `user_ids=${keyOwnerId},${otherUserId}`;
      expect(await exportIds(`format=json&${users}&approval_statuses=DRAFT,SUBMITTED`)).toEqual(expected);
      expect(await exportIds(`format=json&${users}&approval_statuses=DRAFT&approval_statuses=SUBMITTED`)).toEqual(expected);
    });

    it('still rejects a value outside the enum', async () => {
      const body = await expectValidationError('format=json&approval_statuses=BOGUS');
      expect(JSON.stringify(body.error.details)).toContain('approval_statuses');
    });
  });

  describe('user_ids', () => {
    it("returns only the named user's sheets", async () => {
      const ids = await exportIds(`format=json&user_ids=${otherUserId}`);
      expect(ids).toEqual(idsWhere((sheet) => sheet.user_id === otherUserId));
      expect(ids.size).toBe(2);
    });

    it('combines with approval_statuses and keeps every one of the 28 approved rows', async () => {
      const rows = await exportRows(`format=json&user_ids=${keyOwnerId}&approval_statuses=APPROVED`);
      expect(rows.length).toBe(APPROVED_SHEETS_FOR_KEY_OWNER);
      expect(rows.every((row) => row.user_id === keyOwnerId && row.approval_status === 'APPROVED')).toBe(true);
    });

    it('still rejects a non-UUID member', async () => {
      await expectValidationError('format=json&user_ids=not-a-uuid');
    });
  });

  describe('period_ids', () => {
    it('returns only sheets in the named periods, across users', async () => {
      const ids = await exportIds(`format=json&period_ids=${periodIds[0]}`);
      expect(ids).toEqual(idsWhere((sheet) => sheet.period_id === periodIds[0]));
      expect(ids.size).toBe(2);

      const two = await exportIds(`format=json&period_ids=${periodIds[0]},${periodIds[1]}`);
      expect(two).toEqual(idsWhere((sheet) => sheet.period_id === periodIds[0] || sheet.period_id === periodIds[1]));
      expect(two.size).toBe(4);
    });

    it('still rejects a non-UUID member', async () => {
      await expectValidationError(`format=json&period_ids=${periodIds[0]},abc`);
    });
  });

  describe('fields projection', () => {
    it('projects exactly the repeated fields', async () => {
      const rows = await exportRows(`format=json&user_ids=${otherUserId}&fields=id&fields=approval_status`);
      expect(rows.length).toBe(2);
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual(['approval_status', 'id']);
      }
    });

    it('treats a comma-separated fields list the same way', async () => {
      const rows = await exportRows(`format=json&user_ids=${otherUserId}&fields=id,approval_status`);
      expect(rows.length).toBe(2);
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual(['approval_status', 'id']);
      }
    });

    it('writes only the projected columns to CSV', async () => {
      const response = await controller.export()(
        request(EXPORT_URL, `format=csv&user_ids=${otherUserId}&fields=id,approval_status`)
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/csv');
      const lines = (await response.text()).split('\n');
      expect(lines[0]).toBe('id,approval_status');
      expect(lines.length).toBe(3);
      const exported = new Set(lines.slice(1).map((line) => line.split(',')[0]));
      expect(exported).toEqual(idsWhere((sheet) => sheet.user_id === otherUserId));
    });
  });

  describe('search() shares the normalizer', () => {
    it('accepts array filters on the search controller too', async () => {
      const response = await controller.search()(
        request(SEARCH_URL, `query=KeyOwner&fields=user_name&approval_statuses=APPROVED&user_ids=${keyOwnerId}&limit=100`)
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.length).toBe(APPROVED_SHEETS_FOR_KEY_OWNER);
      expect(body.data.every((row: any) => row.approval_status === 'APPROVED')).toBe(true);
    });
  });
});
