'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { validateData } from 'server/src/lib/utils/validation';
import { ITicket, ITicketListItem } from 'server/src/interfaces/ticket.interfaces';
import { IComment } from 'server/src/interfaces/comment.interface';
import { auth } from 'server/src/app/api/auth/[...nextauth]/auth';
import { z } from 'zod';
import { NumberingService } from 'server/src/lib/services/numberingService';
import { convertBlockNoteToMarkdown } from 'server/src/lib/utils/blocknoteUtils';
import { TicketModel, CreateTicketInput } from '@shared/models/ticketModel';
import { ServerEventPublisher } from '../../adapters/serverEventPublisher';
import { ServerAnalyticsTracker } from '../../adapters/serverAnalyticsTracker';

const clientTicketSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  priority_id: z.string(),
});

export async function getClientTickets(status: string): Promise<ITicketListItem[]> {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get user's company_id
      const user = await trx('users')
        .where({
          user_id: session.user.id,
          tenant
        })
        .first();

      if (!user?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      const contact = await trx('contacts')
        .where({
          contact_name_id: user.contact_id,
          tenant
        })
        .first();

      if (!contact?.company_id) {
        throw new Error('Contact not associated with a company');
      }

      let query = trx('tickets as t')
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
        'p.color as priority_color',
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

      return tickets;
    });

    return result.map((ticket): ITicketListItem => ({
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
    const session = await auth();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get user's company_id
      const user = await trx('users')
        .where({
          user_id: session.user.id,
          tenant
        })
        .first();

      if (!user?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      const contact = await trx('contacts')
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
        trx('tickets as t')
        .select(
          't.*',
          's.name as status_name',
          'p.priority_name',
          'p.color as priority_color'
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
        trx('comments')
        .where({
          ticket_id: ticketId,
          tenant
        })
        .orderBy('created_at', 'asc'),
      
        // Get documents
        trx('documents as d')
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
      
        // Get all users involved in the ticket, including avatar file_id
        trx('users as u')
        .select(
          'u.user_id',
          'u.first_name',
          'u.last_name',
          'u.email',
          'u.user_type',
          'd.file_id as avatar_file_id'
        )
        .leftJoin('document_associations as da', function() {
          this.on('da.entity_id', '=', 'u.user_id')
              .andOn('da.tenant', '=', 'u.tenant')
              .andOnVal('da.entity_type', '=', 'user');
        })
        .leftJoin('documents as d', function() {
           this.on('d.document_id', '=', 'da.document_id')
              .andOn('d.tenant', '=', 'u.tenant');
        })
        .join('comments as c', function() {
          this.on('u.user_id', '=', 'c.user_id')
              .andOn('u.tenant', '=', 'c.tenant');
        })
        .where({
          'c.ticket_id': ticketId,
          'c.tenant': tenant,
          'u.tenant': tenant
        })
        .distinct('u.user_id', 'u.first_name', 'u.last_name', 'u.email', 'u.user_type', 'd.file_id')
      ]);

      return { ticket, conversations, documents, users };
    });

    if (!result.ticket) {
      throw new Error('Ticket not found');
    }

    // Create user map, including avatar URLs
    const usersWithAvatars = await Promise.all(result.users.map(async (user: any) => {
      let avatarUrl: string | null = null;
      if (user.avatar_file_id) {
        try {
          const { getImageUrl } = await import('server/src/lib/actions/document-actions/documentActions');
          avatarUrl = await getImageUrl(user.avatar_file_id);
        } catch (imgError) {
          console.error(`Error fetching avatar URL for user ${user.user_id} fileId ${user.avatar_file_id}:`, imgError);
          avatarUrl = null;
        }
      }
      const { avatar_file_id, ...userData } = user;
      return {
        ...userData,
        avatarUrl,
      };
    }));

    const userMap = usersWithAvatars.reduce((acc, user) => ({
      ...acc,
      [user.user_id]: {
        first_name: user.first_name,
        last_name: user.last_name,
        user_id: user.user_id,
        email: user.email,
        user_type: user.user_type,
        avatarUrl: user.avatarUrl
      }
    }), {} as Record<string, { user_id: string; first_name: string; last_name: string; email?: string, user_type: string, avatarUrl: string | null }>);

    return {
      ...result.ticket,
      entered_at: result.ticket.entered_at instanceof Date ? result.ticket.entered_at.toISOString() : result.ticket.entered_at,
      updated_at: result.ticket.updated_at instanceof Date ? result.ticket.updated_at.toISOString() : result.ticket.updated_at,
      closed_at: result.ticket.closed_at instanceof Date ? result.ticket.closed_at.toISOString() : result.ticket.closed_at,
      conversations: result.conversations,
      documents: result.documents,
      userMap
    };
  } catch (error) {
    console.error('Failed to fetch ticket details:', error);
    throw new Error('Failed to fetch ticket details');
  }
}

export async function addClientTicketComment(ticketId: string, content: string, isInternal: boolean = false, isResolution: boolean = false): Promise<boolean> {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const user = await trx('users')
        .where({
          user_id: session.user.id,
          tenant
        })
        .first();

      if (!user?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      let markdownContent = "";
      try {
        markdownContent = await convertBlockNoteToMarkdown(content);
        console.log("Converted markdown content for client comment:", markdownContent);
      } catch (e) {
        console.error("Error converting client comment to markdown:", e);
        markdownContent = "[Error converting content to markdown]";
      }

      await trx('comments').insert({
      tenant,
      ticket_id: ticketId,
      author_type: 'client',
      note: content,
      is_internal: isInternal,
      is_resolution: isResolution,
        created_at: new Date().toISOString(),
        user_id: session.user.id,
        markdown_content: markdownContent
      });
    });
    
    return true; // Return true to indicate success
  } catch (error) {
    console.error('Failed to add comment:', error);
    throw new Error('Failed to add comment');
  }
}

