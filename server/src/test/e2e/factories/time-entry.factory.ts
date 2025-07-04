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

  const result = await db.query(
    `INSERT INTO time_entries (
      entry_id, tenant, user_id, project_id, ticket_id,
      work_date, start_time, end_time, hours, description,
      billable, approval_status, notes, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
    ) RETURNING *`,
    [
      timeEntry.entry_id,
      timeEntry.tenant,
      timeEntry.user_id,
      timeEntry.project_id,
      timeEntry.ticket_id,
      timeEntry.work_date,
      timeEntry.start_time,
      timeEntry.end_time,
      timeEntry.hours,
      timeEntry.description,
      timeEntry.billable,
      timeEntry.approval_status,
      timeEntry.notes,
      timeEntry.created_at,
      timeEntry.updated_at
    ]
  );

  return result.rows[0];
}