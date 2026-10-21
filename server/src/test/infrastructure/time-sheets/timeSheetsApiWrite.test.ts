import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { TestContext } from '../../../../test-utils/testContext';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import { TimeSheetService } from '../../../lib/api/services/TimeSheetService';
import {
  createTimeSheetSchema,
  updateTimeSheetSchema,
  submitTimeSheetSchema,
  approveTimeSheetSchema,
  requestChangesTimeSheetSchema,
  reverseApprovalSchema,
  bulkApproveTimeSheetSchema,
  createTimeSheetCommentSchema,
  timeSheetCommentResponseSchema,
  timeSheetSearchSchema,
  timeSheetExportQuerySchema,
  timeSheetResponseSchema,
  timeSheetWithDetailsResponseSchema,
} from '../../../lib/api/schemas/timeSheet';

// The REST write paths used to touch time_sheets columns that do not exist (created_at, updated_at,
// submission_notes, approval_notes, change_reason, reversal_reason, ...). These tests run each write
// against the real schema and read the row back.

// setupCommonMocks() owns the hasPermission mock; this flag drives its permissionCheck.
const rbac = { allow: true };
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishUnregisteredEventType: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishEvent: vi.fn(async () => undefined),
}));

/** What the HTTP client sees: Date objects become ISO strings, undefined keys disappear. */
const wire = (value: unknown) => JSON.parse(JSON.stringify(value));

// time_entries carries fields the time-entry response schema does not yet describe; that is a
// separate card. The time-sheet schemas are what this card asserts on.
const detailsSchema = timeSheetWithDetailsResponseSchema.omit({ time_entries: true, summary: true });

