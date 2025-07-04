/**
 * Ticket Factory for E2E Tests
 * Creates ticket test data with realistic values
 */

import { faker } from '@faker-js/faker';

interface TicketInput {
  tenant: string;
  company_id: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  assigned_to?: string;
}

export async function ticketFactory(db: any, input: TicketInput) {
  const ticket = {
    ticket_id: faker.string.uuid(),
    ticket_number: faker.number.int({ min: 1000, max: 9999 }).toString(),
    tenant: input.tenant,
    company_id: input.company_id,
    title: input.title || faker.lorem.sentence(),
    description: input.description || faker.lorem.paragraph(),
    status: input.status || 'open',
    priority: input.priority || 'medium',
    assigned_to: input.assigned_to || null,
    created_at: new Date(),
    updated_at: new Date()
  };

  const result = await db.query(
    `INSERT INTO tickets (
      ticket_id, ticket_number, tenant, company_id, 
      title, description, status, priority, 
      assigned_to, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
    ) RETURNING *`,
    [
      ticket.ticket_id,
      ticket.ticket_number,
      ticket.tenant,
      ticket.company_id,
      ticket.title,
      ticket.description,
      ticket.status,
      ticket.priority,
      ticket.assigned_to,
      ticket.created_at,
      ticket.updated_at
    ]
  );

  return result.rows[0];
}