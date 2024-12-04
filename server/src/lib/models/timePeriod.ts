import { createTenantKnex } from '../db';
import { ITimePeriod } from '../../interfaces/timeEntry.interfaces';
import { ISO8601String } from '../../types/types.d';

export class TimePeriod {
  static async getLatest(): Promise<ITimePeriod | null> {
    const {knex: db} = await createTenantKnex();
    const latestPeriod = await db<ITimePeriod>('time_periods')
      .orderBy('end_date', 'desc')
      .first();

    return latestPeriod || null;
  }

  static async getAll(): Promise<ITimePeriod[]> {
    const {knex: db} = await createTenantKnex();
    const timePeriods = await db<ITimePeriod>('time_periods')
      .select('*')
      .orderBy('start_date', 'desc');

    return timePeriods.map((period): ITimePeriod => ({
      ...period,
      start_date: new Date(period.start_date).toISOString().split('.')[0] + 'Z',
      end_date: new Date(period.end_date).toISOString().split('.')[0] + 'Z'
    }));
  }  

  static async create(timePeriodData: Omit<ITimePeriod, 'period_id' | 'tenant'>): Promise<ITimePeriod> {
    const {knex: db, tenant} = await createTenantKnex();
    const [newPeriod] = await db<ITimePeriod>('time_periods')
      .insert({...timePeriodData, tenant: tenant!})
      .returning('*');

    // Convert dates to ISO strings
    return {
      ...newPeriod,
      start_date: new Date(newPeriod.start_date).toISOString().split('.')[0] + 'Z',
      end_date: new Date(newPeriod.end_date).toISOString().split('.')[0] + 'Z'
    };
  }

  static async findByDate(date: ISO8601String): Promise<ITimePeriod | null> {
    const {knex: db} = await createTenantKnex();
    const period = await db<ITimePeriod>('time_periods')
      .where('start_date', '<=', date)
      .where('end_date', '>=', date)
      .first();

    return period || null;
  }

  static async findOverlapping(
    startDate: ISO8601String, 
    endDate: ISO8601String,
    excludePeriodId?: string
  ): Promise<ITimePeriod | null> {
    const {knex: db} = await createTenantKnex();
    const query = db<ITimePeriod>('time_periods')
      .where((qb) => {
        qb.whereBetween('start_date', [startDate, endDate])
          .orWhereBetween('end_date', [startDate, endDate])
          .orWhere((inner) => {
            inner.where('start_date', '<', startDate).andWhere('end_date', '>', endDate);
          });
      });

    if (excludePeriodId) {
      query.whereNot('period_id', excludePeriodId);
    }

    return await query.first() || null;
  }

  static async findById(periodId: string): Promise<ITimePeriod | null> {
    const {knex: db} = await createTenantKnex();
    const period = await db<ITimePeriod>('time_periods')
      .where('period_id', periodId)
      .first();
    
    return period || null;
  }

  static async hasTimeSheets(periodId: string): Promise<boolean> {
    const {knex: db} = await createTenantKnex();
    const count = await db('time_sheets')
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
    const {knex: db} = await createTenantKnex();
    const [updatedPeriod] = await db<ITimePeriod>('time_periods')
      .where('period_id', periodId)
      .update(updates)
      .returning('*');

    return {
      ...updatedPeriod,
      start_date: new Date(updatedPeriod.start_date).toISOString().split('.')[0] + 'Z',
      end_date: new Date(updatedPeriod.end_date).toISOString().split('.')[0] + 'Z'
    };
  }

  static async delete(periodId: string): Promise<void> {
    const {knex: db} = await createTenantKnex();
    await db('time_periods')
      .where('period_id', periodId)
      .delete();
  }
}