describe('TimeSheetService write paths (REST API, alga-2026-0002763)', () => {
  const context = new TestContext({
    cleanupTables: ['time_sheet_notes', 'time_sheet_comments', 'time_entries', 'time_sheets', 'time_periods'],
    runSeeds: true,
  });
  let service: TimeSheetService;
  let ctx: any;
  let periodId: string;

  const table = (name: string) => tenantDb(context.db, context.tenantId).table(name);
  const sheetRow = (id: string) => table('time_sheets').where({ id }).first();
  const notesFor = (id: string) => table('time_sheet_notes').where({ time_sheet_id: id }).orderBy('created_at', 'asc');
  const commentsFor = (id: string) => table('time_sheet_comments').where({ time_sheet_id: id }).orderBy('created_at', 'asc');

  const addPeriod = async (start: string, end: string) => {
    const id = uuidv4();
    await table('time_periods').insert({ period_id: id, tenant: context.tenantId, start_date: start, end_date: end });
    return id;
  };

  const addEntry = async (timeSheetId: string, day: string, minutes = 60) => {
    const id = uuidv4();
    await table('time_entries').insert({
      tenant: context.tenantId,
      entry_id: id,
      user_id: context.userId,
      time_sheet_id: timeSheetId,
      start_time: `${day}T09:00:00.000Z`,
      end_time: `${day}T10:00:00.000Z`,
      work_timezone: 'UTC',
      work_date: day,
      work_item_id: uuidv4(),
      work_item_type: 'ad_hoc',
      approval_status: 'DRAFT',
      billable_duration: minutes,
      notes: null,
    });
    return id;
  };

  const create = (body: Record<string, unknown>) => service.create(createTimeSheetSchema.parse(body), ctx);
  const submit = (id: string, body: Record<string, unknown> = {}) =>
    service.submitTimeSheet(id, submitTimeSheetSchema.parse(body), ctx);
  const approve = (id: string, body: Record<string, unknown> = {}) =>
    service.approveTimeSheet(id, approveTimeSheetSchema.parse(body), ctx);

  /** A DRAFT sheet for the test user with one entry, so it can be submitted. */
  const draftWithEntry = async (period = periodId) => {
    const sheet = await create({ period_id: period });
    await addEntry(sheet.id, '2026-11-03');
    return sheet;
  };

  beforeAll(async () => {
    await context.initialize();
  });

  afterAll(async () => {
    await context.cleanup();
  });

  beforeEach(async () => {
    await context.reset();
    rbac.allow = true;
    setupCommonMocks({ tenantId: context.tenantId, permissionCheck: () => rbac.allow });
    service = new TimeSheetService();
    vi.spyOn(service as any, 'getKnex').mockImplementation(async () => ({
      knex: context.db,
      tenant: context.tenantId,
    }));
    ctx = { tenant: context.tenantId, userId: context.userId, user: context.user };
    periodId = await addPeriod('2026-11-01', '2026-11-08');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('create', () => {
    it('inserts only real columns and returns a row the response schema accepts', async () => {
      const sheet = await create({ period_id: periodId });

      const row = await sheetRow(sheet.id);
      expect(row).toMatchObject({ period_id: periodId, user_id: context.userId, approval_status: 'DRAFT' });
      expect(row).not.toHaveProperty('created_at');
      expect(row).not.toHaveProperty('notes');

      const parsed = timeSheetResponseSchema.parse(wire(sheet));
      expect(parsed.id).toBe(sheet.id);
      expect(parsed).not.toHaveProperty('created_at');
    });

    it('rejects body fields the table cannot store at the schema boundary', () => {
      const parsed = createTimeSheetSchema.parse({ period_id: periodId, notes: 'dropped' });
      expect(parsed).not.toHaveProperty('notes');
    });
  });

  describe('update', () => {
    it('updates approval_status and returns the row', async () => {
      const sheet = await create({ period_id: periodId });

      const updated = await service.update(sheet.id, updateTimeSheetSchema.parse({ approval_status: 'SUBMITTED' }), ctx);

      expect(updated.approval_status).toBe('SUBMITTED');
      expect((await sheetRow(sheet.id)).approval_status).toBe('SUBMITTED');
      timeSheetResponseSchema.parse(wire(updated));
    });

    it('tolerates an empty body', async () => {
      const sheet = await create({ period_id: periodId });
      const updated = await service.update(sheet.id, updateTimeSheetSchema.parse({}), ctx);
      expect(updated.approval_status).toBe('DRAFT');
    });
  });

  describe('submit', () => {
    it('marks the sheet SUBMITTED and records the submission note in time_sheet_notes', async () => {
      const sheet = await draftWithEntry();

      const result = await submit(sheet.id, { submission_notes: 'Week 45, all client work' });

      const row = await sheetRow(sheet.id);
      expect(row.approval_status).toBe('SUBMITTED');
      expect(row.submitted_at).toBeInstanceOf(Date);
      expect(await notesFor(sheet.id)).toMatchObject([
        { kind: 'submission', note: 'Week 45, all client work', detail: null, created_by: context.userId },
      ]);
      timeSheetResponseSchema.parse(wire(result));
    });

    it('submits without a note and writes no notes row', async () => {
      const sheet = await draftWithEntry();
      await submit(sheet.id);
      expect(await notesFor(sheet.id)).toHaveLength(0);
      expect((await sheetRow(sheet.id)).approval_status).toBe('SUBMITTED');
    });

    it('refuses an empty sheet with 409', async () => {
      const sheet = await create({ period_id: periodId });
      await expect(submit(sheet.id)).rejects.toMatchObject({ statusCode: 409 });
    });
  });

  describe('approve', () => {
    it('approves the sheet and its entries and records the approval note', async () => {
      const sheet = await draftWithEntry();
      await submit(sheet.id);

      const result = await approve(sheet.id, { approval_notes: 'Looks good' });

      const row = await sheetRow(sheet.id);
      expect(row).toMatchObject({ approval_status: 'APPROVED', approved_by: context.userId });
      expect(row.approved_at).toBeInstanceOf(Date);
      const entries = await table('time_entries').where({ time_sheet_id: sheet.id });
      expect(entries.map((e: any) => e.approval_status)).toEqual(['APPROVED']);
      expect(await notesFor(sheet.id)).toMatchObject([{ kind: 'approval', note: 'Looks good' }]);
      timeSheetResponseSchema.parse(wire(result));
    });

    it('is forbidden without the approve permission', async () => {
      const sheet = await draftWithEntry();
      await submit(sheet.id);
      rbac.allow = false;
      await expect(approve(sheet.id)).rejects.toMatchObject({ statusCode: 403 });
      expect((await sheetRow(sheet.id)).approval_status).toBe('SUBMITTED');
    });

    it('bulk approve reports per-sheet results', async () => {
      const a = await draftWithEntry();
      const other = await addPeriod('2026-11-08', '2026-11-15');
      const b = await draftWithEntry(other);
      await submit(a.id);
      // b stays DRAFT: approving it must fail without aborting the batch

      const results = await service.bulkApprove(
        bulkApproveTimeSheetSchema.parse({ time_sheet_ids: [a.id, b.id], approval_notes: 'batch' }),
        ctx
      );

      expect(results.map((r) => [r.time_sheet_id, r.success])).toEqual([[a.id, true], [b.id, false]]);
      expect((await sheetRow(a.id)).approval_status).toBe('APPROVED');
      expect(await notesFor(a.id)).toMatchObject([{ kind: 'approval', note: 'batch' }]);
    });
  });

  describe('request changes', () => {
    it('moves the sheet to CHANGES_REQUESTED, records the reason and leaves a comment', async () => {
      const sheet = await draftWithEntry();
      await submit(sheet.id);

      const result = await service.requestChanges(
        sheet.id,
        requestChangesTimeSheetSchema.parse({ change_reason: 'Missing Tuesday', detailed_feedback: 'Add the on-site visit' }),
        ctx
      );

      expect((await sheetRow(sheet.id)).approval_status).toBe('CHANGES_REQUESTED');
      expect(await notesFor(sheet.id)).toMatchObject([
        { kind: 'request_changes', note: 'Missing Tuesday', detail: 'Add the on-site visit' },
      ]);
      const comments = await commentsFor(sheet.id);
      expect(comments).toHaveLength(1);
      expect(comments[0].comment).toContain('Missing Tuesday');
      expect(comments[0].is_approver).toBe(true);
      timeSheetResponseSchema.parse(wire(result));
    });
  });

  describe('reverse approval', () => {
    it('reopens the sheet and its entries, records the reversal and leaves a comment', async () => {
      const sheet = await draftWithEntry();
      await submit(sheet.id);
      await approve(sheet.id, { approval_notes: 'ok' });

      const result = await service.reverseApproval(
        sheet.id,
        reverseApprovalSchema.parse({ reversal_reason: 'Billed to wrong client' }),
        ctx
      );

      const row = await sheetRow(sheet.id);
      expect(row).toMatchObject({ approval_status: 'CHANGES_REQUESTED', approved_at: null, approved_by: null });
      const entries = await table('time_entries').where({ time_sheet_id: sheet.id });
      expect(entries.map((e: any) => e.approval_status)).toEqual(['CHANGES_REQUESTED']);
      expect((await notesFor(sheet.id)).map((n: any) => n.kind)).toEqual(['approval', 'reverse_approval']);
      expect((await commentsFor(sheet.id))[0].comment).toBe('Approval reversed: Billed to wrong client');
      timeSheetResponseSchema.parse(wire(result));
    });
  });

  describe('comments', () => {
    it('adds a comment with the real column names', async () => {
      const sheet = await create({ period_id: periodId });

      const comment = await service.addComment(sheet.id, createTimeSheetCommentSchema.parse({ comment: 'FYI' }), ctx);

      expect(await commentsFor(sheet.id)).toMatchObject([{ comment: 'FYI', user_id: context.userId, is_approver: true }]);
      const parsed = timeSheetCommentResponseSchema.parse(wire(comment));
      expect(parsed.comment).toBe('FYI');
      expect(parsed.user?.user_id).toBe(context.userId);
    });
  });

  describe('getWithDetails', () => {
    it('returns the notes history, comments and a body the details schema accepts', async () => {
      const sheet = await draftWithEntry();
      await submit(sheet.id, { submission_notes: 'first' });
      await service.requestChanges(sheet.id, requestChangesTimeSheetSchema.parse({ change_reason: 'fix it' }), ctx);

      const details = await service.getWithDetails(sheet.id, ctx);
      const parsed = detailsSchema.parse(wire(details));

      expect(parsed.notes?.map((n) => [n.kind, n.note])).toEqual([
        ['request_changes', 'fix it'],
        ['submission', 'first'],
      ]);
      expect(parsed.comments).toHaveLength(1);
      expect(parsed.time_period?.period_id).toBe(periodId);
      expect(parsed).not.toHaveProperty('created_at');
    });
  });

  describe('list / search / export', () => {
    // list()'s default sort and computed-hours select are the sibling card (GET /api/v1/time-sheets 500).
    it('getById rows satisfy the response schema with API-shaped period dates', async () => {
      const sheet = await draftWithEntry();
      const parsed = timeSheetResponseSchema.parse(wire(await service.getById(sheet.id, ctx)));
      expect(parsed.id).toBe(sheet.id);
      expect(parsed.period_start).toBe('2026-11-01');
      expect(parsed.period_end).toBe('2026-11-08');
      expect(parsed.user_name).toBeTruthy();
    });

    it('search matches on the notes history and the submitter name without touching a notes column', async () => {
      const sheet = await draftWithEntry();
      await submit(sheet.id, { submission_notes: 'zebra crossing audit' });
      const other = await addPeriod('2026-11-08', '2026-11-15');
      await create({ period_id: other });

      const byNote = await service.search(timeSheetSearchSchema.parse({ query: 'zebra' }), ctx);
      expect(byNote.map((r: any) => r.id)).toEqual([sheet.id]);

      const byName = await service.search(timeSheetSearchSchema.parse({ query: context.user.first_name, fields: ['user_name'] }), ctx);
      expect(byName).toHaveLength(2);

      const none = await service.search(timeSheetSearchSchema.parse({ query: 'no-such-text' }), ctx);
      expect(none).toHaveLength(0);
    });

    it('export honours filters and is not capped at 25 rows', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 27; i += 1) {
        const day = String(i + 1).padStart(2, '0');
        const period = i === 0 ? periodId : await addPeriod(`2027-01-${day}`, `2027-01-${String(i + 2).padStart(2, '0')}`);
        const sheet = await create({ period_id: period });
        ids.push(sheet.id);
      }
      await addEntry(ids[0], '2026-11-03');
      await submit(ids[0]);

      const all = await service.exportTimeSheets(timeSheetExportQuerySchema.parse({}), ctx);
      expect(all).toHaveLength(27);
      const first = timeSheetResponseSchema.parse(wire(all.find((r: any) => r.id === ids[0])));
      expect(first.total_hours).toBe(1);
      expect(first.billable_hours).toBe(1);
      expect(first.entry_count).toBe(1);
      expect(timeSheetResponseSchema.parse(wire(all.find((r: any) => r.id === ids[1]))).entry_count).toBe(0);

      const submitted = await service.exportTimeSheets(
        timeSheetExportQuerySchema.parse({ approval_statuses: ['SUBMITTED'] } as any),
        ctx
      );
      expect(submitted.map((r: any) => r.id)).toEqual([ids[0]]);

      const janOnly = await service.exportTimeSheets(
        timeSheetExportQuerySchema.parse({ date_from: '2027-01-01T00:00:00Z' } as any),
        ctx
      );
      expect(janOnly).toHaveLength(26);

      const withEntries = await service.exportTimeSheets(
        timeSheetExportQuerySchema.parse({ include_time_entries: 'true', user_ids: [context.userId] } as any),
        ctx
      );
      expect(withEntries.find((r: any) => r.id === ids[0]).time_entries).toHaveLength(1);
    });
  });
});
