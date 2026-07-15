import type { Knex } from 'knex';
import { createTenantKnex, requireTenantId } from '@alga-psa/db';
import type {
  IProjectBillingCapUsage,
  IProjectBillingConfig,
  IProjectBillingScheduleEntry,
  IProjectPhaseRateOverride
} from '@alga-psa/types';

export type ProjectBillingDbConnection = Knex | Knex.Transaction;

export async function resolveProjectBillingDb(
  connection?: ProjectBillingDbConnection
): Promise<{ connection: ProjectBillingDbConnection; tenant: string }> {
  if (connection) {
    return {
      connection,
      tenant: await requireTenantId(connection)
    };
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant context is required for project billing');
  }

  return { connection: knex, tenant };
}

export function numberFromDatabase(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new Error(`Invalid numeric project billing value: ${String(value)}`);
  }

  return numericValue;
}

export function nullableNumberFromDatabase(value: unknown): number | null {
  return value === null || value === undefined
    ? null
    : numberFromDatabase(value);
}

export function numberArrayFromDatabase(value: unknown): number[] {
  let candidate = value;

  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate.map((item) => numberFromDatabase(item));
}

export function dateOnlyFromDatabase(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) {
    throw new Error(`Invalid project billing calendar date: ${String(value)}`);
  }
  return match[1];
}

export function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as Partial<T>;
}

export function normalizeProjectBillingConfig(row: Record<string, unknown>): IProjectBillingConfig {
  return {
    ...row,
    total_price: nullableNumberFromDatabase(row.total_price),
    cap_amount: nullableNumberFromDatabase(row.cap_amount),
    cap_notify_thresholds: numberArrayFromDatabase(row.cap_notify_thresholds)
  } as IProjectBillingConfig;
}

export function normalizeProjectBillingScheduleEntry(
  row: Record<string, unknown>
): IProjectBillingScheduleEntry {
  return {
    ...row,
    amount: nullableNumberFromDatabase(row.amount),
    percentage: nullableNumberFromDatabase(row.percentage),
    trigger_date: dateOnlyFromDatabase(row.trigger_date),
    requires_payment_before_work: row.requires_payment_before_work === true,
    display_order: numberFromDatabase(row.display_order)
  } as IProjectBillingScheduleEntry;
}

export function normalizeProjectPhaseRateOverride(
  row: Record<string, unknown>
): IProjectPhaseRateOverride {
  return {
    ...row,
    rate: nullableNumberFromDatabase(row.rate)
  } as IProjectPhaseRateOverride;
}

export function normalizeProjectBillingCapUsage(
  row: Record<string, unknown>
): IProjectBillingCapUsage {
  return {
    ...row,
    billed_amount: numberFromDatabase(row.billed_amount),
    written_down_amount: numberFromDatabase(row.written_down_amount),
    notified_thresholds: numberArrayFromDatabase(row.notified_thresholds)
  } as IProjectBillingCapUsage;
}
