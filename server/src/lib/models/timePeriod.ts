import { createTenantKnex } from '../db';
import { ITimePeriod, ITimePeriodView } from 'server/src/interfaces/timeEntry.interfaces';
import { ISO8601String } from 'server/src/types/types.d';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
import { Temporal } from '@js-temporal/polyfill';
import { v4 as uuidv4 } from 'uuid';

// Database representation of time period
interface DbTimePeriod {
  period_id: string;
  start_date: string;
  end_date: string;
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
function fromDbDate(date: string): Temporal.PlainDate {
  return toPlainDate(date);
}

export class TimePeriod {
  static async getLatest(): Promise<ITimePeriod | null> {
    const {knex: db, tenant} = await createTenantKnex();
    const latestPeriod = await db<DbTimePeriod>('time_periods')
      .where('tenant', tenant)
      .orderBy('end_date', 'desc')
      .first();

    if (!latestPeriod) return null;
    
    return {
      ...latestPeriod,
      start_date: fromDbDate(latestPeriod.start_date),
      end_date: fromDbDate(latestPeriod.end_date)
    };
  }

  static async getAll(): Promise<ITimePeriod[]> {
    const {knex: db, tenant} = await createTenantKnex();
    const timePeriods = await db<DbTimePeriod>('time_periods')
      .where('tenant', tenant)
      .select('*')
      .orderBy('start_date', 'desc');

    return timePeriods.map((period): ITimePeriod => ({
      ...period,
      start_date: fromDbDate(period.start_date),
      end_date: fromDbDate(period.end_date)
    }));
  }  

  static async create(timePeriodData: Omit<ITimePeriod, 'period_id' | 'tenant'>): Promise<ITimePeriod> {
    const {knex: db, tenant} = await createTenantKnex();
    // Create a clean object with only the fields we want to insert
    const dbData: DbTimePeriod = {
      tenant: tenant!,
      period_id: uuidv4(),
      start_date: toDbDate(timePeriodData.start_date),
      end_date: toDbDate(timePeriodData.end_date)
    };

    const [newPeriod] = await db<DbTimePeriod>('time_periods')
      .insert(dbData)
      .returning('*');

    return {
      ...newPeriod,
      start_date: fromDbDate(newPeriod.start_date),
      end_date: fromDbDate(newPeriod.end_date)
    };
  }

  static async findByDate(date: ISO8601String): Promise<ITimePeriodView | null> {
    const {knex: db, tenant} = await createTenantKnex();
    const period = await db<DbTimePeriod>('time_periods')
      .where('tenant', tenant)
      .where('start_date', '<=', date)
      .where('end_date', '>', date)
      .first();

    if (!period) return null;
    
    // Convert to view type with string dates
    return {
      ...period,
      start_date: period.start_date,
      end_date: period.end_date
    };
  }

  static async findOverlapping(
    startDate: Temporal.PlainDate | ISO8601String,
    endDate: Temporal.PlainDate | ISO8601String,
    excludePeriodId?: string
  ): Promise<ITimePeriod | null> {
    const {knex: db, tenant} = await createTenantKnex();
    
    // Convert inputs to database format
    const startStr = toDbDate(startDate);
    const endStr = toDbDate(endDate);
    
    // For half-open intervals [A,B), two periods overlap if: existing.start_date < newEnd AND existing.end_date > newStart
    const period = await db<DbTimePeriod>('time_periods')
      .where('tenant', tenant)
      .andWhere('start_date', '<', endStr)
      .andWhere('end_date', '>', startStr)
      .modify(qb => {
        if (excludePeriodId) {
          qb.whereNot('period_id', excludePeriodId);
        }
      })
      .first();
    if (!period) return null;
    
    return {
      ...period,
      start_date: fromDbDate(period.start_date),
      end_date: fromDbDate(period.end_date)
    };
  }

  static async findById(periodId: string): Promise<ITimePeriod | null> {
    const {knex: db, tenant} = await createTenantKnex();
    const period = await db<DbTimePeriod>('time_periods')
      .where('tenant', tenant)
      .where('period_id', periodId)
      .first();
    
    if (!period) return null;
    
    return {
      ...period,
      start_date: fromDbDate(period.start_date),
      end_date: fromDbDate(period.end_date)
    };
  }

  static async hasTimeSheets(periodId: string): Promise<boolean> {
    const {knex: db, tenant} = await createTenantKnex();
    const count = await db('time_sheets')
      .where('tenant', tenant)
      .where('period_id', periodId)
      .count('id as count')
      .first();
    
    return count ? Number(count.count) > 0 : false;
  }

  static async isEditable(periodId: string): Promise<boolean> {
    const hasSheets = await this.hasTimeSheets(periodId);
    return !hasSheets;
  }

  static async update(
    periodId: string, 
    updates: Partial<Omit<ITimePeriod, 'period_id' | 'tenant'>>
  ): Promise<ITimePeriod> {
    const {knex: db, tenant} = await createTenantKnex();
    
    // Create a clean object with only the fields we want to update
    const dbUpdates: Record<string, string> = {};
    
    // Convert dates if they exist
    if (updates.start_date) {
      dbUpdates.start_date = toDbDate(updates.start_date);
    }
    if (updates.end_date) {
      dbUpdates.end_date = toDbDate(updates.end_date);
    }

    const [updatedPeriod] = await db<DbTimePeriod>('time_periods')
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
      end_date: fromDbDate(updatedPeriod.end_date)
    };
  }

  static async delete(periodId: string): Promise<void> {
    const {knex: db, tenant} = await createTenantKnex();
    const deleted = await db('time_periods')
      .where('period_id', periodId)
      .where('tenant', tenant)
      .delete();
    
    if (!deleted) {
      throw new Error('Time period not found or belongs to different tenant');
    }
  }
}
