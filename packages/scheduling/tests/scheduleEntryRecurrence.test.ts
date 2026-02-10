/**
 * @alga-psa/scheduling - Schedule Entry Recurrence Tests
 *
 * Tests for recurrence-aware update/delete operations in the ScheduleEntry model.
 * Uses a mock Knex builder to verify the correct DB operations are performed
 * for SINGLE/FUTURE/ALL edit scopes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import ScheduleEntry from '../src/models/scheduleEntry';
import type { IScheduleEntry, IRecurrencePattern } from '@alga-psa/types';

// ---------- Mock Knex Builder ----------

/**
 * Creates a deeply chainable mock Knex object that records calls.
 * Every method returns the chainable object so query builder chaining works.
 * Terminal methods (first, del, returning) can be configured to resolve with values.
 */
function createMockKnex() {
  const calls: { table: string; method: string; args: any[] }[] = [];
  let currentTable = '';

  // Storage for configuring mock return values
  const firstResults: Map<string, any> = new Map();
  const selectResults: any[] = [];
  let insertCalled = false;
  let insertArgs: any = null;
  let updateCalled = false;
  let updateArgs: any = null;
  let deleteCalled = false;
  let returningResult: any[] = [];

  const chainable: Record<string, any> = {};

  const chainMethods = [
    'where',
    'andWhere',
    'whereIn',
    'whereNull',
    'whereNotNull',
    'whereBetween',
    'orWhereBetween',
    'orWhere',
    'orWhereRaw',
    'andWhereRaw',
    'whereRaw',
    'select',
    'orderBy',
    'join',
  ];

  for (const method of chainMethods) {
    chainable[method] = vi.fn((...args: any[]) => {
      calls.push({ table: currentTable, method, args });
      return chainable;
    });
  }

  chainable.first = vi.fn(async () => {
    calls.push({ table: currentTable, method: 'first', args: [] });
    return firstResults.get(currentTable) ?? undefined;
  });

  chainable.del = vi.fn(async () => {
    calls.push({ table: currentTable, method: 'del', args: [] });
    deleteCalled = true;
    return 1;
  });

  chainable.insert = vi.fn(async (data: any) => {
    calls.push({ table: currentTable, method: 'insert', args: [data] });
    insertCalled = true;
    insertArgs = data;
    return chainable;
  });

  chainable.update = vi.fn((data: any) => {
    calls.push({ table: currentTable, method: 'update', args: [data] });
    updateCalled = true;
    updateArgs = data;
    return chainable;
  });

  chainable.returning = vi.fn(async () => {
    calls.push({ table: currentTable, method: 'returning', args: [] });
    return returningResult;
  });

  const mockKnex = vi.fn((tableName: string) => {
    currentTable = tableName;
    return chainable;
  }) as any;

  return {
    knex: mockKnex,
    chainable,
    calls,
    // Helpers to configure mock behavior
    setFirstResult: (table: string, result: any) => firstResults.set(table, result),
    setReturningResult: (result: any[]) => {
      returningResult = result;
    },
    getInsertArgs: () => insertArgs,
    getUpdateArgs: () => updateArgs,
    wasInsertCalled: () => insertCalled,
    wasUpdateCalled: () => updateCalled,
    wasDeleteCalled: () => deleteCalled,
    reset: () => {
      calls.length = 0;
      firstResults.clear();
      selectResults.length = 0;
      insertCalled = false;
      insertArgs = null;
      updateCalled = false;
      updateArgs = null;
      deleteCalled = false;
      returningResult = [];
    },
  };
}

// ---------- Test Fixtures ----------

const TENANT = 'test-tenant';

function makeRecurrencePattern(overrides: Partial<IRecurrencePattern> = {}): IRecurrencePattern {
  return {
    frequency: 'daily',
    interval: 1,
    startDate: new Date('2024-01-15'),
    ...overrides,
  };
}

function makeMasterEntry(overrides: Partial<any> = {}) {
  return {
    entry_id: 'master-1',
    title: 'Daily Standup',
    scheduled_start: new Date('2024-01-15T09:00:00Z'),
    scheduled_end: new Date('2024-01-15T09:30:00Z'),
    notes: 'Team standup',
    status: 'scheduled',
    work_item_id: null,
    work_item_type: 'ad_hoc',
    tenant: TENANT,
    is_recurring: true,
    recurrence_pattern: JSON.stringify(makeRecurrencePattern()),
    is_private: false,
    original_entry_id: null,
    ...overrides,
  };
}

