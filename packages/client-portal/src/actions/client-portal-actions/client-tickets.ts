'use server'

/* eslint-disable custom-rules/no-feature-to-feature-imports -- Client portal ticket actions intentionally compose ticketing feature APIs for client-facing workflows. */

import { validateData } from '@alga-psa/validation';
import { COMMENT_RESPONSE_SOURCES, IComment, ITicket, ITicketListItem, ITicketWithDetails, TICKET_ORIGINS } from '@alga-psa/types';
import { IDocument } from '@alga-psa/types';
import { IUser } from '@alga-psa/types';
import { z } from 'zod';
import { Knex } from 'knex';
import { hasPermission, withAuth } from '@alga-psa/auth';
import { convertBlockNoteToMarkdown } from '@alga-psa/formatting/blocknoteUtils';
import { TicketModel, CreateTicketInput } from '@shared/models/ticketModel';
import { ServerEventPublisher } from '@alga-psa/event-bus';
import { ServerAnalyticsTracker } from '@alga-psa/analytics';
import { createTenantKnex, getConnection, tenantDb, withTransaction } from '@alga-psa/db';
import { publishEvent, publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { enforceTicketCloseRules } from '@alga-psa/tickets/lib/validateTicketClosure';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  TICKET_ACTIVITY_SOURCE,
  writeTicketActivity,
} from '@shared/lib/ticketActivity';
import { maybeReopenBundleMasterFromChildReply } from '@alga-psa/tickets/actions/ticketBundleUtils';
import {
  applyVisibilityBoardFilter,
  getTicketOrigin,
  parseTicketStatusFilterValue,
} from '@alga-psa/tickets/lib';
import { getClientContactVisibilityContext } from '@alga-psa/tickets/lib/clientPortalVisibility.server';
import { publishTicketUpdate } from '@alga-psa/tickets/lib/liveUpdates';
import { getUserAvatarUrlAction, getContactAvatarUrlAction } from '@alga-psa/user-composition/actions/avatarActions';

const clientTicketSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  priority_id: z.string(),
  board_id: z.string().optional(),
  asset_id: z.string().uuid().optional(),
});

const VISIBILITY_NOT_FOUND_ERROR =
  'Visibility group assignment is invalid for this contact.';

async function resolvePortalVisibility(
  trx: Knex.Transaction,
  tenant: string,
  userId: string
) {
  const userRecord = await tenantDb(trx, tenant).table('users')
    .where({
      user_id: userId
    })
    .first();

  if (!userRecord?.contact_id) {
    throw new Error('User not associated with a contact');
  }

  const visibility = await getClientContactVisibilityContext(trx, tenant, userRecord.contact_id);
  return { userRecord, visibility };
}

async function resolveVisibleTicket(
  trx: Knex.Transaction,
  tenant: string,
  userContactId: string,
  ticketId: string
) {
  const visibility = await getClientContactVisibilityContext(trx, tenant, userContactId);

  const ticket = await tenantDb(trx, tenant).table('tickets as t')
    .select('t.*')
    .where({
      't.ticket_id': ticketId,
      't.client_id': visibility.clientId
    })
    .modify((queryBuilder: Knex.QueryBuilder) => {
      applyVisibilityBoardFilter(queryBuilder, visibility.visibleBoardIds, 't.board_id');
    })
    .first();

  if (!ticket) {
    throw new Error('Ticket not found or access denied');
  }

  return ticket;
}

