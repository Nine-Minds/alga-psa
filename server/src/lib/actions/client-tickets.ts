'use server'

import { createTenantKnex } from '@/lib/db';
import { validateData } from '@/lib/utils/validation';
import { ITicket, ITicketListItem } from '@/interfaces/ticket.interfaces';
import { getServerSession } from 'next-auth';
import { options } from '@/app/api/auth/[...nextauth]/options';
import { z } from 'zod';

const clientTicketSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  priority_id: z.string(),
});

export async function getClientTickets(status: string): Promise<ITicketListItem[]> {
  try {
    const session = await getServerSession(options);
    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get user's company_id
    const user = await db('users')
      .where('user_id', session.user.id)
      .first();

    if (!user?.contact_id) {
      throw new Error('User not associated with a contact');
    }

    const contact = await db('contacts')
      .where('contact_name_id', user.contact_id)
      .first();

    if (!contact?.company_id) {
      throw new Error('Contact not associated with a company');
    }

    let query = db('tickets as t')
      .select(
        't.ticket_id',
        't.ticket_number',
        't.title',
        't.url',
        't.channel_id',
        't.company_id',
        't.contact_name_id',
        't.status_id',
        't.category_id',
        't.subcategory_id',
        't.entered_by',
        't.updated_by',
        't.closed_by',
        't.assigned_to',
        't.entered_at',
        't.updated_at',
        't.closed_at',
        't.attributes',
        't.priority_id',
        't.tenant',
        's.name as status_name',
        'p.priority_name',
        'c.channel_name',
        'cat.category_name',
        db.raw("CONCAT(u.first_name, ' ', u.last_name) as entered_by_name")
      )
      .leftJoin('statuses as s', 't.status_id', 's.status_id')
      .leftJoin('priorities as p', 't.priority_id', 'p.priority_id')
      .leftJoin('channels as c', 't.channel_id', 'c.channel_id')
      .leftJoin('categories as cat', 't.category_id', 'cat.category_id')
      .leftJoin('users as u', 't.entered_by', 'u.user_id')
      .where({
        't.tenant': tenant,
        't.company_id': contact.company_id
      });

    // Filter by status
    if (status === 'open') {
      query = query.whereNull('t.closed_at');
    } else if (status === 'closed') {
      query = query.whereNotNull('t.closed_at');
    }

    const tickets = await query.orderBy('t.entered_at', 'desc');

    return tickets.map((ticket): ITicketListItem => ({
      ...ticket,
      entered_at: ticket.entered_at instanceof Date ? ticket.entered_at.toISOString() : ticket.entered_at,
      updated_at: ticket.updated_at instanceof Date ? ticket.updated_at.toISOString() : ticket.updated_at,
      closed_at: ticket.closed_at instanceof Date ? ticket.closed_at.toISOString() : ticket.closed_at,
    }));
  } catch (error) {
    console.error('Failed to fetch client tickets:', error);
    throw new Error('Failed to fetch tickets');
  }
}

export async function getClientTicketDetails(ticketId: string): Promise<ITicket> {
  try {
    const session = await getServerSession(options);
    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get user's company_id
    const user = await db('users')
      .where('user_id', session.user.id)
      .first();

    if (!user?.contact_id) {
      throw new Error('User not associated with a contact');
    }

    const contact = await db('contacts')
      .where('contact_name_id', user.contact_id)
      .first();

    if (!contact?.company_id) {
      throw new Error('Contact not associated with a company');
    }

    const ticket = await db('tickets as t')
      .select(
        't.*',
        's.name as status_name',
        'p.priority_name'
      )
      .leftJoin('statuses as s', 't.status_id', 's.status_id')
      .leftJoin('priorities as p', 't.priority_id', 'p.priority_id')
      .where({
        't.ticket_id': ticketId,
        't.tenant': tenant,
        't.company_id': contact.company_id
      })
      .first();

    if (!ticket) {
      throw new Error('Ticket not found');
    }

    return {
      ...ticket,
      entered_at: ticket.entered_at instanceof Date ? ticket.entered_at.toISOString() : ticket.entered_at,
      updated_at: ticket.updated_at instanceof Date ? ticket.updated_at.toISOString() : ticket.updated_at,
      closed_at: ticket.closed_at instanceof Date ? ticket.closed_at.toISOString() : ticket.closed_at,
    };
  } catch (error) {
    console.error('Failed to fetch ticket details:', error);
    throw new Error('Failed to fetch ticket details');
  }
}

async function generateTicketNumber(db: any, tenant: string): Promise<string> {
  // Get the current highest ticket number for the tenant
  const result = await db('tickets')
    .where('tenant', tenant)
    .max('ticket_number as max')
    .first();

  const currentMax = result.max || 'T-0000';
  const currentNumber = parseInt(currentMax.split('-')[1]);
  const newNumber = (currentNumber + 1).toString().padStart(4, '0');
  return `T-${newNumber}`;
}

export async function createClientTicket(data: FormData): Promise<ITicket> {
  try {
    const session = await getServerSession(options);
    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get default status for new tickets
    const defaultStatus = await db('statuses')
      .where({ 
        tenant,
        is_default: true,
        item_type: 'ticket'
      })
      .first();

    if (!defaultStatus) {
      throw new Error('No default status found for tickets');
    }

    // Get default channel for tickets
    const defaultChannel = await db('channels')
      .where({ 
        tenant,
        is_default: true
      })
      .first();

    if (!defaultChannel) {
      throw new Error('No default channel found for tickets');
    }

    // Get user's company_id
    const user = await db('users')
      .where('user_id', session.user.id)
      .first();

    if (!user?.contact_id) {
      throw new Error('User not associated with a contact');
    }

    const contact = await db('contacts')
      .where('contact_name_id', user.contact_id)
      .first();

    if (!contact?.company_id) {
      throw new Error('Contact not associated with a company');
    }

    // Generate ticket number
    const ticketNumber = await generateTicketNumber(db, tenant);

    // Validate input data
    const validatedData = validateData(clientTicketSchema, {
      title: data.get('title'),
      description: data.get('description'),
      priority_id: data.get('priority_id'),
    });

    const ticketData: Partial<ITicket> = {
      title: validatedData.title,
      ticket_number: ticketNumber,
      status_id: defaultStatus.status_id,
      priority_id: validatedData.priority_id,
      channel_id: defaultChannel.channel_id,
      company_id: contact.company_id,
      contact_name_id: user.contact_id,
      entered_by: session.user.id,
      entered_at: new Date().toISOString(),
      attributes: {
        description: validatedData.description
      },
      tenant,
      url: null,
      category_id: null,
      subcategory_id: null,
      updated_by: null,
      closed_by: null,
      assigned_to: null,
      updated_at: null,
      closed_at: null,
    };

    // Create ticket
    const [newTicket] = await db('tickets')
      .insert(ticketData)
      .returning('*');

    return newTicket;
  } catch (error) {
    console.error('Failed to create client ticket:', error);
    throw new Error('Failed to create ticket');
  }
}
