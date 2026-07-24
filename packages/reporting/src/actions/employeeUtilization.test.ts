import { describe, expect, it } from 'vitest';
import {
  buildEmployeeUtilizationReport,
  proratedCapacityHours,
  type EmployeeUtilizationInputRow,
} from './employeeUtilization';

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
      totalCapacityHours: 40,
      overallUtilizationPercent: 250,
    });
  });

  it('leaves capacity and utilization null when no capacity is set', () => {
    const report = buildEmployeeUtilizationReport(
      [row({ userId: 'u1', name: 'Grace', workedMinutes: 1200, maxWeeklyCapacity: null })],
      30,
    );

    expect(report.byUser[0].capacityHours).toBeNull();
    expect(report.byUser[0].utilizationPercent).toBeNull();
    expect(report.summary.usersWithoutCapacity).toBe(1);
    expect(report.summary.totalCapacityHours).toBe(0);
    expect(report.summary.overallUtilizationPercent).toBeNull();
  });

  it('excludes uncapped users from the overall utilization denominator', () => {
    const report = buildEmployeeUtilizationReport(
      [
        row({ userId: 'capped', workedMinutes: 1200, maxWeeklyCapacity: 40 }), // 20h worked, 40h cap (7d)
        row({ userId: 'uncapped', workedMinutes: 6000, maxWeeklyCapacity: null }), // 100h worked, no cap
      ],
      7,
    );

    expect(report.summary.activeUsers).toBe(2);
    expect(report.summary.usersWithoutCapacity).toBe(1);
    expect(report.summary.totalWorkedHours).toBe(120);
    expect(report.summary.totalCapacityHours).toBe(40);
    expect(report.summary.overallUtilizationPercent).toBe(300); // 120 / 40
  });

  it('ranks users with capacity utilization ahead of uncapped users', () => {
    const report = buildEmployeeUtilizationReport(
      [
        row({ userId: 'uncapped', name: 'No cap', workedMinutes: 9000, maxWeeklyCapacity: null }),
        row({ userId: 'capped', name: 'Capped', workedMinutes: 1200, maxWeeklyCapacity: 40 }),
      ],
      7,
    );

    expect(report.byUser.map((u) => u.userId)).toEqual(['capped', 'uncapped']);
  });

  it('rounds worked hours to one decimal place', () => {
    const report = buildEmployeeUtilizationReport(
      [row({ workedMinutes: 100 })], // 1.666.. h
      7,
    );
    expect(report.byUser[0].workedHours).toBe(1.7);
  });
});