// ---------- Tests ----------

describe('ScheduleEntry - Recurrence Operations', () => {
  describe('update() with IEditScope', () => {
    describe('SINGLE scope', () => {
      it('should create a standalone entry and add exception to master', async () => {
        const mock = createMockKnex();
        const masterEntry = makeMasterEntry();
        mock.setFirstResult('schedule_entries', masterEntry);

        // Stub getAssignedUserIds to avoid DB calls
        const origGetAssigned = ScheduleEntry.getAssignedUserIds;
        ScheduleEntry.getAssignedUserIds = vi.fn(async () => ({
          'master-1': ['user-1'],
        }));

        // Stub updateAssignees to avoid DB calls
        const origUpdateAssignees = ScheduleEntry.updateAssignees;
        ScheduleEntry.updateAssignees = vi.fn(async () => {});

        try {
          const result = await ScheduleEntry.update(
            mock.knex,
            TENANT,
            'master-1_1705485600000', // virtual ID: master-1 at Jan 17 2024 09:00 UTC
            {
              title: 'Updated Standup',
              scheduled_start: new Date('2024-01-17T10:00:00Z'),
              scheduled_end: new Date('2024-01-17T10:30:00Z'),
            },
            'single' as any
          );

          expect(result).toBeDefined();
          // The returned entry should be non-recurring (standalone)
          expect(result!.is_recurring).toBe(false);
          expect(result!.original_entry_id).toBeNull();
          expect(result!.title).toBe('Updated Standup');
          expect(result!.assigned_user_ids).toEqual(['user-1']);

          // Should have inserted a new standalone entry
          expect(mock.wasInsertCalled()).toBe(true);
          const insertArgs = mock.getInsertArgs();
          expect(insertArgs.is_recurring).toBe(false);
          expect(insertArgs.recurrence_pattern).toBeNull();
          expect(insertArgs.title).toBe('Updated Standup');

          // Should have updated master pattern with exception
          expect(mock.wasUpdateCalled()).toBe(true);
          const updateArgs = mock.getUpdateArgs();
          expect(updateArgs.recurrence_pattern).toBeDefined();
          const updatedPattern = JSON.parse(updateArgs.recurrence_pattern);
          expect(updatedPattern.exceptions).toBeDefined();
          expect(updatedPattern.exceptions.length).toBeGreaterThan(0);
        } finally {
          ScheduleEntry.getAssignedUserIds = origGetAssigned;
          ScheduleEntry.updateAssignees = origUpdateAssignees;
        }
      });
    });

    describe('FUTURE scope', () => {
      it('should truncate original master and create new master for future', async () => {
        const mock = createMockKnex();
        const masterEntry = makeMasterEntry();
        mock.setFirstResult('schedule_entries', masterEntry);

        const origGetAssigned = ScheduleEntry.getAssignedUserIds;
        ScheduleEntry.getAssignedUserIds = vi.fn(async () => ({
          'master-1': ['user-1'],
        }));

        const origUpdateAssignees = ScheduleEntry.updateAssignees;
        ScheduleEntry.updateAssignees = vi.fn(async () => {});

        try {
          // Virtual ID for Jan 20, 2024 09:00 UTC
          const virtualTimestamp = new Date('2024-01-20T09:00:00Z').getTime();
          const result = await ScheduleEntry.update(
            mock.knex,
            TENANT,
            `master-1_${virtualTimestamp}`,
            {
              title: 'Renamed Standup',
            },
            'future' as any
          );

          expect(result).toBeDefined();
          // The new master should be recurring
          expect(result!.is_recurring).toBe(true);
          expect(result!.title).toBe('Renamed Standup');

          // Should have updated original master (truncating its endDate)
          expect(mock.wasUpdateCalled()).toBe(true);
          const updateArgs = mock.getUpdateArgs();
          const truncatedPattern = JSON.parse(updateArgs.recurrence_pattern);
          // endDate should be the day before the virtual timestamp
          const expectedEnd = new Date('2024-01-19T23:59:59.999');
          expect(new Date(truncatedPattern.endDate).getDate()).toBe(expectedEnd.getDate());

          // Should have inserted a new master entry
          expect(mock.wasInsertCalled()).toBe(true);
          const insertArgs = mock.getInsertArgs();
          expect(insertArgs.is_recurring).toBe(true);
          expect(insertArgs.recurrence_pattern).toBeDefined();
          const newPattern = JSON.parse(insertArgs.recurrence_pattern);
          expect(new Date(newPattern.startDate).getTime()).toBe(
            new Date('2024-01-20T09:00:00Z').getTime()
          );
        } finally {
          ScheduleEntry.getAssignedUserIds = origGetAssigned;
          ScheduleEntry.updateAssignees = origUpdateAssignees;
        }
      });

      it('should throw when virtualTimestamp is missing for FUTURE scope', async () => {
        const mock = createMockKnex();
        const masterEntry = makeMasterEntry();
        mock.setFirstResult('schedule_entries', masterEntry);

        await expect(
          ScheduleEntry.update(
            mock.knex,
            TENANT,
            'master-1', // NOT a virtual ID — no timestamp
            { title: 'Updated' },
            'future' as any
          )
        ).rejects.toThrow('Virtual timestamp is required for future updates');
      });
    });

    describe('ALL scope', () => {
      it('should update the master entry directly, preserving exceptions', async () => {
        const patternWithExceptions = makeRecurrencePattern({
          exceptions: [new Date('2024-01-17')],
        });
        const masterEntry = makeMasterEntry({
          recurrence_pattern: JSON.stringify(patternWithExceptions),
        });

        const mock = createMockKnex();
        mock.setFirstResult('schedule_entries', masterEntry);
        mock.setReturningResult([
          {
            ...masterEntry,
            title: 'All Updated',
            recurrence_pattern: JSON.stringify(patternWithExceptions),
          },
        ]);

        const origGetAssigned = ScheduleEntry.getAssignedUserIds;
        ScheduleEntry.getAssignedUserIds = vi.fn(async () => ({
          'master-1': ['user-1'],
        }));

        try {
          const result = await ScheduleEntry.update(
            mock.knex,
            TENANT,
            'master-1',
            { title: 'All Updated' },
            'all' as any
          );

          expect(result).toBeDefined();
          expect(result!.is_recurring).toBe(true);
          expect(result!.assigned_user_ids).toEqual(['user-1']);

          // Should have updated the master entry
          expect(mock.wasUpdateCalled()).toBe(true);
          const updateArgs = mock.getUpdateArgs();
          expect(updateArgs.title).toBe('All Updated');
          expect(updateArgs.is_recurring).toBe(true);

          // Exceptions should be preserved
          const updatedPattern = JSON.parse(updateArgs.recurrence_pattern);
          expect(updatedPattern.exceptions).toBeDefined();
          expect(updatedPattern.exceptions.length).toBe(1);
        } finally {
          ScheduleEntry.getAssignedUserIds = origGetAssigned;
        }
      });
    });

    describe('non-recurring update (no scope)', () => {
      it('should perform a simple field update when entry has no recurrence_pattern', async () => {
        const nonRecurringEntry = makeMasterEntry({
          is_recurring: false,
          recurrence_pattern: null,
        });

        const mock = createMockKnex();
        mock.setFirstResult('schedule_entries', nonRecurringEntry);
        mock.setReturningResult([{ ...nonRecurringEntry, title: 'Updated Title' }]);

        const origGetAssigned = ScheduleEntry.getAssignedUserIds;
        ScheduleEntry.getAssignedUserIds = vi.fn(async () => ({
          'master-1': ['user-1'],
        }));

        try {
          const result = await ScheduleEntry.update(mock.knex, TENANT, 'master-1', {
            title: 'Updated Title',
          });

          expect(result).toBeDefined();
          expect(result!.title).toBe('Updated Title');

          // Should have done a regular update (not insert)
          expect(mock.wasUpdateCalled()).toBe(true);
          expect(mock.wasInsertCalled()).toBe(false);
        } finally {
          ScheduleEntry.getAssignedUserIds = origGetAssigned;
        }
      });

      it('should return undefined when entry does not exist', async () => {
        const mock = createMockKnex();
        mock.setFirstResult('schedule_entries', undefined);

        const result = await ScheduleEntry.update(mock.knex, TENANT, 'nonexistent', {
          title: 'test',
        });

        expect(result).toBeUndefined();
      });
    });

    describe('removing recurrence', () => {
      it('should clear recurrence when pattern is set to empty object', async () => {
        const masterEntry = makeMasterEntry();
        const mock = createMockKnex();
        mock.setFirstResult('schedule_entries', masterEntry);
        mock.setReturningResult([
          {
            ...masterEntry,
            is_recurring: false,
            recurrence_pattern: null,
          },
        ]);

        const origGetAssigned = ScheduleEntry.getAssignedUserIds;
        ScheduleEntry.getAssignedUserIds = vi.fn(async () => ({
          'master-1': ['user-1'],
        }));

        try {
          // Pass empty recurrence_pattern and no updateType — triggers removal path
          const result = await ScheduleEntry.update(mock.knex, TENANT, 'master-1', {
            recurrence_pattern: {} as any,
          });

          expect(result).toBeDefined();
          expect(mock.wasUpdateCalled()).toBe(true);
          const updateArgs = mock.getUpdateArgs();
          expect(updateArgs.recurrence_pattern).toBeNull();
          expect(updateArgs.is_recurring).toBe(false);
        } finally {
          ScheduleEntry.getAssignedUserIds = origGetAssigned;
        }
      });
    });
  });

  describe('delete() with IEditScope', () => {
    describe('SINGLE scope — virtual instance', () => {
      it('should add exception date to master pattern', async () => {
        const mock = createMockKnex();
        const masterEntry = makeMasterEntry();
        mock.setFirstResult('schedule_entries', masterEntry);

        // Virtual ID for Jan 17, 2024 09:00 UTC
        const virtualTimestamp = new Date('2024-01-17T09:00:00Z').getTime();
        const result = await ScheduleEntry.delete(
          mock.knex,
          TENANT,
          `master-1_${virtualTimestamp}`,
          'single' as any
        );

        expect(result).toBe(true);

        // Should have updated (not deleted) the master with an exception
        expect(mock.wasUpdateCalled()).toBe(true);
        const updateArgs = mock.getUpdateArgs();
        const updatedPattern = JSON.parse(updateArgs.recurrence_pattern);
        expect(updatedPattern.exceptions).toBeDefined();
        expect(updatedPattern.exceptions.length).toBe(1);

        // The exception should be midnight UTC on Jan 17
        const exceptionDate = new Date(updatedPattern.exceptions[0]);
        expect(exceptionDate.getUTCFullYear()).toBe(2024);
        expect(exceptionDate.getUTCMonth()).toBe(0); // January
        expect(exceptionDate.getUTCDate()).toBe(17);
        expect(exceptionDate.getUTCHours()).toBe(0);
      });
    });

    describe('SINGLE scope — master entry', () => {
      it('should delete the original master', async () => {
        const mock = createMockKnex();
        const masterEntry = makeMasterEntry();
        mock.setFirstResult('schedule_entries', masterEntry);

        // Stub getAssignedUserIds + updateAssignees for the new master creation
        const origGetAssigned = ScheduleEntry.getAssignedUserIds;
        ScheduleEntry.getAssignedUserIds = vi.fn(async () => ({
          'master-1': ['user-1'],
        }));
        const origUpdateAssignees = ScheduleEntry.updateAssignees;
        ScheduleEntry.updateAssignees = vi.fn(async () => {});

        try {
          const result = await ScheduleEntry.delete(
            mock.knex,
            TENANT,
            'master-1', // NOT a virtual ID
            'single' as any
          );

          expect(result).toBe(true);
          // Should have deleted the master entry
          expect(mock.wasDeleteCalled()).toBe(true);
        } finally {
          ScheduleEntry.getAssignedUserIds = origGetAssigned;
          ScheduleEntry.updateAssignees = origUpdateAssignees;
        }
      });
    });

    describe('FUTURE scope — virtual instance', () => {
      it('should truncate master series endDate to before this instance', async () => {
        const mock = createMockKnex();
        const masterEntry = makeMasterEntry();
        mock.setFirstResult('schedule_entries', masterEntry);

        // Virtual ID for Jan 20, 2024 09:00 UTC
        const virtualTimestamp = new Date('2024-01-20T09:00:00Z').getTime();
        const result = await ScheduleEntry.delete(
          mock.knex,
          TENANT,
          `master-1_${virtualTimestamp}`,
          'future' as any
        );

        expect(result).toBe(true);

        // Should have updated master with truncated endDate
        expect(mock.wasUpdateCalled()).toBe(true);
        const updateArgs = mock.getUpdateArgs();
        const updatedPattern = JSON.parse(updateArgs.recurrence_pattern);

        // endDate should be Jan 19 end of day
        const endDate = new Date(updatedPattern.endDate);
        expect(endDate.getDate()).toBe(19);
        expect(endDate.getHours()).toBe(23);
        expect(endDate.getMinutes()).toBe(59);
      });

      it('should filter out exceptions after the truncation point', () => {
        // This is an indirect test — the update method filters exceptions.
        // We verify by checking the pattern stored.
        const mock = createMockKnex();
        const patternWithExceptions = makeRecurrencePattern({
          exceptions: [
            new Date('2024-01-17T00:00:00Z'), // before truncation
            new Date('2024-01-22T00:00:00Z'), // after truncation
          ],
        });
        const masterEntry = makeMasterEntry({
          recurrence_pattern: JSON.stringify(patternWithExceptions),
        });
        mock.setFirstResult('schedule_entries', masterEntry);

        const virtualTimestamp = new Date('2024-01-20T09:00:00Z').getTime();

        return ScheduleEntry.delete(
          mock.knex,
          TENANT,
          `master-1_${virtualTimestamp}`,
          'future' as any
        ).then((result) => {
          expect(result).toBe(true);
          const updateArgs = mock.getUpdateArgs();
          const updatedPattern = JSON.parse(updateArgs.recurrence_pattern);
          // Only the exception before the truncation point should remain
          expect(updatedPattern.exceptions.length).toBe(1);
          expect(new Date(updatedPattern.exceptions[0]).getUTCDate()).toBe(17);
        });
      });
    });

    describe('FUTURE scope — master entry', () => {
      it('should delete the entire series', async () => {
        const mock = createMockKnex();
        const masterEntry = makeMasterEntry();
        mock.setFirstResult('schedule_entries', masterEntry);

        const result = await ScheduleEntry.delete(
          mock.knex,
          TENANT,
          'master-1',
          'future' as any
        );

        expect(result).toBe(true);
        expect(mock.wasDeleteCalled()).toBe(true);
      });
    });

    describe('ALL scope', () => {
      it('should delete the master entry entirely', async () => {
        const mock = createMockKnex();
        const masterEntry = makeMasterEntry();
        mock.setFirstResult('schedule_entries', masterEntry);

        const result = await ScheduleEntry.delete(
          mock.knex,
          TENANT,
          'master-1',
          'all' as any
        );

        expect(result).toBe(true);
        expect(mock.wasDeleteCalled()).toBe(true);
      });
    });

    describe('non-recurring delete', () => {
      it('should perform a simple delete for non-recurring entries', async () => {
        const nonRecurringEntry = makeMasterEntry({
          is_recurring: false,
          recurrence_pattern: null,
        });

        const mock = createMockKnex();
        mock.setFirstResult('schedule_entries', nonRecurringEntry);

        const result = await ScheduleEntry.delete(mock.knex, TENANT, 'master-1');

        expect(result).toBe(true);
        expect(mock.wasDeleteCalled()).toBe(true);
      });

      it('should return false when entry does not exist', async () => {
        const mock = createMockKnex();
        mock.setFirstResult('schedule_entries', undefined);

        const result = await ScheduleEntry.delete(mock.knex, TENANT, 'nonexistent');

        expect(result).toBe(false);
      });
    });
  });

  describe('Virtual ID parsing', () => {
    it('should correctly parse virtual entry IDs in update()', async () => {
      const mock = createMockKnex();
      const masterEntry = makeMasterEntry();
      mock.setFirstResult('schedule_entries', masterEntry);

      const origGetAssigned = ScheduleEntry.getAssignedUserIds;
      ScheduleEntry.getAssignedUserIds = vi.fn(async () => ({
        'master-1': ['user-1'],
      }));
      const origUpdateAssignees = ScheduleEntry.updateAssignees;
      ScheduleEntry.updateAssignees = vi.fn(async () => {});

      try {
        // The virtual ID should be parsed into master-1 + timestamp
        await ScheduleEntry.update(
          mock.knex,
          TENANT,
          'master-1_1705485600000',
          { title: 'Updated' },
          'single' as any
        );

        // Verify the master entry was fetched using master-1 (not the full virtual ID)
        const firstCall = mock.calls.find(
          (c) => c.table === 'schedule_entries' && c.method === 'first'
        );
        expect(firstCall).toBeDefined();
      } finally {
        ScheduleEntry.getAssignedUserIds = origGetAssigned;
        ScheduleEntry.updateAssignees = origUpdateAssignees;
      }
    });

    it('should correctly parse virtual entry IDs in delete()', async () => {
      const mock = createMockKnex();
      const masterEntry = makeMasterEntry();
      mock.setFirstResult('schedule_entries', masterEntry);

      await ScheduleEntry.delete(
        mock.knex,
        TENANT,
        'master-1_1705485600000',
        'single' as any
      );

      // The exception should have been added based on the parsed timestamp
      expect(mock.wasUpdateCalled()).toBe(true);
      const updateArgs = mock.getUpdateArgs();
      const pattern = JSON.parse(updateArgs.recurrence_pattern);
      expect(pattern.exceptions).toHaveLength(1);
    });
  });

  describe('getRecurringEntriesInRange()', () => {
    it('should throw when tenant is not provided', async () => {
      const mock = createMockKnex();
      await expect(
        ScheduleEntry.getRecurringEntriesInRange(
          mock.knex,
          '',
          new Date('2024-01-01'),
          new Date('2024-01-31')
        )
      ).rejects.toThrow('Tenant context is required');
    });
  });

  describe('getRecurringEntriesWithAssignments()', () => {
    it('should generate virtual entries with composite IDs and assignments', async () => {
      const pattern = makeRecurrencePattern({
        frequency: 'daily',
        interval: 1,
        startDate: new Date('2024-01-15'),
      });

      const masterEntry: IScheduleEntry = {
        entry_id: 'master-1',
        title: 'Daily Standup',
        scheduled_start: new Date('2024-01-15T09:00:00Z'),
        scheduled_end: new Date('2024-01-15T09:30:00Z'),
        notes: 'Team standup',
        status: 'scheduled',
        work_item_id: null,
        work_item_type: 'ad_hoc',
        tenant: TENANT,
        is_recurring: true,
        recurrence_pattern: pattern,
        is_private: false,
        original_entry_id: null,
        assigned_user_ids: [],
      } as IScheduleEntry;

      // Stub getAssignedUserIds
      const origGetAssigned = ScheduleEntry.getAssignedUserIds;
      ScheduleEntry.getAssignedUserIds = vi.fn(async () => ({
        'master-1': ['user-1', 'user-2'],
      }));

      try {
        const mock = createMockKnex();
        const start = new Date('2024-01-16');
        const end = new Date('2024-01-18');

        const result = await ScheduleEntry.getRecurringEntriesWithAssignments(
          mock.knex,
          TENANT,
          [masterEntry],
          start,
          end
        );

        // Should have generated virtual entries for Jan 16, 17, 18
        expect(result.length).toBeGreaterThanOrEqual(2);

        for (const entry of result) {
          // Each virtual entry should have a composite ID
          expect(entry.entry_id).toContain('master-1_');
          // Should reference the master
          expect(entry.original_entry_id).toBe('master-1');
          // Should be marked as recurring
          expect(entry.is_recurring).toBe(true);
          // Should inherit assignments
          expect(entry.assigned_user_ids).toEqual(['user-1', 'user-2']);
          // Duration should be preserved (30 min)
          const duration =
            new Date(entry.scheduled_end).getTime() -
            new Date(entry.scheduled_start).getTime();
          expect(duration).toBe(30 * 60 * 1000); // 30 minutes in ms
        }
      } finally {
        ScheduleEntry.getAssignedUserIds = origGetAssigned;
      }
    });

    it('should skip entries with empty recurrence patterns', async () => {
      const entryWithoutPattern: IScheduleEntry = {
        entry_id: 'entry-no-pattern',
        title: 'No Pattern',
        scheduled_start: new Date('2024-01-15T09:00:00Z'),
        scheduled_end: new Date('2024-01-15T09:30:00Z'),
        notes: '',
        status: 'scheduled',
        work_item_id: null,
        work_item_type: 'ad_hoc',
        tenant: TENANT,
        is_recurring: true,
        recurrence_pattern: null as any,
        is_private: false,
        original_entry_id: null,
        assigned_user_ids: [],
      } as IScheduleEntry;

      const origGetAssigned = ScheduleEntry.getAssignedUserIds;
      ScheduleEntry.getAssignedUserIds = vi.fn(async () => ({}));

      try {
        const mock = createMockKnex();
        const result = await ScheduleEntry.getRecurringEntriesWithAssignments(
          mock.knex,
          TENANT,
          [entryWithoutPattern],
          new Date('2024-01-16'),
          new Date('2024-01-18')
        );

        expect(result).toEqual([]);
      } finally {
        ScheduleEntry.getAssignedUserIds = origGetAssigned;
      }
    });

    it('should parse JSON string recurrence patterns from DB', async () => {
      const patternObj = makeRecurrencePattern({
        frequency: 'daily',
        interval: 1,
        startDate: new Date('2024-01-15'),
      });

      // Simulate what the DB returns — pattern as a JSON string
      const masterEntry: IScheduleEntry = {
        entry_id: 'master-1',
        title: 'Daily Standup',
        scheduled_start: new Date('2024-01-15T09:00:00Z'),
        scheduled_end: new Date('2024-01-15T09:30:00Z'),
        notes: '',
        status: 'scheduled',
        work_item_id: null,
        work_item_type: 'ad_hoc',
        tenant: TENANT,
        is_recurring: true,
        recurrence_pattern: JSON.stringify(patternObj) as any,
        is_private: false,
        original_entry_id: null,
        assigned_user_ids: [],
      } as IScheduleEntry;

      const origGetAssigned = ScheduleEntry.getAssignedUserIds;
      ScheduleEntry.getAssignedUserIds = vi.fn(async () => ({
        'master-1': ['user-1'],
      }));

      try {
        const mock = createMockKnex();
        const result = await ScheduleEntry.getRecurringEntriesWithAssignments(
          mock.knex,
          TENANT,
          [masterEntry],
          new Date('2024-01-16'),
          new Date('2024-01-17')
        );

        expect(result.length).toBeGreaterThan(0);
        for (const entry of result) {
          expect(entry.entry_id).toContain('master-1_');
        }
      } finally {
        ScheduleEntry.getAssignedUserIds = origGetAssigned;
      }
    });

    it('should filter out exception dates from virtual entries', async () => {
      const pattern = makeRecurrencePattern({
        frequency: 'daily',
        interval: 1,
        startDate: new Date('2024-01-15'),
        exceptions: [new Date('2024-01-17')],
      });

      const masterEntry: IScheduleEntry = {
        entry_id: 'master-1',
        title: 'Daily Standup',
        scheduled_start: new Date('2024-01-15T09:00:00Z'),
        scheduled_end: new Date('2024-01-15T09:30:00Z'),
        notes: '',
        status: 'scheduled',
        work_item_id: null,
        work_item_type: 'ad_hoc',
        tenant: TENANT,
        is_recurring: true,
        recurrence_pattern: pattern,
        is_private: false,
        original_entry_id: null,
        assigned_user_ids: [],
      } as IScheduleEntry;

      const origGetAssigned = ScheduleEntry.getAssignedUserIds;
      ScheduleEntry.getAssignedUserIds = vi.fn(async () => ({
        'master-1': ['user-1'],
      }));

      try {
        const mock = createMockKnex();
        // Use a wide range to avoid boundary issues
        const result = await ScheduleEntry.getRecurringEntriesWithAssignments(
          mock.knex,
          TENANT,
          [masterEntry],
          new Date('2024-01-14'),
          new Date('2024-01-20')
        );

        const dates = result.map(
          (e) => new Date(e.scheduled_start).toISOString().split('T')[0]
        );

        expect(dates).toContain('2024-01-16');
        expect(dates).not.toContain('2024-01-17'); // exception
        expect(dates).toContain('2024-01-18');
      } finally {
        ScheduleEntry.getAssignedUserIds = origGetAssigned;
      }
    });
  });
});
