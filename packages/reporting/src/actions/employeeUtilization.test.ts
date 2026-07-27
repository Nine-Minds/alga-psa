import { describe, expect, it } from 'vitest';
import {
  buildEmployeeUtilizationReport,
  proratedCapacityHours,
  type EmployeeUtilizationInputRow,
} from './employeeUtilization';

// Monday, so a 7-day range runs Tue..Mon and holds five weekdays.
const RANGE_END = '2026-07-27';

const row = (over: Partial<EmployeeUtilizationInputRow>): EmployeeUtilizationInputRow => ({
  userId: 'u1',
  name: 'Ada Lovelace',
  workedMinutes: 0,
  billableMinutes: 0,
  entries: 0,
  maxWeeklyCapacity: null,
  ...over,
});

describe('proratedCapacityHours', () => {
  it('returns the weekly capacity unchanged for a 7-day window', () => {
    expect(proratedCapacityHours(40, 7)).toBe(40);
  });

  it('prorates the weekly capacity across a 30-day window', () => {
    // 40 * 30 / 7 = 171.428..., rounded to one decimal
    expect(proratedCapacityHours(40, 30)).toBe(171.4);
  });

  it('treats null and non-positive capacity as unset', () => {
    expect(proratedCapacityHours(null, 30)).toBeNull();
    expect(proratedCapacityHours(0, 30)).toBeNull();
    expect(proratedCapacityHours(-5, 30)).toBeNull();
  });
});

describe('buildEmployeeUtilizationReport', () => {
  it('computes worked/billable hours, prorated capacity, and utilization percent', () => {
    const report = buildEmployeeUtilizationReport(
      [
        row({
          userId: 'u1',
          name: 'Ada',
          workedMinutes: 6000, // 100h
          billableMinutes: 4800, // 80h
          entries: 12,
          maxWeeklyCapacity: 40, // 7d -> 40h capacity
        }),
      ],
      7,
      RANGE_END,
    );

    expect(report.byUser[0]).toMatchObject({
      workedHours: 100,
      billableHours: 80,
      entries: 12,
      capacityHours: 40,
      utilizationPercent: 250, // 100 / 40
    });
    expect(report.summary).toMatchObject({
      activeUsers: 1,
      usersWithoutCapacity: 0,
      totalWorkedHours: 100,
      workedHoursWithCapacity: 100,
      totalCapacityHours: 40,
      overallUtilizationPercent: 250,
    });
  });

  it('leaves capacity and utilization null when no capacity is set', () => {
    const report = buildEmployeeUtilizationReport(
      [row({ userId: 'u1', name: 'Grace', workedMinutes: 1200, maxWeeklyCapacity: null })],
      30,
      RANGE_END,
    );

    expect(report.byUser[0].capacityHours).toBeNull();
    expect(report.byUser[0].utilizationPercent).toBeNull();
    expect(report.summary.usersWithoutCapacity).toBe(1);
    expect(report.summary.totalCapacityHours).toBe(0);
    expect(report.summary.workedHoursWithCapacity).toBe(0);
    expect(report.summary.overallUtilizationPercent).toBeNull();
  });

  it('excludes uncapped users from both sides of the overall utilization ratio', () => {
    const report = buildEmployeeUtilizationReport(
      [
        row({ userId: 'capped', workedMinutes: 1200, maxWeeklyCapacity: 40 }), // 20h worked, 40h cap (7d)
        row({ userId: 'uncapped', workedMinutes: 6000, maxWeeklyCapacity: null }), // 100h worked, no cap
      ],
      7,
      RANGE_END,
    );

    expect(report.summary.activeUsers).toBe(2);
    expect(report.summary.usersWithoutCapacity).toBe(1);
    expect(report.summary.totalWorkedHours).toBe(120);
    expect(report.summary.workedHoursWithCapacity).toBe(20);
    expect(report.summary.totalCapacityHours).toBe(40);
    expect(report.summary.overallUtilizationPercent).toBe(50); // 20 / 40, uncapped hours excluded
  });

  it('ranks users with capacity utilization ahead of uncapped users', () => {
    const report = buildEmployeeUtilizationReport(
      [
        row({ userId: 'uncapped', name: 'No cap', workedMinutes: 9000, maxWeeklyCapacity: null }),
        row({ userId: 'capped', name: 'Capped', workedMinutes: 1200, maxWeeklyCapacity: 40 }),
      ],
      7,
      RANGE_END,
    );

    expect(report.byUser.map((u) => u.userId)).toEqual(['capped', 'uncapped']);
  });

  it('rounds worked hours to one decimal place', () => {
    const report = buildEmployeeUtilizationReport(
      [row({ workedMinutes: 100 })], // 1.666.. h
      7,
      RANGE_END,
    );
    expect(report.byUser[0].workedHours).toBe(1.7);
  });
});

describe('capacity resolution', () => {
  // Mon-Fri 09:00-17:00.
  const weekdays = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
    dayOfWeek: dayOfWeek as 1 | 2 | 3 | 4 | 5,
    isWorking: true,
    startTime: '09:00',
    endTime: '17:00',
  }));

  it('prefers the work schedule over the coarse weekly override', () => {
    const report = buildEmployeeUtilizationReport(
      [row({ workedMinutes: 1200, maxWeeklyCapacity: 40, workSchedule: weekdays })],
      30,
      RANGE_END,
    );

    // Real weekdays in the range, not 40 * 30 / 7 = 171.4.
    expect(report.byUser[0].capacityHours).toBe(168);
    expect(report.byUser[0].capacitySource).toBe('schedule');
  });

  it('falls back to the weekly override when no schedule exists', () => {
    const report = buildEmployeeUtilizationReport(
      [row({ maxWeeklyCapacity: 40, workSchedule: [] })],
      30,
      RANGE_END,
    );

    expect(report.byUser[0].capacityHours).toBe(171.4);
    expect(report.byUser[0].capacitySource).toBe('weekly');
  });

  it('reports no capacity when neither source is configured', () => {
    const report = buildEmployeeUtilizationReport([row({})], 30, RANGE_END);

    expect(report.byUser[0].capacityHours).toBeNull();
    expect(report.byUser[0].capacitySource).toBeNull();
    expect(report.byUser[0].utilizationPercent).toBeNull();
  });

  it('keeps an all-days-off schedule out of the overall ratio', () => {
    const allOff = weekdays.map((day) => ({ ...day, isWorking: false }));
    const report = buildEmployeeUtilizationReport(
      [row({ userId: 'off', workedMinutes: 600, workSchedule: allOff })],
      30,
      RANGE_END,
    );

    expect(report.byUser[0].capacityHours).toBe(0);
    expect(report.byUser[0].utilizationPercent).toBeNull();
    // Zero is no more divisible than null, so it must not reach the ratio.
    expect(report.summary.overallUtilizationPercent).toBeNull();
    expect(report.summary.usersWithoutCapacity).toBe(1);
  });

  it('counts a part-time schedule by its actual hours', () => {
    const partTime = [
      { dayOfWeek: 2 as const, isWorking: true, startTime: '09:00', endTime: '13:00' },
      { dayOfWeek: 4 as const, isWorking: true, startTime: '09:00', endTime: '13:00' },
    ];
    const report = buildEmployeeUtilizationReport(
      [row({ workedMinutes: 240, workSchedule: partTime })],
      7,
      RANGE_END,
    );

    expect(report.byUser[0].capacityHours).toBe(8);
    expect(report.byUser[0].utilizationPercent).toBe(50);
  });
});
