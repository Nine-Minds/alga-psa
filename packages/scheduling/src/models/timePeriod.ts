import { Temporal } from '@js-temporal/polyfill';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import type { ISO8601String, ITimePeriod, ITimePeriodView } from '@alga-psa/types';
import { toPlainDate } from '@alga-psa/core';

// Database representation of time period
// After migration to DATE type, pg driver may return Date objects for date columns
interface DbTimePeriod {
  period_id: string;
  start_date: string | Date;
  end_date: string | Date;
  tenant: string;
}

// Helper function to convert Temporal.PlainDate to database format
function toDbDate(date: Temporal.PlainDate | ISO8601String): string {
  if (date instanceof Temporal.PlainDate) {
    return date.toString();
  }
  return date;
}

// Helper function to convert database date to Temporal.PlainDate
// After migration to DATE type, pg driver returns Date objects - handle both
function fromDbDate(date: string | Date): Temporal.PlainDate {
  if (date instanceof Date) {
    return toPlainDate(date.toISOString().slice(0, 10));
  }
  return toPlainDate(date);
}

export class TimePeriod {
  static async getLatest(knexOrTrx: Knex | Knex.Transaction, tenant: string): Promise<ITimePeriod | null> {
    const latestPeriod = await knexOrTrx<DbTimePeriod>('time_periods')
      .where('tenant', tenant)
      .orderBy('end_date', 'desc')
      .first();

    if (!latestPeriod) return null;

    return {
      ...latestPeriod,
      start_date: fromDbDate(latestPeriod.start_date),
      end_date: fromDbDate(latestPeriod.end_date),
    };
  }

  static async getAll(knexOrTrx: Knex | Knex.Transaction, tenant: string): Promise<ITimePeriod[]> {
    const timePeriods = await knexOrTrx<DbTimePeriod>('time_periods')
      .where('tenant', tenant)
      .select('*')
      .orderBy('start_date', 'desc');

    return timePeriods.map((period): ITimePeriod => ({
      ...period,
      start_date: fromDbDate(period.start_date),
      end_date: fromDbDate(period.end_date),
    }));
  }

  static async create(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    timePeriodData: Omit<ITimePeriod, 'period_id' | 'tenant'>
  ): Promise<ITimePeriod> {
    // Create a clean object with only the fields we want to insert
    const dbData: DbTimePeriod = {
      tenant,
      period_id: uuidv4(),
      start_date: toDbDate(timePeriodData.start_date),
      end_date: toDbDate(timePeriodData.end_date),
    };

    const [newPeriod] = await knexOrTrx<DbTimePeriod>('time_periods').insert(dbData).returning('*');

    return {
      ...newPeriod,
      start_date: fromDbDate(newPeriod.start_date),
      end_date: fromDbDate(newPeriod.end_date),
    };
  }

  static async findByDate(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    date: ISO8601String | string
  ): Promise<ITimePeriodView | null> {
    const period = await knexOrTrx<DbTimePeriod>('time_periods')
      .where('tenant', tenant)
      .where('start_date', '<=', date)
      .where('end_date', '>', date)
      .first();

    if (!period) return null;

    // Convert to view type with string dates
    // After migration to DATE type, pg driver returns Date objects - convert to ISO strings
    const toIsoDateString = (d: string | Date): string => {
      if (d instanceof Date) {
        return d.toISOString().slice(0, 10);
      }
      return String(d);
    };

    return {
      ...period,
      start_date: toIsoDateString(period.start_date),
      end_date: toIsoDateString(period.end_date),
    };
  }

  static async findOverlapping(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    startDate: Temporal.PlainDate | ISO8601String,
    endDate: Temporal.PlainDate | ISO8601String,
    excludePeriodId?: string
  ): Promise<ITimePeriod | null> {
    // Convert inputs to database format
    const startStr = toDbDate(startDate);
    const endStr = toDbDate(endDate);

    // For half-open intervals [A,B), two periods overlap if: existing.start_date < newEnd AND existing.end_date > newStart
    const period = await knexOrTrx<DbTimePeriod>('time_periods')
      .where('tenant', tenant)
      .andWhere('start_date', '<', endStr)
      .andWhere('end_date', '>', startStr)
      .modify((qb) => {
        if (excludePeriodId) {
          qb.whereNot('period_id', excludePeriodId);
        }
      })
      .first();
    if (!period) return null;

    return {
      ...period,
      start_date: fromDbDate(period.start_date),
      end_date: fromDbDate(period.end_date),
    };
  }

  static async findById(knexOrTrx: Knex | Knex.Transaction, tenant: string, periodId: string): Promise<ITimePeriod | null> {
    const period = await knexOrTrx<DbTimePeriod>('time_periods')
      .where('tenant', tenant)
      .where('period_id', periodId)
      .first();

    if (!period) return null;

    return {
      ...period,
      start_date: fromDbDate(period.start_date),
      end_date: fromDbDate(period.end_date),
    };
  }

  static async hasTimeSheets(knexOrTrx: Knex | Knex.Transaction, tenant: string, periodId: string): Promise<boolean> {
    const count = await knexOrTrx('time_sheets')
      .where('tenant', tenant)
      .where('period_id', periodId)
      .count('id as count')
      .first();

    return count ? Number((count as any).count) > 0 : false;
  }

  static async isEditable(knexOrTrx: Knex | Knex.Transaction, tenant: string, periodId: string): Promise<boolean> {
    const hasSheets = await this.hasTimeSheets(knexOrTrx, tenant, periodId);
    return !hasSheets;
  }

  static async update(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    periodId: string,
    updates: Partial<Omit<ITimePeriod, 'period_id' | 'tenant'>>
  ): Promise<ITimePeriod> {
    // Create a clean object with only the fields we want to update
    const dbUpdates: Record<string, string> = {};

    // Convert dates if they exist
    if (updates.start_date) {
      dbUpdates.start_date = toDbDate(updates.start_date);
    }
    if (updates.end_date) {
      dbUpdates.end_date = toDbDate(updates.end_date);
    }

    const [updatedPeriod] = await knexOrTrx<DbTimePeriod>('time_periods')
      .where('period_id', periodId)
      .where('tenant', tenant)
      .update(dbUpdates)
      .returning('*');

    if (!updatedPeriod) {
      throw new Error('Time period not found or belongs to different tenant');
    }

    return {
      ...updatedPeriod,
      start_date: fromDbDate(updatedPeriod.start_date),
      end_date: fromDbDate(updatedPeriod.end_date),
    };
  }

  static async delete(knexOrTrx: Knex | Knex.Transaction, tenant: string, periodId: string): Promise<void> {
    const deleted = await knexOrTrx('time_periods').where('period_id', periodId).where('tenant', tenant).delete();

    if (!deleted) {
      throw new Error('Time period not found or belongs to different tenant');
    }
  }
}