export const getClientTickets = withAuth(async (user, { tenant }, status: string): Promise<ITicketListItem[]> => {
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
      is_inactive: false,
      tenant
    } as IUser;
    const canRead = await hasPermission(userForPermission, 'ticket', 'read', db);
    if (!canRead) {
      throw new Error('Insufficient permissions to view tickets');
    }

    const parsedStatusFilter = parseTicketStatusFilterValue(status);

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const { visibility } = await resolvePortalVisibility(trx, tenant, user.user_id);
      const scopedDb = tenantDb(trx, tenant);
      const additionalAgentCountSubquery = scopedDb
        .table('ticket_resources as tr')
        .whereRaw('tr.ticket_id = t.ticket_id')
        .whereNotNull('tr.additional_user_id')
        .select(trx.raw('COUNT(*)::int'))
        .as('additional_agent_count');
      const additionalAgentsSubquery = scopedDb.table('ticket_resources as tr2');
      scopedDb.tenantJoin(additionalAgentsSubquery, 'users as uu', 'tr2.additional_user_id', 'uu.user_id');
      additionalAgentsSubquery
        .whereRaw('tr2.ticket_id = t.ticket_id')
        .select(trx.raw("COALESCE(json_agg(json_build_object('user_id', uu.user_id, 'name', CONCAT(uu.first_name, ' ', uu.last_name))), '[]'::json)"))
        .as('additional_agents');

      let query = scopedDb.table('tickets as t');
      scopedDb.tenantJoin(query, 'statuses as s', 't.status_id', 's.status_id', { type: 'left' });
      scopedDb.tenantJoin(query, 'priorities as p', 't.priority_id', 'p.priority_id', { type: 'left' });
      scopedDb.tenantJoin(query, 'boards as c', 't.board_id', 'c.board_id', { type: 'left' });
      scopedDb.tenantJoin(query, 'categories as cat', 't.category_id', 'cat.category_id', { type: 'left' });
      scopedDb.tenantJoin(query, 'users as u', 't.entered_by', 'u.user_id', { type: 'left' });
      scopedDb.tenantJoin(query, 'users as au', 't.assigned_to', 'au.user_id', { type: 'left' });
      scopedDb.tenantJoin(query, 'teams as tm', 't.assigned_team_id', 'tm.team_id', { type: 'left' });

      query = query.select(
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
        't.assigned_team_id',
        'tm.team_name as assigned_team_name',
        additionalAgentCountSubquery,
        additionalAgentsSubquery.as('additional_agents')
      )
      .where({
        't.client_id': visibility.clientId
      });

      applyVisibilityBoardFilter(query, visibility.visibleBoardIds);

    // Filter by status
    if (parsedStatusFilter.kind === 'all') {
      // No filter, show all tickets
    } else if (parsedStatusFilter.kind === 'open') {
      query = query.where('s.is_closed', false);
    } else if (parsedStatusFilter.kind === 'closed') {
      query = query.where('s.is_closed', true);
    } else if (parsedStatusFilter.kind === 'name') {
      query = query.where('s.name', parsedStatusFilter.statusName);
    } else if (parsedStatusFilter.kind === 'id') {
      query = query.where('t.status_id', parsedStatusFilter.statusId);
    }

      const tickets = await query.orderBy('t.entered_at', 'desc') as ITicketListItem[];

      return tickets;
    }) as any[];

    return result.map((ticket: any): ITicketListItem => ({
      ...ticket,
      entered_at: ticket.entered_at instanceof Date ? ticket.entered_at.toISOString() : ticket.entered_at,
      updated_at: ticket.updated_at instanceof Date ? ticket.updated_at.toISOString() : ticket.updated_at,
      closed_at: ticket.closed_at instanceof Date ? ticket.closed_at.toISOString() : ticket.closed_at,
    }));
  } catch (error) {
    console.error('Failed to fetch client tickets:', error);
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
      is_inactive: false,
      tenant
    } as IUser;
    const canRead = await hasPermission(userForPermission, 'ticket', 'read', db);
    if (!canRead) {
      throw new Error('Insufficient permissions to view ticket details');
    }

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const { visibility } = await resolvePortalVisibility(trx, tenant, user.user_id);
      const scopedDb = tenantDb(trx, tenant);

      // Get ticket details with related data
      const ticketAdditionalAgentsSubquery = scopedDb.table('ticket_resources as tr2');
      scopedDb.tenantJoin(ticketAdditionalAgentsSubquery, 'users as uu', 'tr2.additional_user_id', 'uu.user_id');
      ticketAdditionalAgentsSubquery
        .whereRaw('tr2.ticket_id = t.ticket_id')
        .select(trx.raw("COALESCE(json_agg(json_build_object('user_id', uu.user_id, 'name', CONCAT(uu.first_name, ' ', uu.last_name))), '[]'::json)"));

      const ticketQuery = scopedDb.table('tickets as t');
      scopedDb.tenantJoin(ticketQuery, 'statuses as s', 't.status_id', 's.status_id', { type: 'left' });
      scopedDb.tenantJoin(ticketQuery, 'priorities as p', 't.priority_id', 'p.priority_id', { type: 'left' });
      scopedDb.tenantJoin(ticketQuery, 'users as u_creator', 't.entered_by', 'u_creator.user_id', { type: 'left' });
      scopedDb.tenantJoin(ticketQuery, 'teams as tm', 't.assigned_team_id', 'tm.team_id', { type: 'left' });
      ticketQuery
        .select(
          't.*',
          's.name as status_name',
          'p.priority_name',
          'p.color as priority_color',
          'u_creator.user_type as entered_by_user_type',
          'tm.team_name as assigned_team_name',
          ticketAdditionalAgentsSubquery.as('additional_agents')
        )
        .where({
          't.ticket_id': ticketId,
          't.client_id': visibility.clientId
        })
        .modify((ticketQuery: Knex.QueryBuilder) => {
          applyVisibilityBoardFilter(ticketQuery, visibility.visibleBoardIds);
        })
        .first();

      const documentsQuery = scopedDb.table('documents as d').select('d.*');
      scopedDb.tenantJoin(documentsQuery, 'document_associations as da', 'd.document_id', 'da.document_id');
      documentsQuery.where({
        'da.entity_id': ticketId,
        'da.entity_type': 'ticket',
        'd.is_client_visible': true,
      });

      const commentUserIdsSubquery = scopedDb.table('comments as c')
        .select('c.user_id')
        .where('c.ticket_id', ticketId);
      const assignedUserIdSubquery = scopedDb.table('tickets as assigned_ticket')
        .select('assigned_ticket.assigned_to')
        .where('assigned_ticket.ticket_id', ticketId);
      const additionalUserIdsSubquery = scopedDb.table('ticket_resources as tr')
        .select('tr.additional_user_id')
        .where('tr.ticket_id', ticketId);

      const usersQuery = scopedDb.table('users as u')
        .distinct(
          'u.user_id',
          'u.first_name',
          'u.last_name',
          'u.email',
          'u.user_type',
          'd.file_id as avatar_file_id'
        );
      scopedDb.tenantJoin(usersQuery, 'document_associations as da', 'da.entity_id', 'u.user_id', {
        type: 'left',
        on: (join) => {
          join.andOn('da.entity_type', '=', trx.raw('?', ['user']));
        },
      });
      scopedDb.tenantJoin(usersQuery, 'documents as d', 'd.document_id', 'da.document_id', { type: 'left' });
      usersQuery.where(function(this: Knex.QueryBuilder) {
        this.whereIn('u.user_id', commentUserIdsSubquery)
          .orWhereIn('u.user_id', assignedUserIdSubquery)
          .orWhereIn('u.user_id', additionalUserIdsSubquery);
      });

      const linkedAssetsQuery = scopedDb.table('asset_associations as aa');
      scopedDb.tenantJoin(linkedAssetsQuery, 'assets as a', 'aa.asset_id', 'a.asset_id');
      linkedAssetsQuery
        .where({
          'aa.entity_id': ticketId,
          'aa.entity_type': 'ticket',
          'a.client_id': visibility.clientId,
        })
        .select<Array<{
          asset_id: string;
          name: string;
          asset_tag: string | null;
          asset_type: string | null;
          relationship_type: string | null;
        }>>(
          'a.asset_id',
          'a.name',
          'a.asset_tag',
          'a.asset_type',
          'aa.relationship_type',
        );

      const [ticket, conversations, documents, users, linkedAssets] = await Promise.all([
        ticketQuery,

        // Get conversations
        scopedDb.table('comments')
        .where({
          ticket_id: ticketId
        })
        .orderBy('created_at', 'asc'),

        // Get client-visible documents only
        documentsQuery,

        // Get all users involved in the ticket, including avatar file_id
        // This includes users who have commented OR are assigned to the ticket
        usersQuery,

        // Linked assets (asset_associations -> assets) scoped to the requester's client.
        linkedAssetsQuery
      ]);

      return { ticket, conversations, documents, users, linkedAssets };
    }) as any;

    if (!result.ticket) {
      throw new Error('Ticket not found');
    }

    // Create user map, including avatar URLs
    const usersWithAvatars = await Promise.all(result.users.map(async (userRecord: any) => {
      let avatarUrl: string | null = null;

      // For internal users, use getUserAvatarUrlAction
      if (userRecord.user_type === 'internal') {
        try {
          avatarUrl = await getUserAvatarUrlAction(userRecord.user_id, tenant);
        } catch (error) {
          console.error(`Error fetching avatar URL for internal user ${userRecord.user_id}:`, error);
        }
      }
      // For client users, get their contact avatar
      else if (userRecord.user_type === 'client') {
        try {
          // First, get the user's contact_id
          const userDbRecord = await tenantDb(db, tenant).table('users')
            .where({ user_id: userRecord.user_id })
            .first();

          if (userDbRecord?.contact_id) {
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

    const commentContactIds = Array.from(
      new Set(
        (result.conversations as Array<{ contact_id?: string | null }>)
          .map((comment) => comment.contact_id)
          .filter((contactId): contactId is string => Boolean(contactId))
      )
    );

    const commentContacts = commentContactIds.length > 0
      ? await tenantDb(db, tenant).table('contacts')
        .select('contact_name_id', 'full_name', 'email')
        .whereIn('contact_name_id', commentContactIds)
      : [];

    const contactMap = commentContacts.reduce((acc, contactRecord) => ({
      ...acc,
      [contactRecord.contact_name_id]: {
        contact_id: contactRecord.contact_name_id,
        full_name: contactRecord.full_name || '',
        email: contactRecord.email || undefined,
        avatarUrl: null as string | null,
      }
    }), {} as Record<string, { contact_id: string; full_name: string; email?: string; avatarUrl: string | null }>);

    const { entered_by_user_type, ...ticketWithoutCreatorType } = result.ticket as any;

    return {
      ...ticketWithoutCreatorType,
      ticket_origin: getTicketOrigin(result.ticket as any),
      entered_at: result.ticket.entered_at instanceof Date ? result.ticket.entered_at.toISOString() : result.ticket.entered_at,
      updated_at: result.ticket.updated_at instanceof Date ? result.ticket.updated_at.toISOString() : result.ticket.updated_at,
      closed_at: result.ticket.closed_at instanceof Date ? result.ticket.closed_at.toISOString() : result.ticket.closed_at,
      conversations: result.conversations,
      documents: result.documents,
      // Linked assets joined from asset_associations; the type is broadened on
      // the consumer side via a small augmentation since ITicketWithDetails
      // doesn't model this today.
      linkedAssets: result.linkedAssets,
      userMap,
      contactMap
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
      is_inactive: false,
      tenant
    } as IUser;
    const canUpdate = await hasPermission(userForPermission, 'ticket', 'update', db);
    if (!canUpdate) {
      throw new Error('Insufficient permissions to add comments');
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const userRecord = await tenantDb(trx, tenant).table('users')
        .where({
          user_id: user.user_id
        })
        .first();

      if (!userRecord?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      await resolveVisibleTicket(trx, tenant, userRecord.contact_id, ticketId);

      let markdownContent = "";
      try {
        markdownContent = await convertBlockNoteToMarkdown(content);
        console.log("Converted markdown content for client comment:", markdownContent);
      } catch (e) {
        console.error("Error converting client comment to markdown:", e);
        markdownContent = "[Error converting content to markdown]";
      }

      // comments.thread_id is NOT NULL — generate IDs and create the thread row first.
      const clientCommentIds = await trx.raw(
        'SELECT gen_random_uuid() AS comment_id, gen_random_uuid() AS thread_id'
      );
      const clientGeneratedIds = clientCommentIds.rows?.[0] as
        | { comment_id: string; thread_id: string }
        | undefined;
      if (!clientGeneratedIds?.comment_id || !clientGeneratedIds?.thread_id) {
        throw new Error('Failed to generate comment/thread identifiers');
      }
      const clientNowIso = new Date().toISOString();

      await tenantDb(trx, tenant).table('comment_threads').insert({
        tenant,
        thread_id: clientGeneratedIds.thread_id,
        ticket_id: ticketId,
        project_task_id: null,
        root_comment_id: clientGeneratedIds.comment_id,
        is_internal: isInternal,
        reply_count: 0,
        last_activity_at: clientNowIso,
        created_at: clientNowIso,
        created_by: user.user_id || null,
      });

      const [newComment] = await tenantDb(trx, tenant).table('comments').insert({
        tenant,
        comment_id: clientGeneratedIds.comment_id,
        thread_id: clientGeneratedIds.thread_id,
        ticket_id: ticketId,
        author_type: 'client',
        note: content,
        is_internal: isInternal,
        is_resolution: isResolution,
        metadata: JSON.stringify({
          responseSource: COMMENT_RESPONSE_SOURCES.CLIENT_PORTAL,
        }),
        created_at: clientNowIso,
        user_id: user.user_id,
        markdown_content: markdownContent
      }).returning('*');

      if (!isInternal) {
        await tenantDb(trx, tenant).table('tickets')
          .where({
            ticket_id: ticketId,
          })
          .update({ response_state: 'awaiting_internal' });

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

      await publishTicketUpdate({
        tenantId: tenant,
        ticketId,
        updatedFields: isInternal ? ['comments'] : ['comments', 'response_state'],
        updatedBy: {
          userId: user.user_id,
          displayName: `${userRecord.first_name || ''} ${userRecord.last_name || ''}`.trim() || user.email || 'Client User',
        },
        updatedAt: newComment.created_at instanceof Date ? newComment.created_at.toISOString() : new Date().toISOString(),
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
      is_inactive: false,
      tenant
    } as IUser;
    const canUpdate = await hasPermission(userForPermission, 'ticket', 'update', db);
    if (!canUpdate) {
      throw new Error('Insufficient permissions to update comments');
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const userRecord = await tenantDb(trx, tenant).table('users')
        .where({
          user_id: user.user_id
        })
        .first();

      if (!userRecord?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      // Verify the comment belongs to this user
      const comment = await tenantDb(trx, tenant).table('comments')
        .where({
          comment_id: commentId,
          user_id: user.user_id
        })
        .first();

      if (!comment) {
        throw new Error('Comment not found or not authorized to edit');
      }

      await resolveVisibleTicket(trx, tenant, userRecord.contact_id, comment.ticket_id);

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

      await tenantDb(trx, tenant).table('comments')
        .where({
          comment_id: commentId
        })
        .update({
          ...updatesWithMarkdown,
          updated_at: new Date().toISOString()
          // Removed updated_by as it doesn't exist in the comments table
        });

      await publishTicketUpdate({
        tenantId: tenant,
        ticketId: comment.ticket_id,
        updatedFields: ['comments'],
        updatedBy: {
          userId: user.user_id,
          displayName: `${userRecord.first_name || ''} ${userRecord.last_name || ''}`.trim() || user.email || 'Client User',
        },
        updatedAt: new Date().toISOString(),
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
      is_inactive: false,
      tenant
    } as IUser;
    const canUpdate = await hasPermission(userForPermission, 'ticket', 'update', db);
    if (!canUpdate) {
      throw new Error('Insufficient permissions to update ticket status');
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const userRecord = await tenantDb(trx, tenant).table('users')
        .where({
          user_id: user.user_id
        })
        .first();

      if (!userRecord?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      const ticket = await resolveVisibleTicket(
        trx,
        tenant,
        userRecord.contact_id,
        ticketId
      );

      if (!ticket) {
        throw new Error('Ticket not found');
      }

      if (!ticket.board_id) {
        throw new Error('Ticket does not have a board');
      }

      const statusForBoard = await tenantDb(trx, tenant).table('statuses')
        .where({
          status_id: newStatusId,
          status_type: 'ticket',
          board_id: ticket.board_id,
        })
        .first('status_id', 'is_closed', 'name');

      if (!statusForBoard) {
        throw new Error('Selected status is not valid for the ticket board');
      }

      // Get old status for change tracking
      const oldStatusId = ticket.status_id;
      const oldStatus = await tenantDb(trx, tenant).table('statuses')
        .where({ status_id: oldStatusId })
        .first('status_id', 'is_closed');

      const isClosing = !!statusForBoard.is_closed && !oldStatus?.is_closed;
      const isReopening = !statusForBoard.is_closed && !!oldStatus?.is_closed;
      const occurredAt = new Date().toISOString();
      const actorDisplayName =
        `${userRecord.first_name || ''} ${userRecord.last_name || ''}`.trim() || user.email || 'Client User';

      // Close rules deliberately do NOT block portal users — customers can't
      // satisfy internal-hygiene gates (time entries, internal checklists).
      // The exemption is recorded as an audited bypass on gated boards.
      if (isClosing) {
        await enforceTicketCloseRules(trx, tenant, {
          ticket: {
            ticket_id: ticketId,
            board_id: ticket.board_id,
            category_id: ticket.category_id ?? null,
            subcategory_id: ticket.subcategory_id ?? null,
            priority_id: ticket.priority_id ?? null,
            assigned_to: ticket.assigned_to ?? null,
          },
          bypass: { source: 'client_portal' },
          actor: {
            actorType: TICKET_ACTIVITY_ACTOR.USER,
            userId: user.user_id,
            displayName: actorDisplayName,
          },
          source: TICKET_ACTIVITY_SOURCE.CLIENT_PORTAL,
        });
      }

      // Update the ticket status with full closure semantics: the denormalized
      // is_closed flag and closed_at/closed_by transitions mirror the MSP-side
      // update paths.
      await tenantDb(trx, tenant).table('tickets')
        .where({
          ticket_id: ticketId
        })
        .update({
          status_id: newStatusId,
          is_closed: !!statusForBoard.is_closed,
          ...(isClosing ? { closed_at: occurredAt, closed_by: user.user_id } : {}),
          ...(isReopening ? { closed_at: null, closed_by: null } : {}),
          ...(isClosing && ticket.response_state ? { response_state: null } : {}),
          updated_at: occurredAt,
          updated_by: user.user_id
        });

      const statusChanges = {
        status_id: {
          old: oldStatusId,
          new: newStatusId
        }
      };

      if (isClosing) {
        await publishWorkflowEvent({
          eventType: 'TICKET_CLOSED',
          payload: {
            ticketId: ticketId,
            userId: user.user_id,
            closedByUserId: user.user_id,
            closedAt: occurredAt,
            changes: statusChanges,
          },
          ctx: {
            tenantId: tenant,
            actor: { actorType: 'USER' as const, actorUserId: user.user_id },
            occurredAt,
          },
          eventName: 'Ticket Closed',
          fromState: oldStatusId,
          toState: newStatusId,
        });
      } else if (isReopening) {
        await publishWorkflowEvent({
          eventType: 'TICKET_REOPENED',
          payload: {
            ticketId: ticketId,
            userId: user.user_id,
            reopenedByUserId: user.user_id,
            changes: statusChanges,
          },
          ctx: {
            tenantId: tenant,
            actor: { actorType: 'USER' as const, actorUserId: user.user_id },
            occurredAt,
          },
          eventName: 'Ticket Reopened',
          fromState: oldStatusId,
          toState: newStatusId,
        });
      } else {
        // Publish ticket updated event
        await publishEvent({
          eventType: 'TICKET_UPDATED',
          payload: {
            tenantId: tenant,
            ticketId: ticketId,
            userId: user.user_id,
            changes: statusChanges
          }
        });
      }

      // Activity-timeline row so portal-driven transitions are attributable.
      await writeTicketActivity(trx, {
        tenant,
        ticketId,
        eventType: isClosing
          ? TICKET_ACTIVITY_EVENT.CLOSED
          : isReopening
            ? TICKET_ACTIVITY_EVENT.REOPENED
            : TICKET_ACTIVITY_EVENT.STATUS_CHANGED,
        entityType: TICKET_ACTIVITY_ENTITY.TICKET,
        entityId: ticketId,
        actor: {
          actorType: TICKET_ACTIVITY_ACTOR.USER,
          userId: user.user_id,
          displayName: actorDisplayName,
        },
        source: TICKET_ACTIVITY_SOURCE.CLIENT_PORTAL,
        occurredAt,
        changes: statusChanges,
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
      is_inactive: false,
      tenant
    } as IUser;
    const canDelete = await hasPermission(userForPermission, 'ticket', 'delete', db);
    if (!canDelete) {
      throw new Error('Insufficient permissions to delete comments');
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const userRecord = await tenantDb(trx, tenant).table('users')
        .where({
          user_id: user.user_id
        })
        .first();

      if (!userRecord?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      // Verify the comment belongs to this user
      const comment = await tenantDb(trx, tenant).table('comments')
        .where({
          comment_id: commentId,
          user_id: user.user_id
        })
        .first();

      if (!comment) {
        throw new Error('Comment not found or not authorized to delete');
      }

      await resolveVisibleTicket(trx, tenant, userRecord.contact_id, comment.ticket_id);

      await tenantDb(trx, tenant).table('comments')
        .where({
          comment_id: commentId
        })
        .del();

      await publishTicketUpdate({
        tenantId: tenant,
        ticketId: comment.ticket_id,
        updatedFields: ['comments'],
        updatedBy: {
          userId: user.user_id,
          displayName: `${userRecord.first_name || ''} ${userRecord.last_name || ''}`.trim() || user.email || 'Client User',
        },
        updatedAt: new Date().toISOString(),
      });
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
      is_inactive: false,
      tenant
    } as IUser;
    const canRead = await hasPermission(userForPermission, 'ticket', 'read', db);
    if (!canRead) {
      throw new Error('Insufficient permissions to view ticket documents');
    }

    const documents = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Verify user has access to this ticket
      const { visibility } = await resolvePortalVisibility(trx, tenant, user.user_id);

      // Verify ticket belongs to user's client
      const ticket = await tenantDb(trx, tenant).table('tickets')
        .where({
          ticket_id: ticketId,
          client_id: visibility.clientId
        })
        .modify((queryBuilder: Knex.QueryBuilder) => {
          applyVisibilityBoardFilter(queryBuilder, visibility.visibleBoardIds);
        })
        .first();

      if (!ticket) {
        throw new Error('Ticket not found or access denied');
      }

      // Get client-visible documents for the ticket
      const scopedDb = tenantDb(trx, tenant);
      const documentsQuery = scopedDb.table('documents as d').select('d.*');
      scopedDb.tenantJoin(documentsQuery, 'document_associations as da', 'd.document_id', 'da.document_id');

      return documentsQuery
        .where({
          'da.entity_id': ticketId,
          'da.entity_type': 'ticket',
          'd.is_client_visible': true,
        }) as unknown as Promise<IDocument[]>;
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
      is_inactive: false,
      tenant
    } as IUser;
    const canCreate = await hasPermission(userForPermission, 'ticket', 'create', db);
    if (!canCreate) {
      throw new Error('Insufficient permissions to create tickets');
    }

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const { visibility } = await resolvePortalVisibility(trx, tenant, user.user_id);

      // Validate input data using shared validation approach
      const validatedData = validateData(clientTicketSchema, {
        title: data.get('title'),
        description: data.get('description'),
        priority_id: data.get('priority_id'),
        board_id: data.get('board_id')
          ? data.get('board_id')?.toString()
          : undefined,
        asset_id: data.get('asset_id')
          ? data.get('asset_id')?.toString()
          : undefined,
      });

      const requestedBoardId = validatedData.board_id?.trim() || null;
      let assignedBoardId: string | null = requestedBoardId;

      if (visibility.visibleBoardIds !== null && visibility.visibleBoardIds.length === 0) {
        throw new Error('Selected visibility group does not allow any boards');
      }

      if (visibility.visibleBoardIds !== null) {
        if (!requestedBoardId) {
          assignedBoardId = visibility.visibleBoardIds[0] || null;
        } else if (!visibility.visibleBoardIds.includes(requestedBoardId)) {
          throw new Error(VISIBILITY_NOT_FOUND_ERROR);
        }
      }

      const resolvedBoard = !assignedBoardId
        ? await tenantDb(trx, tenant).table('boards')
            .where({
              is_default: true,
              is_inactive: false
            })
            .first()
        : await tenantDb(trx, tenant).table('boards')
            .where({
              board_id: assignedBoardId,
              is_inactive: false
            })
            .first();

      if (!resolvedBoard) {
        throw new Error(
          assignedBoardId
            ? VISIBILITY_NOT_FOUND_ERROR
            : 'No default board configured for tickets'
        );
      }

      assignedBoardId = resolvedBoard.board_id;

      // Fetch default status for tickets
      const defaultStatusId = await TicketModel.getDefaultStatusId(
        tenant,
        trx,
        resolvedBoard.board_id
      );

      if (!defaultStatusId) {
        throw new Error('No default status configured for tickets');
      }

      // Convert to TicketModel input format
      const createTicketInput: CreateTicketInput = {
        title: validatedData.title,
        description: validatedData.description,
        priority_id: validatedData.priority_id,
        client_id: visibility.clientId,
        contact_id: visibility.contactId, // Maps to contact_name_id in database
        entered_by: user.user_id,
        source: 'client_portal',
        ticket_origin: TICKET_ORIGINS.CLIENT_PORTAL,
        board_id: resolvedBoard.board_id,
        status_id: defaultStatusId,
        // Auto-assign from the resolved board after visibility checks.
        assigned_to: resolvedBoard.default_assigned_to ?? undefined
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

      // If an asset was selected, link it to the ticket. The asset must already
      // belong to the requester's client; we verify ownership before inserting.
      if (validatedData.asset_id) {
        const asset = await tenantDb(trx, tenant).table('assets')
          .where({
            asset_id: validatedData.asset_id,
            client_id: visibility.clientId,
          })
          .select('asset_id')
          .first();

        if (!asset) {
          throw new Error('Selected asset does not belong to this client');
        }

        await tenantDb(trx, tenant).table('asset_associations').insert({
          tenant,
          asset_id: validatedData.asset_id,
          entity_id: ticketResult.ticket_id,
          entity_type: 'ticket',
          relationship_type: 'affected',
          created_by: user.user_id,
          created_at: new Date().toISOString(),
        });
      }

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
      const fullTicket = await tenantDb(trx, tenant).table('tickets')
        .where({ ticket_id: ticketResult.ticket_id })
        .first();

      if (!fullTicket) {
        throw new Error('Failed to retrieve created ticket');
      }

      return fullTicket as ITicket;
    });

    return result;
  } catch (error) {
    console.error('Failed to create client ticket:', error);
    if (error instanceof Error && (
      error.message === VISIBILITY_NOT_FOUND_ERROR ||
      error.message === 'Selected visibility group does not allow any boards'
    )) {
      throw error;
    }
    throw new Error('Failed to create ticket');
  }
});
