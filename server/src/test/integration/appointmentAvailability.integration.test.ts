import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { setupCommonMocks, createMockUser } from '../../../test-utils/testMocks';

let db: Knex;
let tenantId: string;
let getAvailableTimeSlots: typeof import('server/src/lib/services/availabilityService').getAvailableTimeSlots;
let getAvailableDates: typeof import('server/src/lib/services/availabilityService').getAvailableDates;
let isSlotAvailable: typeof import('server/src/lib/services/availabilityService').isSlotAvailable;

type CreatedIds = {
  serviceTypeId?: string;
  serviceId?: string;
  userId?: string;
  user2Id?: string;
  user3Id?: string;
  availabilitySettingIds: string[];
  exceptionIds: string[];
  scheduleEntryIds: string[];
};
let createdIds: CreatedIds = { availabilitySettingIds: [], exceptionIds: [], scheduleEntryIds: [] };

// Mock the database module to return test database
vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn())
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null)
}));

describe('Appointment Availability Integration Tests', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'sebastian_test';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureTenant(db);

    // Import the functions after mocks are set up
    ({ getAvailableTimeSlots, getAvailableDates, isSlotAvailable } = await import('server/src/lib/services/availabilityService'));
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  afterEach(async () => {
    if (db && tenantId) {
      await cleanupCreatedRecords(db, tenantId, createdIds);
    }
    createdIds = { availabilitySettingIds: [], exceptionIds: [], scheduleEntryIds: [] };
    vi.clearAllMocks();
  });

  describe('1. Time Slot Availability', () => {
    it('should get available time slots for a date', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId);

      // Get next Monday
      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      const slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        60,
        userId
      );

      expect(slots.length).toBeGreaterThan(0);
      expect(slots[0]).toHaveProperty('start_time');
      expect(slots[0]).toHaveProperty('end_time');
      expect(slots[0]).toHaveProperty('available_users');
      expect(slots[0].available_users).toContain(userId);
      expect(slots[0].is_available).toBe(true);

      // Verify slots are within working hours (09:00 - 17:00)
      slots.forEach(slot => {
        const startTime = new Date(slot.start_time);
        const hour = startTime.getHours();
        expect(hour).toBeGreaterThanOrEqual(9);
        expect(hour).toBeLessThan(17);
      });
    });

    it('should exclude slots with existing appointments (conflicts)', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId);

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      // Create an existing appointment at 10:00
      const appointmentStart = new Date(nextMonday);
      appointmentStart.setHours(10, 0, 0, 0);
      const appointmentEnd = new Date(appointmentStart);
      appointmentEnd.setMinutes(appointmentEnd.getMinutes() + 60);

      const scheduleEntryId = await createScheduleEntry(
        db,
        tenantId,
        userId,
        appointmentStart,
        appointmentEnd
      );
      createdIds.scheduleEntryIds.push(scheduleEntryId);

      const slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        60,
        userId
      );

      // Verify no slots overlap with the 10:00-11:00 appointment
      const conflictingSlots = slots.filter(slot => {
        const slotStart = new Date(slot.start_time);
        const slotEnd = new Date(slot.end_time);
        return (slotStart < appointmentEnd && slotEnd > appointmentStart);
      });

      expect(conflictingSlots.length).toBe(0);
    });

    it('should apply buffer times between appointments', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId, {
        bufferBefore: 15,
        bufferAfter: 15
      });

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      // Create appointment at 10:00-11:00
      const appointmentStart = new Date(nextMonday);
      appointmentStart.setHours(10, 0, 0, 0);
      const appointmentEnd = new Date(appointmentStart);
      appointmentEnd.setMinutes(appointmentEnd.getMinutes() + 60);

      const scheduleEntryId = await createScheduleEntry(
        db,
        tenantId,
        userId,
        appointmentStart,
        appointmentEnd
      );
      createdIds.scheduleEntryIds.push(scheduleEntryId);

      const slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        60,
        userId
      );

      // Verify no slots exist in the buffered time (09:45-11:15)
      const bufferedStart = new Date(appointmentStart);
      bufferedStart.setMinutes(bufferedStart.getMinutes() - 15);
      const bufferedEnd = new Date(appointmentEnd);
      bufferedEnd.setMinutes(bufferedEnd.getMinutes() + 15);

      const conflictingSlots = slots.filter(slot => {
        const slotStart = new Date(slot.start_time);
        const slotEnd = new Date(slot.end_time);
        return (slotStart < bufferedEnd && slotEnd > bufferedStart);
      });

      expect(conflictingSlots.length).toBe(0);
    });

    it('should handle user working hours', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId, {
        workingHours: { start: '13:00', end: '17:00' }
      });

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      const slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        60,
        userId
      );

      expect(slots.length).toBeGreaterThan(0);

      // All slots should be between 13:00 and 17:00
      slots.forEach(slot => {
        const startTime = new Date(slot.start_time);
        const hour = startTime.getHours();
        const minute = startTime.getMinutes();
        const totalMinutes = hour * 60 + minute;

        expect(totalMinutes).toBeGreaterThanOrEqual(13 * 60);
        expect(totalMinutes).toBeLessThan(17 * 60);
      });
    });

    it('should handle day-of-week availability', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId, {
        dayOfWeek: 2 // Tuesday only
      });

      // Try to get slots for Monday (should be empty)
      const nextMonday = getNextWeekday(1);
      const mondayStr = nextMonday.toISOString().split('T')[0];

      const mondaySlots = await getAvailableTimeSlots(
        tenantId,
        mondayStr,
        serviceId!,
        60,
        userId
      );

      expect(mondaySlots.length).toBe(0);

      // Try to get slots for Tuesday (should have slots)
      const nextTuesday = getNextWeekday(2);
      const tuesdayStr = nextTuesday.toISOString().split('T')[0];

      const tuesdaySlots = await getAvailableTimeSlots(
        tenantId,
        tuesdayStr,
        serviceId!,
        60,
        userId
      );

      expect(tuesdaySlots.length).toBeGreaterThan(0);
    });
  });

  describe('2. Advance Booking Windows', () => {
    it('should respect advance_booking_days setting', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId, {
        advanceBookingDays: 7
      });

      // Try to get slots 30 days in the future (should be empty)
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      const futureDateStr = futureDate.toISOString().split('T')[0];

      const slots = await getAvailableTimeSlots(
        tenantId,
        futureDateStr,
        serviceId!,
        60,
        userId
      );

      expect(slots.length).toBe(0);

      // Try to get slots 3 days in the future (should have slots)
      const nearDate = new Date();
      nearDate.setDate(nearDate.getDate() + 3);
      // Make sure it's the correct day of week (Monday)
      while (nearDate.getDay() !== 1) {
        nearDate.setDate(nearDate.getDate() + 1);
      }
      const nearDateStr = nearDate.toISOString().split('T')[0];

      const nearSlots = await getAvailableTimeSlots(
        tenantId,
        nearDateStr,
        serviceId!,
        60,
        userId
      );

      expect(nearSlots.length).toBeGreaterThan(0);
    });

    it('should reject dates in the past', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId);

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      const slots = await getAvailableTimeSlots(
        tenantId,
        yesterdayStr,
        serviceId!,
        60,
        userId
      );

      expect(slots.length).toBe(0);
    });
  });

  describe('3. Minimum Notice Requirements', () => {
    it('should respect minimum_notice_hours setting', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId, {
        minimumNoticeHours: 48
      });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      // Make it a Monday
      while (tomorrow.getDay() !== 1) {
        tomorrow.setDate(tomorrow.getDate() + 1);
      }
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      const slots = await getAvailableTimeSlots(
        tenantId,
        tomorrowStr,
        serviceId!,
        60,
        userId
      );

      // All slots should be at least 48 hours in the future
      const minTime = new Date();
      minTime.setHours(minTime.getHours() + 48);

      slots.forEach(slot => {
        const slotStart = new Date(slot.start_time);
        expect(slotStart.getTime()).toBeGreaterThanOrEqual(minTime.getTime());
      });
    });

    it('should allow slots that meet minimum notice', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId, {
        minimumNoticeHours: 2
      });

      // Get slots for a date 3 days out
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 3);
      // Make it a Monday
      while (futureDate.getDay() !== 1) {
        futureDate.setDate(futureDate.getDate() + 1);
      }
      const futureDateStr = futureDate.toISOString().split('T')[0];

      const slots = await getAvailableTimeSlots(
        tenantId,
        futureDateStr,
        serviceId!,
        60,
        userId
      );

      expect(slots.length).toBeGreaterThan(0);
    });
  });

  describe('4. Max Appointments Per Day', () => {
    it('should respect max_appointments_per_day limit', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId, {
        maxAppointmentsPerDay: 2
      });

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      // Create 2 appointments for that day
      const appt1Start = new Date(nextMonday);
      appt1Start.setHours(9, 0, 0, 0);
      const appt1End = new Date(appt1Start);
      appt1End.setMinutes(appt1End.getMinutes() + 60);

      const appt2Start = new Date(nextMonday);
      appt2Start.setHours(11, 0, 0, 0);
      const appt2End = new Date(appt2Start);
      appt2End.setMinutes(appt2End.getMinutes() + 60);

      const entry1Id = await createScheduleEntry(db, tenantId, userId, appt1Start, appt1End);
      const entry2Id = await createScheduleEntry(db, tenantId, userId, appt2Start, appt2End);
      createdIds.scheduleEntryIds.push(entry1Id, entry2Id);

      const slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        60,
        userId
      );

      // Should have no available slots since limit is reached
      expect(slots.length).toBe(0);
    });

    it('should return slots when below daily limit', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId, {
        maxAppointmentsPerDay: 5
      });

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      // Create 1 appointment
      const apptStart = new Date(nextMonday);
      apptStart.setHours(9, 0, 0, 0);
      const apptEnd = new Date(apptStart);
      apptEnd.setMinutes(apptEnd.getMinutes() + 60);

      const entryId = await createScheduleEntry(db, tenantId, userId, apptStart, apptEnd);
      createdIds.scheduleEntryIds.push(entryId);

      const slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        60,
        userId
      );

      // Should still have available slots
      expect(slots.length).toBeGreaterThan(0);
    });
  });

  describe('5. Availability Exceptions', () => {
    it('should handle company-wide holidays (all users unavailable)', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId);

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      // Create company-wide exception (user_id is NULL)
      const exceptionId = await createAvailabilityException(
        db,
        tenantId,
        null,
        dateStr,
        false,
        'Company Holiday'
      );
      createdIds.exceptionIds.push(exceptionId);

      const slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        60,
        userId
      );

      expect(slots.length).toBe(0);
    });

    it('should handle user-specific time off', async () => {
      const { serviceId, userId, user2Id } = await setupTestDataMultipleUsers(db, tenantId);

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      // Create user-specific exception for user1
      const exceptionId = await createAvailabilityException(
        db,
        tenantId,
        userId,
        dateStr,
        false,
        'Personal Time Off'
      );
      createdIds.exceptionIds.push(exceptionId);

      // Get slots without specifying user (should return user2's slots only)
      const slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        60
      );

      expect(slots.length).toBeGreaterThan(0);
      // Verify user1 is not in available users
      slots.forEach(slot => {
        expect(slot.available_users).not.toContain(userId);
        expect(slot.available_users).toContain(user2Id);
      });
    });

    it('should handle available exceptions (override normal schedule)', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId, {
        dayOfWeek: 1 // Only Monday
      });

      // Get next Tuesday (normally not available)
      const nextTuesday = getNextWeekday(2);
      const dateStr = nextTuesday.toISOString().split('T')[0];

      // Verify no slots normally
      const slotsWithoutException = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        60,
        userId
      );
      expect(slotsWithoutException.length).toBe(0);

      // Create available exception for Tuesday
      const exceptionId = await createAvailabilityException(
        db,
        tenantId,
        userId,
        dateStr,
        true,
        'Special availability'
      );
      createdIds.exceptionIds.push(exceptionId);

      const slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        60,
        userId
      );

      expect(slots.length).toBeGreaterThan(0);
      expect(slots[0].available_users).toContain(userId);
    });
  });

  describe('6. Multiple Users/Technicians', () => {
    it('should get slots when ANY technician available', async () => {
      const { serviceId, userId, user2Id } = await setupTestDataMultipleUsers(db, tenantId);

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      // Create appointment for user1 at 10:00
      const appt1Start = new Date(nextMonday);
      appt1Start.setHours(10, 0, 0, 0);
      const appt1End = new Date(appt1Start);
      appt1End.setMinutes(appt1End.getMinutes() + 60);

      const entry1Id = await createScheduleEntry(db, tenantId, userId, appt1Start, appt1End);
      createdIds.scheduleEntryIds.push(entry1Id);

      // Get slots without specifying user
      const slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        60
      );

      // Should have slots including the 10:00 slot (available for user2)
      const tenOClockSlots = slots.filter(slot => {
        const startTime = new Date(slot.start_time);
        return startTime.getHours() === 10 && startTime.getMinutes() === 0;
      });

      expect(tenOClockSlots.length).toBeGreaterThan(0);
      expect(tenOClockSlots[0].available_users).toContain(user2Id);
      expect(tenOClockSlots[0].available_users).not.toContain(userId);
    });

    it('should get slots for specific technician', async () => {
      const { serviceId, userId, user2Id } = await setupTestDataMultipleUsers(db, tenantId);

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      // Get slots for specific user
      const user1Slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        60,
        userId
      );

      expect(user1Slots.length).toBeGreaterThan(0);
      user1Slots.forEach(slot => {
        expect(slot.available_users).toContain(userId);
        expect(slot.available_users.length).toBe(1);
      });
    });

    it('should handle overlapping availability', async () => {
      const { serviceId, userId, user2Id } = await setupTestDataMultipleUsers(db, tenantId);

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      const slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        60
      );

      // Should have slots with both users available
      const slotsWithBothUsers = slots.filter(
        slot => slot.available_users.includes(userId) && slot.available_users.includes(user2Id)
      );

      expect(slotsWithBothUsers.length).toBeGreaterThan(0);
    });
  });

  describe('7. Service-Specific Rules', () => {
    it('should filter services requiring contract', async () => {
      // This is tested indirectly through the service settings
      // The actual filtering happens in the appointment request creation
      const { serviceId, userId } = await setupTestData(db, tenantId, {
        allowWithoutContract: false
      });

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      const slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        60,
        userId
      );

      // Slots should still be available - contract checking happens elsewhere
      expect(slots.length).toBeGreaterThan(0);
    });

    it('should allow public booking services', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId, {
        allowWithoutContract: true
      });

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      const slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        60,
        userId
      );

      expect(slots.length).toBeGreaterThan(0);
    });

    it('should handle service-specific duration', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId);

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      // Request 120-minute slots
      const slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        120,
        userId
      );

      expect(slots.length).toBeGreaterThan(0);

      // Verify each slot is 120 minutes
      slots.forEach(slot => {
        const start = new Date(slot.start_time);
        const end = new Date(slot.end_time);
        const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
        expect(durationMinutes).toBe(120);
      });
    });
  });

  describe('8. Edge Cases', () => {
    it('should handle no availability settings (use defaults)', async () => {
      // Create minimal test data without availability settings
      const serviceTypeId = uuidv4();
      await db('service_types').insert({
        id: serviceTypeId,
        tenant: tenantId,
        name: `Service Type ${serviceTypeId.slice(0, 8)}`,
        billing_method: 'fixed',
        order_number: Math.floor(Math.random() * 1000000),
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      });
      createdIds.serviceTypeId = serviceTypeId;

      const serviceId = uuidv4();
      await db('service_catalog').insert({
        tenant: tenantId,
        service_id: serviceId!,
        service_name: 'Test Service',
        billing_method: 'fixed',
        default_rate: 10000,
        custom_service_type_id: serviceTypeId
      });
      createdIds.serviceId = serviceId;

      const userId = uuidv4();
      await db('users').insert({
        tenant: tenantId,
        user_id: userId,
        username: 'testuser',
        first_name: 'Test',
        last_name: 'User',
        email: 'test@test.com',
        hashed_password: 'hashed',
        user_type: 'internal',
        is_inactive: false
      });
      createdIds.userId = userId;

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      const slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        60,
        userId
      );

      // Should return empty since no availability settings
      expect(slots.length).toBe(0);
    });

    it('should handle midnight boundary correctly', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId, {
        workingHours: { start: '00:00', end: '23:59' }
      });

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      const slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        60,
        userId
      );

      expect(slots.length).toBeGreaterThan(0);

      // Verify first slot starts at midnight
      const firstSlot = slots[0];
      const startTime = new Date(firstSlot.start_time);
      expect(startTime.getHours()).toBe(0);
      expect(startTime.getMinutes()).toBe(0);
    });

    it('should handle cross-day appointments correctly', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId, {
        workingHours: { start: '22:00', end: '23:59' }
      });

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      // Request 2-hour slot that would cross midnight
      const slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        120,
        userId
      );

      // Should have no slots since 2-hour slot can't fit in 22:00-23:59
      expect(slots.length).toBe(0);
    });
  });

  describe('9. getAvailableDates Integration', () => {
    it('should return dates with availability', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);

      const startDate = today.toISOString().split('T')[0];
      const endDate = nextWeek.toISOString().split('T')[0];

      const dates = await getAvailableDates(
        tenantId,
        serviceId!,
        startDate,
        endDate,
        userId
      );

      expect(dates.length).toBeGreaterThan(0);
      expect(dates[0]).toHaveProperty('date');
      expect(dates[0]).toHaveProperty('has_availability');
      expect(dates[0]).toHaveProperty('slot_count');

      // At least one date should have availability (Monday)
      const datesWithAvailability = dates.filter(d => d.has_availability);
      expect(datesWithAvailability.length).toBeGreaterThan(0);
    });

    it('should mark dates without availability correctly', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId, {
        dayOfWeek: 1 // Only Monday
      });

      const nextMonday = getNextWeekday(1);
      const nextSunday = new Date(nextMonday);
      nextSunday.setDate(nextSunday.getDate() + 6);

      const startDate = nextMonday.toISOString().split('T')[0];
      const endDate = nextSunday.toISOString().split('T')[0];

      const dates = await getAvailableDates(
        tenantId,
        serviceId!,
        startDate,
        endDate,
        userId
      );

      // Only Monday should have availability
      const monday = dates.find(d => new Date(d.date).getDay() === 1);
      expect(monday?.has_availability).toBe(true);

      // Other days should not have availability
      const otherDays = dates.filter(d => new Date(d.date).getDay() !== 1);
      otherDays.forEach(day => {
        expect(day.has_availability).toBe(false);
        expect(day.slot_count).toBe(0);
      });
    });
  });

  describe('10. isSlotAvailable Integration', () => {
    it('should correctly identify available slots', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId);

      const nextMonday = getNextWeekday(1);
      const slotStart = new Date(nextMonday);
      slotStart.setHours(14, 0, 0, 0);

      const isAvailable = await isSlotAvailable(
        tenantId,
        slotStart.toISOString(),
        60,
        userId
      );

      expect(isAvailable).toBe(true);
    });

    it('should identify conflicting slots', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId);

      const nextMonday = getNextWeekday(1);
      const apptStart = new Date(nextMonday);
      apptStart.setHours(14, 0, 0, 0);
      const apptEnd = new Date(apptStart);
      apptEnd.setMinutes(apptEnd.getMinutes() + 60);

      // Create existing appointment
      const entryId = await createScheduleEntry(db, tenantId, userId, apptStart, apptEnd);
      createdIds.scheduleEntryIds.push(entryId);

      // Try to check same slot
      const isAvailable = await isSlotAvailable(
        tenantId,
        apptStart.toISOString(),
        60,
        userId
      );

      expect(isAvailable).toBe(false);
    });

    it('should respect company-wide exceptions in slot check', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId);

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      // Create company-wide exception
      const exceptionId = await createAvailabilityException(
        db,
        tenantId,
        null,
        dateStr,
        false,
        'Company Holiday'
      );
      createdIds.exceptionIds.push(exceptionId);

      const slotStart = new Date(nextMonday);
      slotStart.setHours(14, 0, 0, 0);

      const isAvailable = await isSlotAvailable(
        tenantId,
        slotStart.toISOString(),
        60,
        userId
      );

      expect(isAvailable).toBe(false);
    });
  });

  describe('11. Time Slot Intervals', () => {
    it('should generate slots at 15-minute intervals', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId, {
        workingHours: { start: '09:00', end: '10:00' }
      });

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      const slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        15, // 15-minute slots
        userId
      );

      expect(slots.length).toBeGreaterThan(0);

      // Verify 15-minute intervals
      slots.forEach(slot => {
        const start = new Date(slot.start_time);
        const end = new Date(slot.end_time);
        const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
        expect(durationMinutes).toBe(15);
      });

      // Verify slots are sequential at 15-minute intervals
      for (let i = 1; i < slots.length; i++) {
        const prevEnd = new Date(slots[i - 1].end_time);
        const currentStart = new Date(slots[i].start_time);
        const gap = (currentStart.getTime() - prevEnd.getTime()) / (1000 * 60);
        expect(gap).toBe(0); // Slots should be continuous
      }
    });

    it('should generate slots at 30-minute intervals', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId, {
        workingHours: { start: '13:00', end: '15:00' }
      });

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      const slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        30, // 30-minute slots
        userId
      );

      expect(slots.length).toBeGreaterThan(0);

      slots.forEach(slot => {
        const start = new Date(slot.start_time);
        const end = new Date(slot.end_time);
        const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
        expect(durationMinutes).toBe(30);
      });
    });

    it('should handle non-standard duration (45 minutes)', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId);

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      const slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        45, // 45-minute slots
        userId
      );

      expect(slots.length).toBeGreaterThan(0);

      slots.forEach(slot => {
        const start = new Date(slot.start_time);
        const end = new Date(slot.end_time);
        const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
        expect(durationMinutes).toBe(45);
      });
    });

    it('should handle very long appointments (4 hours)', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId);

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      const slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId!,
        240, // 4-hour slots
        userId
      );

      expect(slots.length).toBeGreaterThan(0);

      slots.forEach(slot => {
        const start = new Date(slot.start_time);
        const end = new Date(slot.end_time);
        const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
        expect(durationMinutes).toBe(240);
      });
    });
  });

  describe('12. Recurring Availability Patterns', () => {
    it('should support multiple days of the week availability', async () => {
      const { serviceId } = await setupTestData(db, tenantId, {
        dayOfWeek: 1 // Monday only for this user
      });

      // Create a second user available on Wednesday
      const user2Id = uuidv4();
      await db('users').insert({
        tenant: tenantId,
        user_id: user2Id,
        username: `user2_${user2Id.slice(0, 8)}`,
        first_name: 'User',
        last_name: 'Two',
        email: 'user2@test.com',
        hashed_password: 'hashed',
        user_type: 'internal',
        is_inactive: false
      });
      createdIds.user2Id = user2Id;

      const user2SettingId = uuidv4();
      await db('availability_settings').insert({
        availability_setting_id: user2SettingId,
        tenant: tenantId,
        setting_type: 'user_hours',
        user_id: user2Id,
        day_of_week: 3, // Wednesday
        start_time: '09:00',
        end_time: '17:00',
        is_available: true
      });
      createdIds.availabilitySettingIds.push(user2SettingId);

      // Check Monday
      const nextMonday = getNextWeekday(1);
      const mondayStr = nextMonday.toISOString().split('T')[0];
      const mondaySlots = await getAvailableTimeSlots(tenantId, mondayStr, serviceId, 60);

      expect(mondaySlots.length).toBeGreaterThan(0);

      // Check Wednesday
      const nextWednesday = getNextWeekday(3);
      const wednesdayStr = nextWednesday.toISOString().split('T')[0];
      const wednesdaySlots = await getAvailableTimeSlots(tenantId, wednesdayStr, serviceId, 60);

      expect(wednesdaySlots.length).toBeGreaterThan(0);

      // Check Tuesday (should be empty)
      const nextTuesday = getNextWeekday(2);
      const tuesdayStr = nextTuesday.toISOString().split('T')[0];
      const tuesdaySlots = await getAvailableTimeSlots(tenantId, tuesdayStr, serviceId, 60);

      expect(tuesdaySlots.length).toBe(0);
    });

    it('should handle split shifts (morning and afternoon)', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId, {
        workingHours: { start: '09:00', end: '12:00' } // Morning shift
      });

      // Add afternoon shift for same user
      const afternoonSettingId = uuidv4();
      await db('availability_settings').insert({
        availability_setting_id: afternoonSettingId,
        tenant: tenantId,
        setting_type: 'user_hours',
        user_id: userId,
        day_of_week: 1,
        start_time: '14:00',
        end_time: '18:00',
        is_available: true
      });
      createdIds.availabilitySettingIds.push(afternoonSettingId);

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      const slots = await getAvailableTimeSlots(tenantId, dateStr, serviceId, 60, userId);

      expect(slots.length).toBeGreaterThan(0);

      // Should have both morning and afternoon slots
      const morningSlots = slots.filter(slot => {
        const hour = new Date(slot.start_time).getHours();
        return hour >= 9 && hour < 12;
      });

      const afternoonSlots = slots.filter(slot => {
        const hour = new Date(slot.start_time).getHours();
        return hour >= 14 && hour < 18;
      });

      expect(morningSlots.length).toBeGreaterThan(0);
      expect(afternoonSlots.length).toBeGreaterThan(0);

      // Should NOT have lunch break slots
      const lunchSlots = slots.filter(slot => {
        const hour = new Date(slot.start_time).getHours();
        return hour >= 12 && hour < 14;
      });

      expect(lunchSlots.length).toBe(0);
    });
  });

  describe('13. Service Availability Edge Cases', () => {
    it('should return empty array when service is marked unavailable', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId);

      // Update service to be unavailable
      await db('availability_settings')
        .where({ service_id: serviceId, tenant: tenantId })
        .update({ is_available: false });

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      const slots = await getAvailableTimeSlots(tenantId, dateStr, serviceId, 60, userId);

      expect(slots.length).toBe(0);
    });

    it('should handle very restrictive advance booking (1 day only)', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId, {
        advanceBookingDays: 1,
        minimumNoticeHours: 0
      });

      // Try to book 2 days out (should fail)
      const twoDaysOut = new Date();
      twoDaysOut.setDate(twoDaysOut.getDate() + 2);
      while (twoDaysOut.getDay() !== 1) { // Make it a Monday
        twoDaysOut.setDate(twoDaysOut.getDate() + 1);
      }
      const farDateStr = twoDaysOut.toISOString().split('T')[0];

      const farSlots = await getAvailableTimeSlots(tenantId, farDateStr, serviceId, 60, userId);

      expect(farSlots.length).toBe(0);
    });

    it('should handle service with no assigned technicians', async () => {
      // Create service without user availability
      const serviceTypeId = uuidv4();
      await db('service_types').insert({
        id: serviceTypeId,
        tenant: tenantId,
        name: `Service Type ${serviceTypeId.slice(0, 8)}`,
        billing_method: 'fixed',
        order_number: Math.floor(Math.random() * 1000000),
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      });
      createdIds.serviceTypeId = serviceTypeId;

      const serviceId = uuidv4();
      await db('service_catalog').insert({
        tenant: tenantId,
        service_id: serviceId!,
        service_name: 'Service With No Techs',
        billing_method: 'fixed',
        default_rate: 10000,
        custom_service_type_id: serviceTypeId
      });
      createdIds.serviceId = serviceId;

      const serviceSettingId = uuidv4();
      await db('availability_settings').insert({
        availability_setting_id: serviceSettingId,
        tenant: tenantId,
        setting_type: 'service_rules',
        service_id: serviceId!,
        is_available: true,
        advance_booking_days: 30,
        minimum_notice_hours: 24
      });
      createdIds.availabilitySettingIds.push(serviceSettingId);

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      const slots = await getAvailableTimeSlots(tenantId, dateStr, serviceId, 60);

      // Should have no slots since no users are available for this service
      expect(slots.length).toBe(0);
    });
  });

  describe('14. Date Range Validation', () => {
    it('should return all dates in range for getAvailableDates', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId);

      const startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 14); // 2 weeks

      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      const dates = await getAvailableDates(tenantId, serviceId, startStr, endStr, userId);

      // Should return dates for entire range
      expect(dates.length).toBeGreaterThanOrEqual(14);
      expect(dates.length).toBeLessThanOrEqual(15); // Inclusive of both ends
    });

    it('should handle single-day date range', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId);

      const tomorrow = getNextWeekday(1);
      const dateStr = tomorrow.toISOString().split('T')[0];

      const dates = await getAvailableDates(tenantId, serviceId, dateStr, dateStr, userId);

      expect(dates.length).toBe(1);
      expect(dates[0].date).toBe(dateStr);
    });

    it('should handle year boundary correctly', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId, {
        minimumNoticeHours: 0
      });

      // Create a date range that crosses year boundary
      const endOfYear = new Date('2025-12-30');
      const startOfNewYear = new Date('2026-01-05');

      const startStr = endOfYear.toISOString().split('T')[0];
      const endStr = startOfNewYear.toISOString().split('T')[0];

      const dates = await getAvailableDates(tenantId, serviceId, startStr, endStr, userId);

      expect(dates.length).toBeGreaterThan(0);

      // Verify dates are in correct order
      for (let i = 1; i < dates.length; i++) {
        const prev = new Date(dates[i - 1].date);
        const current = new Date(dates[i].date);
        expect(current.getTime()).toBeGreaterThan(prev.getTime());
      }
    });
  });

  describe('15. Concurrent Booking Scenarios', () => {
    it('should handle back-to-back appointments correctly', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId);

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      // Create first appointment 10:00-11:00
      const appt1Start = new Date(nextMonday);
      appt1Start.setHours(10, 0, 0, 0);
      const appt1End = new Date(appt1Start);
      appt1End.setMinutes(appt1End.getMinutes() + 60);

      const entry1Id = await createScheduleEntry(db, tenantId, userId, appt1Start, appt1End);
      createdIds.scheduleEntryIds.push(entry1Id);

      // Create second appointment 11:00-12:00 (back-to-back)
      const appt2Start = new Date(appt1End);
      const appt2End = new Date(appt2Start);
      appt2End.setMinutes(appt2End.getMinutes() + 60);

      const entry2Id = await createScheduleEntry(db, tenantId, userId, appt2Start, appt2End);
      createdIds.scheduleEntryIds.push(entry2Id);

      const slots = await getAvailableTimeSlots(tenantId, dateStr, serviceId, 60, userId);

      // Verify no slots overlap with either appointment
      const overlappingSlots = slots.filter(slot => {
        const slotStart = new Date(slot.start_time);
        const slotEnd = new Date(slot.end_time);
        return (
          (slotStart < appt1End && slotEnd > appt1Start) ||
          (slotStart < appt2End && slotEnd > appt2Start)
        );
      });

      expect(overlappingSlots.length).toBe(0);
    });

    it('should handle partial overlap detection', async () => {
      const { serviceId, userId } = await setupTestData(db, tenantId);

      const nextMonday = getNextWeekday(1);
      const dateStr = nextMonday.toISOString().split('T')[0];

      // Create appointment 10:00-11:30
      const apptStart = new Date(nextMonday);
      apptStart.setHours(10, 0, 0, 0);
      const apptEnd = new Date(apptStart);
      apptEnd.setMinutes(apptEnd.getMinutes() + 90);

      const entryId = await createScheduleEntry(db, tenantId, userId, apptStart, apptEnd);
      createdIds.scheduleEntryIds.push(entryId);

      // Check if 11:00-12:00 slot is available (should not be - partial overlap)
      const testSlotStart = new Date(nextMonday);
      testSlotStart.setHours(11, 0, 0, 0);

      const isAvailable = await isSlotAvailable(
        tenantId,
        testSlotStart.toISOString(),
        60,
        userId
      );

      expect(isAvailable).toBe(false);
    });
  });
});

