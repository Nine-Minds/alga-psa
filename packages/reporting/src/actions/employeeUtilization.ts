/**
 * Pure helpers for the Employee Utilization report.
 *
 * Kept free of server-only imports so the utilization math can be unit tested
 * without loading the 'use server' action module.
 */

export type UtilizationRangeDays = 7 | 30 | 90;

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
}

function toCount(value: unknown): number {
  return Number(value ?? 0) || 0;
}

function minutesToHours(value: unknown): number {
  return Math.round(((Number(value ?? 0) || 0) / 60) * 10) / 10;
}

export function proratedCapacityHours(maxWeeklyCapacity: number | null, rangeDays: number): number | null {
  if (maxWeeklyCapacity === null || !(maxWeeklyCapacity > 0)) return null;
  return Math.round(((maxWeeklyCapacity * rangeDays) / 7) * 10) / 10;
}

export function buildEmployeeUtilizationReport(
  rows: EmployeeUtilizationInputRow[],
  rangeDays: UtilizationRangeDays,
): EmployeeUtilizationReport {
  const byUser = rows.map((row) => {
    const workedHours = minutesToHours(row.workedMinutes);
    const billableHours = minutesToHours(row.billableMinutes);
    const capacityHours = proratedCapacityHours(row.maxWeeklyCapacity, rangeDays);
    const utilizationPercent =
      capacityHours && capacityHours > 0 ? Math.round((workedHours / capacityHours) * 100) : null;
    return {
      userId: row.userId,
      name: row.name || 'Unknown user',
      workedHours,
      billableHours,
      entries: toCount(row.entries),
      capacityHours,
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
  const withCapacity = byUser.filter((row) => row.capacityHours !== null);
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
