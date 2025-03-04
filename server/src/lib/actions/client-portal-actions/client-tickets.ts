'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { validateData } from 'server/src/lib/utils/validation';
import { ITicket, ITicketListItem } from 'server/src/interfaces/ticket.interfaces';
import { IComment } from 'server/src/interfaces/comment.interface';
import { getServerSession } from 'next-auth';
import { options } from 'server/src/app/api/auth/[...nextauth]/options';
import { z } from 'zod';
import { NumberingService } from 'server/src/lib/services/numberingService';

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
      .where({
        user_id: session.user.id,
        tenant
      })
      .first();

    if (!user?.contact_id) {
      throw new Error('User not associated with a contact');
    }

    const contact = await db('contacts')
      .where({
        contact_name_id: user.contact_id,
        tenant
      })
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
        db.raw("CONCAT(u.first_name, ' ', u.last_name) as entered_by_name"),
        db.raw("CONCAT(au.first_name, ' ', au.last_name) as assigned_to_name")
      )
      .leftJoin('statuses as s', function() {
        this.on('t.status_id', '=', 's.status_id')
            .andOn('t.tenant', '=', 's.tenant');
      })
      .leftJoin('priorities as p', function() {
        this.on('t.priority_id', '=', 'p.priority_id')
            .andOn('t.tenant', '=', 'p.tenant');
      })
      .leftJoin('channels as c', function() {
        this.on('t.channel_id', '=', 'c.channel_id')
            .andOn('t.tenant', '=', 'c.tenant');
      })
      .leftJoin('categories as cat', function() {
        this.on('t.category_id', '=', 'cat.category_id')
            .andOn('t.tenant', '=', 'cat.tenant');
      })
      .leftJoin('users as u', function() {
        this.on('t.entered_by', '=', 'u.user_id')
            .andOn('t.tenant', '=', 'u.tenant');
      })
      .leftJoin('users as au', function() {
        this.on('t.assigned_to', '=', 'au.user_id')
            .andOn('t.tenant', '=', 'au.tenant');
      })
      .where({
        't.tenant': tenant,
        't.company_id': contact.company_id
      });

    // Filter by status
    if (status === 'all') {
      // No filter, show all tickets
    } else if (status === 'open') {
      query = query.whereNull('t.closed_at');
    } else if (status === 'closed') {
      query = query.whereNotNull('t.closed_at');
    } else if (status) {
      // Filter by specific status_id
      query = query.where('t.status_id', status);
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
      .where({
        user_id: session.user.id,
        tenant
      })
      .first();

    if (!user?.contact_id) {
      throw new Error('User not associated with a contact');
    }

    const contact = await db('contacts')
      .where({
        contact_name_id: user.contact_id,
        tenant
      })
      .first();

    if (!contact?.company_id) {
      throw new Error('Contact not associated with a company');
    }

    // Get ticket details with related data
    const [ticket, conversations, documents, users] = await Promise.all([
      db('tickets as t')
        .select(
          't.*',
          's.name as status_name',
          'p.priority_name'
        )
        .leftJoin('statuses as s', function() {
          this.on('t.status_id', '=', 's.status_id')
              .andOn('t.tenant', '=', 's.tenant');
        })
        .leftJoin('priorities as p', function() {
          this.on('t.priority_id', '=', 'p.priority_id')
              .andOn('t.tenant', '=', 'p.tenant');
        })
        .where({
          't.ticket_id': ticketId,
          't.tenant': tenant,
          't.company_id': contact.company_id
        })
        .first(),
      
      // Get conversations
      db('comments')
        .where({
          ticket_id: ticketId,
          tenant
        })
        .orderBy('created_at', 'asc'),
      
      // Get documents
      db('documents as d')
        .select('d.*')
        .join('document_associations as da', function() {
          this.on('d.document_id', '=', 'da.document_id')
              .andOn('d.tenant', '=', 'da.tenant');
        })
        .where({
          'da.entity_id': ticketId,
          'da.entity_type': 'ticket',
          'd.tenant': tenant
        }),
      
      // Get all users involved in the ticket
      db('users as u')
        .select(
          'u.user_id',
          'u.first_name',
          'u.last_name',
          'u.email',
          'u.user_type'
        )
        .join('comments as c', function() {
          this.on('u.user_id', '=', 'c.user_id')
              .andOn('u.tenant', '=', 'c.tenant');
        })
        .where({
          'c.ticket_id': ticketId,
          'c.tenant': tenant,
          'u.tenant': tenant
        })
        .distinct()
    ]);

    if (!ticket) {
      throw new Error('Ticket not found');
    }

    // Create user map
    const userMap = users.reduce((acc, user) => ({
      ...acc,
      [user.user_id]: {
        first_name: user.first_name,
        last_name: user.last_name,
        user_id: user.user_id,
        email: user.email,
        user_type: user.user_type
      }
    }), {});

    return {
      ...ticket,
      entered_at: ticket.entered_at instanceof Date ? ticket.entered_at.toISOString() : ticket.entered_at,
      updated_at: ticket.updated_at instanceof Date ? ticket.updated_at.toISOString() : ticket.updated_at,
      closed_at: ticket.closed_at instanceof Date ? ticket.closed_at.toISOString() : ticket.closed_at,
      conversations,
      documents,
      userMap
    };
  } catch (error) {
    console.error('Failed to fetch ticket details:', error);
    throw new Error('Failed to fetch ticket details');
  }
}

