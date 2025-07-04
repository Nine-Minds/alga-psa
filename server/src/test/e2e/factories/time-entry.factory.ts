/**
 * Time Entry Factory for E2E Tests
 * Creates time entry test data with realistic values
 */

import { faker } from '@faker-js/faker';
import { IUser } from '../../../lib/interfaces/user.interface';

interface TimeEntryInput {
  tenant: string;
  user_id: string;
  project_id?: string;
  ticket_id?: string;
  work_date?: string;
  start_time?: string;
  end_time?: string;
  hours?: number;
  description?: string;
  billable?: boolean;
  approval_status?: 'pending' | 'approved' | 'rejected' | 'changes_requested';
  notes?: string;
}

export async function timeEntryFactory(db: any, input: TimeEntryInput) {
  const timeEntry = {
    entry_id: faker.string.uuid(),
    tenant: input.tenant,
    user_id: input.user_id,
    project_id: input.project_id || null,
    ticket_id: input.ticket_id || null,
    work_date: input.work_date || faker.date.recent({ days: 30 }).toISOString().split('T')[0],
    start_time: input.start_time || '09:00:00',
    end_time: input.end_time || '17:00:00', 
    hours: input.hours || faker.number.float({ min: 0.5, max: 8, precision: 0.5 }),
    description: input.description || faker.lorem.sentence(),
    billable: input.billable !== undefined ? input.billable : faker.datatype.boolean(),
    approval_status: input.approval_status || 'pending',
    notes: input.notes || faker.lorem.sentence(),
    created_at: new Date(),
    updated_at: new Date()
  };

  const result = await db('time_entries')
    .insert({
      entry_id: timeEntry.entry_id,
      tenant: timeEntry.tenant,
      user_id: timeEntry.user_id,
      project_id: timeEntry.project_id,
      ticket_id: timeEntry.ticket_id,
      work_date: timeEntry.work_date,
      start_time: timeEntry.start_time,
      end_time: timeEntry.end_time,
      hours: timeEntry.hours,
      description: timeEntry.description,
      billable: timeEntry.billable,
      approval_status: timeEntry.approval_status,
      notes: timeEntry.notes,
      created_at: timeEntry.created_at,
      updated_at: timeEntry.updated_at
    })
    .returning('*');

  return result[0];
}