import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { faker } from '@faker-js/faker';

export interface TimeEntry {
  entry_id: string;
  tenant: string;
  work_item_id?: string;
  work_item_type?: string;
  service_id: string;
  user_id: string;
  start_time: Date;
  end_time: Date;
  billable_duration: number;
  notes?: string;
  time_sheet_id?: string;
  approval_status?: string;
  approved_by?: string;
  approved_date?: Date;
  billing_plan_id?: string;
  created_at: Date;
  updated_at: Date;
}

export interface Service {
  service_id: string;
  tenant: string;
  service_name: string;
  custom_service_type_id: string;
  billing_method: 'fixed' | 'per_unit';
  default_rate: number;
  unit_of_measure: string;
  category_id?: string | null;
  tax_rate_id?: string | null;
  description?: string | null;
}

export interface TimePeriod {
  period_id: string;
  tenant: string;
  user_id: string;
  start_date: Date;
  end_date: Date;
  period_status: string;
  created_at: Date;
  updated_at: Date;
}

// TrackingSession interface removed - table doesn't exist

export async function createTestTimeEntry(
  db: Knex, 
  tenantId: string,
  overrides: Partial<TimeEntry> = {}
): Promise<TimeEntry> {
  const now = new Date();
  const startTime = overrides.start_time || faker.date.recent({ days: 7 });
  const endTime = overrides.end_time || new Date(startTime.getTime() + faker.number.int({ min: 30, max: 480 }) * 60000);
  const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);
  
  const entryData: TimeEntry = {
    entry_id: overrides.entry_id || uuidv4(),
    tenant: tenantId,
    work_item_id: overrides.work_item_id || uuidv4(),
    work_item_type: overrides.work_item_type || 'ticket',
    service_id: overrides.service_id || uuidv4(),
    user_id: overrides.user_id || uuidv4(),
    start_time: startTime,
    end_time: endTime,
    billable_duration: overrides.billable_duration !== undefined ? overrides.billable_duration : durationMinutes,
    notes: overrides.notes || faker.lorem.sentence(),
    time_sheet_id: overrides.time_sheet_id,
    approval_status: overrides.approval_status || 'DRAFT',
    approved_by: overrides.approved_by,
    approved_date: overrides.approved_date,
    billing_plan_id: overrides.billing_plan_id,
    created_at: overrides.created_at || now,
    updated_at: overrides.updated_at || now
  };

  const [entry] = await db('time_entries').insert(entryData).returning('*');
  return entry;
}

export async function createTestService(
  db: Knex,
  tenantId: string,
  overrides: Partial<Service> = {}
): Promise<Service> {
  // Create a service type first if not provided
  let serviceTypeId = overrides.custom_service_type_id;
  if (!serviceTypeId) {
    const serviceType = {
      id: uuidv4(),
      tenant: tenantId,
      name: faker.commerce.department() + ' Type',
      billing_method: 'fixed' as const,
      is_active: true,
      order_number: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    await db('service_types').insert(serviceType);
    serviceTypeId = serviceType.id;
  }

  const serviceData: Service = {
    service_id: overrides.service_id || uuidv4(),
    tenant: tenantId,
    service_name: overrides.service_name || faker.commerce.department() + ' Service',
    custom_service_type_id: serviceTypeId,
    billing_method: overrides.billing_method || 'fixed',
    default_rate: overrides.default_rate !== undefined ? overrides.default_rate : faker.number.int({ min: 50, max: 200 }),
    unit_of_measure: overrides.unit_of_measure || 'hour',
    category_id: overrides.category_id !== undefined ? overrides.category_id : null,
    tax_rate_id: overrides.tax_rate_id !== undefined ? overrides.tax_rate_id : null,
    description: overrides.description !== undefined ? overrides.description : faker.lorem.sentence()
  };

  const [service] = await db('service_catalog').insert(serviceData).returning('*');
  return service;
}

export async function createTestTimePeriod(
  db: Knex,
  tenantId: string,
  userId: string,
  overrides: Partial<TimePeriod> = {}
): Promise<TimePeriod> {
  const now = new Date();
  const startDate = overrides.start_date || faker.date.recent({ days: 14 });
  const endDate = overrides.end_date || new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000); // 1 week later
  
  const periodData: TimePeriod = {
    period_id: overrides.period_id || uuidv4(),
    tenant: tenantId,
    user_id: userId,
    start_date: startDate,
    end_date: endDate,
    period_status: overrides.period_status || 'open',
    created_at: overrides.created_at || now,
    updated_at: overrides.updated_at || now
  };

  const [period] = await db('time_periods').insert(periodData).returning('*');
  return period;
}

// createTestTrackingSession function removed - table doesn't exist

export async function cleanupTestTimeEntries(db: Knex, tenantId: string): Promise<void> {
  await db('time_entries').where({ tenant: tenantId }).delete();
  await db('time_periods').where({ tenant: tenantId }).delete();
  await db('service_catalog').where({ tenant: tenantId }).delete();
}