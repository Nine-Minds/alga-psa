'use server'

import { validateData } from '@alga-psa/validation';
import { ITicket, ITicketListItem, ITicketWithDetails } from '@alga-psa/types';
import { IComment } from '@alga-psa/types';
import { IDocument } from '@alga-psa/types';
import { IUser } from '@alga-psa/types';
import { z } from 'zod';
import { Knex } from 'knex';
import { hasPermission, withAuth } from '@alga-psa/auth';
import { convertBlockNoteToMarkdown } from '@alga-psa/documents/lib/blocknoteUtils';
import { TicketModel, CreateTicketInput } from '@shared/models/ticketModel';
import { ServerEventPublisher } from '@alga-psa/event-bus';
import { ServerAnalyticsTracker } from '@alga-psa/analytics';
import { createTenantKnex, getConnection, withTransaction } from '@alga-psa/db';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { maybeReopenBundleMasterFromChildReply } from '@alga-psa/tickets/actions/ticketBundleUtils';

const clientTicketSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  priority_id: z.string(),
});

export const getClientTickets = withAuth(async (user, { tenant }, status: string): Promise<ITicketListItem[]> => {
  try {
    console.log('Debug - Full user:', JSON.stringify(user, null, 2));

    if (!user.user_id) {
      console.error('User object:', user);
      throw new Error('User ID not found in session');
    }

    // Enforce client portal access only
    if (user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    // Get the database connection
    const db = await getConnection(tenant);

    // Check RBAC permission
    const userForPermission = {
      user_id: user.user_id,
      email: user.email,
      user_type: user.user_type,
      is_inactive: false
    } as IUser;
    const canRead = await hasPermission(userForPermission, 'ticket', 'read', db);
    if (!canRead) {
      throw new Error('Insufficient permissions to view tickets');
    }

    console.log('Debug - User ID:', user.user_id);
    console.log('Debug - Tenant:', tenant);
    console.log('Debug - Client user:', user.user_id);

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get user's client_id
      const userRecord = await trx('users')
        .where({
          user_id: user.user_id,
          tenant: tenant
        })
        .first();

      if (!userRecord?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      const contact = await trx('contacts')
        .where({
          contact_name_id: userRecord.contact_id,
          tenant: tenant
        })
        .first();

      if (!contact?.client_id) {
        throw new Error('Contact not associated with a client');
      }

      let query = trx('tickets as t')
      .select(
        't.ticket_id',
        't.ticket_number',
        't.title',
        't.url',
        't.board_id',
        't.client_id',
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
        't.due_date',
        't.attributes',
        't.priority_id',
        't.tenant',
        't.response_state',
        's.name as status_name',
        'p.priority_name',
        'p.color as priority_color',
        'c.board_name',
        'cat.category_name',
        db.raw("CONCAT(u.first_name, ' ', u.last_name) as entered_by_name"),
        db.raw("CONCAT(au.first_name, ' ', au.last_name) as assigned_to_name"),
        db.raw("(SELECT COUNT(*) FROM ticket_resources tr WHERE tr.ticket_id = t.ticket_id AND tr.tenant = t.tenant AND tr.additional_user_id IS NOT NULL)::int as additional_agent_count"),
        db.raw(`(SELECT COALESCE(json_agg(json_build_object('user_id', uu.user_id, 'name', CONCAT(uu.first_name, ' ', uu.last_name))), '[]'::json) FROM ticket_resources tr2 JOIN users uu ON tr2.additional_user_id = uu.user_id AND tr2.tenant = uu.tenant WHERE tr2.ticket_id = t.ticket_id AND tr2.tenant = t.tenant) as additional_agents`)
      )
      .leftJoin('statuses as s', function() {
        this.on('t.status_id', '=', 's.status_id')
            .andOn('t.tenant', '=', 's.tenant');
      })
      .leftJoin('priorities as p', function() {
        this.on('t.priority_id', '=', 'p.priority_id')
            .andOn('t.tenant', '=', 'p.tenant');
      })
      .leftJoin('boards as c', function() {
        this.on('t.board_id', '=', 'c.board_id')
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
        't.client_id': contact.client_id
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
    console.error('Failed to fetch client tickets - Full error:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    throw error; // Throw the original error to see the actual issue
  }
});

export const getClientTicketDetails = withAuth(async (user, { tenant }, ticketId: string): Promise<ITicketWithDetails> => {
  try {
    if (!user.user_id) {
      throw new Error('User ID not found in session');
    }

    // Enforce client portal access only
    if (user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    // Get the database connection
    const db = await getConnection(tenant);

    // Check RBAC permission
    const userForPermission = {
      user_id: user.user_id,
      email: user.email,
      user_type: user.user_type,
      is_inactive: false
    } as IUser;
    const canRead = await hasPermission(userForPermission, 'ticket', 'read', db);
    if (!canRead) {
      throw new Error('Insufficient permissions to view ticket details');
    }

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get user's client_id
      const userRecord = await trx('users')
        .where({
          user_id: user.user_id,
          tenant: tenant
        })
        .first();

      if (!userRecord?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      const contact = await trx('contacts')
        .where({
          contact_name_id: userRecord.contact_id,
          tenant: tenant
        })
        .first();

      if (!contact?.client_id) {
        throw new Error('Contact not associated with a client');
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
          't.client_id': contact.client_id
        })
        .first(),

        // Get conversations
        trx('comments')
        .where({
          ticket_id: ticketId,
          tenant: tenant
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
        // This includes users who have commented OR are assigned to the ticket
        trx.raw(`
          SELECT DISTINCT u.user_id, u.first_name, u.last_name, u.email, u.user_type, d.file_id as avatar_file_id
          FROM users u
          LEFT JOIN document_associations da ON da.entity_id = u.user_id
            AND da.tenant = u.tenant
            AND da.entity_type = 'user'
          LEFT JOIN documents d ON d.document_id = da.document_id
            AND d.tenant = u.tenant
          WHERE u.tenant = ?
            AND (
              -- Users who have commented
              u.user_id IN (
                SELECT c.user_id FROM comments c
                WHERE c.ticket_id = ? AND c.tenant = ?
              )
              -- Or the assigned agent
              OR u.user_id = (
                SELECT t.assigned_to FROM tickets t
                WHERE t.ticket_id = ? AND t.tenant = ?
              )
              -- Or additional agents from ticket_resources
              OR u.user_id IN (
                SELECT tr.additional_user_id FROM ticket_resources tr
                WHERE tr.ticket_id = ? AND tr.tenant = ?
              )
            )
        `, [tenant, ticketId, tenant, ticketId, tenant, ticketId, tenant])
        .then((result: any) => result.rows)
      ]);

      return { ticket, conversations, documents, users };
    });

    if (!result.ticket) {
      throw new Error('Ticket not found');
    }

    // Create user map, including avatar URLs
    const usersWithAvatars = await Promise.all(result.users.map(async (userRecord: any) => {
      let avatarUrl: string | null = null;

      // For internal users, use getUserAvatarUrlAction
      if (userRecord.user_type === 'internal') {
        try {
          const { getUserAvatarUrlAction } = await import('@alga-psa/users/actions');
          avatarUrl = await getUserAvatarUrlAction(userRecord.user_id, tenant);
        } catch (error) {
          console.error(`Error fetching avatar URL for internal user ${userRecord.user_id}:`, error);
        }
      }
      // For client users, get their contact avatar
      else if (userRecord.user_type === 'client') {
        try {
          // First, get the user's contact_id
          const userDbRecord = await db('users')
            .where({ user_id: userRecord.user_id, tenant })
            .first();

          if (userDbRecord?.contact_id) {
            const { getContactAvatarUrlAction } = await import('@alga-psa/users/actions');
            avatarUrl = await getContactAvatarUrlAction(userDbRecord.contact_id, tenant);
          }
        } catch (error) {
          console.error(`Error fetching avatar URL for client user ${userRecord.user_id}:`, error);
        }
      }

      const { avatar_file_id, ...userData } = userRecord;
      return {
        ...userData,
        avatarUrl,
      };
    }));

    const userMap = usersWithAvatars.reduce((acc, userRecord) => ({
      ...acc,
      [userRecord.user_id]: {
        first_name: userRecord.first_name,
        last_name: userRecord.last_name,
        user_id: userRecord.user_id,
        email: userRecord.email,
        user_type: userRecord.user_type,
        avatarUrl: userRecord.avatarUrl
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
});

export const addClientTicketComment = withAuth(async (
  user,
  { tenant },
  ticketId: string,
  content: string,
  isInternal: boolean = false,
  isResolution: boolean = false
): Promise<boolean> => {
  try {
    if (!user.user_id) {
      throw new Error('User ID not found in session');
    }

    // Enforce client portal access only
    if (user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    // Get the database connection
    const db = await getConnection(tenant);

    // Check RBAC permission
    const userForPermission = {
      user_id: user.user_id,
      email: user.email,
      user_type: user.user_type,
      is_inactive: false
    } as IUser;
    const canUpdate = await hasPermission(userForPermission, 'ticket', 'update', db);
    if (!canUpdate) {
      throw new Error('Insufficient permissions to add comments');
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const userRecord = await trx('users')
        .where({
          user_id: user.user_id,
          tenant: tenant
        })
        .first();

      if (!userRecord?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      let markdownContent = "";
      try {
        markdownContent = convertBlockNoteToMarkdown(content);
        console.log("Converted markdown content for client comment:", markdownContent);
      } catch (e) {
        console.error("Error converting client comment to markdown:", e);
        markdownContent = "[Error converting content to markdown]";
      }

      const [newComment] = await trx('comments').insert({
      tenant,
      ticket_id: ticketId,
      author_type: 'client',
      note: content,
      is_internal: isInternal,
      is_resolution: isResolution,
        created_at: new Date().toISOString(),
        user_id: user.user_id,
        markdown_content: markdownContent
      }).returning('*');

      if (!isInternal) {
        await maybeReopenBundleMasterFromChildReply(trx, tenant, ticketId, user.user_id);
      }

      // Publish comment added event
      await publishEvent({
        eventType: 'TICKET_COMMENT_ADDED',
        payload: {
          tenantId: tenant,
          ticketId: ticketId,
          userId: user.user_id,
          comment: {
            id: newComment.comment_id,
            content: content,
            author: `${userRecord.first_name} ${userRecord.last_name}`,
            isInternal
          }
        }
      });
    });

    return true; // Return true to indicate success
  } catch (error) {
    console.error('Failed to add comment:', error);
    throw new Error('Failed to add comment');
  }
});

export const updateClientTicketComment = withAuth(async (
  user,
  { tenant },
  commentId: string,
  updates: Partial<IComment>
): Promise<void> => {
  try {
    if (!user.user_id) {
      throw new Error('User ID not found in session');
    }

    // Enforce client portal access only
    if (user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    // Get the database connection
    const db = await getConnection(tenant);

    // Check RBAC permission
    const userForPermission = {
      user_id: user.user_id,
      email: user.email,
      user_type: user.user_type,
      is_inactive: false
    } as IUser;
    const canUpdate = await hasPermission(userForPermission, 'ticket', 'update', db);
    if (!canUpdate) {
      throw new Error('Insufficient permissions to update comments');
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const userRecord = await trx('users')
        .where({
          user_id: user.user_id,
          tenant: tenant
        })
        .first();

      if (!userRecord?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      // Verify the comment belongs to this user
      const comment = await trx('comments')
        .where({
          comment_id: commentId,
          tenant,
          user_id: user.user_id
        })
        .first();

      if (!comment) {
        throw new Error('Comment not found or not authorized to edit');
      }

      let updatesWithMarkdown = { ...updates };
      if (updates.note) {
        try {
          const markdownContent = convertBlockNoteToMarkdown(updates.note);
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
          tenant: tenant
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
});

export const updateTicketStatus = withAuth(async (
  user,
  { tenant },
  ticketId: string,
  newStatusId: string
): Promise<void> => {
  try {
    if (!user.user_id) {
      throw new Error('User ID not found in session');
    }

    // Enforce client portal access only
    if (user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    // Get the database connection
    const db = await getConnection(tenant);

    // Check RBAC permission
    const userForPermission = {
      user_id: user.user_id,
      email: user.email,
      user_type: user.user_type,
      is_inactive: false
    } as IUser;
    const canUpdate = await hasPermission(userForPermission, 'ticket', 'update', db);
    if (!canUpdate) {
      throw new Error('Insufficient permissions to update ticket status');
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const userRecord = await trx('users')
        .where({
          user_id: user.user_id,
          tenant: tenant
        })
        .first();

      if (!userRecord?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      // Verify the ticket belongs to the user's client
      const ticket = await trx('tickets')
        .where({
          ticket_id: ticketId,
          tenant: tenant
        })
        .first();

      if (!ticket) {
        throw new Error('Ticket not found');
      }

      // Get old status for change tracking
      const oldStatusId = ticket.status_id;

      // Update the ticket status
      await trx('tickets')
        .where({
          ticket_id: ticketId,
          tenant: tenant
        })
        .update({
          status_id: newStatusId,
          updated_at: new Date().toISOString(),
          updated_by: user.user_id
        });

      // Publish ticket updated event
      await publishEvent({
        eventType: 'TICKET_UPDATED',
        payload: {
          tenantId: tenant,
          ticketId: ticketId,
          userId: user.user_id,
          changes: {
            status_id: {
              old: oldStatusId,
              new: newStatusId
            }
          }
        }
      });
    });

  } catch (error) {
    console.error('Failed to update ticket status:', error);
    throw new Error('Failed to update ticket status');
  }
});

export const deleteClientTicketComment = withAuth(async (user, { tenant }, commentId: string): Promise<void> => {
  try {
    if (!user.user_id) {
      throw new Error('User ID not found in session');
    }

    // Enforce client portal access only
    if (user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    // Get the database connection
    const db = await getConnection(tenant);

    // Check RBAC permission
    const userForPermission = {
      user_id: user.user_id,
      email: user.email,
      user_type: user.user_type,
      is_inactive: false
    } as IUser;
    const canDelete = await hasPermission(userForPermission, 'ticket', 'delete', db);
    if (!canDelete) {
      throw new Error('Insufficient permissions to delete comments');
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const userRecord = await trx('users')
        .where({
          user_id: user.user_id,
          tenant: tenant
        })
        .first();

      if (!userRecord?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      // Verify the comment belongs to this user
      const comment = await trx('comments')
        .where({
          comment_id: commentId,
          tenant,
          user_id: user.user_id
        })
        .first();

      if (!comment) {
        throw new Error('Comment not found or not authorized to delete');
      }

      await trx('comments')
        .where({
          comment_id: commentId,
          tenant: tenant
        })
        .del();
    });
  } catch (error) {
    console.error('Failed to delete comment:', error);
    throw new Error('Failed to delete comment');
  }
});

export const getClientTicketDocuments = withAuth(async (user, { tenant }, ticketId: string): Promise<IDocument[]> => {
  try {
    if (!user.user_id) {
      throw new Error('User ID not found in session');
    }

    if (user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    const db = await getConnection(tenant);

    const userForPermission = {
      user_id: user.user_id,
      email: user.email,
      user_type: user.user_type,
      is_inactive: false
    } as IUser;
    const canRead = await hasPermission(userForPermission, 'ticket', 'read', db);
    if (!canRead) {
      throw new Error('Insufficient permissions to view ticket documents');
    }

    const documents = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Verify user has access to this ticket
      const userRecord = await trx('users')
        .where({
          user_id: user.user_id,
          tenant: tenant
        })
        .first();

      if (!userRecord?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      const contact = await trx('contacts')
        .where({
          contact_name_id: userRecord.contact_id,
          tenant: tenant
        })
        .first();

      if (!contact?.client_id) {
        throw new Error('Contact not associated with a client');
      }

      // Verify ticket belongs to user's client
      const ticket = await trx('tickets')
        .where({
          ticket_id: ticketId,
          tenant: tenant,
          client_id: contact.client_id
        })
        .first();

      if (!ticket) {
        throw new Error('Ticket not found or access denied');
      }

      // Get documents for the ticket
      return trx('documents as d')
        .select('d.*')
        .join('document_associations as da', function() {
          this.on('d.document_id', '=', 'da.document_id')
              .andOn('d.tenant', '=', 'da.tenant');
        })
        .where({
          'da.entity_id': ticketId,
          'da.entity_type': 'ticket',
          'd.tenant': tenant
        });
    });

    return documents;
  } catch (error) {
    console.error('Failed to fetch ticket documents:', error);
    throw new Error('Failed to fetch ticket documents');
  }
});

export const createClientTicket = withAuth(async (user, { tenant }, data: FormData): Promise<ITicket> => {
  try {
    if (!user.user_id) {
      throw new Error('User ID not found in session');
    }

    // Enforce client portal access only
    if (user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    // Get the database connection
    const db = await getConnection(tenant);

    // Check RBAC permission
    const userForPermission = {
      user_id: user.user_id,
      email: user.email,
      user_type: user.user_type,
      is_inactive: false
    } as IUser;
    const canCreate = await hasPermission(userForPermission, 'ticket', 'create', db);
    if (!canCreate) {
      throw new Error('Insufficient permissions to create tickets');
    }

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get user's contact and client information
      const userRecord = await trx('users')
        .where({
          user_id: user.user_id,
          tenant: tenant
        })
        .first();

      if (!userRecord?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      const contact = await trx('contacts')
        .where({
          contact_name_id: userRecord.contact_id,
          tenant: tenant
        })
        .first();

      if (!contact?.client_id) {
        throw new Error('Contact not associated with a client');
      }

      // Fetch default board for client portal tickets
      const defaultBoard = await trx('boards')
        .where({
          tenant,
          is_default: true
        })
        .first();

      if (!defaultBoard) {
        throw new Error('No default board configured for tickets');
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
        client_id: contact.client_id,
        contact_id: userRecord.contact_id, // Maps to contact_name_id in database
        entered_by: user.user_id,
        source: 'client_portal',
        board_id: defaultBoard.board_id,
        status_id: defaultStatus.status_id,
        // Auto-assign to board's default agent if configured
        assigned_to: defaultBoard.default_assigned_to || undefined
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
        user.user_id,
        3 // max retries
      );

      // Publish TICKET_ASSIGNED event if a default agent was set
      if (createTicketInput.assigned_to) {
        await publishEvent({
          eventType: 'TICKET_ASSIGNED',
          payload: {
            tenantId: tenant,
            ticketId: ticketResult.ticket_id,
            userId: createTicketInput.assigned_to,
            assignedByUserId: user.user_id
          }
        });
      }

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
});
