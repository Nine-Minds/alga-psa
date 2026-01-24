/**
 * @alga-psa/scheduling - Schedule Entry Model Tests
 *
 * Tests for the ScheduleEntry model business logic.
 * These tests verify validation logic and error handling.
 */

import { describe, it, expect, vi } from 'vitest';
import ScheduleEntry from '../src/models/scheduleEntry';

// Mock Knex to test validation logic without database
const createMockKnex = () => {
  const mockInsert = vi.fn().mockReturnThis();
  const mockWhere = vi.fn().mockReturnThis();
  const mockAndWhere = vi.fn().mockReturnThis();
  const mockWhereIn = vi.fn().mockReturnThis();
  const mockWhereNull = vi.fn().mockReturnThis();
  const mockWhereBetween = vi.fn().mockReturnThis();
  const mockOrWhereBetween = vi.fn().mockReturnThis();
  const mockFirst = vi.fn();
  const mockUpdate = vi.fn().mockReturnThis();
  const mockDel = vi.fn();
  const mockReturning = vi.fn();
  const mockSelect = vi.fn().mockReturnThis();
  const mockJoin = vi.fn().mockReturnThis();
  const mockOrderBy = vi.fn().mockReturnThis();

  const chainable = {
    insert: mockInsert,
    where: mockWhere,
    andWhere: mockAndWhere,
    whereIn: mockWhereIn,
    whereNull: mockWhereNull,
    whereBetween: mockWhereBetween,
    orWhereBetween: mockOrWhereBetween,
    first: mockFirst,
    update: mockUpdate,
    del: mockDel,
    returning: mockReturning,
    select: mockSelect,
    join: mockJoin,
    orderBy: mockOrderBy,
  };

  // Make all methods return the chainable object for chaining
  Object.keys(chainable).forEach((key) => {
    if (key !== 'first' && key !== 'del') {
      (chainable as any)[key] = vi.fn().mockReturnValue(chainable);
    }
  });

  const mockKnex = vi.fn(() => chainable);

  return {
    knex: mockKnex as any,
    mocks: chainable,
  };
};

describe('ScheduleEntry Model', () => {
  describe('getAssignedUserIds', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(
        ScheduleEntry.getAssignedUserIds(knex, '', ['entry-123'])
      ).rejects.toThrow('Tenant context is required for getting schedule entry assignees');
    });

    it('should return empty object when no entry IDs are provided', async () => {
      const { knex } = createMockKnex();

      const result = await ScheduleEntry.getAssignedUserIds(knex, 'tenant-123', []);
      expect(result).toEqual({});
    });

    it('should filter out undefined entry IDs', async () => {
      const { knex } = createMockKnex();

      const result = await ScheduleEntry.getAssignedUserIds(knex, 'tenant-123', [
        undefined,
        undefined,
      ]);
      expect(result).toEqual({});
    });
  });

  describe('updateAssignees', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(
        ScheduleEntry.updateAssignees(knex, '', 'entry-123', ['user-1'])
      ).rejects.toThrow('Tenant context is required for updating schedule entry assignees');
    });
  });

  describe('getAll', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();
      const start = new Date('2024-01-01');
      const end = new Date('2024-01-31');

      await expect(ScheduleEntry.getAll(knex, '', start, end)).rejects.toThrow(
        'Tenant context is required for getting schedule entries'
      );
    });
  });

  describe('getEarliest', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(ScheduleEntry.getEarliest(knex, '')).rejects.toThrow(
        'Tenant context is required for getting earliest schedule entry'
      );
    });
  });

  describe('get', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(ScheduleEntry.get(knex, '', 'entry-123')).rejects.toThrow(
        'Tenant context is required for getting schedule entry'
      );
    });
  });

  describe('create', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();
      const entry = {
        title: 'Test Entry',
        scheduled_start: new Date('2024-01-15T09:00:00'),
        scheduled_end: new Date('2024-01-15T10:00:00'),
        status: 'scheduled',
        work_item_id: null,
        work_item_type: 'ad_hoc' as const,
        assigned_user_ids: [],
      };
      const options = {
        assignedUserIds: ['user-1'],
      };

      await expect(ScheduleEntry.create(knex, '', entry, options)).rejects.toThrow(
        'Tenant context is required for creating schedule entry'
      );
    });
  });

  describe('update', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(ScheduleEntry.update(knex, '', 'entry-123', {})).rejects.toThrow(
        'Tenant context is required for updating schedule entry'
      );
    });
  });

  describe('delete', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(ScheduleEntry.delete(knex, '', 'entry-123')).rejects.toThrow(
        'Tenant context is required for deleting schedule entry'
      );
    });
  });

  describe('getByWorkItem', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(
        ScheduleEntry.getByWorkItem(knex, '', 'work-item-123', 'ticket')
      ).rejects.toThrow('Tenant context is required for getting schedule entries by work item');
    });
  });

  describe('getByUser', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(ScheduleEntry.getByUser(knex, '', 'user-123')).rejects.toThrow(
        'Tenant context is required for getting schedule entries by user'
      );
    });
  });

  describe('parseRecurrencePattern', () => {
    it('should return null for null input', () => {
      expect(ScheduleEntry.parseRecurrencePattern(null)).toBeNull();
    });

    it('should return the object as-is for object input', () => {
      const pattern = {
        frequency: 'daily' as const,
        interval: 1,
        startDate: new Date('2024-01-01'),
      };

      expect(ScheduleEntry.parseRecurrencePattern(pattern)).toEqual(pattern);
    });

    it('should parse valid JSON string', () => {
      const pattern = {
        frequency: 'weekly',
        interval: 2,
        startDate: '2024-01-01',
      };
      const jsonString = JSON.stringify(pattern);

      const result = ScheduleEntry.parseRecurrencePattern(jsonString);
      expect(result).toEqual(pattern);
    });

    it('should return null for invalid JSON string', () => {
      const invalidJson = 'not valid json';

      // The function should not throw, but return null
      const result = ScheduleEntry.parseRecurrencePattern(invalidJson);
      expect(result).toBeNull();
    });
  });
});
