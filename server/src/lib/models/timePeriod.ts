import { createTenantKnex } from '../db';
import { ITimePeriod } from '@/interfaces/timeEntry.interfaces';
import { ISO8601String } from '@/types/types.d';

export class TimePeriod {
  static async getLatest(): Promise<ITimePeriod | null> {
    const {knex: db, tenant} = await createTenantKnex();
    const latestPeriod = await db<ITimePeriod>('time_periods')
      .where('tenant', tenant)
      .orderBy('end_date', 'desc')
      .first();

    if (!latestPeriod) return null;
    
    return {
      ...latestPeriod,
      start_date: new Date(latestPeriod.start_date).toISOString().split('.')[0] + 'Z',
      end_date: new Date(latestPeriod.end_date).toISOString().split('.')[0] + 'Z'
    };
  }

  static async getAll(): Promise<ITimePeriod[]> {
    const {knex: db, tenant} = await createTenantKnex();
    const timePeriods = await db<ITimePeriod>('time_periods')
      .where('tenant', tenant)
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
    const {knex: db, tenant} = await createTenantKnex();
    const period = await db<ITimePeriod>('time_periods')
      .where('tenant', tenant)
      .where('start_date', '<=', date)
      .where('end_date', '>=', date)
      .first();

    if (!period) return null;
    
    return {
      ...period,
      start_date: new Date(period.start_date).toISOString().split('.')[0] + 'Z',
      end_date: new Date(period.end_date).toISOString().split('.')[0] + 'Z'
    };
  }

  static async findOverlapping(
    startDate: ISO8601String,
    endDate: ISO8601String,
    excludePeriodId?: string
  ): Promise<ITimePeriod | null> {
    const {knex: db, tenant} = await createTenantKnex();
    const query = db<ITimePeriod>('time_periods')
      .where('tenant', tenant)
      .where((qb) => {
        qb.where((inner) => {
          inner.where('start_date', '>=', startDate).andWhere('start_date', '<', endDate);
        })
        .orWhere((inner) => {
          inner.where('end_date', '>', startDate).andWhere('end_date', '<=', endDate);
        })
        .orWhere((inner) => {
          inner.where('start_date', '<', startDate).andWhere('end_date', '>', endDate);
        });
      });

    if (excludePeriodId) {
      query.whereNot('period_id', excludePeriodId);
    }

    const period = await query.first();
    if (!period) return null;
    
    return {
      ...period,
      start_date: new Date(period.start_date).toISOString().split('.')[0] + 'Z',
      end_date: new Date(period.end_date).toISOString().split('.')[0] + 'Z'
    };
  }

  static async findById(periodId: string): Promise<ITimePeriod | null> {
    const {knex: db, tenant} = await createTenantKnex();
    const period = await db<ITimePeriod>('time_periods')
      .where('tenant', tenant)
      .where('period_id', periodId)
      .first();
    
    if (!period) return null;
    
    return {
      ...period,
      start_date: new Date(period.start_date).toISOString().split('.')[0] + 'Z',
      end_date: new Date(period.end_date).toISOString().split('.')[0] + 'Z'
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
    const [updatedPeriod] = await db<ITimePeriod>('time_periods')
      .where('period_id', periodId)
      .where('tenant', tenant)
      .update(updates)
      .returning('*');

    if (!updatedPeriod) {
      throw new Error('Time period not found or belongs to different tenant');
    }

    return {
      ...updatedPeriod,
      start_date: new Date(updatedPeriod.start_date).toISOString().split('.')[0] + 'Z',
      end_date: new Date(updatedPeriod.end_date).toISOString().split('.')[0] + 'Z'
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