export async function updateClientTicketComment(commentId: string, updates: Partial<IComment>): Promise<void> {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const user = await trx('users')
        .where({
          user_id: session.user.id,
          tenant
        })
        .first();

      if (!user?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      // Verify the comment belongs to this user
      const comment = await trx('comments')
        .where({
          comment_id: commentId,
          tenant,
          user_id: session.user.id
        })
        .first();

      if (!comment) {
        throw new Error('Comment not found or not authorized to edit');
      }

      let updatesWithMarkdown = { ...updates };
      if (updates.note) {
        try {
          const markdownContent = await convertBlockNoteToMarkdown(updates.note);
          console.log("Converted markdown content for updated client comment:", markdownContent);
          updatesWithMarkdown.markdown_content = markdownContent;
        } catch (e) {
          console.error("Error converting updated client comment to markdown:", e);
          updatesWithMarkdown.markdown_content = "[Error converting content to markdown]";
        }
      }

      await trx('comments')
        .where({
          comment_id: commentId,
          tenant
        })
        .update({
          ...updatesWithMarkdown,
          updated_at: new Date().toISOString()
          // Removed updated_by as it doesn't exist in the comments table
        });
    });
  } catch (error) {
    console.error('Failed to update comment:', error);
    throw new Error('Failed to update comment');
  }
}

export async function updateTicketStatus(ticketId: string, newStatusId: string): Promise<void> {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const user = await trx('users')
        .where({
          user_id: session.user.id,
          tenant
        })
        .first();

      if (!user?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      // Verify the ticket belongs to the user's company
      const ticket = await trx('tickets')
        .where({
          ticket_id: ticketId,
          tenant
        })
        .first();

      if (!ticket) {
        throw new Error('Ticket not found');
      }

      // Update the ticket status
      await trx('tickets')
        .where({
          ticket_id: ticketId,
          tenant
        })
        .update({
          status_id: newStatusId,
          updated_at: new Date().toISOString(),
          updated_by: session.user.id
        });
    });

  } catch (error) {
    console.error('Failed to update ticket status:', error);
    throw new Error('Failed to update ticket status');
  }
}

export async function deleteClientTicketComment(commentId: string): Promise<void> {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const user = await trx('users')
        .where({
          user_id: session.user.id,
          tenant
        })
        .first();

      if (!user?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      // Verify the comment belongs to this user
      const comment = await trx('comments')
        .where({
          comment_id: commentId,
          tenant,
          user_id: session.user.id
        })
        .first();

      if (!comment) {
        throw new Error('Comment not found or not authorized to delete');
      }

      await trx('comments')
        .where({
          comment_id: commentId,
          tenant
        })
        .del();
    });
  } catch (error) {
    console.error('Failed to delete comment:', error);
    throw new Error('Failed to delete comment');
  }
}

export async function createClientTicket(data: FormData): Promise<ITicket> {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get user's contact and company information
      const user = await trx('users')
        .where({
          user_id: session.user.id,
          tenant
        })
        .first();

      if (!user?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      const contact = await trx('contacts')
        .where({
          contact_name_id: user.contact_id,
          tenant
        })
        .first();

      if (!contact?.company_id) {
        throw new Error('Contact not associated with a company');
      }

      // Fetch default channel for client portal tickets
      const defaultChannel = await trx('channels')
        .where({
          tenant,
          is_default: true
        })
        .first();

      if (!defaultChannel) {
        throw new Error('No default channel configured for tickets');
      }

      // Fetch default status for tickets
      const defaultStatus = await trx('statuses')
        .where({
          tenant,
          is_default: true,
          status_type: 'ticket'
        })
        .first();

      if (!defaultStatus) {
        throw new Error('No default status configured for tickets');
      }

      // Validate input data using shared validation approach
      const validatedData = validateData(clientTicketSchema, {
        title: data.get('title'),
        description: data.get('description'),
        priority_id: data.get('priority_id'),
      });

      // Convert to TicketModel input format
      const createTicketInput: CreateTicketInput = {
        title: validatedData.title,
        description: validatedData.description,
        priority_id: validatedData.priority_id,
        company_id: contact.company_id,
        contact_id: user.contact_id, // Maps to contact_name_id in database
        entered_by: session.user.id,
        source: 'client_portal',
        channel_id: defaultChannel.channel_id,
        status_id: defaultStatus.status_id
      };

      // Create adapters for client portal context
      const eventPublisher = new ServerEventPublisher();
      const analyticsTracker = new ServerAnalyticsTracker();

      // Use shared TicketModel with retry logic, events, and analytics
      const ticketResult = await TicketModel.createTicketWithRetry(
        createTicketInput,
        tenant,
        trx,
        {}, // validation options
        eventPublisher,
        analyticsTracker,
        session.user.id,
        3 // max retries
      );

      // Get the full ticket data for return
      const fullTicket = await trx('tickets')
        .where({ ticket_id: ticketResult.ticket_id, tenant: tenant })
        .first();

      if (!fullTicket) {
        throw new Error('Failed to retrieve created ticket');
      }

      return fullTicket as ITicket;
    });

    return result;
  } catch (error) {
    console.error('Failed to create client ticket:', error);
    throw new Error('Failed to create ticket');
  }
}