/**
 * Helper function to ensure a tenant exists
 */
async function ensureTenant(connection: Knex): Promise<string> {
  const existing = await connection('tenants').first<{ tenant: string }>('tenant');
  if (existing?.tenant) {
    return existing.tenant;
  }

  const newTenantId = uuidv4();
  await connection('tenants').insert({
    tenant: newTenantId,
    client_name: 'Availability Test Tenant',
    email: 'availability-test@test.com',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now()
  });
  return newTenantId;
}

/**
 * Helper to get next occurrence of a weekday
 */
function getNextWeekday(targetDay: number): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 1); // Start from tomorrow

  while (date.getDay() !== targetDay) {
    date.setDate(date.getDate() + 1);
  }

  return date;
}

/**
 * Helper to set up test data with single user
 */
async function setupTestData(
  db: Knex,
  tenantId: string,
  options: {
    dayOfWeek?: number;
    workingHours?: { start: string; end: string };
    bufferBefore?: number;
    bufferAfter?: number;
    maxAppointmentsPerDay?: number;
    advanceBookingDays?: number;
    minimumNoticeHours?: number;
    allowWithoutContract?: boolean;
  } = {}
): Promise<{
  serviceId: string;
  userId: string;
}> {
  // Create service type
  const serviceTypeId = uuidv4();
  await db('service_types').insert({
    id: serviceTypeId,
    tenant: tenantId,
    name: `Service Type ${serviceTypeId.slice(0, 8)}`,
    billing_method: 'fixed',
    order_number: Math.floor(Math.random() * 1000000),
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
  createdIds.serviceTypeId = serviceTypeId;

  // Create service
  const serviceId = uuidv4();
  await db('service_catalog').insert({
    tenant: tenantId,
    service_id: serviceId!,
    service_name: 'Test Service',
    billing_method: 'fixed',
    default_rate: 10000,
    custom_service_type_id: serviceTypeId
  });
  createdIds.serviceId = serviceId;

  // Create user
  const userId = uuidv4();
  await db('users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `user_${userId.slice(0, 8)}`,
    first_name: 'Test',
    last_name: 'User',
    email: 'user@test.com',
    hashed_password: 'hashed',
    user_type: 'internal',
    is_inactive: false
  });
  createdIds.userId = userId;

  // Create service rules
  const serviceSettingId = uuidv4();
  await db('availability_settings').insert({
    availability_setting_id: serviceSettingId,
    tenant: tenantId,
    setting_type: 'service_rules',
    service_id: serviceId!,
    is_available: true,
    allow_without_contract: options.allowWithoutContract ?? false,
    advance_booking_days: options.advanceBookingDays ?? 30,
    minimum_notice_hours: options.minimumNoticeHours ?? 24
  });
  createdIds.availabilitySettingIds.push(serviceSettingId);

  // Create user availability
  const dayOfWeek = options.dayOfWeek ?? 1; // Default to Monday
  const userSettingId = uuidv4();
  await db('availability_settings').insert({
    availability_setting_id: userSettingId,
    tenant: tenantId,
    setting_type: 'user_hours',
    user_id: userId,
    day_of_week: dayOfWeek,
    start_time: options.workingHours?.start ?? '09:00',
    end_time: options.workingHours?.end ?? '17:00',
    is_available: true,
    buffer_before_minutes: options.bufferBefore ?? 0,
    buffer_after_minutes: options.bufferAfter ?? 0,
    max_appointments_per_day: options.maxAppointmentsPerDay ?? null
  });
  createdIds.availabilitySettingIds.push(userSettingId);

  return { serviceId, userId };
}

/**
 * Helper to set up test data with multiple users
 */
async function setupTestDataMultipleUsers(
  db: Knex,
  tenantId: string
): Promise<{
  serviceId: string;
  userId: string;
  user2Id: string;
}> {
  // Create service type
  const serviceTypeId = uuidv4();
  await db('service_types').insert({
    id: serviceTypeId,
    tenant: tenantId,
    name: `Service Type ${serviceTypeId.slice(0, 8)}`,
    billing_method: 'fixed',
    order_number: Math.floor(Math.random() * 1000000),
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
  createdIds.serviceTypeId = serviceTypeId;

  // Create service
  const serviceId = uuidv4();
  await db('service_catalog').insert({
    tenant: tenantId,
    service_id: serviceId!,
    service_name: 'Test Service',
    billing_method: 'fixed',
    default_rate: 10000,
    custom_service_type_id: serviceTypeId
  });
  createdIds.serviceId = serviceId;

  // Create service rules
  const serviceSettingId = uuidv4();
  await db('availability_settings').insert({
    availability_setting_id: serviceSettingId,
    tenant: tenantId,
    setting_type: 'service_rules',
    service_id: serviceId!,
    is_available: true,
    allow_without_contract: false,
    advance_booking_days: 30,
    minimum_notice_hours: 24
  });
  createdIds.availabilitySettingIds.push(serviceSettingId);

  // Create user 1
  const userId = uuidv4();
  await db('users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `user1_${userId.slice(0, 8)}`,
    first_name: 'User',
    last_name: 'One',
    email: 'user1@test.com',
    hashed_password: 'hashed',
    user_type: 'internal',
    is_inactive: false
  });
  createdIds.userId = userId;

  // Create user 2
  const user2Id = uuidv4();
  await db('users').insert({
    tenant: tenantId,
    user_id: user2Id,
    username: `user2_${user2Id.slice(0, 8)}`,
    first_name: 'User',
    last_name: 'Two',
    email: 'user2@test.com',
    hashed_password: 'hashed',
    user_type: 'internal',
    is_inactive: false
  });
  createdIds.user2Id = user2Id;

  // Create availability for both users (Monday)
  const user1SettingId = uuidv4();
  await db('availability_settings').insert({
    availability_setting_id: user1SettingId,
    tenant: tenantId,
    setting_type: 'user_hours',
    user_id: userId,
    day_of_week: 1,
    start_time: '09:00',
    end_time: '17:00',
    is_available: true
  });
  createdIds.availabilitySettingIds.push(user1SettingId);

  const user2SettingId = uuidv4();
  await db('availability_settings').insert({
    availability_setting_id: user2SettingId,
    tenant: tenantId,
    setting_type: 'user_hours',
    user_id: user2Id,
    day_of_week: 1,
    start_time: '09:00',
    end_time: '17:00',
    is_available: true
  });
  createdIds.availabilitySettingIds.push(user2SettingId);

  return { serviceId, userId, user2Id };
}

/**
 * Helper to create a schedule entry
 */
async function createScheduleEntry(
  db: Knex,
  tenantId: string,
  userId: string,
  startTime: Date,
  endTime: Date
): Promise<string> {
  const entryId = uuidv4();
  await db('schedule_entries').insert({
    entry_id: entryId,
    tenant: tenantId,
    title: 'Test Appointment',
    scheduled_start: startTime.toISOString(),
    scheduled_end: endTime.toISOString(),
    status: 'scheduled',
    work_item_type: 'appointment_request'
  });

  await db('schedule_entry_assignees').insert({
    tenant: tenantId,
    entry_id: entryId,
    user_id: userId
  });

  return entryId;
}

/**
 * Helper to create availability exception
 */
async function createAvailabilityException(
  db: Knex,
  tenantId: string,
  userId: string | null,
  date: string,
  isAvailable: boolean,
  reason: string
): Promise<string> {
  const exceptionId = uuidv4();
  await db('availability_exceptions').insert({
    exception_id: exceptionId,
    tenant: tenantId,
    user_id: userId,
    date: date,
    is_available: isAvailable,
    reason: reason
  });

  return exceptionId;
}

/**
 * Helper to clean up created records
 */
async function cleanupCreatedRecords(db: Knex, tenantId: string, ids: CreatedIds) {
  if (!ids) {
    return;
  }

  const safeDelete = async (table: string, where: Record<string, unknown>) => {
    try {
      await db(table).where(where).del();
    } catch {
      // Ignore cleanup issues
    }
  };

  const safeDeleteIn = async (table: string, column: string, values: string[]) => {
    if (!values || values.length === 0) {
      return;
    }
    try {
      await db(table).whereIn(column, values).andWhere({ tenant: tenantId }).del();
    } catch {
      // Ignore cleanup issues
    }
  };

  // Delete schedule entries
  if (ids.scheduleEntryIds.length > 0) {
    await safeDeleteIn('schedule_entry_assignees', 'entry_id', ids.scheduleEntryIds);
    await safeDeleteIn('schedule_entries', 'entry_id', ids.scheduleEntryIds);
  }

  // Delete exceptions
  await safeDeleteIn('availability_exceptions', 'exception_id', ids.exceptionIds);

  // Delete availability settings
  await safeDeleteIn('availability_settings', 'availability_setting_id', ids.availabilitySettingIds);

  // Delete users
  if (ids.userId) {
    await safeDelete('users', { tenant: tenantId, user_id: ids.userId });
  }
  if (ids.user2Id) {
    await safeDelete('users', { tenant: tenantId, user_id: ids.user2Id });
  }
  if (ids.user3Id) {
    await safeDelete('users', { tenant: tenantId, user_id: ids.user3Id });
  }

  // Delete service
  if (ids.serviceId) {
    await safeDelete('service_catalog', { tenant: tenantId, service_id: ids.serviceId });
  }
}
