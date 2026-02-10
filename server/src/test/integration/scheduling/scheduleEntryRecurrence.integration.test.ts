import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { TestContext } from '../../../../test-utils/testContext';
import { ScheduleEntry } from '@alga-psa/scheduling';
import { IEditScope } from '@alga-psa/types';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 240_000;

/** JSONB columns are already parsed by PostgreSQL; plain JSON columns are strings. */
function parsePattern(val: unknown): Record<string, unknown> {
  if (typeof val === 'string') return JSON.parse(val);
  return val as Record<string, unknown>;
}

describe('Schedule entry recurrence integration', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: [
        'schedule_entry_assignees',
        'schedule_entries',
      ],
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    await ctx.db('schedule_entry_assignees').where({ tenant: ctx.tenantId }).del();
    await ctx.db('schedule_entries').where({ tenant: ctx.tenantId }).del();
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    vi.restoreAllMocks();
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  // ── Helper ───────────────────────────────────────────────────────────────

  async function createRecurringEntry(overrides: Record<string, unknown> = {}) {
    const entryId = uuidv4();
    const defaults = {
      entry_id: entryId,
      tenant: ctx.tenantId,
      title: 'Daily standup',
      scheduled_start: new Date('2024-06-01T09:00:00Z'),
      scheduled_end: new Date('2024-06-01T09:30:00Z'),
      status: 'scheduled',
      work_item_type: 'ad_hoc',
      is_recurring: true,
      is_private: false,
      recurrence_pattern: JSON.stringify({
        frequency: 'daily',
        interval: 1,
        startDate: '2024-06-01T00:00:00.000Z',
        endDate: '2024-06-14T23:59:59.000Z',
        exceptions: [],
      }),
    };

    const data = { ...defaults, ...overrides, entry_id: overrides.entry_id || entryId };
    await ctx.db('schedule_entries').insert(data);

    // Add assignee
    await ctx.db('schedule_entry_assignees').insert({
      tenant: ctx.tenantId,
      entry_id: data.entry_id,
      user_id: ctx.userId,
    });

    return data;
  }

  // ── getAll: virtual recurring instances ──────────────────────────────────

  describe('getAll() with recurring entries', () => {
    it('returns virtual instances for a daily recurring entry within the date range', async () => {
      await createRecurringEntry();

      const start = new Date('2024-06-01T00:00:00Z');
      const end = new Date('2024-06-07T23:59:59Z');

      const entries = await ScheduleEntry.getAll(ctx.db, ctx.tenantId, start, end);

      // Recurring masters are excluded from getAll — only virtual instances appear.
      // One virtual instance per day from June 1–7 (7 days).
      const virtualEntries = entries.filter(e => e.entry_id.includes('_'));

      expect(entries.length).toBe(virtualEntries.length); // no master entry in results
      expect(virtualEntries.length).toBeGreaterThanOrEqual(6);

      // Virtual entries should have composite IDs
      for (const ve of virtualEntries) {
        expect(ve.entry_id).toMatch(/^[0-9a-f-]+_\d+$/);
        expect(ve.is_recurring).toBe(true);
        expect(ve.original_entry_id).toBeDefined();
      }
    });

    it('respects recurrence end date and does not generate instances beyond it', async () => {
      await createRecurringEntry({
        recurrence_pattern: JSON.stringify({
          frequency: 'daily',
          interval: 1,
          startDate: '2024-06-01T00:00:00.000Z',
          endDate: '2024-06-03T23:59:59.000Z',
          exceptions: [],
        }),
      });

      // Query a wider range than the recurrence end date
      const start = new Date('2024-06-01T00:00:00Z');
      const end = new Date('2024-06-10T23:59:59Z');

      const entries = await ScheduleEntry.getAll(ctx.db, ctx.tenantId, start, end);
      const virtualEntries = entries.filter(e => e.entry_id.includes('_'));

      // Should only have instances up to June 3
      for (const ve of virtualEntries) {
        const scheduledStart = new Date(ve.scheduled_start);
        expect(scheduledStart.getTime()).toBeLessThanOrEqual(new Date('2024-06-03T23:59:59Z').getTime());
      }
    });

    it('carries user assignments to virtual instances', async () => {
      await createRecurringEntry();

      const start = new Date('2024-06-01T00:00:00Z');
      const end = new Date('2024-06-03T23:59:59Z');

      const entries = await ScheduleEntry.getAll(ctx.db, ctx.tenantId, start, end);
      const virtualEntries = entries.filter(e => e.entry_id.includes('_'));

      expect(virtualEntries.length).toBeGreaterThan(0);
      for (const ve of virtualEntries) {
        expect(ve.assigned_user_ids).toContain(ctx.userId);
      }
    });

    it('includes non-recurring entries alongside virtual instances', async () => {
      // Create a regular (non-recurring) entry
      const regularId = uuidv4();
      await ctx.db('schedule_entries').insert({
        entry_id: regularId,
        tenant: ctx.tenantId,
        title: 'One-off meeting',
        scheduled_start: new Date('2024-06-02T14:00:00Z'),
        scheduled_end: new Date('2024-06-02T15:00:00Z'),
        status: 'scheduled',
        work_item_type: 'ad_hoc',
        is_recurring: false,
        is_private: false,
      });
      await ctx.db('schedule_entry_assignees').insert({
        tenant: ctx.tenantId,
        entry_id: regularId,
        user_id: ctx.userId,
      });

      // Create a recurring entry
      await createRecurringEntry();

      const start = new Date('2024-06-01T00:00:00Z');
      const end = new Date('2024-06-03T23:59:59Z');

      const entries = await ScheduleEntry.getAll(ctx.db, ctx.tenantId, start, end);

      const regularEntries = entries.filter(e => e.title === 'One-off meeting');
      const recurringEntries = entries.filter(e => e.title === 'Daily standup');

      expect(regularEntries.length).toBe(1);
      expect(regularEntries[0].entry_id).toBe(regularId);
      expect(recurringEntries.length).toBeGreaterThan(0); // virtual instances only (no master)
    });

    it('does not include virtual instances for entries outside the date range', async () => {
      await createRecurringEntry();

      // Query a range entirely after the recurrence end date
      const start = new Date('2024-07-01T00:00:00Z');
      const end = new Date('2024-07-31T23:59:59Z');

      const entries = await ScheduleEntry.getAll(ctx.db, ctx.tenantId, start, end);
      expect(entries.length).toBe(0);
    });
  });

  // ── Weekly recurrence ───────────────────────────────────────────────────

  describe('weekly recurrence', () => {
    it('generates instances only on specified days of the week', async () => {
      await createRecurringEntry({
        recurrence_pattern: JSON.stringify({
          frequency: 'weekly',
          interval: 1,
          startDate: '2024-06-03T00:00:00.000Z', // Monday
          endDate: '2024-06-21T23:59:59.000Z',
          daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
          exceptions: [],
        }),
        scheduled_start: new Date('2024-06-03T09:00:00Z'),
        scheduled_end: new Date('2024-06-03T09:30:00Z'),
      });

      const start = new Date('2024-06-01T00:00:00Z');
      const end = new Date('2024-06-22T23:59:59Z');

      const entries = await ScheduleEntry.getAll(ctx.db, ctx.tenantId, start, end);
      const virtualEntries = entries.filter(e => e.entry_id.includes('_'));

      // Verify instances are generated on consistent days (RRule uses local time internally,
      // so we check local day-of-week rather than UTC)
      const daysSet = new Set<number>();
      for (const ve of virtualEntries) {
        daysSet.add(new Date(ve.scheduled_start).getDay());
      }
      // Should land on exactly 3 distinct weekdays
      expect(daysSet.size).toBe(3);

      // Should have approximately 9 instances (3 weeks × 3 days)
      expect(virtualEntries.length).toBeGreaterThanOrEqual(8);
    });
  });

  // ── delete with SINGLE scope (virtual instance) ─────────────────────────

  describe('delete() with SINGLE scope on a virtual instance', () => {
    it('adds exception date to master and excludes that occurrence from getAll', async () => {
      const entry = await createRecurringEntry();

      // First, get all entries to find a virtual instance ID
      const start = new Date('2024-06-01T00:00:00Z');
      const end = new Date('2024-06-07T23:59:59Z');

      const entriesBefore = await ScheduleEntry.getAll(ctx.db, ctx.tenantId, start, end);
      const virtualsBefore = entriesBefore.filter(e => e.entry_id.includes('_'));
      expect(virtualsBefore.length).toBeGreaterThan(0);

      // Pick the second virtual instance to delete
      const targetVirtual = virtualsBefore[1];
      const targetDate = new Date(targetVirtual.scheduled_start);

      // Delete the single virtual instance
      const result = await ScheduleEntry.delete(ctx.db, ctx.tenantId, targetVirtual.entry_id, IEditScope.SINGLE);
      expect(result).toBe(true);

      // Verify the exception was added to the master's recurrence_pattern
      const masterAfter = await ctx.db('schedule_entries')
        .where({ entry_id: entry.entry_id, tenant: ctx.tenantId })
        .first();

      expect(masterAfter).toBeDefined();
      const pattern = parsePattern(masterAfter.recurrence_pattern);
      expect(pattern.exceptions.length).toBe(1);

      // Verify getAll no longer returns that occurrence
      const entriesAfter = await ScheduleEntry.getAll(ctx.db, ctx.tenantId, start, end);
      const virtualsAfter = entriesAfter.filter(e => e.entry_id.includes('_'));

      expect(virtualsAfter.length).toBe(virtualsBefore.length - 1);

      // The deleted occurrence's date should not appear
      const afterDates = virtualsAfter.map(e => new Date(e.scheduled_start).toISOString().slice(0, 10));
      const targetDateStr = targetDate.toISOString().slice(0, 10);
      expect(afterDates).not.toContain(targetDateStr);
    });
  });

  // ── delete with SINGLE scope (master entry) ─────────────────────────────

  describe('delete() with SINGLE scope on a master entry', () => {
    it('creates a new master from the next occurrence and deletes the original', async () => {
      const entry = await createRecurringEntry();
      const originalEntryId = entry.entry_id as string;

      // Delete the master with SINGLE scope (removes the first occurrence, shifts master)
      const result = await ScheduleEntry.delete(ctx.db, ctx.tenantId, originalEntryId, IEditScope.SINGLE);
      expect(result).toBe(true);

      // Original master should be gone
      const originalMaster = await ctx.db('schedule_entries')
        .where({ entry_id: originalEntryId, tenant: ctx.tenantId })
        .first();
      expect(originalMaster).toBeUndefined();

      // A new master should have been created
      const newMasters = await ctx.db('schedule_entries')
        .where({ tenant: ctx.tenantId, is_recurring: true })
        .select('*');

      expect(newMasters.length).toBe(1);
      const newMaster = newMasters[0];
      expect(newMaster.entry_id).not.toBe(originalEntryId);
      expect(newMaster.title).toBe('Daily standup');

      // New master's start should be after the original
      expect(new Date(newMaster.scheduled_start).getTime()).toBeGreaterThan(
        new Date(entry.scheduled_start as Date).getTime()
      );

      // New master should have the original's first date as an exception
      const newPattern = parsePattern(newMaster.recurrence_pattern);
      expect(newPattern.exceptions.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── delete with FUTURE scope (virtual instance) ─────────────────────────

  describe('delete() with FUTURE scope on a virtual instance', () => {
    it('truncates the series end date to before the target instance', async () => {
      const entry = await createRecurringEntry();

      const start = new Date('2024-06-01T00:00:00Z');
      const end = new Date('2024-06-14T23:59:59Z');

      const entriesBefore = await ScheduleEntry.getAll(ctx.db, ctx.tenantId, start, end);
      const virtualsBefore = entriesBefore.filter(e => e.entry_id.includes('_'));

      // Pick a virtual instance in the middle of the series (e.g. around June 7)
      const midIndex = Math.floor(virtualsBefore.length / 2);
      const targetVirtual = virtualsBefore[midIndex];
      const targetDate = new Date(targetVirtual.scheduled_start);

      // Delete FUTURE from that point
      const result = await ScheduleEntry.delete(ctx.db, ctx.tenantId, targetVirtual.entry_id, IEditScope.FUTURE);
      expect(result).toBe(true);

      // Verify the master's pattern now has an endDate before the target
      const masterAfter = await ctx.db('schedule_entries')
        .where({ entry_id: entry.entry_id, tenant: ctx.tenantId })
        .first();

      const pattern = parsePattern(masterAfter.recurrence_pattern);
      const newEndDate = new Date(pattern.endDate);
      expect(newEndDate.getTime()).toBeLessThan(targetDate.getTime());

      // Verify getAll no longer returns instances at or after the target date
      const entriesAfter = await ScheduleEntry.getAll(ctx.db, ctx.tenantId, start, end);
      const virtualsAfter = entriesAfter.filter(e => e.entry_id.includes('_'));

      for (const ve of virtualsAfter) {
        expect(new Date(ve.scheduled_start).getTime()).toBeLessThan(targetDate.getTime());
      }

      expect(virtualsAfter.length).toBeLessThan(virtualsBefore.length);
    });
  });

  // ── delete with ALL scope ───────────────────────────────────────────────

  describe('delete() with ALL scope', () => {
    it('deletes the master entry and all virtual instances disappear', async () => {
      const entry = await createRecurringEntry();

      const start = new Date('2024-06-01T00:00:00Z');
      const end = new Date('2024-06-14T23:59:59Z');

      // Verify entries exist before
      const entriesBefore = await ScheduleEntry.getAll(ctx.db, ctx.tenantId, start, end);
      expect(entriesBefore.length).toBeGreaterThan(0);

      // Delete ALL
      const result = await ScheduleEntry.delete(ctx.db, ctx.tenantId, entry.entry_id as string, IEditScope.ALL);
      expect(result).toBe(true);

      // Master should be gone from DB
      const masterAfter = await ctx.db('schedule_entries')
        .where({ entry_id: entry.entry_id, tenant: ctx.tenantId })
        .first();
      expect(masterAfter).toBeUndefined();

      // Assignees should be gone
      const assigneesAfter = await ctx.db('schedule_entry_assignees')
        .where({ entry_id: entry.entry_id, tenant: ctx.tenantId })
        .select('*');
      expect(assigneesAfter.length).toBe(0);

      // getAll should return nothing
      const entriesAfter = await ScheduleEntry.getAll(ctx.db, ctx.tenantId, start, end);
      expect(entriesAfter.length).toBe(0);
    });
  });

  // ── update with SINGLE scope ──────────────────────────────────────────

  describe('update() with SINGLE scope', () => {
    it('creates a standalone entry and adds exception to master', async () => {
      const entry = await createRecurringEntry();

      const start = new Date('2024-06-01T00:00:00Z');
      const end = new Date('2024-06-07T23:59:59Z');

      const entriesBefore = await ScheduleEntry.getAll(ctx.db, ctx.tenantId, start, end);
      const virtualsBefore = entriesBefore.filter(e => e.entry_id.includes('_'));
      expect(virtualsBefore.length).toBeGreaterThan(0);

      const targetVirtual = virtualsBefore[1];
      const targetDate = new Date(targetVirtual.scheduled_start);

      // Update single instance with new title
      const updated = await ScheduleEntry.update(
        ctx.db,
        ctx.tenantId,
        targetVirtual.entry_id,
        {
          title: 'Special standup',
          scheduled_start: targetDate,
          scheduled_end: new Date(targetDate.getTime() + 30 * 60 * 1000),
        },
        IEditScope.SINGLE
      );

      expect(updated).toBeDefined();
      expect(updated!.title).toBe('Special standup');
      expect(updated!.is_recurring).toBe(false);

      // Verify a standalone entry was created in the DB
      const standaloneEntry = await ctx.db('schedule_entries')
        .where({ entry_id: updated!.entry_id, tenant: ctx.tenantId })
        .first();
      expect(standaloneEntry).toBeDefined();
      expect(standaloneEntry.title).toBe('Special standup');
      expect(standaloneEntry.is_recurring).toBe(false);

      // Verify exception was added to master
      const masterAfter = await ctx.db('schedule_entries')
        .where({ entry_id: entry.entry_id, tenant: ctx.tenantId })
        .first();
      const pattern = parsePattern(masterAfter.recurrence_pattern);
      expect(pattern.exceptions.length).toBe(1);

      // getAll should include the standalone entry and exclude the old virtual instance
      const entriesAfter = await ScheduleEntry.getAll(ctx.db, ctx.tenantId, start, end);
      const standalone = entriesAfter.find(e => e.entry_id === updated!.entry_id);
      expect(standalone).toBeDefined();
      expect(standalone!.title).toBe('Special standup');

      // The virtual instance for that date should no longer appear
      const virtualsAfter = entriesAfter.filter(e => e.entry_id.includes('_'));
      const virtualDates = virtualsAfter.map(e => new Date(e.scheduled_start).toISOString().slice(0, 10));
      const targetDateStr = targetDate.toISOString().slice(0, 10);
      expect(virtualDates).not.toContain(targetDateStr);
    });

    it('copies assignments from master to standalone entry', async () => {
      await createRecurringEntry();

      const start = new Date('2024-06-01T00:00:00Z');
      const end = new Date('2024-06-05T23:59:59Z');
      const entries = await ScheduleEntry.getAll(ctx.db, ctx.tenantId, start, end);
      const virtuals = entries.filter(e => e.entry_id.includes('_'));
      const target = virtuals[0];

      const updated = await ScheduleEntry.update(
        ctx.db,
        ctx.tenantId,
        target.entry_id,
        { title: 'Modified' },
        IEditScope.SINGLE
      );

      // Check the assignee was copied
      const assignees = await ctx.db('schedule_entry_assignees')
        .where({ entry_id: updated!.entry_id, tenant: ctx.tenantId })
        .select('user_id');
      expect(assignees.length).toBe(1);
      expect(assignees[0].user_id).toBe(ctx.userId);
    });
  });

  // ── update with FUTURE scope ──────────────────────────────────────────

  describe('update() with FUTURE scope', () => {
    it('splits the series into two: original truncated, new master created', async () => {
      const entry = await createRecurringEntry();

      const start = new Date('2024-06-01T00:00:00Z');
      const end = new Date('2024-06-14T23:59:59Z');

      const entriesBefore = await ScheduleEntry.getAll(ctx.db, ctx.tenantId, start, end);
      const virtualsBefore = entriesBefore.filter(e => e.entry_id.includes('_'));

      // Pick a virtual instance in the middle
      const midIndex = Math.floor(virtualsBefore.length / 2);
      const targetVirtual = virtualsBefore[midIndex];

      // Update FUTURE with new title
      const updated = await ScheduleEntry.update(
        ctx.db,
        ctx.tenantId,
        targetVirtual.entry_id,
        { title: 'Renamed standup' },
        IEditScope.FUTURE
      );

      expect(updated).toBeDefined();
      expect(updated!.title).toBe('Renamed standup');
      expect(updated!.is_recurring).toBe(true);

      // Verify original master was truncated
      const originalMaster = await ctx.db('schedule_entries')
        .where({ entry_id: entry.entry_id, tenant: ctx.tenantId })
        .first();
      const originalPattern = parsePattern(originalMaster.recurrence_pattern);
      const originalEnd = new Date(originalPattern.endDate);
      const targetDate = new Date(targetVirtual.scheduled_start);
      expect(originalEnd.getTime()).toBeLessThan(targetDate.getTime());

      // Verify new master was created
      const newMaster = await ctx.db('schedule_entries')
        .where({ entry_id: updated!.entry_id, tenant: ctx.tenantId })
        .first();
      expect(newMaster).toBeDefined();
      expect(newMaster.title).toBe('Renamed standup');
      expect(newMaster.is_recurring).toBe(true);

      // We now have 2 recurring masters in the DB
      const allMasters = await ctx.db('schedule_entries')
        .where({ tenant: ctx.tenantId, is_recurring: true })
        .select('*');
      expect(allMasters.length).toBe(2);

      // getAll should show entries from both series
      const entriesAfter = await ScheduleEntry.getAll(ctx.db, ctx.tenantId, start, end);
      const oldTitle = entriesAfter.filter(e => e.title === 'Daily standup');
      const newTitle = entriesAfter.filter(e => e.title === 'Renamed standup');

      expect(oldTitle.length).toBeGreaterThan(0);
      expect(newTitle.length).toBeGreaterThan(0);
    });
  });

  // ── update with ALL scope ─────────────────────────────────────────────

  describe('update() with ALL scope', () => {
    it('updates the master entry and preserves existing exceptions', async () => {
      const entry = await createRecurringEntry();

      // First, add an exception by deleting a single instance
      const start = new Date('2024-06-01T00:00:00Z');
      const end = new Date('2024-06-07T23:59:59Z');

      const entries = await ScheduleEntry.getAll(ctx.db, ctx.tenantId, start, end);
      const virtuals = entries.filter(e => e.entry_id.includes('_'));
      const target = virtuals[0];

      await ScheduleEntry.delete(ctx.db, ctx.tenantId, target.entry_id, IEditScope.SINGLE);

      // Verify exception exists
      const masterMid = await ctx.db('schedule_entries')
        .where({ entry_id: entry.entry_id, tenant: ctx.tenantId })
        .first();
      const midPattern = parsePattern(masterMid.recurrence_pattern);
      expect(midPattern.exceptions.length).toBe(1);

      // Now update ALL with a new title
      const updated = await ScheduleEntry.update(
        ctx.db,
        ctx.tenantId,
        entry.entry_id as string,
        { title: 'Updated daily standup' },
        IEditScope.ALL
      );

      expect(updated).toBeDefined();
      expect(updated!.title).toBe('Updated daily standup');
      expect(updated!.is_recurring).toBe(true);

      // Verify DB was updated
      const masterAfter = await ctx.db('schedule_entries')
        .where({ entry_id: entry.entry_id, tenant: ctx.tenantId })
        .first();
      expect(masterAfter.title).toBe('Updated daily standup');

      // Exceptions should be preserved
      const afterPattern = parsePattern(masterAfter.recurrence_pattern);
      expect(afterPattern.exceptions.length).toBe(1);

      // getAll should reflect the new title on all virtual instances
      const entriesAfter = await ScheduleEntry.getAll(ctx.db, ctx.tenantId, start, end);
      const virtualsAfter = entriesAfter.filter(e => e.entry_id.includes('_'));
      for (const ve of virtualsAfter) {
        expect(ve.title).toBe('Updated daily standup');
      }
    });
  });

  // ── Exception dates filtering ────────────────────────────────────────

  describe('exception dates', () => {
    it('entries with pre-existing exceptions skip those dates', async () => {
      const exceptionDate = '2024-06-05T00:00:00.000Z'; // June 5

      await createRecurringEntry({
        recurrence_pattern: JSON.stringify({
          frequency: 'daily',
          interval: 1,
          startDate: '2024-06-01T00:00:00.000Z',
          endDate: '2024-06-10T23:59:59.000Z',
          exceptions: [exceptionDate],
        }),
      });

      const start = new Date('2024-06-01T00:00:00Z');
      const end = new Date('2024-06-10T23:59:59Z');

      const entries = await ScheduleEntry.getAll(ctx.db, ctx.tenantId, start, end);
      const virtualEntries = entries.filter(e => e.entry_id.includes('_'));

      // June 5 should NOT appear in virtual instances
      const virtualDates = virtualEntries.map(e =>
        new Date(e.scheduled_start).toISOString().slice(0, 10)
      );
      expect(virtualDates).not.toContain('2024-06-05');
    });

    it('multiple exception dates are all respected', async () => {
      await createRecurringEntry({
        recurrence_pattern: JSON.stringify({
          frequency: 'daily',
          interval: 1,
          startDate: '2024-06-01T00:00:00.000Z',
          endDate: '2024-06-10T23:59:59.000Z',
          exceptions: [
            '2024-06-03T00:00:00.000Z',
            '2024-06-05T00:00:00.000Z',
            '2024-06-07T00:00:00.000Z',
          ],
        }),
      });

      const start = new Date('2024-06-01T00:00:00Z');
      const end = new Date('2024-06-10T23:59:59Z');

      const entries = await ScheduleEntry.getAll(ctx.db, ctx.tenantId, start, end);
      const virtualDates = entries
        .filter(e => e.entry_id.includes('_'))
        .map(e => new Date(e.scheduled_start).toISOString().slice(0, 10));

      expect(virtualDates).not.toContain('2024-06-03');
      expect(virtualDates).not.toContain('2024-06-05');
      expect(virtualDates).not.toContain('2024-06-07');
    });
  });

  // ── Non-recurring entries: simple update/delete ──────────────────────

  describe('non-recurring entry operations', () => {
    it('update() on a non-recurring entry performs a simple update', async () => {
      const entryId = uuidv4();
      await ctx.db('schedule_entries').insert({
        entry_id: entryId,
        tenant: ctx.tenantId,
        title: 'Regular meeting',
        scheduled_start: new Date('2024-06-05T10:00:00Z'),
        scheduled_end: new Date('2024-06-05T11:00:00Z'),
        status: 'scheduled',
        work_item_type: 'ad_hoc',
        is_recurring: false,
        is_private: false,
      });
      await ctx.db('schedule_entry_assignees').insert({
        tenant: ctx.tenantId,
        entry_id: entryId,
        user_id: ctx.userId,
      });

      const updated = await ScheduleEntry.update(
        ctx.db,
        ctx.tenantId,
        entryId,
        { title: 'Renamed meeting' }
      );

      expect(updated).toBeDefined();
      expect(updated!.title).toBe('Renamed meeting');

      // Verify in DB
      const dbEntry = await ctx.db('schedule_entries')
        .where({ entry_id: entryId, tenant: ctx.tenantId })
        .first();
      expect(dbEntry.title).toBe('Renamed meeting');
    });

    it('delete() on a non-recurring entry removes it completely', async () => {
      const entryId = uuidv4();
      await ctx.db('schedule_entries').insert({
        entry_id: entryId,
        tenant: ctx.tenantId,
        title: 'To be deleted',
        scheduled_start: new Date('2024-06-05T10:00:00Z'),
        scheduled_end: new Date('2024-06-05T11:00:00Z'),
        status: 'scheduled',
        work_item_type: 'ad_hoc',
        is_recurring: false,
        is_private: false,
      });
      await ctx.db('schedule_entry_assignees').insert({
        tenant: ctx.tenantId,
        entry_id: entryId,
        user_id: ctx.userId,
      });

      const result = await ScheduleEntry.delete(ctx.db, ctx.tenantId, entryId);
      expect(result).toBe(true);

      // Should be gone from DB
      const dbEntry = await ctx.db('schedule_entries')
        .where({ entry_id: entryId, tenant: ctx.tenantId })
        .first();
      expect(dbEntry).toBeUndefined();

      // Assignees should be gone too
      const assignees = await ctx.db('schedule_entry_assignees')
        .where({ entry_id: entryId, tenant: ctx.tenantId })
        .select('*');
      expect(assignees.length).toBe(0);
    });
  });

  // ── Create with recurrence ──────────────────────────────────────────

  describe('create() with recurrence pattern', () => {
    it('creates a recurring master entry and getAll returns virtual instances', async () => {
      const created = await ScheduleEntry.create(
        ctx.db,
        ctx.tenantId,
        {
          title: 'New recurring',
          scheduled_start: new Date('2024-06-01T10:00:00Z'),
          scheduled_end: new Date('2024-06-01T11:00:00Z'),
          status: 'scheduled',
          work_item_type: 'ad_hoc',
          is_private: false,
          recurrence_pattern: {
            frequency: 'daily',
            interval: 1,
            startDate: new Date('2024-06-01T00:00:00Z'),
            endDate: new Date('2024-06-05T23:59:59Z'),
          } as any,
        },
        { assignedUserIds: [ctx.userId] }
      );

      expect(created).toBeDefined();
      expect(created.is_recurring).toBe(true);

      // Verify in DB
      const dbEntry = await ctx.db('schedule_entries')
        .where({ entry_id: created.entry_id, tenant: ctx.tenantId })
        .first();
      expect(dbEntry.is_recurring).toBe(true);
      expect(dbEntry.recurrence_pattern).toBeTruthy();

      // getAll should return virtual instances
      const start = new Date('2024-06-01T00:00:00Z');
      const end = new Date('2024-06-05T23:59:59Z');
      const entries = await ScheduleEntry.getAll(ctx.db, ctx.tenantId, start, end);
      const virtuals = entries.filter(e => e.entry_id.includes('_'));

      expect(virtuals.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ── Tenant isolation ────────────────────────────────────────────────

  describe('tenant isolation', () => {
    it('recurring entries from one tenant are not visible to another', async () => {
      await createRecurringEntry();

      const fakeTenant = uuidv4();

      const start = new Date('2024-06-01T00:00:00Z');
      const end = new Date('2024-06-14T23:59:59Z');

      const entries = await ScheduleEntry.getAll(ctx.db, fakeTenant, start, end);
      expect(entries.length).toBe(0);
    });
  });
});
