import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { faker } from '@faker-js/faker';

export interface TimeEntry {
  entry_id: string;
  tenant: string;
  work_item_id?: string;
  work_item_type?: string;
  service_id?: string;
  user_id: string;
  start_time: Date;
  end_time: Date;
  billable_duration: number;
  notes?: string;
  time_sheet_id?: string;
  approval_status?: string;
  contract_line_id?: string;
  tax_region?: string;
  tax_rate_id?: string;
  invoiced?: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Service {
  service_id: string;
  tenant: string;
  service_name: string;
  description?: string;
  billing_method: 'fixed' | 'hourly' | 'usage';
  custom_service_type_id: string;
  default_rate?: number;
  unit_of_measure?: string;
  category_id?: string | null;
  tax_rate_id?: string | null;
}

export interface TimePeriod {
  period_id: string;
  tenant: string;
  start_date: Date;
  end_date: Date;
  is_closed: boolean;
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
    tax_region: overrides.tax_region,
    tax_rate_id: overrides.tax_rate_id,
    invoiced: overrides.invoiced || false,
    contract_line_id: overrides.contract_line_id,
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
  // First, we need to create a service type if not provided
  let serviceTypeId = overrides.custom_service_type_id;
  if (!serviceTypeId) {
    // Check if a service type exists for this tenant
    const existingType = await db('service_types')
      .where({ tenant: tenantId })
      .first();
    
    if (existingType) {
      serviceTypeId = existingType.id;
    } else {
      // Create a new service type
      const typeData = {
        id: uuidv4(),
        tenant: tenantId,
        name: 'Default Service Type',
        billing_method: 'fixed' as const,
        is_active: true,
        order_number: 1
      };
      await db('service_types').insert(typeData);
      serviceTypeId = typeData.id;
    }
  }

  const serviceData: Service = {
    service_id: overrides.service_id || uuidv4(),
    tenant: tenantId,
    service_name: overrides.service_name || faker.commerce.department() + ' Service',
    description: overrides.description || faker.lorem.sentence(),
    billing_method: overrides.billing_method || 'fixed',
    custom_service_type_id: serviceTypeId,
    default_rate: overrides.default_rate || faker.number.int({ min: 5000, max: 20000 }), // in cents
    unit_of_measure: overrides.unit_of_measure || 'hour',
    category_id: overrides.category_id || null,
    tax_rate_id: overrides.tax_rate_id || null
  };

  const [service] = await db('service_catalog').insert(serviceData).returning('*');
  return service;
}

export async function createTestTimePeriod(
  db: Knex,
  tenantId: string,
  overrides: Partial<TimePeriod> = {}
): Promise<TimePeriod> {
  const now = new Date();
  const startDate = overrides.start_date || faker.date.recent({ days: 14 });
  const endDate = overrides.end_date || new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000); // 1 week later
  
  const periodData: TimePeriod = {
    period_id: overrides.period_id || uuidv4(),
    tenant: tenantId,
    start_date: startDate,
    end_date: endDate,
    is_closed: overrides.is_closed !== undefined ? overrides.is_closed : false,
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
  await db('service_types').where({ tenant: tenantId }).delete();
}