export async function addClientTicketComment(ticketId: string, content: string, isInternal: boolean = false): Promise<void> {
  try {
    const session = await getServerSession(options);
    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const user = await db('users')
      .where({
        user_id: session.user.id,
        tenant
      })
      .first();

    if (!user?.contact_id) {
      throw new Error('User not associated with a contact');
    }

    await db('comments').insert({
      tenant,
      ticket_id: ticketId,
      author_type: 'client',
      note: content,
      is_internal: isInternal,
      is_resolution: false,
      is_initial_description: false,
      created_at: new Date().toISOString(),
      user_id: session.user.id
    });
  } catch (error) {
    console.error('Failed to add comment:', error);
    throw new Error('Failed to add comment');
  }
}

export async function updateClientTicketComment(commentId: string, updates: Partial<IComment>): Promise<void> {
  try {
    const session = await getServerSession(options);
    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const user = await db('users')
      .where({
        user_id: session.user.id,
        tenant
      })
      .first();

    if (!user?.contact_id) {
      throw new Error('User not associated with a contact');
    }

    // Verify the comment belongs to this user
    const comment = await db('comments')
      .where({
        comment_id: commentId,
        tenant,
        user_id: session.user.id
      })
      .first();

    if (!comment) {
      throw new Error('Comment not found or not authorized to edit');
    }

    await db('comments')
      .where({
        comment_id: commentId,
        tenant
      })
      .update({
        ...updates,
        updated_at: new Date().toISOString()
        // Removed updated_by as it doesn't exist in the comments table
      });
  } catch (error) {
    console.error('Failed to update comment:', error);
    throw new Error('Failed to update comment');
  }
}

export async function updateTicketStatus(ticketId: string, newStatusId: string): Promise<void> {
  try {
    const session = await getServerSession(options);
    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const user = await db('users')
      .where({
        user_id: session.user.id,
        tenant
      })
      .first();

    if (!user?.contact_id) {
      throw new Error('User not associated with a contact');
    }

    // Verify the ticket belongs to the user's company
    const ticket = await db('tickets')
      .where({
        ticket_id: ticketId,
        tenant
      })
      .first();

    if (!ticket) {
      throw new Error('Ticket not found');
    }

    // Update the ticket status
    await db('tickets')
      .where({
        ticket_id: ticketId,
        tenant
      })
      .update({
        status_id: newStatusId,
        updated_at: new Date().toISOString(),
        updated_by: session.user.id
      });

  } catch (error) {
    console.error('Failed to update ticket status:', error);
    throw new Error('Failed to update ticket status');
  }
}

export async function deleteClientTicketComment(commentId: string): Promise<void> {
  try {
    const session = await getServerSession(options);
    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const user = await db('users')
      .where({
        user_id: session.user.id,
        tenant
      })
      .first();

    if (!user?.contact_id) {
      throw new Error('User not associated with a contact');
    }

    // Verify the comment belongs to this user
    const comment = await db('comments')
      .where({
        comment_id: commentId,
        tenant,
        user_id: session.user.id
      })
      .first();

    if (!comment) {
      throw new Error('Comment not found or not authorized to delete');
    }

    await db('comments')
      .where({
        comment_id: commentId,
        tenant
      })
      .del();
  } catch (error) {
    console.error('Failed to delete comment:', error);
    throw new Error('Failed to delete comment');
  }
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
        status_type: 'ticket'
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
      .where({
        user_id: session.user.id,
        tenant
      })
      .first();

    if (!user?.contact_id) {
      throw new Error('User not associated with a contact');
    }

    const contact = await db('contacts')
      .where({
        contact_name_id: user.contact_id,
        tenant
      })
      .first();

    if (!contact?.company_id) {
      throw new Error('Contact not associated with a company');
    }

    // Generate ticket number
    const numberingService = new NumberingService();
    const ticketNumber = await numberingService.getNextTicketNumber();

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

    // Create ticket and initial comment in a transaction
    const result = await db.transaction(async (trx) => {
      // Insert the ticket
      const [newTicket] = await trx('tickets')
        .insert(ticketData)
        .returning('*');

      if (!newTicket.ticket_id) {
        throw new Error('Failed to create ticket');
      }

      // Create initial description comment
      if (validatedData.description) {
        await trx('comments').insert({
          tenant,
          ticket_id: newTicket.ticket_id,
          user_id: session.user.id,
          author_type: 'client',
          note: validatedData.description,
          is_internal: false,
          is_resolution: false,
          is_initial_description: true
        });
      }

      return newTicket;
    });

    return result;
  } catch (error) {
    console.error('Failed to create client ticket:', error);
    throw new Error('Failed to create ticket');
  }
}
