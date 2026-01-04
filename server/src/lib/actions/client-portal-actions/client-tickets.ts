'use server'

import { getConnection } from 'server/src/lib/db/db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { validateData } from 'server/src/lib/utils/validation';
import { ITicket, ITicketListItem, ITicketWithDetails } from 'server/src/interfaces/ticket.interfaces';
import { IComment } from 'server/src/interfaces/comment.interface';
import { IDocument } from 'server/src/interfaces/document.interface';
import { IUser } from 'server/src/interfaces/auth.interfaces';
import { z } from 'zod';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { convertBlockNoteToMarkdown } from 'server/src/lib/utils/blocknoteUtils';
import { TicketModel, CreateTicketInput } from '@shared/models/ticketModel';
import { ServerEventPublisher } from '../../adapters/serverEventPublisher';
import { ServerAnalyticsTracker } from '../../adapters/serverAnalyticsTracker';
import { getSession } from 'server/src/lib/auth/getSession';
import { publishEvent } from '../../eventBus/publishers';

const clientTicketSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  priority_id: z.string(),
});

export async function getClientTickets(status: string): Promise<ITicketListItem[]> {
  try {
    const session = await getSession();
    console.log('Debug - Full session:', JSON.stringify(session?.user, null, 2));

    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    if (!session.user.id) {
      console.error('Session user object:', session.user);
      throw new Error('User ID not found in session');
    }

    // For client portal, tenant must be present
    const tenant = session.user.tenant;
    if (!tenant) {
      console.error('Session missing tenant:', session.user);
      throw new Error('Tenant not found in session. Please log out and log back in.');
    }

    // Enforce client portal access only
    if (session.user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    // Get the database connection
    const db = await getConnection(tenant);

    // Check RBAC permission
    const userForPermission = {
      user_id: session.user.id,
      email: session.user.email,
      user_type: session.user.user_type,
      is_inactive: false
    } as IUser;
    const canRead = await hasPermission(userForPermission, 'ticket', 'read', db);
    if (!canRead) {
      throw new Error('Insufficient permissions to view tickets');
    }

    console.log('Debug - Session user ID:', session.user.id);
    console.log('Debug - Tenant:', tenant);
    console.log('Debug - ClientId:', session.user.clientId);

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get user's client_id
      const user = await trx('users')
        .where({
          user_id: session.user.id,
          tenant: tenant
        })
        .first();

      if (!user?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      const contact = await trx('contacts')
        .where({
          contact_name_id: user.contact_id,
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
        't.attributes',
        't.priority_id',
        't.tenant',
        's.name as status_name',
        'p.priority_name',
        'p.color as priority_color',
        'c.board_name',
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
}

export async function getClientTicketDetails(ticketId: string): Promise<ITicketWithDetails> {
  try {
    const session = await getSession();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    if (!session.user.id) {
      throw new Error('User ID not found in session');
    }

    // For client portal, tenant must be present
    const tenant = session.user.tenant;
    if (!tenant) {
      console.error('Session missing tenant:', session.user);
      throw new Error('Tenant not found in session. Please log out and log back in.');
    }

    // Enforce client portal access only
    if (session.user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    // Get the database connection
    const db = await getConnection(tenant);

    // Check RBAC permission
    const userForPermission = {
      user_id: session.user.id,
      email: session.user.email,
      user_type: session.user.user_type,
      is_inactive: false
    } as IUser;
    const canRead = await hasPermission(userForPermission, 'ticket', 'read', db);
    if (!canRead) {
      throw new Error('Insufficient permissions to view ticket details');
    }

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get user's client_id
      const user = await trx('users')
        .where({
          user_id: session.user.id,
          tenant: tenant
        })
        .first();

      if (!user?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      const contact = await trx('contacts')
        .where({
          contact_name_id: user.contact_id,
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
    const usersWithAvatars = await Promise.all(result.users.map(async (user: any) => {
      let avatarUrl: string | null = null;

      // For internal users, use getUserAvatarUrlAction
      if (user.user_type === 'internal') {
        try {
          const { getUserAvatarUrlAction } = await import('server/src/lib/actions/avatar-actions');
          avatarUrl = await getUserAvatarUrlAction(user.user_id, tenant);
        } catch (error) {
          console.error(`Error fetching avatar URL for internal user ${user.user_id}:`, error);
        }
      }
      // For client users, get their contact avatar
      else if (user.user_type === 'client') {
        try {
          // First, get the user's contact_id
          const userRecord = await db('users')
            .where({ user_id: user.user_id, tenant })
            .first();

          if (userRecord?.contact_id) {
            const { getContactAvatarUrlAction } = await import('server/src/lib/actions/avatar-actions');
            avatarUrl = await getContactAvatarUrlAction(userRecord.contact_id, tenant);
          }
        } catch (error) {
          console.error(`Error fetching avatar URL for client user ${user.user_id}:`, error);
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
    const session = await getSession();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    if (!session.user.id) {
      throw new Error('User ID not found in session');
    }

    // For client portal, tenant must be present
    const tenant = session.user.tenant;
    if (!tenant) {
      console.error('Session missing tenant:', session.user);
      throw new Error('Tenant not found in session. Please log out and log back in.');
    }

    // Enforce client portal access only
    if (session.user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    // Get the database connection
    const db = await getConnection(tenant);

    // Check RBAC permission
    const userForPermission = {
      user_id: session.user.id,
      email: session.user.email,
      user_type: session.user.user_type,
      is_inactive: false
    } as IUser;
    const canUpdate = await hasPermission(userForPermission, 'ticket', 'update', db);
    if (!canUpdate) {
      throw new Error('Insufficient permissions to add comments');
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const user = await trx('users')
        .where({
          user_id: session.user.id,
          tenant: tenant
        })
        .first();

      if (!user?.contact_id) {
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
        user_id: session.user.id,
        markdown_content: markdownContent
      }).returning('*');

      // Publish comment added event
      await publishEvent({
        eventType: 'TICKET_COMMENT_ADDED',
        payload: {
          tenantId: tenant,
          ticketId: ticketId,
          userId: session.user.id,
          comment: {
            id: newComment.comment_id,
            content: content,
            author: `${user.first_name} ${user.last_name}`,
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
}

export async function updateClientTicketComment(commentId: string, updates: Partial<IComment>): Promise<void> {
  try {
    const session = await getSession();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    if (!session.user.id) {
      throw new Error('User ID not found in session');
    }

    // For client portal, tenant must be present
    const tenant = session.user.tenant;
    if (!tenant) {
      console.error('Session missing tenant:', session.user);
      throw new Error('Tenant not found in session. Please log out and log back in.');
    }

    // Enforce client portal access only
    if (session.user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    // Get the database connection
    const db = await getConnection(tenant);

    // Check RBAC permission
    const userForPermission = {
      user_id: session.user.id,
      email: session.user.email,
      user_type: session.user.user_type,
      is_inactive: false
    } as IUser;
    const canUpdate = await hasPermission(userForPermission, 'ticket', 'update', db);
    if (!canUpdate) {
      throw new Error('Insufficient permissions to update comments');
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const user = await trx('users')
        .where({
          user_id: session.user.id,
          tenant: tenant
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
}

export async function updateTicketStatus(ticketId: string, newStatusId: string): Promise<void> {
  try {
    const session = await getSession();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    if (!session.user.id) {
      throw new Error('User ID not found in session');
    }

    // For client portal, tenant must be present
    const tenant = session.user.tenant;
    if (!tenant) {
      console.error('Session missing tenant:', session.user);
      throw new Error('Tenant not found in session. Please log out and log back in.');
    }

    // Enforce client portal access only
    if (session.user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    // Get the database connection
    const db = await getConnection(tenant);

    // Check RBAC permission
    const userForPermission = {
      user_id: session.user.id,
      email: session.user.email,
      user_type: session.user.user_type,
      is_inactive: false
    } as IUser;
    const canUpdate = await hasPermission(userForPermission, 'ticket', 'update', db);
    if (!canUpdate) {
      throw new Error('Insufficient permissions to update ticket status');
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const user = await trx('users')
        .where({
          user_id: session.user.id,
          tenant: tenant
        })
        .first();

      if (!user?.contact_id) {
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
          updated_by: session.user.id
        });

      // Publish ticket updated event
      await publishEvent({
        eventType: 'TICKET_UPDATED',
        payload: {
          tenantId: tenant,
          ticketId: ticketId,
          userId: session.user.id,
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
}

export async function deleteClientTicketComment(commentId: string): Promise<void> {
  try {
    const session = await getSession();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    if (!session.user.id) {
      throw new Error('User ID not found in session');
    }

    // For client portal, tenant must be present
    const tenant = session.user.tenant;
    if (!tenant) {
      console.error('Session missing tenant:', session.user);
      throw new Error('Tenant not found in session. Please log out and log back in.');
    }

    // Enforce client portal access only
    if (session.user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    // Get the database connection
    const db = await getConnection(tenant);

    // Check RBAC permission
    const userForPermission = {
      user_id: session.user.id,
      email: session.user.email,
      user_type: session.user.user_type,
      is_inactive: false
    } as IUser;
    const canDelete = await hasPermission(userForPermission, 'ticket', 'delete', db);
    if (!canDelete) {
      throw new Error('Insufficient permissions to delete comments');
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const user = await trx('users')
        .where({
          user_id: session.user.id,
          tenant: tenant
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
          tenant: tenant
        })
        .del();
    });
  } catch (error) {
    console.error('Failed to delete comment:', error);
    throw new Error('Failed to delete comment');
  }
}

export async function getClientTicketDocuments(ticketId: string): Promise<IDocument[]> {
  try {
    const session = await getSession();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    if (!session.user.id) {
      throw new Error('User ID not found in session');
    }

    const tenant = session.user.tenant;
    if (!tenant) {
      throw new Error('Tenant not found in session. Please log out and log back in.');
    }

    if (session.user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    const db = await getConnection(tenant);

    const userForPermission = {
      user_id: session.user.id,
      email: session.user.email,
      user_type: session.user.user_type,
      is_inactive: false
    } as IUser;
    const canRead = await hasPermission(userForPermission, 'ticket', 'read', db);
    if (!canRead) {
      throw new Error('Insufficient permissions to view ticket documents');
    }

    const documents = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Verify user has access to this ticket
      const user = await trx('users')
        .where({
          user_id: session.user.id,
          tenant: tenant
        })
        .first();

      if (!user?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      const contact = await trx('contacts')
        .where({
          contact_name_id: user.contact_id,
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
}

export async function createClientTicket(data: FormData): Promise<ITicket> {
  try {
    const session = await getSession();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    if (!session.user.id) {
      throw new Error('User ID not found in session');
    }

    // For client portal, tenant must be present
    const tenant = session.user.tenant;
    if (!tenant) {
      console.error('Session missing tenant:', session.user);
      throw new Error('Tenant not found in session. Please log out and log back in.');
    }

    // Enforce client portal access only
    if (session.user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    // Get the database connection
    const db = await getConnection(tenant);

    // Check RBAC permission
    const userForPermission = {
      user_id: session.user.id,
      email: session.user.email,
      user_type: session.user.user_type,
      is_inactive: false
    } as IUser;
    const canCreate = await hasPermission(userForPermission, 'ticket', 'create', db);
    if (!canCreate) {
      throw new Error('Insufficient permissions to create tickets');
    }

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get user's contact and client information
      const user = await trx('users')
        .where({
          user_id: session.user.id,
          tenant: tenant
        })
        .first();

      if (!user?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      const contact = await trx('contacts')
        .where({
          contact_name_id: user.contact_id,
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
        contact_id: user.contact_id, // Maps to contact_name_id in database
        entered_by: session.user.id,
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
        session.user.id,
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
            assignedByUserId: session.user.id
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
}
