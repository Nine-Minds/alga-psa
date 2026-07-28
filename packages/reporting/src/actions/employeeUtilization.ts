/**
 * Pure helpers for the Employee Utilization report.
 *
 * Kept free of server-only imports so the utilization math can be unit tested
 * without loading the 'use server' action module.
 */

import { scheduledHoursForRange, type WorkScheduleDay } from '@alga-psa/core/workSchedule';

export type UtilizationRangeDays = 7 | 30 | 90;

/**
 * Where a user's capacity came from, so the UI can explain a denominator
 * instead of showing an unexplained number.
 */
export type CapacitySource = 'schedule' | 'weekly' | null;

export interface EmployeeUtilizationReport {
  rangeDays: UtilizationRangeDays;
  summary: {
    activeUsers: number;
    usersWithoutCapacity: number;
    totalWorkedHours: number;
    /** Worked hours of the employees that actually have a capacity configured. */
    workedHoursWithCapacity: number;
    totalCapacityHours: number;
    overallUtilizationPercent: number | null;
  };
  byUser: Array<{
    userId: string;
    name: string;
    workedHours: number;
    billableHours: number;
    entries: number;
    capacityHours: number | null;
    capacitySource: CapacitySource;
    utilizationPercent: number | null;
  }>;
}

export interface EmployeeUtilizationInputRow {
  userId: string;
  name: string;
  workedMinutes: number;
  billableMinutes: number;
  entries: number;
  maxWeeklyCapacity: number | null;
  workSchedule?: WorkScheduleDay[];
}

function toCount(value: unknown): number {
  return Number(value ?? 0) || 0;
}

function minutesToHours(value: unknown): number {
  return Math.round(((Number(value ?? 0) || 0) / 60) * 10) / 10;
}

/**
 * Whole hours on purpose. This number assumes every week in the range looks
 * like every other, so a tenth of an hour is precision it does not have —
 * 40h/week over 90 days yields 514.3, while the same person's actual weekday
 * count is 512. The `*` in the report already says "estimated"; a lone
 * fractional figure beside exact schedule-derived ones says the opposite.
 */
export function proratedCapacityHours(maxWeeklyCapacity: number | null, rangeDays: number): number | null {
  if (maxWeeklyCapacity === null || !(maxWeeklyCapacity > 0)) return null;
  return Math.round((maxWeeklyCapacity * rangeDays) / 7);
}

/**
 * A configured work schedule wins over the coarse weekly number, because it
 * knows which days the range actually landed on. The weekly value stays as an
 * override for tenants that only track contract hours.
 */
export function resolveCapacityHours(
  row: EmployeeUtilizationInputRow,
  rangeDays: number,
  rangeEndDate: string,
): { capacityHours: number | null; capacitySource: CapacitySource } {
  const scheduled = row.workSchedule?.length
    ? scheduledHoursForRange(row.workSchedule, rangeDays, rangeEndDate)
    : null;
  if (scheduled !== null) {
    return { capacityHours: scheduled, capacitySource: 'schedule' };
  }

  const prorated = proratedCapacityHours(row.maxWeeklyCapacity, rangeDays);
  if (prorated !== null) {
    return { capacityHours: prorated, capacitySource: 'weekly' };
  }

  return { capacityHours: null, capacitySource: null };
}

export function buildEmployeeUtilizationReport(
  rows: EmployeeUtilizationInputRow[],
  rangeDays: UtilizationRangeDays,
  rangeEndDate: string,
): EmployeeUtilizationReport {
  const byUser = rows.map((row) => {
    const workedHours = minutesToHours(row.workedMinutes);
    const billableHours = minutesToHours(row.billableMinutes);
    const { capacityHours, capacitySource } = resolveCapacityHours(row, rangeDays, rangeEndDate);
    const utilizationPercent =
      capacityHours && capacityHours > 0 ? Math.round((workedHours / capacityHours) * 100) : null;
    return {
      userId: row.userId,
      name: row.name || 'Unknown user',
      workedHours,
      billableHours,
      entries: toCount(row.entries),
      capacityHours,
      capacitySource,
      utilizationPercent,
    };
  });

  byUser.sort((left, right) => {
    const rankRight = right.utilizationPercent ?? -1;
    const rankLeft = left.utilizationPercent ?? -1;
    if (rankRight !== rankLeft) return rankRight - rankLeft;
    return right.workedHours - left.workedHours;
  });

  const totalWorkedHours = Math.round(byUser.reduce((sum, row) => sum + row.workedHours, 0) * 10) / 10;
  // A schedule with every day marked off yields 0 capacity, which is no more
  // divisible than a missing one; both must stay out of the ratio.
  const withCapacity = byUser.filter((row) => row.capacityHours !== null && row.capacityHours > 0);
  // Numerator and denominator must cover the same people: counting hours worked
  // by employees without a configured capacity would inflate the percentage.
  const workedHoursWithCapacity =
    Math.round(withCapacity.reduce((sum, row) => sum + row.workedHours, 0) * 10) / 10;
  const totalCapacityHours =
    Math.round(withCapacity.reduce((sum, row) => sum + (row.capacityHours ?? 0), 0) * 10) / 10;

  return {
    rangeDays,
    summary: {
      activeUsers: byUser.length,
      usersWithoutCapacity: byUser.length - withCapacity.length,
      totalWorkedHours,
      workedHoursWithCapacity,
      totalCapacityHours,
      overallUtilizationPercent:
        totalCapacityHours > 0 ? Math.round((workedHoursWithCapacity / totalCapacityHours) * 100) : null,
    },
    byUser,
  };
}
