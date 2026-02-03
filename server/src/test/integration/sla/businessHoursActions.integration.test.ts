// Import mocks first to ensure they're hoisted
import 'server/test-utils/testMocks';

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { TestContext } from 'server/test-utils/testContext';
import { setupCommonMocks } from 'server/test-utils/testMocks';
import { v4 as uuidv4 } from 'uuid';

import {
  getBusinessHoursSchedules,
  getBusinessHoursScheduleById,
  getDefaultBusinessHoursSchedule,
  createBusinessHoursSchedule,
  updateBusinessHoursSchedule,
  deleteBusinessHoursSchedule,
  setDefaultBusinessHoursSchedule,
  getBusinessHoursEntries,
  upsertBusinessHoursEntries,
  deleteBusinessHoursEntry,
  getHolidays,
  createHoliday,
  updateHoliday,
  deleteHoliday,
  bulkCreateHolidays,
  createDefaultBusinessHoursSchedule
} from '@alga-psa/sla/actions';

const HOOK_TIMEOUT = 120_000;

describe('Business Hours Actions Integration Tests', () => {
  const {
    beforeAll: setupContext,
    beforeEach: resetContext,
    afterEach: rollbackContext,
    afterAll: cleanupContext
  } = TestContext.createHelpers();

  let context: TestContext;

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'sla_policies',
        'holidays',
        'business_hours_entries',
        'business_hours_schedules'
      ]
    });

    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      user: context.user,
      permissionCheck: () => true
    });
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    context = await resetContext();
    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      user: context.user,
      permissionCheck: () => true
    });
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await rollbackContext();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await cleanupContext();
  }, HOOK_TIMEOUT);

  // ============================================================================
  // Schedule CRUD Tests
  // ============================================================================
  describe('Schedule CRUD Operations', () => {
    it('should create a new business hours schedule', async () => {
      const schedule = await createBusinessHoursSchedule({
        schedule_name: 'Test Schedule',
        timezone: 'America/New_York',
        is_default: false,
        is_24x7: false
      });

      expect(schedule).toBeDefined();
      expect(schedule.schedule_id).toBeDefined();
      expect(schedule.schedule_name).toBe('Test Schedule');
      expect(schedule.timezone).toBe('America/New_York');
      expect(schedule.is_default).toBe(false);
      expect(schedule.is_24x7).toBe(false);
      expect(schedule.entries).toEqual([]);
      expect(schedule.holidays).toEqual([]);
    });

    it('should create a schedule with entries', async () => {
      const entries = [
        { day_of_week: 1, start_time: '09:00', end_time: '17:00', is_enabled: true },
        { day_of_week: 2, start_time: '09:00', end_time: '17:00', is_enabled: true }
      ];

      const schedule = await createBusinessHoursSchedule(
        {
          schedule_name: 'Schedule with Entries',
          timezone: 'America/Chicago',
          is_default: false,
          is_24x7: false
        },
        entries
      );

      expect(schedule.entries).toHaveLength(2);
      expect(schedule.entries[0].day_of_week).toBe(1);
      expect(schedule.entries[0].start_time).toBe('09:00');
      expect(schedule.entries[0].end_time).toBe('17:00');
      expect(schedule.entries[0].is_enabled).toBe(true);
    });

    it('should get all business hours schedules', async () => {
      await createBusinessHoursSchedule({
        schedule_name: 'Schedule A',
        timezone: 'America/New_York',
        is_default: false,
        is_24x7: false
      });

      await createBusinessHoursSchedule({
        schedule_name: 'Schedule B',
        timezone: 'America/Los_Angeles',
        is_default: false,
        is_24x7: true
      });

      const schedules = await getBusinessHoursSchedules();

      expect(schedules.length).toBeGreaterThanOrEqual(2);
      const names = schedules.map(s => s.schedule_name);
      expect(names).toContain('Schedule A');
      expect(names).toContain('Schedule B');
    });

    it('should get a schedule by ID with entries and holidays', async () => {
      const created = await createBusinessHoursSchedule(
        {
          schedule_name: 'Detailed Schedule',
          timezone: 'UTC',
          is_default: false,
          is_24x7: false
        },
        [{ day_of_week: 0, start_time: '08:00', end_time: '16:00', is_enabled: true }]
      );

      await createHoliday({
        schedule_id: created.schedule_id,
        holiday_name: 'Test Holiday',
        holiday_date: '2025-12-25',
        is_recurring: true
      });

      const schedule = await getBusinessHoursScheduleById(created.schedule_id);

      expect(schedule).toBeDefined();
      expect(schedule!.schedule_name).toBe('Detailed Schedule');
      expect(schedule!.entries).toHaveLength(1);
      expect(schedule!.holidays).toHaveLength(1);
      expect(schedule!.holidays![0].holiday_name).toBe('Test Holiday');
    });

    it('should return null for non-existent schedule', async () => {
      const schedule = await getBusinessHoursScheduleById(uuidv4());
      expect(schedule).toBeNull();
    });

    it('should update a business hours schedule', async () => {
      const created = await createBusinessHoursSchedule({
        schedule_name: 'Original Name',
        timezone: 'America/New_York',
        is_default: false,
        is_24x7: false
      });

      const updated = await updateBusinessHoursSchedule(created.schedule_id, {
        schedule_name: 'Updated Name',
        timezone: 'Europe/London',
        is_24x7: true
      });

      expect(updated.schedule_name).toBe('Updated Name');
      expect(updated.timezone).toBe('Europe/London');
      expect(updated.is_24x7).toBe(true);
    });

    it('should delete a business hours schedule', async () => {
      const schedule = await createBusinessHoursSchedule({
        schedule_name: 'To Be Deleted',
        timezone: 'UTC',
        is_default: false,
        is_24x7: false
      });

      await deleteBusinessHoursSchedule(schedule.schedule_id);

      const fetched = await getBusinessHoursScheduleById(schedule.schedule_id);
      expect(fetched).toBeNull();
    });

    it('should throw error when deleting non-existent schedule', async () => {
      await expect(deleteBusinessHoursSchedule(uuidv4())).rejects.toThrow('Business hours schedule not found');
    });
  });

  // ============================================================================
  // Default Schedule Tests
  // ============================================================================
  describe('Default Business Hours Schedule', () => {
    it('should get the default business hours schedule', async () => {
      await createBusinessHoursSchedule({
        schedule_name: 'Default Schedule',
        timezone: 'America/New_York',
        is_default: true,
        is_24x7: false
      });

      const defaultSchedule = await getDefaultBusinessHoursSchedule();

      expect(defaultSchedule).toBeDefined();
      expect(defaultSchedule!.is_default).toBe(true);
      expect(defaultSchedule!.schedule_name).toBe('Default Schedule');
    });

    it('should return null when no default schedule exists', async () => {
      await createBusinessHoursSchedule({
        schedule_name: 'Non-Default Schedule',
        timezone: 'UTC',
        is_default: false,
        is_24x7: false
      });

      const defaultSchedule = await getDefaultBusinessHoursSchedule();
      expect(defaultSchedule).toBeNull();
    });

    it('should set a schedule as default', async () => {
      const schedule1 = await createBusinessHoursSchedule({
        schedule_name: 'Schedule 1',
        timezone: 'UTC',
        is_default: true,
        is_24x7: false
      });

      const schedule2 = await createBusinessHoursSchedule({
        schedule_name: 'Schedule 2',
        timezone: 'UTC',
        is_default: false,
        is_24x7: false
      });

      await setDefaultBusinessHoursSchedule(schedule2.schedule_id);

      const defaultSchedule = await getDefaultBusinessHoursSchedule();
      expect(defaultSchedule!.schedule_id).toBe(schedule2.schedule_id);

      // Verify old default is no longer default
      const schedule1Updated = await getBusinessHoursScheduleById(schedule1.schedule_id);
      expect(schedule1Updated!.is_default).toBe(false);
    });

    it('should throw error when setting non-existent schedule as default', async () => {
      await expect(setDefaultBusinessHoursSchedule(uuidv4())).rejects.toThrow('Business hours schedule not found');
    });

    it('should only have one default schedule at a time', async () => {
      await createBusinessHoursSchedule({
        schedule_name: 'First Default',
        timezone: 'UTC',
        is_default: true,
        is_24x7: false
      });

      await createBusinessHoursSchedule({
        schedule_name: 'Second Default',
        timezone: 'UTC',
        is_default: true,
        is_24x7: false
      });

      const schedules = await getBusinessHoursSchedules();
      const defaultSchedules = schedules.filter(s => s.is_default);

      expect(defaultSchedules).toHaveLength(1);
      expect(defaultSchedules[0].schedule_name).toBe('Second Default');
    });

    it('should create a standard default business hours schedule', async () => {
      const schedule = await createDefaultBusinessHoursSchedule();

      expect(schedule.schedule_name).toBe('Standard Business Hours');
      expect(schedule.timezone).toBe('America/New_York');
      expect(schedule.is_default).toBe(true);
      expect(schedule.is_24x7).toBe(false);
      expect(schedule.entries).toHaveLength(7);

      // Verify Monday-Friday are enabled
      const mondayEntry = schedule.entries.find(e => e.day_of_week === 1);
      expect(mondayEntry!.is_enabled).toBe(true);
      expect(mondayEntry!.start_time).toBe('08:00');
      expect(mondayEntry!.end_time).toBe('18:00');

      // Verify weekend is disabled
      const sundayEntry = schedule.entries.find(e => e.day_of_week === 0);
      expect(sundayEntry!.is_enabled).toBe(false);
    });
  });

  // ============================================================================
  // Business Hours Entries Tests
  // ============================================================================
  describe('Business Hours Entries CRUD', () => {
    let testScheduleId: string;

    beforeEach(async () => {
      const schedule = await createBusinessHoursSchedule({
        schedule_name: 'Entries Test Schedule',
        timezone: 'UTC',
        is_default: false,
        is_24x7: false
      });
      testScheduleId = schedule.schedule_id;
    });

    it('should get business hours entries for a schedule', async () => {
      await upsertBusinessHoursEntries(testScheduleId, [
        { day_of_week: 1, start_time: '09:00', end_time: '17:00', is_enabled: true },
        { day_of_week: 2, start_time: '09:00', end_time: '17:00', is_enabled: true }
      ]);

      const entries = await getBusinessHoursEntries(testScheduleId);

      expect(entries).toHaveLength(2);
      expect(entries.map(e => e.day_of_week)).toContain(1);
      expect(entries.map(e => e.day_of_week)).toContain(2);
    });

    it('should upsert business hours entries', async () => {
      // Create initial entries
      await upsertBusinessHoursEntries(testScheduleId, [
        { day_of_week: 1, start_time: '09:00', end_time: '17:00', is_enabled: true }
      ]);

      // Update with new entries for the same day
      const updated = await upsertBusinessHoursEntries(testScheduleId, [
        { day_of_week: 1, start_time: '08:00', end_time: '18:00', is_enabled: true }
      ]);

      expect(updated).toHaveLength(1);
      expect(updated[0].start_time).toBe('08:00');
      expect(updated[0].end_time).toBe('18:00');

      // Verify only one entry exists for day 1
      const allEntries = await getBusinessHoursEntries(testScheduleId);
      const dayOneEntries = allEntries.filter(e => e.day_of_week === 1);
      expect(dayOneEntries).toHaveLength(1);
    });

    it('should delete a specific business hours entry', async () => {
      const entries = await upsertBusinessHoursEntries(testScheduleId, [
        { day_of_week: 1, start_time: '09:00', end_time: '17:00', is_enabled: true },
        { day_of_week: 2, start_time: '09:00', end_time: '17:00', is_enabled: true }
      ]);

      await deleteBusinessHoursEntry(entries[0].entry_id);

      const remaining = await getBusinessHoursEntries(testScheduleId);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].day_of_week).toBe(2);
    });

    it('should throw error when deleting non-existent entry', async () => {
      await expect(deleteBusinessHoursEntry(uuidv4())).rejects.toThrow('Business hours entry not found');
    });

    it('should throw error when upserting entries for non-existent schedule', async () => {
      await expect(
        upsertBusinessHoursEntries(uuidv4(), [
          { day_of_week: 1, start_time: '09:00', end_time: '17:00', is_enabled: true }
        ])
      ).rejects.toThrow('Business hours schedule not found');
    });
  });

  // ============================================================================
  // Entry Validation Tests
  // ============================================================================
  describe('Entry Validation', () => {
    let testScheduleId: string;

    beforeEach(async () => {
      const schedule = await createBusinessHoursSchedule({
        schedule_name: 'Validation Test Schedule',
        timezone: 'UTC',
        is_default: false,
        is_24x7: false
      });
      testScheduleId = schedule.schedule_id;
    });

    it('should accept valid day_of_week values (0-6)', async () => {
      const entries = await upsertBusinessHoursEntries(testScheduleId, [
        { day_of_week: 0, start_time: '09:00', end_time: '17:00', is_enabled: true }, // Sunday
        { day_of_week: 3, start_time: '09:00', end_time: '17:00', is_enabled: true }, // Wednesday
        { day_of_week: 6, start_time: '09:00', end_time: '17:00', is_enabled: true }  // Saturday
      ]);

      expect(entries).toHaveLength(3);
      expect(entries.map(e => e.day_of_week).sort()).toEqual([0, 3, 6]);
    });

    it('should handle entries with valid time formats', async () => {
      const entries = await upsertBusinessHoursEntries(testScheduleId, [
        { day_of_week: 1, start_time: '00:00', end_time: '23:59', is_enabled: true },
        { day_of_week: 2, start_time: '08:30', end_time: '17:45', is_enabled: true }
      ]);

      expect(entries).toHaveLength(2);
      expect(entries[0].start_time).toBe('00:00');
      expect(entries[0].end_time).toBe('23:59');
      expect(entries[1].start_time).toBe('08:30');
      expect(entries[1].end_time).toBe('17:45');
    });

    it('should handle disabled entries', async () => {
      const entries = await upsertBusinessHoursEntries(testScheduleId, [
        { day_of_week: 0, start_time: '09:00', end_time: '17:00', is_enabled: false },
        { day_of_week: 6, start_time: '09:00', end_time: '17:00', is_enabled: false }
      ]);

      expect(entries.filter(e => !e.is_enabled)).toHaveLength(2);
    });
  });

  // ============================================================================
  // Holidays CRUD Tests
  // ============================================================================
  describe('Holidays CRUD Operations', () => {
    let testScheduleId: string;

    beforeEach(async () => {
      const schedule = await createBusinessHoursSchedule({
        schedule_name: 'Holidays Test Schedule',
        timezone: 'UTC',
        is_default: false,
        is_24x7: false
      });
      testScheduleId = schedule.schedule_id;
    });

    it('should create a holiday', async () => {
      const holiday = await createHoliday({
        schedule_id: testScheduleId,
        holiday_name: 'Christmas',
        holiday_date: '2025-12-25',
        is_recurring: true
      });

      expect(holiday).toBeDefined();
      expect(holiday.holiday_id).toBeDefined();
      expect(holiday.holiday_name).toBe('Christmas');
      expect(holiday.holiday_date).toBe('2025-12-25');
      expect(holiday.is_recurring).toBe(true);
    });

    it('should create a holiday without schedule (global)', async () => {
      const holiday = await createHoliday({
        holiday_name: 'New Years Day',
        holiday_date: '2025-01-01',
        is_recurring: true
      });

      expect(holiday.schedule_id).toBeNull();
      expect(holiday.holiday_name).toBe('New Years Day');
    });

    it('should get holidays filtered by schedule', async () => {
      await createHoliday({
        schedule_id: testScheduleId,
        holiday_name: 'Schedule Holiday',
        holiday_date: '2025-07-04',
        is_recurring: false
      });

      await createHoliday({
        holiday_name: 'Global Holiday',
        holiday_date: '2025-12-25',
        is_recurring: true
      });

      const scheduleHolidays = await getHolidays(testScheduleId);
      expect(scheduleHolidays).toHaveLength(1);
      expect(scheduleHolidays[0].holiday_name).toBe('Schedule Holiday');
    });

    it('should get all holidays when no schedule filter', async () => {
      await createHoliday({
        schedule_id: testScheduleId,
        holiday_name: 'Schedule Holiday',
        holiday_date: '2025-07-04',
        is_recurring: false
      });

      await createHoliday({
        holiday_name: 'Global Holiday',
        holiday_date: '2025-12-25',
        is_recurring: true
      });

      const allHolidays = await getHolidays();
      expect(allHolidays.length).toBeGreaterThanOrEqual(2);
    });

    it('should update a holiday', async () => {
      const holiday = await createHoliday({
        schedule_id: testScheduleId,
        holiday_name: 'Original Name',
        holiday_date: '2025-01-01',
        is_recurring: false
      });

      const updated = await updateHoliday(holiday.holiday_id, {
        holiday_name: 'Updated Name',
        holiday_date: '2025-12-31',
        is_recurring: true
      });

      expect(updated.holiday_name).toBe('Updated Name');
      expect(updated.holiday_date).toBe('2025-12-31');
      expect(updated.is_recurring).toBe(true);
    });

    it('should delete a holiday', async () => {
      const holiday = await createHoliday({
        schedule_id: testScheduleId,
        holiday_name: 'To Be Deleted',
        holiday_date: '2025-06-15',
        is_recurring: false
      });

      await deleteHoliday(holiday.holiday_id);

      const holidays = await getHolidays(testScheduleId);
      expect(holidays.find(h => h.holiday_id === holiday.holiday_id)).toBeUndefined();
    });

    it('should throw error when deleting non-existent holiday', async () => {
      await expect(deleteHoliday(uuidv4())).rejects.toThrow('Holiday not found');
    });

    it('should throw error when creating holiday for non-existent schedule', async () => {
      await expect(
        createHoliday({
          schedule_id: uuidv4(),
          holiday_name: 'Invalid Holiday',
          holiday_date: '2025-01-01',
          is_recurring: false
        })
      ).rejects.toThrow('Business hours schedule not found');
    });
  });

  // ============================================================================
  // Recurring vs One-Time Holidays Tests
  // ============================================================================
  describe('Recurring vs One-Time Holidays', () => {
    let testScheduleId: string;

    beforeEach(async () => {
      const schedule = await createBusinessHoursSchedule({
        schedule_name: 'Recurring Holiday Test Schedule',
        timezone: 'UTC',
        is_default: false,
        is_24x7: false
      });
      testScheduleId = schedule.schedule_id;
    });

    it('should create a recurring holiday', async () => {
      const holiday = await createHoliday({
        schedule_id: testScheduleId,
        holiday_name: 'Christmas',
        holiday_date: '2025-12-25',
        is_recurring: true
      });

      expect(holiday.is_recurring).toBe(true);
    });

    it('should create a one-time holiday', async () => {
      const holiday = await createHoliday({
        schedule_id: testScheduleId,
        holiday_name: 'Company Event',
        holiday_date: '2025-03-15',
        is_recurring: false
      });

      expect(holiday.is_recurring).toBe(false);
    });

    it('should default to non-recurring when is_recurring not specified', async () => {
      const holiday = await createHoliday({
        schedule_id: testScheduleId,
        holiday_name: 'Default Recurring Test',
        holiday_date: '2025-05-01'
      });

      expect(holiday.is_recurring).toBe(false);
    });
  });

  // ============================================================================
  // Bulk Create Holidays Tests
  // ============================================================================
  describe('Bulk Create Holidays', () => {
    let testScheduleId: string;

    beforeEach(async () => {
      const schedule = await createBusinessHoursSchedule({
        schedule_name: 'Bulk Holiday Test Schedule',
        timezone: 'UTC',
        is_default: false,
        is_24x7: false
      });
      testScheduleId = schedule.schedule_id;
    });

    it('should bulk create multiple holidays', async () => {
      const holidays = await bulkCreateHolidays([
        { schedule_id: testScheduleId, holiday_name: 'New Year', holiday_date: '2025-01-01', is_recurring: true },
        { schedule_id: testScheduleId, holiday_name: 'Independence Day', holiday_date: '2025-07-04', is_recurring: true },
        { schedule_id: testScheduleId, holiday_name: 'Christmas', holiday_date: '2025-12-25', is_recurring: true }
      ]);

      expect(holidays).toHaveLength(3);
      expect(holidays.map(h => h.holiday_name)).toContain('New Year');
      expect(holidays.map(h => h.holiday_name)).toContain('Independence Day');
      expect(holidays.map(h => h.holiday_name)).toContain('Christmas');
    });

    it('should bulk create holidays with mixed schedules', async () => {
      const schedule2 = await createBusinessHoursSchedule({
        schedule_name: 'Second Schedule',
        timezone: 'UTC',
        is_default: false,
        is_24x7: false
      });

      const holidays = await bulkCreateHolidays([
        { schedule_id: testScheduleId, holiday_name: 'Holiday A', holiday_date: '2025-01-01' },
        { schedule_id: schedule2.schedule_id, holiday_name: 'Holiday B', holiday_date: '2025-02-01' },
        { holiday_name: 'Global Holiday', holiday_date: '2025-03-01' }
      ]);

      expect(holidays).toHaveLength(3);
      expect(holidays.find(h => h.holiday_name === 'Holiday A')!.schedule_id).toBe(testScheduleId);
      expect(holidays.find(h => h.holiday_name === 'Holiday B')!.schedule_id).toBe(schedule2.schedule_id);
      expect(holidays.find(h => h.holiday_name === 'Global Holiday')!.schedule_id).toBeNull();
    });

    it('should return empty array when bulk creating with empty input', async () => {
      const holidays = await bulkCreateHolidays([]);
      expect(holidays).toHaveLength(0);
    });

    it('should throw error when bulk creating with invalid schedule_id', async () => {
      await expect(
        bulkCreateHolidays([
          { schedule_id: uuidv4(), holiday_name: 'Invalid', holiday_date: '2025-01-01' }
        ])
      ).rejects.toThrow('Business hours schedules not found');
    });
  });

  // ============================================================================
  // Delete Schedule with SLA Policy Reference Tests
  // ============================================================================
  describe('Delete Schedule with SLA Policy Reference', () => {
    it('should fail to delete schedule when referenced by SLA policy', async () => {
      const schedule = await createBusinessHoursSchedule({
        schedule_name: 'Referenced Schedule',
        timezone: 'UTC',
        is_default: false,
        is_24x7: false
      });

      // Insert SLA policy that references this schedule directly into the database
      await context.db('sla_policies').insert({
        tenant: context.tenantId,
        sla_policy_id: uuidv4(),
        policy_name: 'Test SLA Policy',
        description: 'Test description',
        is_default: false,
        business_hours_schedule_id: schedule.schedule_id
      });

      await expect(deleteBusinessHoursSchedule(schedule.schedule_id)).rejects.toThrow(
        'Cannot delete schedule: it is used by one or more SLA policies'
      );

      // Verify schedule still exists
      const fetched = await getBusinessHoursScheduleById(schedule.schedule_id);
      expect(fetched).not.toBeNull();
    });

    it('should delete schedule when not referenced by any SLA policy', async () => {
      const schedule = await createBusinessHoursSchedule({
        schedule_name: 'Unreferenced Schedule',
        timezone: 'UTC',
        is_default: false,
        is_24x7: false
      });

      // Add some entries and holidays to ensure cascade delete works
      await upsertBusinessHoursEntries(schedule.schedule_id, [
        { day_of_week: 1, start_time: '09:00', end_time: '17:00', is_enabled: true }
      ]);

      await createHoliday({
        schedule_id: schedule.schedule_id,
        holiday_name: 'Test Holiday',
        holiday_date: '2025-12-25',
        is_recurring: true
      });

      await deleteBusinessHoursSchedule(schedule.schedule_id);

      const fetched = await getBusinessHoursScheduleById(schedule.schedule_id);
      expect(fetched).toBeNull();

      // Verify entries and holidays were also deleted
      const entries = await getBusinessHoursEntries(schedule.schedule_id);
      expect(entries).toHaveLength(0);

      const holidays = await getHolidays(schedule.schedule_id);
      expect(holidays).toHaveLength(0);
    });
  });

  // ============================================================================
  // Multi-Tenant Isolation Tests
  // ============================================================================
  describe('Multi-Tenant Isolation', () => {
    it('should only return schedules for the current tenant', async () => {
      // Create a schedule in the current tenant context
      const currentTenantSchedule = await createBusinessHoursSchedule({
        schedule_name: 'Current Tenant Schedule',
        timezone: 'UTC',
        is_default: false,
        is_24x7: false
      });

      // Insert a schedule directly for a different tenant
      const otherTenantId = uuidv4();
      await context.db('tenants').insert({
        tenant: otherTenantId,
        client_name: 'Other Tenant',
        email: 'other@test.com'
      });

      await context.db('business_hours_schedules').insert({
        tenant: otherTenantId,
        schedule_id: uuidv4(),
        schedule_name: 'Other Tenant Schedule',
        timezone: 'UTC',
        is_default: false,
        is_24x7: false
      });

      // Get schedules - should only see current tenant's schedule
      const schedules = await getBusinessHoursSchedules();
      const scheduleNames = schedules.map(s => s.schedule_name);

      expect(scheduleNames).toContain('Current Tenant Schedule');
      expect(scheduleNames).not.toContain('Other Tenant Schedule');
    });

    it('should not be able to access another tenants schedule by ID', async () => {
      // Insert a schedule for a different tenant
      const otherTenantId = uuidv4();
      const otherScheduleId = uuidv4();

      await context.db('tenants').insert({
        tenant: otherTenantId,
        client_name: 'Other Tenant 2',
        email: 'other2@test.com'
      });

      await context.db('business_hours_schedules').insert({
        tenant: otherTenantId,
        schedule_id: otherScheduleId,
        schedule_name: 'Other Tenant Schedule',
        timezone: 'UTC',
        is_default: false,
        is_24x7: false
      });

      // Try to get the other tenant's schedule - should return null
      const schedule = await getBusinessHoursScheduleById(otherScheduleId);
      expect(schedule).toBeNull();
    });

    it('should not be able to update another tenants schedule', async () => {
      const otherTenantId = uuidv4();
      const otherScheduleId = uuidv4();

      await context.db('tenants').insert({
        tenant: otherTenantId,
        client_name: 'Other Tenant 3',
        email: 'other3@test.com'
      });

      await context.db('business_hours_schedules').insert({
        tenant: otherTenantId,
        schedule_id: otherScheduleId,
        schedule_name: 'Other Tenant Schedule',
        timezone: 'UTC',
        is_default: false,
        is_24x7: false
      });

      // Try to update - should throw error
      await expect(
        updateBusinessHoursSchedule(otherScheduleId, { schedule_name: 'Hacked' })
      ).rejects.toThrow('Business hours schedule not found');
    });

    it('should isolate holidays by tenant', async () => {
      const schedule = await createBusinessHoursSchedule({
        schedule_name: 'Holiday Isolation Test',
        timezone: 'UTC',
        is_default: false,
        is_24x7: false
      });

      await createHoliday({
        schedule_id: schedule.schedule_id,
        holiday_name: 'Current Tenant Holiday',
        holiday_date: '2025-01-01',
        is_recurring: false
      });

      // Insert a holiday for a different tenant
      const otherTenantId = uuidv4();
      await context.db('tenants').insert({
        tenant: otherTenantId,
        client_name: 'Other Tenant 4',
        email: 'other4@test.com'
      });

      await context.db('holidays').insert({
        tenant: otherTenantId,
        holiday_id: uuidv4(),
        schedule_id: null,
        holiday_name: 'Other Tenant Holiday',
        holiday_date: '2025-12-25',
        is_recurring: false
      });

      const holidays = await getHolidays();
      const holidayNames = holidays.map(h => h.holiday_name);

      expect(holidayNames).toContain('Current Tenant Holiday');
      expect(holidayNames).not.toContain('Other Tenant Holiday');
    });
  });
});
