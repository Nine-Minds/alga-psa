/**
 * Ticket Factory for E2E Tests
 * Creates ticket test data with realistic values
 */

import { faker } from '@faker-js/faker';

interface TicketInput {
  tenant: string;
  client_id: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  assigned_to?: string;
  // Backward compatibility
  client_id?: string;
}

export async function ticketFactory(db: any, input: TicketInput) {
  // Support both client_id and client_id (backward compatibility)
  const clientId = input.client_id || input.client_id;
  if (!clientId) {
    throw new Error('Either client_id or client_id must be provided');
  }

  const ticket = {
    ticket_id: faker.string.uuid(),
    ticket_number: faker.number.int({ min: 1000, max: 9999 }).toString(),
    tenant: input.tenant,
    client_id: clientId,
    title: input.title || faker.lorem.sentence(),
    description: input.description || faker.lorem.paragraph(),
    status: input.status || 'open',
    priority: input.priority || 'medium',
    assigned_to: input.assigned_to || null,
    created_at: new Date(),
    updated_at: new Date()
  };

  const result = await db('tickets')
    .insert({
      ticket_id: ticket.ticket_id,
      ticket_number: ticket.ticket_number,
      tenant: ticket.tenant,
      client_id: ticket.client_id,
      title: ticket.title,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      assigned_to: ticket.assigned_to,
      created_at: ticket.created_at,
      updated_at: ticket.updated_at
    })
    .returning('*');

  return result[0];
}