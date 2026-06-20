'use server'

import type {
  ITicket,
  ITicketListItem,
  ITicketListFilters,
  IAgentSchedule,
  IComment,
  IClient,
  IContact,
  IBoard,
  ITicketCategory,
  ITicketResource,
  IDocument,
  ITag,
  IUserWithRoles,
  TicketResponseState,
} from '@alga-psa/types';
import { withTransaction, registerAfterCommit } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { revalidatePath } from 'next/cache';
import { hasPermission } from '@alga-psa/auth/rbac';
import { z } from 'zod';
import { validateData } from '@alga-psa/validation';
import { publishEvent, publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { getEventBus } from '@alga-psa/event-bus';
import { convertBlockNoteToMarkdown } from '@alga-psa/formatting/blocknoteUtils';
import { getClientLogoUrl, getUserAvatarUrl, getClientLogoUrlsBatch, getEntityImageUrlsBatch } from '@alga-psa/formatting/avatarUtils';
import {
  ticketFormSchema,
  ticketSchema,
  ticketUpdateSchema,
  ticketAttributesQuerySchema,
  ticketListItemSchema,
  ticketListFiltersSchema
} from '../schemas/ticket.schema';
import { Temporal } from '@js-temporal/polyfill';
import { resolveUserTimeZone, normalizeIanaTimeZone } from '@alga-psa/db';
import { calculateItilPriority } from '@alga-psa/tickets/lib/itilUtils';
import { withAuth } from '@alga-psa/auth';
import { TicketModel } from '@alga-psa/shared/models/ticketModel';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  TICKET_ACTIVITY_SOURCE,
  buildCuratedTicketDiffWithLabels,
  hasCuratedChanges,
  writeTicketActivity,
} from '@alga-psa/shared/lib/ticketActivity';
import { applyMatchingChecklistTemplates } from '@alga-psa/shared/lib/ticketChecklists';
import { enforceTicketCloseRules, type CloseRuleBypassSource } from '../lib/validateTicketClosure';
import { maybeReopenBundleMasterFromChildReply } from './ticketBundleUtils';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  compileResourceReadAuthorizationSql,
  type AuthorizationRecord,
  type AuthorizationSubject,
  type RelationshipRule,
  type RelationshipSqlCompileResult,
} from '@alga-psa/authorization/kernel';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';
import { createTicketRelationshipSqlAdapter, fetchTicketAdditionalUserIds } from '../lib/ticketAuthorizationSql';
import { getClientContactVisibilityContext } from '../lib/clientPortalVisibility';
import { buildTicketTransitionWorkflowEvents } from '../lib/workflowTicketTransitionEvents';
import { buildTicketCommunicationWorkflowEvents } from '../lib/workflowTicketCommunicationEvents';
import { buildTicketResolutionSlaStageCompletionEvent } from '../lib/workflowTicketSlaStageEvents';
import { diffTicketFields, publishTicketUpdate } from '../lib/liveUpdates';
import {
  parseTicketStatusFilterValue,
  shouldApplyOpenOnlyStatusFilter,
  TICKET_STATUS_FILTER_ALL,
  TICKET_STATUS_FILTER_OPEN,
} from '../lib/ticketStatusFilter';

// Email event channel constant - inlined to avoid circular dependency with notifications
// Must match the value in @alga-psa/notifications/emailChannel
const EMAIL_EVENT_CHANNEL = 'emailservice::v7';
function getEmailEventChannel(): string {
  return EMAIL_EVENT_CHANNEL;
}

const TICKET_LIST_SEARCH_TSQUERY_UNSAFE_RE = /[^\p{L}\p{N}\s]+/gu;
const TICKET_LIST_SEARCH_IDENTIFIER_TOKEN_PATTERN = /\b[A-Z]+-?\d+\b/i;

function captureAnalytics(_event: string, _properties?: Record<string, any>, _userId?: string): void {
  // Intentionally no-op: avoid pulling analytics (and its tenancy/client-portal deps) into tickets.
}

function formatLiveUpdateDisplayName(user: Pick<IUserWithRoles, 'first_name' | 'last_name' | 'username'>): string {
  return `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || 'Unknown User';
}

function toIsoTimestamp(value: unknown, fallback: string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  return fallback;
}

async function resolveAuthorizationSubjectForUser(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles
): Promise<AuthorizationSubject> {
  const roleRows = await trx('user_roles')
    .where({ tenant, user_id: user.user_id })
    .select<{ role_id: string }[]>('role_id')
    .catch(() => []);

  const teamRows = await trx('team_members')
    .where({ tenant, user_id: user.user_id })
    .select<{ team_id: string }[]>('team_id')
    .catch(() => []);

  const managedRows = await trx('users')
    .where({ tenant, reports_to: user.user_id })
    .select<{ user_id: string }[]>('user_id')
    .catch(() => []);

  return {
    tenant,
    userId: user.user_id,
    userType: user.user_type,
    roleIds: roleRows.map((row) => row.role_id),
    teamIds: teamRows.map((row) => row.team_id),
    managedUserIds: managedRows.map((row) => row.user_id),
    clientId: user.clientId ?? null,
    portfolioClientIds: [],
  };
}

function toTicketAuthorizationRecord(
  ticket: Partial<ITicket>,
  additionalUserIds: string[] = []
): AuthorizationRecord {
  // `tickets.assigned_to` is the primary assignee; `ticket_resources.additional_user_id`
  // holds co-assignees ("additional agents"). Both should authorize via own_or_assigned.
  const assignees = new Set<string>();
  if (ticket.assigned_to) assignees.add(ticket.assigned_to);
  for (const id of additionalUserIds) {
    if (id) assignees.add(id);
  }
  return {
    id: ticket.ticket_id ?? null,
    ownerUserId: ticket.entered_by ?? null,
    assignedUserIds: Array.from(assignees),
    clientId: ticket.client_id ?? null,
    boardId: ticket.board_id ?? null,
    teamIds: ticket.assigned_team_id ? [ticket.assigned_team_id] : [],
  };
}

async function resolveClientSelectedBoardIds(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles
): Promise<string[] | undefined> {
  if (user.user_type !== 'client') {
    return undefined;
  }

  if (!user.contact_id) {
    return [];
  }

  try {
    const visibilityContext = await getClientContactVisibilityContext(trx, tenant, user.contact_id);
    return visibilityContext.visibleBoardIds ?? undefined;
  } catch {
    return [];
  }
}

async function createTicketAuthorizationContext(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles
): Promise<{
  authorizationSubject: AuthorizationSubject;
  authorizationKernel: ReturnType<typeof createAuthorizationKernel>;
  selectedBoardIds: string[] | undefined;
  requestCache: RequestLocalAuthorizationCache;
  ticketReadBundleNarrowingRules: Awaited<ReturnType<typeof resolveBundleNarrowingRulesForEvaluation>>;
}> {
  const authorizationSubject = await resolveAuthorizationSubjectForUser(trx, tenant, user);
  const selectedBoardIds = await resolveClientSelectedBoardIds(trx, tenant, user);
  const relationshipRules =
    selectedBoardIds === undefined ? [] : [{ template: 'selected_boards' as const }];
  const requestCache = new RequestLocalAuthorizationCache();
  const ticketReadBundleNarrowingRules = await resolveBundleNarrowingRulesForEvaluation(trx, {
    subject: authorizationSubject,
    resource: {
      type: 'ticket',
      action: 'read',
    },
    selectedBoardIds,
    requestCache,
    knex: trx,
  });

  return {
    authorizationSubject,
    authorizationKernel: createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider({
        relationshipRules,
      }),
      bundleProvider: new BundleAuthorizationKernelProvider({
        resolveRules: async (input) => {
          if (input.resource.type === 'ticket' && input.resource.action === 'read') {
            return ticketReadBundleNarrowingRules;
          }

          try {
            return await resolveBundleNarrowingRulesForEvaluation(trx, {
              ...input,
              requestCache,
              knex: trx,
            });
          } catch {
            return [];
          }
        },
      }),
      rbacEvaluator: async () => true,
    }),
    selectedBoardIds,
    requestCache,
    ticketReadBundleNarrowingRules,
  };
}

async function filterAuthorizedTickets<T extends Partial<ITicket> & { ticket_id?: string | null }>(
  trx: Knex.Transaction,
  context: Awaited<ReturnType<typeof createTicketAuthorizationContext>>,
  tickets: T[]
): Promise<T[]> {
  const ticketIds = tickets
    .map((ticket) => ticket.ticket_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const additionalUserIdsByTicket = await fetchTicketAdditionalUserIds(
    trx,
    context.authorizationSubject.tenant,
    ticketIds
  );

  const decisions = await Promise.all(
    tickets.map((ticket) => {
      if (!ticket.ticket_id) {
        return Promise.resolve({ allowed: false });
      }

      return context.authorizationKernel.authorizeResource({
        subject: context.authorizationSubject,
        resource: {
          type: 'ticket',
          action: 'read',
          id: ticket.ticket_id,
        },
        record: toTicketAuthorizationRecord(
          ticket,
          additionalUserIdsByTicket.get(ticket.ticket_id) ?? []
        ),
        selectedBoardIds: context.selectedBoardIds,
        requestCache: context.requestCache,
        knex: trx,
      });
    })
  );

  return tickets.filter((_, index) => decisions[index]?.allowed);
}

type TicketAuthorizationContext = Awaited<ReturnType<typeof createTicketAuthorizationContext>>;

function applyTicketReadAuthorizationSql(
  query: Knex.QueryBuilder,
  trx: Knex.Transaction,
  tenant: string,
  context: TicketAuthorizationContext
): RelationshipSqlCompileResult {
  // Built-in narrowing for client-portal users mirrors createTicketAuthorizationContext.
  const builtinRules: RelationshipRule[] =
    context.selectedBoardIds === undefined ? [] : [{ template: 'selected_boards' }];

  return compileResourceReadAuthorizationSql(query, {
    resourceType: 'ticket',
    action: 'read',
    builtinRules,
    bundleRules: context.ticketReadBundleNarrowingRules,
    ctx: {
      subject: context.authorizationSubject,
      selectedBoardIds: context.selectedBoardIds,
      adapter: createTicketRelationshipSqlAdapter(trx, tenant),
    },
  });
}

async function updateTicketResponseStateFromComment(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  authorType: 'internal' | 'client' | 'unknown',
  isInternal: boolean,
  userId: string | null
): Promise<{ previousState: TicketResponseState; newState: TicketResponseState }> {
  const ticket = await trx('tickets')
    .select('response_state')
    .where({ ticket_id: ticketId, tenant })
    .first();

  const previousState = (ticket?.response_state || null) as TicketResponseState;
  let newState: TicketResponseState = previousState;

  if (isInternal) {
    return { previousState, newState };
  }

  if (authorType === 'internal') {
    newState = 'awaiting_client';
  } else if (authorType === 'client') {
    newState = 'awaiting_internal';
  }

  if (newState !== previousState) {
    await trx('tickets')
      .where({ ticket_id: ticketId, tenant })
      .update({ response_state: newState });

    registerAfterCommit(trx, () =>
      publishEvent({
        eventType: 'TICKET_RESPONSE_STATE_CHANGED',
        payload: {
          tenantId: tenant,
          ticketId,
          userId,
          previousState,
          newState,
          trigger: 'comment',
        },
      }),
      `TICKET_RESPONSE_STATE_CHANGED ticket=${ticketId}`
    );
  }

  return { previousState, newState };
}

// Helper function to safely convert dates
function convertDates<T extends { entered_at?: Date | string | null, updated_at?: Date | string | null, closed_at?: Date | string | null, due_date?: Date | string | null }>(record: T): T {
  return {
    ...record,
    entered_at: record.entered_at instanceof Date ? record.entered_at.toISOString() : record.entered_at,
    updated_at: record.updated_at instanceof Date ? record.updated_at.toISOString() : record.updated_at,
    closed_at: record.closed_at instanceof Date ? record.closed_at.toISOString() : record.closed_at,
    due_date: record.due_date instanceof Date ? record.due_date.toISOString() : record.due_date,
  };
}

// Helper function to safely publish events
async function safePublishEvent(eventType: string, payload: any) {
  try {
    const event = { eventType, payload };

    await getEventBus().publish(event);
    await getEventBus().publish(event, { channel: getEmailEventChannel() });
  } catch (error) {
    console.error(`Failed to publish ${eventType} event:`, error);
  }
}

/**
 * Consolidated function to get all ticket data for the ticket details page
 * This reduces multiple network calls by fetching all related data in a single server action
 */
export const getConsolidatedTicketData = withAuth(async (user, { tenant }, ticketId: string) => {
  const {knex: db} = await createTenantKnex();

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'read', trx)) {
      throw new Error('Permission denied: Cannot view ticket');
    }

    try {

    // Fetch ticket with status and location info
    const ticket = await trx('tickets as t')
      .select(
        't.*',
        's.name as status_name',
        's.is_closed',
        'cl.location_id as location_location_id',
        'cl.location_name',
        'cl.address_line1',
        'cl.address_line2',
        'cl.address_line3',
        'cl.city',
        'cl.state_province',
        'cl.postal_code',
        'cl.country_code',
        'cl.country_name',
        'cl.region_code',
        'cl.phone as location_phone',
        'cl.fax as location_fax',
        'cl.email as location_email',
        'cl.is_billing_address',
        'cl.is_shipping_address',
        'cl.is_default as location_is_default'
      )
      .leftJoin('statuses as s', function() {
        this.on('t.status_id', 's.status_id')
           .andOn('t.tenant', 's.tenant')
      })
      .leftJoin('client_locations as cl', function() {
        this.on('t.location_id', 'cl.location_id')
           .andOn('t.tenant', 'cl.tenant')
      })
      .where({
        't.ticket_id': ticketId,
        't.tenant': tenant
      })
      .first();

    if (!ticket) {
      throw new Error('Ticket not found');
    }

    const authorizationContext = await createTicketAuthorizationContext(
      trx,
      tenant,
      user as IUserWithRoles
    );
    const [authorizedTicket] = await filterAuthorizedTickets(trx, authorizationContext, [ticket]);

    if (!authorizedTicket) {
      throw new Error('Permission denied: Cannot view ticket');
    }

    // Fetch all related data in parallel
    const [
      comments,
      documents,
      clients,
      resources,
      users,
      statuses,
      boards,
      priorities,
      categories
    ] = await Promise.all([
      // Comments
      trx('comments')
        .where({
          ticket_id: ticketId,
          tenant: tenant
        })
        .orderBy('created_at', 'asc'),
      
      // Documents
      trx('documents as d')
        .select('d.*')
        .leftJoin('document_associations as da', function() {
          this.on('d.document_id', 'da.document_id')
             .andOn('d.tenant', 'da.tenant')
        })
        .where({
          'da.entity_id': ticketId,
          'da.entity_type': 'ticket',
          'd.tenant': tenant
        }),
      
      trx('clients as c')
        .select(
          'c.*',
          'da.document_id'
        )
        .leftJoin('document_associations as da', function() {
          this.on('da.entity_id', '=', 'c.client_id')
              .andOn('da.tenant', '=', 'c.tenant')
              .andOnVal('da.entity_type', '=', 'client');
        })
        .where({ 'c.tenant': tenant })
        .orderBy('c.client_name', 'asc'),

      trx('ticket_resources')
        .where({
          ticket_id: ticketId,
          tenant: tenant
        }),
      
      // Users - removed document joins that were causing duplicates
      // Avatar URLs are fetched later using getUserAvatarUrl()
      trx('users')
        .where({ tenant })
        .orderBy('first_name', 'asc'),
      
      // Statuses
      trx('statuses')
        .where({
          tenant: tenant,
          status_type: 'ticket'
        })
        .orderBy('order_number', 'asc')
        .orderBy('name', 'asc'),
      
      // Boards
      trx('boards')
        .where({ tenant })
        .orderBy('board_name', 'asc'),
      
      // Priorities - fetch only tenant-specific ticket priorities
      trx('priorities')
        .where({ tenant, item_type: 'ticket' })
        .orderBy('priority_name', 'asc'),
      
      // Categories for the ticket's current board. This must match
      // getTicketCategoriesByBoard so the hydrated dropdown doesn't briefly
      // show tenant-wide categories before the client-side board fetch returns.
      (async () => {
        if (!ticket.board_id) {
          return trx<ITicketCategory>('categories')
            .where({ tenant })
            .orderBy('category_name', 'asc');
        }

        const ticketBoard = await trx('boards')
          .where({ tenant, board_id: ticket.board_id })
          .select('category_type')
          .first();

        if (ticketBoard?.category_type === 'itil') {
          return trx<ITicketCategory>('categories')
            .where({ tenant })
            .where('is_from_itil_standard', true)
            .orderBy('category_name', 'asc');
        }

        return trx<ITicketCategory>('categories')
          .where({ tenant, board_id: ticket.board_id })
          .orderBy('category_name', 'asc');
      })()
    ]);

    // --- Add Logo URL Processing for the fetched 'clients' list ---
    const clientsData = clients as (IClient & { document_id?: string })[];
    const documentIds = clientsData
      .map((c: any) => c.document_id)
      .filter((id: any): id is string => !!id);

    let fileIdMap: Record<string, string> = {};
    if (documentIds.length > 0) {
      const fileRecords = await trx('documents')
        .select('document_id', 'file_id')
        .whereIn('document_id', documentIds)
        .andWhere({ tenant });

      fileIdMap = fileRecords.reduce((acc, record) => {
        if (record.file_id) {
          acc[record.document_id] = record.file_id;
        }
        return acc;
      }, {} as Record<string, string>);
    }

    // Process the full clients list to add logoUrl using batch loading
    const clientIds = clientsData.map(c => c.client_id);
    const logoUrlsMap = await getClientLogoUrlsBatch(clientIds, tenant);
    
    const clientsWithLogos = clientsData.map((clientData) => {
      const logoUrl = logoUrlsMap.get(clientData.client_id) || null;
      const { document_id, ...clientResult } = clientData;
      return {
        ...clientResult,
        properties: clientData.properties || {},
        logoUrl,
      };
    });
    // --- End Logo URL Processing for 'clients' list ---


    // Fetch specific client and contact data if available
    let client: any = null;
    let contacts: IContact[] = [];
    let contactInfo: any = null;
    let locations: any[] = [];
    
    if (ticket.client_id) {
      [client, contacts, locations] = await Promise.all([
        trx('clients as c')
          .select(
            'c.*',
            'd.file_id'
          )
          .leftJoin('document_associations as da', function() {
            this.on('da.entity_id', '=', 'c.client_id')
                .andOn('da.tenant', '=', 'c.tenant')
                .andOnVal('da.entity_type', '=', 'client');
          })
          .leftJoin('documents as d', function() {
             this.on('d.document_id', '=', 'da.document_id')
                .andOn('d.tenant', '=', 'c.tenant');
          })
          .where({
            'c.client_id': ticket.client_id,
            'c.tenant': tenant
          })
          .first(),

        trx('contacts')
          .where({
            client_id: ticket.client_id,
            tenant: tenant
          })
          .orderBy('full_name', 'asc'),
          
        trx('client_locations')
          .where({
            client_id: ticket.client_id,
            tenant: tenant,
            is_active: true
          })
          .orderBy('is_default', 'desc')
          .orderBy('location_name', 'asc')
      ]);
      
      if (client) {
        try {
          client.logoUrl = await getClientLogoUrl(client.client_id, tenant);
        } catch (imgError) {
          console.error(`Error fetching logo URL for client ${client.client_id}:`, imgError);
          client.logoUrl = null;
        }
        if ('file_id' in client) {
            delete client.file_id;
        }
      }
    }

    if (ticket.contact_name_id) {
      contactInfo = await trx('contacts')
        .where({
          contact_name_id: ticket.contact_name_id,
          tenant: tenant
        })
        .first();
    }

    // Fetch created by user
    const createdByUser = ticket.entered_by ? 
      await trx('users')
        .where({
          user_id: ticket.entered_by,
          tenant: tenant
        })
        .first() : null;

    // Fetch board
    const board = ticket.board_id ?
      await trx('boards')
        .where({
          board_id: ticket.board_id,
          tenant: tenant
        })
        .first() : null;
    if (board && (board.enable_live_ticket_timer === null || board.enable_live_ticket_timer === undefined)) {
      board.enable_live_ticket_timer = true;
    }

    // Resolve avatar URLs in one batch (2 queries) instead of a DB transaction per
    // tenant user — the per-user path scaled O(users) and dominated ticket-open latency.
    const userAvatarUrls = await getEntityImageUrlsBatch(
      'user',
      users.map((user: any) => user.user_id),
      tenant,
    ).catch((imgError) => {
      console.error('Error batch-fetching user avatar URLs:', imgError);
      return new Map<string, string | null>();
    });
    const usersWithAvatars = users.map((user: any) => ({
      ...user,
      avatarUrl: userAvatarUrls.get(user.user_id) ?? null,
    }));

    const userMap = usersWithAvatars.reduce((acc, user) => {
      acc[user.user_id] = {
        user_id: user.user_id,
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        email: user.email,
        user_type: user.user_type,
        avatarUrl: user.avatarUrl // Include avatarUrl
      };
      return acc;
    }, {} as Record<string, { user_id: string; first_name: string; last_name: string; email?: string, user_type: string, avatarUrl: string | null }>);

    const commentContactIds = Array.from(
      new Set(
        (comments as Array<{ contact_id?: string | null }>)
          .map((comment) => comment.contact_id)
          .filter((contactId): contactId is string => Boolean(contactId))
      )
    );

    const commentContacts = commentContactIds.length > 0
      ? await trx('contacts')
        .select('contact_name_id', 'full_name', 'email')
        .whereIn('contact_name_id', commentContactIds)
        .andWhere({ tenant })
      : [];

    const contactMap = commentContacts.reduce((acc, contact) => {
      acc[contact.contact_name_id] = {
        contact_id: contact.contact_name_id,
        full_name: contact.full_name || '',
        email: contact.email || undefined,
        avatarUrl: null as string | null,
      };
      return acc;
    }, {} as Record<string, { contact_id: string; full_name: string; email?: string; avatarUrl: string | null }>);

    // Format options for dropdowns
    // Include `is_closed` so UI can reliably derive "closed status" subsets.
    const statusOptions = statuses.map((status: any) => ({
      value: status.status_id,
      label: status.name || "",
      is_closed: !!status.is_closed,
      board_id: status.board_id ?? null,
    }));

    const agentOptions = users.map((agent) => ({
      value: agent.user_id,
      label: `${agent.first_name} ${agent.last_name}`
    }));

    const boardOptions = boards
      .filter(board => board.board_id !== undefined)
      .map((board) => ({
        value: board.board_id,
        label: board.board_name || ""
      }));

    const priorityOptions = priorities.map((priority) => ({
      value: priority.priority_id,
      label: priority.priority_name,
      color: priority.color
    }));

    // Get scheduled hours for ticket
    const scheduleEntries = await trx('schedule_entries as se')
      .select(
        'se.*',
        'sea.user_id'
      )
      .leftJoin('schedule_entry_assignees as sea', function() {
        this.on('se.entry_id', 'sea.entry_id')
           .andOn('se.tenant', 'sea.tenant')
      })
      .where({
        'se.work_item_id': ticketId,
        'se.work_item_type': 'ticket',
        'se.tenant': tenant
      });

    // Calculate scheduled hours per agent
    const agentSchedules: Record<string, number> = {};
    
    scheduleEntries.forEach((entry: any) => {
      const userId = entry.user_id;
      if (!userId) {
        return; // Skip entries with no user_id
      }
      
      const startTime = new Date(entry.scheduled_start);
      const endTime = new Date(entry.scheduled_end);
      const durationMs = endTime.getTime() - startTime.getTime();
      const durationMinutes = Math.ceil(durationMs / (1000 * 60)); // Convert ms to minutes
      
      if (!agentSchedules[userId]) {
        agentSchedules[userId] = 0;
      }
      
      agentSchedules[userId] += durationMinutes;
    });

    // Convert to array format
    const agentSchedulesList: IAgentSchedule[] = Object.entries(agentSchedules).map(([userId, minutes]) => ({
      userId,
      minutes
    }));

    // Process location data from ticket query
    const location = ticket.location_location_id ? {
      location_id: ticket.location_location_id,
      location_name: ticket.location_name,
      address_line1: ticket.address_line1,
      address_line2: ticket.address_line2,
      address_line3: ticket.address_line3,
      city: ticket.city,
      state_province: ticket.state_province,
      postal_code: ticket.postal_code,
      country_code: ticket.country_code,
      country_name: ticket.country_name,
      region_code: ticket.region_code,
      phone: ticket.location_phone,
      fax: ticket.location_fax,
      email: ticket.location_email,
      is_billing_address: ticket.is_billing_address,
      is_shipping_address: ticket.is_shipping_address,
      is_default: ticket.location_is_default
    } : null;

    // Remove location fields from ticket object
    const {
      location_location_id,
      location_name,
      address_line1,
      address_line2,
      address_line3,
      city,
      state_province,
      postal_code,
      country_code,
      country_name,
      region_code,
      location_phone,
      location_fax,
      location_email,
      is_billing_address,
      is_shipping_address,
      location_is_default,
      ...ticketData
    } = ticket;

    const normalizedTicketData = convertDates(ticketData);

    // Bundle context (master/child + settings + children list)
    const masterTicketId = normalizedTicketData.master_ticket_id ?? null;
    const bundleRootId = masterTicketId ?? ticketId;
    const bundleSettings = await trx('ticket_bundle_settings')
      .where({ tenant, master_ticket_id: bundleRootId })
      .first();

    const rawBundleChildren = await trx('tickets as ct')
      .select(
        'ct.ticket_id',
        'ct.ticket_number',
        'ct.title',
        'ct.client_id',
        'comp.client_name',
        'ct.status_id',
        'ct.entered_at',
        'ct.updated_at',
        'ct.entered_by',
        'ct.assigned_to',
        'ct.board_id',
        'ct.assigned_team_id'
      )
      .leftJoin('clients as comp', function() {
        this.on('ct.client_id', 'comp.client_id')
          .andOn('ct.tenant', 'comp.tenant');
      })
      .where({ 'ct.tenant': tenant, 'ct.master_ticket_id': bundleRootId })
      .orderBy('ct.updated_at', 'desc');

    const rawBundleMaster = masterTicketId
      ? await trx('tickets as mt')
        .select(
          'mt.ticket_id',
          'mt.ticket_number',
          'mt.title',
          'mt.client_id',
          'comp.client_name',
          'mt.status_id',
          'mt.entered_at',
          'mt.updated_at',
          'mt.entered_by',
          'mt.assigned_to',
          'mt.board_id',
          'mt.assigned_team_id'
        )
        .leftJoin('clients as comp', function() {
          this.on('mt.client_id', 'comp.client_id')
            .andOn('mt.tenant', 'comp.tenant');
        })
        .where({ 'mt.tenant': tenant, 'mt.ticket_id': masterTicketId })
        .first()
      : null;

    const bundleChildren = await filterAuthorizedTickets(trx, authorizationContext, rawBundleChildren);
    const [bundleMaster] = rawBundleMaster
      ? await filterAuthorizedTickets(trx, authorizationContext, [rawBundleMaster])
      : [null];

    const isBundleChild = Boolean(masterTicketId);
    const isBundleMaster = !isBundleChild && bundleChildren.length > 0;
    const authorizedBundleChildIds = new Set(bundleChildren.map((child) => child.ticket_id).filter(Boolean));

    // Aggregated child inbound replies surfaced on master (view-only; not duplicated onto master)
    const aggregatedChildClientComments = isBundleMaster
      ? await trx('comments as c')
        .select(
          'c.*',
          'ct.ticket_id as child_ticket_id',
          'ct.ticket_number as child_ticket_number',
          'ct.title as child_ticket_title',
          'comp.client_name as child_client_name'
        )
        .leftJoin('tickets as ct', function() {
          this.on('c.ticket_id', 'ct.ticket_id')
            .andOn('c.tenant', 'ct.tenant');
        })
        .leftJoin('clients as comp', function() {
          this.on('ct.client_id', 'comp.client_id')
            .andOn('ct.tenant', 'comp.tenant');
        })
        .where({ 'c.tenant': tenant })
        .andWhere('c.is_internal', false)
        .andWhere('ct.master_ticket_id', ticketId)
        .orderBy('c.created_at', 'desc')
        .limit(200)
      : [];

    const filteredAggregatedChildClientComments = isBundleMaster
      ? aggregatedChildClientComments.filter((comment: any) =>
          typeof comment.child_ticket_id === 'string' && authorizedBundleChildIds.has(comment.child_ticket_id)
        )
      : [];

    // Track ticket view analytics
    captureAnalytics('ticket_viewed', {
      ticket_id: ticketId,
      status_id: normalizedTicketData.status_id,
      status_name: normalizedTicketData.status_name,
      is_closed: normalizedTicketData.is_closed,
      priority_id: normalizedTicketData.priority_id,
      category_id: normalizedTicketData.category_id,
      board_id: normalizedTicketData.board_id,
      assigned_to: normalizedTicketData.assigned_to,
      client_id: normalizedTicketData.client_id,
      has_comments: comments.length > 0,
      comment_count: comments.length,
      has_documents: documents.length > 0,
      document_count: documents.length,
      has_additional_agents: resources.length > 0,
      additional_agent_count: resources.length,
      has_schedule: agentSchedulesList.length > 0,
      total_scheduled_minutes: agentSchedulesList.reduce((sum, schedule) => sum + schedule.minutes, 0),
      view_source: 'ticket_details'
    }, user.user_id);

    // Return all data in a single consolidated object
    return {
      ticket: {
        ...normalizedTicketData,
        tenant,
        location
      },
      bundle: {
        isBundleChild,
        isBundleMaster,
        masterTicketId: bundleRootId,
        mode: bundleSettings?.mode ?? null,
        reopenOnChildReply: Boolean(bundleSettings?.reopen_on_child_reply),
        masterTicket: bundleMaster,
        children: bundleChildren
      },
      aggregatedChildClientComments: filteredAggregatedChildClientComments,
      comments,
      documents,
      client,
      contacts,
      contactInfo,
      createdByUser,
      board,
      additionalAgents: resources,
      availableAgents: users,
      userMap,
      contactMap,
      options: {
        status: statusOptions,
        agent: agentOptions,
        board: boardOptions,
        priority: priorityOptions
      },
      categories,
      clients: clientsWithLogos,
      locations,
      agentSchedules: agentSchedulesList
    };
    } catch (error) {
      console.error('Failed to fetch consolidated ticket data:', error);
      throw new Error('Failed to fetch ticket data');
    }
  });
});

/**
 * Build the base filtered query for the ticket list.
 * Returns a Knex query builder with all JOINs and WHERE clauses applied,
 * but no SELECT, ORDER BY, LIMIT, or OFFSET.
 * Shared between getTicketsForList and getAdjacentTicketIds.
 */
async function buildTicketListBaseQuery(
  trx: Knex.Transaction,
  tenant: string,
  user: { user_id: string; user_type?: string; clientId?: string | null },
  validatedFilters: ITicketListFilters
): Promise<{ builder: Knex.QueryBuilder }> {
    const parsedStatusFilter = parseTicketStatusFilterValue(validatedFilters.statusId);
    let baseQuery = trx('tickets as t')
      .leftJoin('tickets as mt', function() {
        this.on('t.master_ticket_id', 'mt.ticket_id')
          .andOn('t.tenant', 'mt.tenant');
      })
      .leftJoin('statuses as s', function() {
        this.on('t.status_id', 's.status_id')
           .andOn('t.tenant', 's.tenant')
      })
      .leftJoin('priorities as p', function() {
        this.on('t.priority_id', 'p.priority_id')
           .andOn('t.tenant', 'p.tenant')
           .andOnVal('p.item_type', '=', 'ticket')
      })
      .leftJoin('boards as c', function() {
        this.on('t.board_id', 'c.board_id')
           .andOn('t.tenant', 'c.tenant')
      })
      .leftJoin('categories as cat', function() {
        this.on('t.category_id', 'cat.category_id')
           .andOn('t.tenant', 'cat.tenant')
      })
      .leftJoin('clients as comp', function() {
        this.on('t.client_id', 'comp.client_id')
           .andOn('t.tenant', 'comp.tenant')
      })
      .leftJoin('users as u', function() {
        this.on('t.entered_by', 'u.user_id')
           .andOn('t.tenant', 'u.tenant')
      })
      .leftJoin('users as au', function() {
        this.on('t.assigned_to', 'au.user_id')
           .andOn('t.tenant', 'au.tenant')
      })
      .leftJoin('teams as tm', function() {
        this.on('t.assigned_team_id', 'tm.team_id')
           .andOn('t.tenant', 'tm.tenant')
      })
      .where({
        't.tenant': tenant
      });

    // Bundle view filter: hide children in bundled view
    if (validatedFilters.bundleView === 'bundled') {
      baseQuery = baseQuery.whereNull('t.master_ticket_id');
    }

    // Board include filter. Prefers the multi-select `boardIds`; falls back to the
    // legacy single `boardId`. An explicit board selection takes precedence over the
    // active/inactive status restriction (the user has positively chosen boards).
    const includeBoardIds = (validatedFilters.boardIds && validatedFilters.boardIds.length > 0)
      ? validatedFilters.boardIds
      : (validatedFilters.boardId ? [validatedFilters.boardId] : []);
    const includeNoBoard = includeBoardIds.includes('no-board');
    const includeRealBoardIds = includeBoardIds.filter(id => id !== 'no-board');
    if (includeBoardIds.length > 0) {
      baseQuery = baseQuery.where(function () {
        if (includeNoBoard && includeRealBoardIds.length > 0) {
          this.whereNull('t.board_id').orWhereIn('t.board_id', includeRealBoardIds);
        } else if (includeNoBoard) {
          this.whereNull('t.board_id');
        } else {
          this.whereIn('t.board_id', includeRealBoardIds);
        }
      });
    } else if (validatedFilters.boardFilterState !== 'all') {
      const boardSubquery = trx('boards')
        .select('board_id')
        .where('tenant', tenant)
        .where('is_inactive', validatedFilters.boardFilterState === 'inactive');

      baseQuery = baseQuery.whereIn('t.board_id', boardSubquery);
    }

    // Board exclude filter. Excludes any ticket on an excluded board; the 'no-board'
    // sentinel excludes tickets that have no board.
    const excludeBoardIds = validatedFilters.excludeBoardIds ?? [];
    if (excludeBoardIds.includes('no-board')) {
      baseQuery = baseQuery.whereNotNull('t.board_id');
    }
    const excludeRealBoardIds = excludeBoardIds.filter(id => id !== 'no-board');
    if (excludeRealBoardIds.length > 0) {
      baseQuery = baseQuery.where(function () {
        this.whereNull('t.board_id').orWhereNotIn('t.board_id', excludeRealBoardIds);
      });
    }

    if (shouldApplyOpenOnlyStatusFilter(validatedFilters.statusId, validatedFilters.showOpenOnly)) {
      baseQuery = baseQuery.whereExists(function() {
        this.select('*')
            .from('statuses')
            .whereRaw('statuses.status_id = t.status_id')
            .andWhere('statuses.is_closed', false)
            .andWhere('statuses.tenant', tenant);
      });
    } else if (parsedStatusFilter.kind === 'name') {
      baseQuery = baseQuery.where('s.name', parsedStatusFilter.statusName);
    } else if (parsedStatusFilter.kind === 'id') {
      baseQuery = baseQuery.where('t.status_id', parsedStatusFilter.statusId);
    }

    if (validatedFilters.priorityId && validatedFilters.priorityId !== 'all') {
      baseQuery = baseQuery.where('t.priority_id', validatedFilters.priorityId);
    }

    // Category include filter. A ticket "has" a category if either its
    // category_id (parent) or subcategory_id (child) matches the selection, so
    // selecting a parent matches its subcategorized tickets and selecting a
    // subcategory matches tickets that reference it via subcategory_id.
    // Prefers the multi-select `categoryIds`; falls back to legacy single `categoryId`.
    const includeCategoryIds = (validatedFilters.categoryIds && validatedFilters.categoryIds.length > 0)
      ? validatedFilters.categoryIds
      : (validatedFilters.categoryId && validatedFilters.categoryId !== 'all'
          ? [validatedFilters.categoryId]
          : []);
    const includeNoCategory = includeCategoryIds.includes('no-category');
    const includeRealCategoryIds = includeCategoryIds.filter(id => id !== 'no-category' && id !== 'all');
    if (includeNoCategory || includeRealCategoryIds.length > 0) {
      baseQuery = baseQuery.where(function () {
        if (includeNoCategory && includeRealCategoryIds.length > 0) {
          this.whereNull('t.category_id').orWhere(function () {
            this.whereIn('t.category_id', includeRealCategoryIds)
              .orWhereIn('t.subcategory_id', includeRealCategoryIds);
          });
        } else if (includeNoCategory) {
          this.whereNull('t.category_id');
        } else {
          this.whereIn('t.category_id', includeRealCategoryIds)
            .orWhereIn('t.subcategory_id', includeRealCategoryIds);
        }
      });
    }

    // Category exclude filter. Excludes any ticket whose parent or subcategory is
    // in the excluded set; null columns are kept (unless 'no-category' is excluded).
    const excludeCategoryIds = validatedFilters.excludeCategoryIds ?? [];
    const excludeNoCategory = excludeCategoryIds.includes('no-category');
    const excludeRealCategoryIds = excludeCategoryIds.filter(id => id !== 'no-category' && id !== 'all');
    if (excludeNoCategory) {
      baseQuery = baseQuery.whereNotNull('t.category_id');
    }
    if (excludeRealCategoryIds.length > 0) {
      baseQuery = baseQuery.where(function () {
        this.where(function () {
          this.whereNull('t.category_id').orWhereNotIn('t.category_id', excludeRealCategoryIds);
        }).andWhere(function () {
          this.whereNull('t.subcategory_id').orWhereNotIn('t.subcategory_id', excludeRealCategoryIds);
        });
      });
    }

    if (validatedFilters.clientId) {
      if (validatedFilters.bundleView === 'bundled') {
        baseQuery = baseQuery.where(function(this: any) {
          this.where('t.client_id', validatedFilters.clientId)
            .orWhereExists(function(this: any) {
              this.select('*')
                .from('tickets as tc')
                .whereRaw('tc.tenant = t.tenant')
                .andWhereRaw('tc.master_ticket_id = t.ticket_id')
                .andWhere('tc.client_id', validatedFilters.clientId);
            });
        });
      } else {
        baseQuery = baseQuery.where('t.client_id', validatedFilters.clientId);
      }
    }

    if (validatedFilters.contactId) {
      if (validatedFilters.bundleView === 'bundled') {
        baseQuery = baseQuery.where(function(this: any) {
          this.where('t.contact_name_id', validatedFilters.contactId)
            .orWhereExists(function(this: any) {
              this.select('*')
                .from('tickets as tc')
                .whereRaw('tc.tenant = t.tenant')
                .andWhereRaw('tc.master_ticket_id = t.ticket_id')
                .andWhere('tc.contact_name_id', validatedFilters.contactId);
            });
        });
      } else {
        baseQuery = baseQuery.where('t.contact_name_id', validatedFilters.contactId);
      }
    }

    baseQuery = applyTicketListIndexedSearchFilter(trx, baseQuery, tenant, user, validatedFilters);

    // Apply tag filter if provided
    if (validatedFilters.tags && validatedFilters.tags.length > 0) {
      baseQuery = baseQuery.whereIn('t.ticket_id', function() {
        this.select('tm.tagged_id')
          .from('tag_mappings as tm')
          .join('tag_definitions as td', function() {
            this.on('tm.tenant', '=', 'td.tenant')
                .andOn('tm.tag_id', '=', 'td.tag_id');
          })
          .where('tm.tagged_type', 'ticket')
          .andWhere('tm.tenant', tenant)
          .whereIn('td.tag_text', validatedFilters.tags as string[]);
      });
    }

    // Apply assignee filter if provided
    if (validatedFilters.assignedToIds?.length || validatedFilters.assignedTeamIds?.length || validatedFilters.includeUnassigned) {
      baseQuery = baseQuery.where(function(this: any) {
        // Handle specific assignee IDs
        if (validatedFilters.assignedToIds?.length) {
          this.whereIn('t.assigned_to', validatedFilters.assignedToIds);
        }

        if (validatedFilters.assignedTeamIds?.length) {
          if (validatedFilters.assignedToIds?.length) {
            this.orWhereIn('t.assigned_team_id', validatedFilters.assignedTeamIds);
          } else {
            this.whereIn('t.assigned_team_id', validatedFilters.assignedTeamIds);
          }
        }

        // Handle unassigned (OR condition if both specified)
        if (validatedFilters.includeUnassigned) {
          if (validatedFilters.assignedToIds?.length || validatedFilters.assignedTeamIds?.length) {
            this.orWhereNull('t.assigned_to');
          } else {
            this.whereNull('t.assigned_to');
          }
        }
      });
    }

    // Apply due date filters (timezone-aware for 'today' filter)
    if (validatedFilters.dueDateFilter && validatedFilters.dueDateFilter !== 'all') {
      const nowInstant = Temporal.Now.instant();
      const nowIso = nowInstant.toString();

      switch (validatedFilters.dueDateFilter) {
        case 'overdue':
          // Due date is in the past
          baseQuery = baseQuery.where('t.due_date', '<', nowIso);
          break;
        case 'upcoming':
          // Due date is within the next 7 days (not overdue)
          const weekFromNow = nowInstant.add({ hours: 24 * 7 });
          baseQuery = baseQuery
            .where('t.due_date', '>=', nowIso)
            .where('t.due_date', '<=', weekFromNow.toString());
          break;
        case 'today':
          // Due date is today in user's timezone
          const userTz = await resolveUserTimeZone(trx, tenant, user.user_id);
          const zonedNow = nowInstant.toZonedDateTimeISO(userTz);
          const startOfTodayZoned = zonedNow.startOfDay();
          const endOfTodayZoned = startOfTodayZoned.add({ days: 1 });
          baseQuery = baseQuery
            .where('t.due_date', '>=', startOfTodayZoned.toInstant().toString())
            .where('t.due_date', '<', endOfTodayZoned.toInstant().toString());
          break;
        case 'no_due_date':
          // No due date set
          baseQuery = baseQuery.whereNull('t.due_date');
          break;
        case 'before':
          // Due date is before a specific date
          if (validatedFilters.dueDateTo) {
            baseQuery = baseQuery.where('t.due_date', '<', validatedFilters.dueDateTo);
          }
          break;
        case 'after':
          // Due date is after a specific date
          if (validatedFilters.dueDateFrom) {
            baseQuery = baseQuery.where('t.due_date', '>', validatedFilters.dueDateFrom);
          }
          break;
        case 'custom':
          // Custom date range
          if (validatedFilters.dueDateFrom) {
            baseQuery = baseQuery.where('t.due_date', '>=', validatedFilters.dueDateFrom);
          }
          if (validatedFilters.dueDateTo) {
            baseQuery = baseQuery.where('t.due_date', '<=', validatedFilters.dueDateTo);
          }
          break;
      }
    }

    // Apply response state filter if provided (F017-F021)
    if (validatedFilters.responseState && validatedFilters.responseState !== 'all') {
      if (validatedFilters.responseState === 'none') {
        // Filter for tickets with no response state set
        baseQuery = baseQuery.whereNull('t.response_state');
      } else {
        // Filter for specific response state
        baseQuery = baseQuery.where('t.response_state', validatedFilters.responseState);
      }
    }

    // Apply SLA status filter
    if (validatedFilters.slaStatusFilter && validatedFilters.slaStatusFilter !== 'all') {
      const nowIso = Temporal.Now.instant().toString();

      switch (validatedFilters.slaStatusFilter) {
        case 'has_sla':
          baseQuery = baseQuery.whereNotNull('t.sla_policy_id');
          break;

        case 'no_sla':
          baseQuery = baseQuery.whereNull('t.sla_policy_id');
          break;

        case 'on_track':
          baseQuery = baseQuery
            .whereNotNull('t.sla_policy_id')
            .whereNull('t.sla_paused_at')
            .where(function() {
              this.whereNotNull('t.sla_response_at')
                .orWhereNull('t.sla_response_due_at')
                .orWhere('t.sla_response_due_at', '>=', nowIso);
            })
            .where(function() {
              this.whereNotNull('t.sla_resolution_at')
                .orWhereNull('t.sla_resolution_due_at')
                .orWhere('t.sla_resolution_due_at', '>=', nowIso);
            })
            .where(function() {
              this.whereNull('t.sla_response_met').orWhere('t.sla_response_met', true);
            })
            .where(function() {
              this.whereNull('t.sla_resolution_met').orWhere('t.sla_resolution_met', true);
            });
          break;

        case 'breached':
          baseQuery = baseQuery
            .whereNotNull('t.sla_policy_id')
            .where(function() {
              this.where(function() {
                this.where('t.sla_response_due_at', '<', nowIso)
                  .whereNull('t.sla_response_at');
              })
              .orWhere(function() {
                this.where('t.sla_resolution_due_at', '<', nowIso)
                  .whereNull('t.sla_resolution_at');
              })
              .orWhere('t.sla_response_met', false)
              .orWhere('t.sla_resolution_met', false);
            });
          break;

        case 'paused':
          baseQuery = baseQuery
            .whereNotNull('t.sla_policy_id')
            .whereNotNull('t.sla_paused_at');
          break;
      }
    }

    // Wrap in object to prevent Promise thenable unwrapping.
    // Knex query builders have .then(), so returning one from an async function
    // would execute the query instead of returning the builder.
    return { builder: baseQuery };
}

function buildTicketListSearchPrefixTsquery(raw: string): string | null {
  const tokens = raw
    .toLowerCase()
    .replace(TICKET_LIST_SEARCH_TSQUERY_UNSAFE_RE, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return null;
  }

  return tokens.map((token) => `${token}:*`).join(' & ');
}

function applyTicketListIndexedSearchFilter(
  trx: Knex.Transaction,
  baseQuery: Knex.QueryBuilder,
  tenant: string,
  user: { user_id: string; user_type?: string; clientId?: string | null },
  validatedFilters: ITicketListFilters
): Knex.QueryBuilder {
  const rawSearch = validatedFilters.searchQuery?.replace(/\s+/g, ' ').trim();
  if (!rawSearch) {
    return baseQuery;
  }

  const prefixTsquery = buildTicketListSearchPrefixTsquery(rawSearch);
  const identifier = rawSearch.match(TICKET_LIST_SEARCH_IDENTIFIER_TOKEN_PATTERN)?.[0]?.toLowerCase() ?? null;
  const includeBundledChildren = validatedFilters.bundleView === 'bundled';
  const isInternalUser = user.user_type !== 'client';
  const clientScopePredicate = isInternalUser
    ? 'TRUE'
    : user.clientId
      ? '(si.client_scope_id IS NULL OR si.client_scope_id = ?::uuid)'
      : 'si.client_scope_id IS NULL';
  const clientScopeBindings = isInternalUser || !user.clientId ? [] : [user.clientId];
  const ilikePattern = `%${rawSearch}%`;

  // Citus cannot push down an OR that mixes correlated EXISTS against two different
  // distributed tables (app_search_index vs tickets). Rewrite as UNION ALL of
  // single-table legs joined back on the distribution column (tenant) plus ticket_id;
  // each leg is independently pushdown-safe and the outer join is co-located.
  const legA = `
        SELECT
          CASE WHEN si.object_type = 'ticket_comment' THEN si.parent_id::uuid
               ELSE si.object_id::uuid END AS ticket_id,
          si.tenant
        FROM app_search_index si
        CROSS JOIN (
          SELECT
            websearch_to_tsquery('english', ?) AS tsq,
            CASE WHEN ?::text IS NULL THEN NULL ELSE to_tsquery('english', ?::text) END AS prefix_tsq,
            ?::text AS raw,
            ?::text AS identifier
        ) q
        WHERE si.tenant = ?::uuid
          AND si.object_type = ANY(?::text[])
          AND (si.required_permission IS NULL OR si.required_permission = ANY(?::text[]))
          AND (cardinality(si.visible_to_user_ids) = 0 OR si.visible_to_user_ids && ARRAY[?]::uuid[])
          AND (si.is_internal_only = false OR ?::boolean = true)
          AND (si.is_private = false OR si.visible_to_user_ids && ARRAY[?]::uuid[])
          AND ${clientScopePredicate}
          AND (
            si.search_vector @@ q.tsq
            OR (q.prefix_tsq IS NOT NULL AND si.search_vector @@ q.prefix_tsq)
            OR si.title ILIKE '%' || q.raw || '%'
            OR coalesce(si.subtitle, '') ILIKE '%' || q.raw || '%'
            OR si.title % q.raw
            OR coalesce(si.subtitle, '') % q.raw
            OR (q.identifier IS NOT NULL AND lower(coalesce(si.metadata->>'identifier', '')) = q.identifier)
            OR (q.identifier IS NOT NULL AND lower(coalesce(si.metadata->>'identifier', '')) LIKE q.identifier || '%')
          )
  `;
  const legABindings: Knex.RawBinding[] = [
    rawSearch,
    prefixTsquery,
    prefixTsquery,
    rawSearch,
    identifier,
    tenant,
    ['ticket', 'ticket_comment'],
    ['ticket:read'],
    user.user_id,
    isInternalUser,
    user.user_id,
    ...clientScopeBindings,
  ];

  const legB = `
        SELECT t2.ticket_id, t2.tenant
        FROM tickets t2
        WHERE t2.tenant = ?::uuid
          AND (t2.title ILIKE ? OR t2.ticket_number ILIKE ?)
  `;
  const legBBindings: Knex.RawBinding[] = [tenant, ilikePattern, ilikePattern];

  // Leg A also surfaces bundled-child matches under the master when bundleView='bundled':
  // a search-index hit on a child ticket (or its comment) maps to the master ticket id.
  let legD = '';
  const legDBindings: Knex.RawBinding[] = [];
  if (includeBundledChildren) {
    legD = `
        UNION ALL
        SELECT child.master_ticket_id AS ticket_id, child.tenant
        FROM app_search_index si
        CROSS JOIN (
          SELECT
            websearch_to_tsquery('english', ?) AS tsq,
            CASE WHEN ?::text IS NULL THEN NULL ELSE to_tsquery('english', ?::text) END AS prefix_tsq,
            ?::text AS raw,
            ?::text AS identifier
        ) q
        JOIN tickets child
          ON child.tenant = si.tenant
         AND child.master_ticket_id IS NOT NULL
         AND (
           (si.object_type = 'ticket' AND child.ticket_id::text = si.object_id)
           OR (si.object_type = 'ticket_comment' AND child.ticket_id::text = si.parent_id)
         )
        WHERE si.tenant = ?::uuid
          AND si.object_type = ANY(?::text[])
          AND (si.required_permission IS NULL OR si.required_permission = ANY(?::text[]))
          AND (cardinality(si.visible_to_user_ids) = 0 OR si.visible_to_user_ids && ARRAY[?]::uuid[])
          AND (si.is_internal_only = false OR ?::boolean = true)
          AND (si.is_private = false OR si.visible_to_user_ids && ARRAY[?]::uuid[])
          AND ${clientScopePredicate}
          AND (
            si.search_vector @@ q.tsq
            OR (q.prefix_tsq IS NOT NULL AND si.search_vector @@ q.prefix_tsq)
            OR si.title ILIKE '%' || q.raw || '%'
            OR coalesce(si.subtitle, '') ILIKE '%' || q.raw || '%'
            OR si.title % q.raw
            OR coalesce(si.subtitle, '') % q.raw
            OR (q.identifier IS NOT NULL AND lower(coalesce(si.metadata->>'identifier', '')) = q.identifier)
            OR (q.identifier IS NOT NULL AND lower(coalesce(si.metadata->>'identifier', '')) LIKE q.identifier || '%')
          )

        UNION ALL
        SELECT tc.master_ticket_id AS ticket_id, tc.tenant
        FROM tickets tc
        WHERE tc.tenant = ?::uuid
          AND tc.master_ticket_id IS NOT NULL
          AND (tc.title ILIKE ? OR tc.ticket_number ILIKE ?)
    `;
    legDBindings.push(
      rawSearch,
      prefixTsquery,
      prefixTsquery,
      rawSearch,
      identifier,
      tenant,
      ['ticket', 'ticket_comment'],
      ['ticket:read'],
      user.user_id,
      isInternalUser,
      user.user_id,
      ...clientScopeBindings,
      tenant,
      ilikePattern,
      ilikePattern,
    );
  }

  const unionSql = `
    INNER JOIN (
      SELECT DISTINCT ticket_id, tenant FROM (
        ${legA}
        UNION ALL
        ${legB}
        ${legD}
      ) u
    ) as sm ON sm.ticket_id = t.ticket_id AND sm.tenant = t.tenant
  `;

  return baseQuery.joinRaw(unionSql, [
    ...legABindings,
    ...legBBindings,
    ...legDBindings,
  ] as unknown as Knex.Value[]);
}

/**
 * Apply sort ordering to a ticket list query.
 * Shared between getTicketsForList and getAdjacentTicketIds.
 */
function applyTicketListSort(
  query: Knex.QueryBuilder,
  validatedFilters: ITicketListFilters
): Knex.QueryBuilder {
    const sortBy = validatedFilters.sortBy ?? 'entered_at';
    const sortDirection: 'asc' | 'desc' = validatedFilters.sortDirection ?? 'desc';
    const sortColumnMap: Record<string, { column?: string; rawExpression?: string }> = {
      ticket_number: { column: 't.ticket_number' },
      title: { column: 't.title' },
      status_name: { column: 's.name' },
      priority_name: { column: 'p.priority_name' },
      board_name: { column: 'c.board_name' },
      category_name: { column: 'cat.category_name' },
      client_name: { column: 'comp.client_name' },
      entered_at: { column: 't.entered_at' },
      entered_by_name: { rawExpression: "COALESCE(CONCAT(u.first_name, ' ', u.last_name), '')" },
      due_date: { column: 't.due_date' }
    };
    const selectedSort = sortColumnMap[sortBy] || sortColumnMap.entered_at;

    return query
      .modify(queryBuilder => {
        if (selectedSort.rawExpression) {
          queryBuilder.orderByRaw(`${selectedSort.rawExpression} ${sortDirection}`);
        } else if (selectedSort.column) {
          queryBuilder.orderBy(selectedSort.column, sortDirection);
        } else {
          queryBuilder.orderBy('t.entered_at', sortDirection);
        }
      })
      .orderBy('t.ticket_id', 'desc');
}

/**
 * Get the ORDER BY clause as a raw SQL string for use in window functions.
 * Mirrors applyTicketListSort but returns a string instead of modifying a query.
 */
function getTicketListSortOrderByClause(validatedFilters: ITicketListFilters): string {
    const sortBy = validatedFilters.sortBy ?? 'entered_at';
    const sortDirection: 'asc' | 'desc' = validatedFilters.sortDirection ?? 'desc';
    const sortColumnMap: Record<string, { column?: string; rawExpression?: string }> = {
      ticket_number: { column: 't.ticket_number' },
      title: { column: 't.title' },
      status_name: { column: 's.name' },
      priority_name: { column: 'p.priority_name' },
      board_name: { column: 'c.board_name' },
      category_name: { column: 'cat.category_name' },
      client_name: { column: 'comp.client_name' },
      entered_at: { column: 't.entered_at' },
      entered_by_name: { rawExpression: "COALESCE(CONCAT(u.first_name, ' ', u.last_name), '')" },
      due_date: { column: 't.due_date' }
    };
    const selectedSort = sortColumnMap[sortBy] || sortColumnMap.entered_at;

    let primarySort: string;
    if (selectedSort.rawExpression) {
      primarySort = `${selectedSort.rawExpression} ${sortDirection}`;
    } else if (selectedSort.column) {
      primarySort = `${selectedSort.column} ${sortDirection}`;
    } else {
      primarySort = `t.entered_at ${sortDirection}`;
    }

    return `${primarySort}, t.ticket_id DESC`;
}

/**
 * Validate and clean filter values, clearing "$undefined" string sentinel values.
 */
function cleanFilterValues(validatedFilters: ITicketListFilters): ITicketListFilters {
    if (validatedFilters.boardId === '$undefined') {
      validatedFilters.boardId = undefined;
    }
    if (validatedFilters.categoryId === '$undefined') {
      validatedFilters.categoryId = undefined;
    }
    if (validatedFilters.clientId === '$undefined') {
      validatedFilters.clientId = undefined;
    }
    if (validatedFilters.contactId === '$undefined') {
      validatedFilters.contactId = undefined;
    }
    return validatedFilters;
}

function buildTicketListItemsQuery(
  trx: Knex.Transaction,
  tenant: string,
  baseQuery: Knex.QueryBuilder
): Knex.QueryBuilder {
  return baseQuery
    .clone()
    .joinRaw(`LEFT JOIN (
      SELECT
        tc.master_ticket_id,
        tc.tenant,
        COUNT(*)::int as bundle_child_count,
        array_agg(DISTINCT tc.client_id) FILTER (WHERE tc.client_id IS NOT NULL) as child_client_ids
      FROM tickets tc
      WHERE tc.master_ticket_id IS NOT NULL AND tc.tenant = ?
      GROUP BY tc.master_ticket_id, tc.tenant
    ) as bs ON bs.master_ticket_id = t.ticket_id AND bs.tenant = t.tenant`, [tenant])
    .joinRaw(`LEFT JOIN (
      SELECT
        tr.ticket_id,
        tr.tenant,
        COUNT(*) FILTER (WHERE tr.additional_user_id IS NOT NULL)::int as additional_agent_count,
        COALESCE(
          json_agg(
            json_build_object('user_id', uu.user_id, 'name', CONCAT(uu.first_name, ' ', uu.last_name))
          ) FILTER (WHERE uu.user_id IS NOT NULL),
          '[]'::json
        ) as additional_agents
      FROM ticket_resources tr
      LEFT JOIN users uu ON tr.additional_user_id = uu.user_id AND tr.tenant = uu.tenant
      WHERE tr.tenant = ?
      GROUP BY tr.ticket_id, tr.tenant
    ) as ags ON ags.ticket_id = t.ticket_id AND ags.tenant = t.tenant`, [tenant])
    .select(
      // Ticket columns (explicit list avoids fetching large unused columns)
      't.ticket_id', 't.ticket_number', 't.title', 't.url',
      't.board_id', 't.client_id', 't.location_id', 't.contact_name_id',
      't.status_id', 't.category_id', 't.subcategory_id', 't.priority_id',
      't.entered_by', 't.updated_by', 't.closed_by',
      't.assigned_to', 't.assigned_team_id',
      't.entered_at', 't.updated_at', 't.closed_at', 't.due_date',
      't.is_closed', 't.attributes',
      't.master_ticket_id', 't.tenant',
      't.itil_impact', 't.itil_urgency', 't.itil_priority_level',
      't.response_state', 't.ticket_origin',
      't.sla_policy_id', 't.sla_started_at',
      't.sla_response_due_at', 't.sla_response_at', 't.sla_response_met',
      't.sla_resolution_due_at', 't.sla_resolution_at', 't.sla_resolution_met',
      't.sla_paused_at', 't.sla_total_pause_minutes',
      // Bundle stats from pre-aggregated JOIN
      trx.raw('COALESCE(bs.bundle_child_count, 0) as bundle_child_count'),
      trx.raw(`COALESCE(
        (SELECT COUNT(DISTINCT cid) FROM unnest(
          array_append(COALESCE(bs.child_client_ids, ARRAY[]::uuid[]), t.client_id)
        ) AS cid WHERE cid IS NOT NULL),
        0
      )::int as bundle_distinct_client_count`),
      // Joined display columns
      'mt.ticket_number as bundle_master_ticket_number',
      's.name as status_name',
      'p.priority_name',
      'p.color as priority_color',
      'c.board_name',
      'cat.category_name',
      'comp.client_name',
      trx.raw("CONCAT(u.first_name, ' ', u.last_name) as entered_by_name"),
      trx.raw("CONCAT(au.first_name, ' ', au.last_name) as assigned_to_name"),
      'tm.team_name as assigned_team_name',
      // Additional agents from pre-aggregated JOIN
      trx.raw('COALESCE(ags.additional_agent_count, 0)::int as additional_agent_count'),
      trx.raw("COALESCE(ags.additional_agents, '[]'::json) as additional_agents"),
    );
}

function mapTicketListItems(tickets: any[]): ITicketListItem[] {
  return tickets.map((ticket: any): ITicketListItem => {
    const {
      status_id,
      priority_id,
      board_id,
      category_id,
      entered_by,
      status_name,
      priority_name,
      priority_color,
      board_name,
      category_name,
      client_name,
      entered_by_name,
      assigned_to_name,
      assigned_team_name,
      additional_agent_count,
      additional_agents,
      bundle_child_count,
      bundle_distinct_client_count,
      bundle_master_ticket_number,
      // NOTE: Legacy ITIL fields removed - now using unified system
      ...rest
    } = ticket;

    const convertedRest = convertDates(rest);
    // Clean up null optional fields to undefined for type compatibility
    if (convertedRest.itil_impact === null) {
      convertedRest.itil_impact = undefined;
    }
    if (convertedRest.itil_urgency === null) {
      convertedRest.itil_urgency = undefined;
    }
    if (convertedRest.itil_priority_level === null) {
      convertedRest.itil_priority_level = undefined;
    }
    if (convertedRest.due_date === null) {
      convertedRest.due_date = undefined;
    }
    return {
      ...convertedRest,
      status_id: status_id || null,
      priority_id: priority_id || null,
      board_id: board_id || null,
      category_id: category_id || null,
      entered_by: entered_by || null,
      status_name: status_name || 'Unknown',
      priority_name: priority_name || 'Unknown',
      priority_color: priority_color || '#6B7280',
      board_name: board_name || 'Unknown',
      category_name: category_name || 'Unknown',
      client_name: client_name || 'Unknown',
      entered_by_name: entered_by_name || 'Unknown',
      assigned_to_name: assigned_to_name || null,
      assigned_team_name: assigned_team_name || null,
      additional_agent_count: additional_agent_count || 0,
      additional_agents: additional_agents || [],
      bundle_child_count: typeof bundle_child_count === 'number' ? bundle_child_count : Number.parseInt(String(bundle_child_count ?? '0'), 10) || 0,
      bundle_distinct_client_count: typeof bundle_distinct_client_count === 'number' ? bundle_distinct_client_count : Number.parseInt(String(bundle_distinct_client_count ?? '0'), 10) || 0,
      bundle_master_ticket_number: bundle_master_ticket_number ?? null
    };
  });
}

/**
 * Get tickets for list with page-based pagination
 * This replaces cursor-based pagination with traditional page-based approach
 */
export const getTicketsForList = withAuth(async (
  user,
  { tenant },
  filters: ITicketListFilters,
  page: number = 1,
  pageSize: number = 10
): Promise<{ tickets: ITicketListItem[], totalCount: number, metadata: { agentAvatarUrls: Record<string, string | null>, teamAvatarUrls: Record<string, string | null>, ticketTags: Record<string, ITag[]> } }> => {
  const {knex: db} = await createTenantKnex();

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'read', trx)) {
      throw new Error('Permission denied: Cannot view tickets');
    }

    try {
      const validatedFilters = cleanFilterValues(
        validateData(ticketListFiltersSchema, filters) as ITicketListFilters
      );

    // Build base query for filtering
    const { builder: baseQuery } = await buildTicketListBaseQuery(trx, tenant, user, validatedFilters);
    const authorizationContext = await createTicketAuthorizationContext(
      trx,
      tenant,
      user as IUserWithRoles
    );

    let totalCount = 0;
    let ticketListItems: ITicketListItem[] = [];
    const normalizedPage = Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1);
    const normalizedPageSize = Math.max(1, Number.isFinite(pageSize) ? Math.floor(pageSize) : 10);
    const offset = (normalizedPage - 1) * normalizedPageSize;
    const scopedBaseQuery = baseQuery.clone();
    const authSqlResult = applyTicketReadAuthorizationSql(scopedBaseQuery, trx, tenant, authorizationContext);

    if (authSqlResult.supported) {
      const countQuery = scopedBaseQuery
        .clone()
        .clearSelect()
        .clearOrder()
        .countDistinct<{ count: string | number }[]>({ count: 't.ticket_id' })
        .first();

      const pageQuery = applyTicketListSort(
        buildTicketListItemsQuery(trx, tenant, scopedBaseQuery),
        validatedFilters
      )
        .limit(normalizedPageSize)
        .offset(offset);

      const [countRow, pageTickets] = await Promise.all([countQuery, pageQuery]);
      totalCount = Number((countRow as { count?: string | number } | undefined)?.count ?? 0);
      ticketListItems = mapTicketListItems(pageTickets);
    } else {
      // Future ABAC templates/constraints may not be representable in SQL yet.
      // Fall back to the exact JS kernel path instead of risking overexposure.
      const tickets = await applyTicketListSort(
        buildTicketListItemsQuery(trx, tenant, baseQuery),
        validatedFilters
      );
      const authorizedTickets = await filterAuthorizedTickets(trx, authorizationContext, tickets);
      totalCount = authorizedTickets.length;
      const paginatedAuthorizedTickets = authorizedTickets.slice(
        (page - 1) * pageSize,
        (page - 1) * pageSize + pageSize
      );
      ticketListItems = mapTicketListItems(paginatedAuthorizedTickets);
    }

    // Fetch metadata in parallel: avatar URLs, team avatar URLs, ticket tags
    const ticketIds = ticketListItems
      .map((t: ITicketListItem) => t.ticket_id)
      .filter((id: string | undefined): id is string => id !== undefined);

    const agentUserIds = new Set<string>();
    ticketListItems.forEach((ticket: ITicketListItem) => {
      if (ticket.assigned_to) {
        agentUserIds.add(ticket.assigned_to);
      }
      ticket.additional_agents?.forEach((agent: { user_id: string }) => {
        agentUserIds.add(agent.user_id);
      });
    });

    const teamIds = new Set<string>();
    ticketListItems.forEach((ticket: ITicketListItem) => {
      if (ticket.assigned_team_id) {
        teamIds.add(ticket.assigned_team_id);
      }
    });

    const [agentAvatarUrlsMap, teamAvatarUrlsMap, ticketTagRows] = await Promise.all([
      agentUserIds.size > 0
        ? getEntityImageUrlsBatch('user', Array.from(agentUserIds), tenant)
        : Promise.resolve(new Map<string, string | null>()),
      teamIds.size > 0
        ? getEntityImageUrlsBatch('team', Array.from(teamIds), tenant)
        : Promise.resolve(new Map<string, string | null>()),
      ticketIds.length > 0
        ? trx('tag_mappings as tm')
            .join('tag_definitions as td', function() {
              this.on('tm.tenant', '=', 'td.tenant')
                .andOn('tm.tag_id', '=', 'td.tag_id');
            })
            .where('tm.tenant', tenant)
            .whereIn('tm.tagged_id', ticketIds)
            .where('tm.tagged_type', 'ticket')
            .select(
              'tm.mapping_id',
              'td.tag_id',
              'td.tag_text',
              'tm.tagged_id',
              'tm.tagged_type',
              'td.board_id',
              'td.background_color',
              'td.text_color'
            )
        : Promise.resolve([]),
    ]);

    // Convert Maps to Records for serialization
    const agentAvatarUrls: Record<string, string | null> = {};
    agentAvatarUrlsMap.forEach((url, id) => { agentAvatarUrls[id] = url; });

    const teamAvatarUrls: Record<string, string | null> = {};
    teamAvatarUrlsMap.forEach((url, id) => { teamAvatarUrls[id] = url; });

    // Group tags by ticket ID
    const ticketTags: Record<string, ITag[]> = {};
    ticketTagRows.forEach((tag: any) => {
      const tagObj: ITag = {
        tag_id: tag.mapping_id,
        tenant,
        tag_text: tag.tag_text,
        tagged_id: tag.tagged_id,
        tagged_type: tag.tagged_type,
        background_color: tag.background_color,
        text_color: tag.text_color,
      };
      if (!ticketTags[tag.tagged_id]) {
        ticketTags[tag.tagged_id] = [];
      }
      ticketTags[tag.tagged_id].push(tagObj);
    });

    return {
      tickets: ticketListItems as ITicketListItem[],
      totalCount,
      metadata: {
        agentAvatarUrls,
        teamAvatarUrls,
        ticketTags,
      }
    };
    } catch (error) {
      console.error('Failed to fetch tickets:', error);
      throw new Error('Failed to fetch tickets');
    }
  });
});

/**
 * Get all ticket IDs matching the current filters (no pagination).
 * Used for "select all matching" functionality.
 */
export const getAllMatchingTicketIds = withAuth(async (
  user,
  { tenant },
  filters: ITicketListFilters
): Promise<string[]> => {
  const {knex: db} = await createTenantKnex();

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'read', trx)) {
      throw new Error('Permission denied: Cannot view tickets');
    }

    const validatedFilters = cleanFilterValues(
      validateData(ticketListFiltersSchema, filters) as ITicketListFilters
    );

    const { builder: baseQuery } = await buildTicketListBaseQuery(trx, tenant, user, validatedFilters);
    const authorizationContext = await createTicketAuthorizationContext(
      trx,
      tenant,
      user as IUserWithRoles
    );

    const scopedBaseQuery = baseQuery.clone();
    const authSqlResult = applyTicketReadAuthorizationSql(scopedBaseQuery, trx, tenant, authorizationContext);
    const rows = authSqlResult.supported
      ? await scopedBaseQuery
          .clearSelect()
          .clearOrder()
          .select('t.ticket_id')
      : await filterAuthorizedTickets(
          trx,
          authorizationContext,
          await baseQuery
            .clone()
            .clearSelect()
            .clearOrder()
            .select('t.ticket_id', 't.entered_by', 't.assigned_to', 't.client_id', 't.board_id', 't.assigned_team_id')
        );

    const ticketIds: Array<string | null | undefined> = rows.map((row: { ticket_id?: string | null }) => row.ticket_id);
    return ticketIds.filter((ticketId): ticketId is string => typeof ticketId === 'string' && ticketId.length > 0);
  });
});

/**
 * Resolve the board for a specific set of ticket ids, scoped to what the caller is
 * authorized to see. Used by the list's bulk action bar to determine whether a
 * selection that spans off-page rows (paginate-then-select or select-all-matching)
 * shares a single board, so the Status action can stay enabled. Tickets the caller
 * can't access are simply omitted from the result.
 */
export const getTicketBoardIds = withAuth(async (
  user,
  { tenant },
  ticketIds: string[]
): Promise<Array<{ ticket_id: string; board_id: string | null }>> => {
  const uniqueIds = Array.from(
    new Set(ticketIds.filter((id): id is string => typeof id === 'string' && id.length > 0))
  );
  if (uniqueIds.length === 0) {
    return [];
  }

  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'read', trx)) {
      throw new Error('Permission denied: Cannot view tickets');
    }

    const authorizationContext = await createTicketAuthorizationContext(
      trx,
      tenant,
      user as IUserWithRoles
    );

    const boardQuery = trx('tickets as t')
      .where('t.tenant', tenant)
      .whereIn('t.ticket_id', uniqueIds)
      .select('t.ticket_id', 't.board_id');
    const authSqlResult = applyTicketReadAuthorizationSql(boardQuery, trx, tenant, authorizationContext);

    const rows = authSqlResult.supported
      ? await boardQuery
      : await filterAuthorizedTickets(
          trx,
          authorizationContext,
          await trx('tickets as t')
            .where('t.tenant', tenant)
            .whereIn('t.ticket_id', uniqueIds)
            .select('t.ticket_id', 't.entered_by', 't.assigned_to', 't.client_id', 't.board_id', 't.assigned_team_id')
        );

    return rows
      .filter((row: { ticket_id?: string | null }): row is { ticket_id: string; board_id?: string | null } =>
        typeof row.ticket_id === 'string' && row.ticket_id.length > 0)
      .map((row) => ({
        ticket_id: row.ticket_id,
        board_id: row.board_id ?? null,
      }));
  });
});

/**
 * Get all options needed for ticket forms and filters
 * This consolidates multiple API calls into a single request
 */
export const getTicketFormOptions = withAuth(async (user, { tenant }) => {
  const {knex: db} = await createTenantKnex();

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'read', trx)) {
      throw new Error('Permission denied: Cannot view ticket options');
    }

    try {

    // Fetch all options in parallel
    const [
      statuses,
      priorities,
      boards,
      categories,
      clients,
      users,
      tags
    ] = await Promise.all([
      trx('statuses')
        .where({
          tenant: tenant,
          status_type: 'ticket'  // Changed from item_type to status_type
        })
        .orderBy('order_number', 'asc')
        .orderBy('name', 'asc'),

      // Fetch only tenant-specific ticket priorities (includes ITIL ones copied to tenant)
      trx('priorities')
        .where({ tenant, item_type: 'ticket' })
        .orderBy('order_number', 'asc')
        .orderBy('priority_name', 'asc'),
      
      trx('boards')
        .where({ tenant })
        .orderBy('board_name', 'asc'),

      // Fetch only tenant-specific categories (includes ITIL ones copied to tenant)
      trx('categories')
        .where({ tenant })
        .orderBy('display_order', 'asc')
        .orderBy('category_name', 'asc'),
      
      trx('clients as c')
        .select('c.*')
        .where({ 'c.tenant': tenant })
        .orderBy('c.client_name', 'asc'),

      trx('users')
        .where({ tenant })
        .orderBy('first_name', 'asc'),

      // Fetch all unique tags for tickets (with colors, filtering orphans)
      // Use DISTINCT ON for deduplication by tag_text (PostgreSQL-specific but works with Citus)
      trx.raw(`
        SELECT DISTINCT ON (td.tag_text) td.tag_id, td.tag_text, td.background_color, td.text_color
        FROM tag_definitions td
        WHERE td.tenant = ?
          AND td.tagged_type = 'ticket'
          AND EXISTS (
            SELECT 1 FROM tag_mappings tm
            WHERE tm.tenant = td.tenant AND tm.tag_id = td.tag_id
          )
        ORDER BY td.tag_text ASC, td.created_at ASC
      `, [tenant])
    ]);

    // Format options for dropdowns
    const statusOptions = [
      { value: TICKET_STATUS_FILTER_OPEN, label: 'All open statuses' },
      { value: TICKET_STATUS_FILTER_ALL, label: 'All Statuses' },
      ...statuses.map((status: any) => ({
        value: status.status_id,
        label: status.name || "",
        className: status.is_closed ? 'bg-gray-200 text-gray-600' : undefined,
        statusName: status.name || "",
        boardId: status.board_id || null,
        isClosed: Boolean(status.is_closed),
      }))
    ];

    const priorityOptions = [
      { value: 'all', label: 'All Priorities' },
      ...priorities.map((priority: any) => ({
        value: priority.priority_id,
        label: priority.priority_name,
        color: priority.color
      }))
    ];

    const boardOptions: IBoard[] = boards.filter((board: IBoard) => board.board_id !== undefined);

    const agentOptions = users.map((user: any) => ({
      value: user.user_id,
      label: `${user.first_name} ${user.last_name}`
    }));

    // --- Add Logo URL Processing ---
    const clientsData = clients; 

    // Process clients to add logoUrl using batch loading
    const clientIds = clientsData.map(c => c.client_id);
    const logoUrlsMap = await getClientLogoUrlsBatch(clientIds, tenant);
    
    const clientsWithLogos = clientsData.map((clientData) => {
      const logoUrl = logoUrlsMap.get(clientData.client_id) || null;
      return {
        ...clientData,
        properties: clientData.properties || {},
        logoUrl,
      };
    });
    // --- End Logo URL Processing ---

    // Use tenant categories directly (includes ITIL ones if copied)

    return {
      statusOptions,
      priorityOptions,
      boardOptions,
      agentOptions,
      categories,
      clients: clientsWithLogos, // Return clients with logos
      users,
      // Handle raw query result format (tags comes from trx.raw which returns { rows: [...] })
      tags: (tags?.rows || []).map((tag: any) => ({
        tag_id: tag.tag_id,
        tag_text: tag.tag_text,
        tagged_id: '',
        tagged_type: 'ticket' as const,
        tenant: tenant,
        background_color: tag.background_color,
        text_color: tag.text_color
      }))
    };
    } catch (error) {
      console.error('Failed to fetch ticket form options:', error);
      throw new Error('Failed to fetch ticket form options');
    }
  });
});

/**
 * Update ticket with proper caching
 */
/**
 * Core ticket-update logic, executed inside a caller-provided transaction.
 *
 * Intentionally does NOT check permissions — callers must authorize first. The public
 * `updateTicketWithCache` wrapper performs the `ticket:update` check; bulk callers hoist
 * a single check and reuse this core per ticket, avoiding one permission lookup per row.
 */
export interface UpdateTicketInTransactionOptions {
  /** Close despite unmet close rules; honored only with ticket:close_override. */
  overrideCloseRules?: boolean;
  overrideCloseRulesReason?: string | null;
  /** Automation exemption from close rules (workflow/import/auto-close/portal); audit-logged. */
  bypassCloseRules?: { source: CloseRuleBypassSource };
  /**
   * Attribute the change to the system rather than `user` (auto-close engine):
   * closed_by stays null, events carry a SYSTEM actor, and the audit row is
   * system-sourced. `user` is still required for the call signature but is not
   * referenced for attribution.
   */
  systemActor?: boolean;
}

export async function updateTicketInTransaction(
  trx: Knex.Transaction,
  user: IUserWithRoles,
  tenant: string,
  id: string,
  data: Partial<ITicket>,
  options?: UpdateTicketInTransactionOptions,
): Promise<'success'> {
    try {
      // Validate update data
      const validatedData = validateData(ticketUpdateSchema, data);

    // Get current ticket state before update
    const currentTicket = await trx('tickets')
      .where({ ticket_id: id, tenant: tenant })
      .first();

    if (!currentTicket) {
      throw new Error('Ticket not found');
    }

    // Bundled child tickets lock workflow fields by default
    const isBundledChild = Boolean(currentTicket.master_ticket_id);
    const lockedFields = new Set(['status_id', 'assigned_to', 'priority_id']);
    if (isBundledChild) {
      const attempted = Object.keys(validatedData).filter((k) => lockedFields.has(k));
      if (attempted.length > 0) {
        throw new Error(`This ticket is bundled; workflow fields are locked (${attempted.join(', ')}). Update the master ticket instead.`);
      }
    }

    // Clean up the data before update
    const updateData = { ...validatedData };

    // Handle null values for category and subcategory
    if ('category_id' in updateData && !updateData.category_id) {
      updateData.category_id = null;
    }
    if ('subcategory_id' in updateData && !updateData.subcategory_id) {
      updateData.subcategory_id = null;
    }

    // Handle ITIL priority calculation if impact or urgency is being updated
    if (('itil_impact' in updateData || 'itil_urgency' in updateData)) {
      const newImpact = 'itil_impact' in updateData ? updateData.itil_impact : currentTicket.itil_impact;
      const newUrgency = 'itil_urgency' in updateData ? updateData.itil_urgency : currentTicket.itil_urgency;

      if (newImpact && newUrgency) {
        // Calculate ITIL priority level
        const priorityLevel = calculateItilPriority(newImpact, newUrgency);

        // Map priority level to ITIL priority name pattern
        const priorityNamePattern = `P${priorityLevel} -%`;

        // Get the corresponding ITIL priority record from tenant's priorities table
        const itilPriorityRecord = await trx('priorities')
          .where('tenant', tenant)
          .where('is_from_itil_standard', true)
          .where('priority_name', 'like', priorityNamePattern)
          .where('item_type', 'ticket')
          .first();

        if (itilPriorityRecord) {
          updateData.priority_id = itilPriorityRecord.priority_id;
          updateData.itil_priority_level = priorityLevel;
        }
      }
    }

    // Check if we're updating the assigned_to field
    const isChangingAssignment = 'assigned_to' in updateData &&
                                updateData.assigned_to !== currentTicket.assigned_to;
    const updatedFields = diffTicketFields(currentTicket, updateData as Record<string, unknown>);
    const isBoardChange =
      'board_id' in updateData &&
      !!updateData.board_id &&
      updateData.board_id !== currentTicket.board_id;

    if (isBoardChange && !updateData.status_id) {
      throw new Error('Changing the board requires selecting a status for the destination board');
    }

    // If updating category or subcategory, ensure they are compatible
    if ('subcategory_id' in updateData || 'category_id' in updateData) {
      const newSubcategoryId = updateData.subcategory_id;
      const newCategoryId = updateData.category_id || currentTicket?.category_id;

      if (newSubcategoryId) {
        // If setting a subcategory, verify it's a valid child of the category
        const subcategory = await trx('categories')
          .where({ category_id: newSubcategoryId, tenant: tenant })
          .first();

        if (subcategory && subcategory.parent_category !== newCategoryId) {
          throw new Error('Invalid category combination: subcategory must belong to the selected parent category');
        }
      }
    }

    if ('status_id' in updateData && updateData.status_id && updateData.status_id !== currentTicket.status_id) {
      const effectiveBoardId = updateData.board_id || currentTicket.board_id;
      const statusResult = effectiveBoardId
        ? await TicketModel.validateStatusBelongsToBoard(
          updateData.status_id,
          effectiveBoardId,
          tenant,
          trx
        )
        : {
          valid: false,
          error: 'Invalid status: board_id is required when selecting a ticket status'
        };

      if (!statusResult.valid && statusResult.error) {
        throw new Error(statusResult.error);
      }
    }

    // Get the status before and after update to check for closure
    const oldStatus = await trx('statuses')
      .where({
        status_id: currentTicket.status_id,
        tenant: tenant
      })
      .first();

    const isSystemActor = options?.systemActor === true;

    // Pre-close validation gates: when this update flips the ticket from an
    // open to a closed status, enforce the board's close rules before any
    // writes. Throws TicketCloseValidationError (aborting the transaction)
    // unless gates pass, a permissioned override applies, or the caller is an
    // exempt automation path (bypassCloseRules).
    if ('status_id' in updateData && updateData.status_id && updateData.status_id !== currentTicket.status_id) {
      const nextStatus = await trx('statuses')
        .where({ status_id: updateData.status_id, tenant: tenant })
        .first();
      if (nextStatus?.is_closed && !oldStatus?.is_closed) {
        const merged = { ...currentTicket, ...updateData };
        await enforceTicketCloseRules(trx, tenant, {
          ticket: {
            ticket_id: id,
            board_id: merged.board_id ?? null,
            category_id: merged.category_id ?? null,
            subcategory_id: merged.subcategory_id ?? null,
            priority_id: merged.priority_id ?? null,
            assigned_to: merged.assigned_to ?? null,
          },
          override: options?.overrideCloseRules
            ? { requested: true, reason: options?.overrideCloseRulesReason ?? null, user }
            : undefined,
          bypass: options?.bypassCloseRules,
          actor: isSystemActor
            ? { actorType: TICKET_ACTIVITY_ACTOR.SYSTEM }
            : {
                actorType: TICKET_ACTIVITY_ACTOR.USER,
                userId: user.user_id,
                displayName: formatLiveUpdateDisplayName(user),
              },
          source: isSystemActor ? TICKET_ACTIVITY_SOURCE.SYSTEM : TICKET_ACTIVITY_SOURCE.UI,
        });
      }
    }

    let updatedTicket;
    
    // If we're changing the assigned_to field, we need to handle the ticket_resources table
    if (isChangingAssignment) {
      // Use the existing transaction instead of creating a nested one
        // Step 1: Delete any ticket_resources where the new assigned_to is an additional_user_id
        // to avoid constraint violations after the update
        await trx('ticket_resources')
          .where({
            tenant: tenant,
            ticket_id: id,
            additional_user_id: updateData.assigned_to
          })
          .delete();
        
        // Step 2: Get existing resources with the old assigned_to value
        const existingResources = await trx('ticket_resources')
          .where({
            tenant: tenant,
            ticket_id: id,
            assigned_to: currentTicket.assigned_to
          })
          .select('*');
          
        // Step 3: Store resources for recreation, excluding those that would violate constraints
        const resourcesToRecreate: any[] = [];
        for (const resource of existingResources) {
          // Skip resources where additional_user_id would equal the new assigned_to
          if (resource.additional_user_id !== updateData.assigned_to) {
            // Clone the resource but exclude the primary key fields
            const { assignment_id, ...resourceData } = resource;
            resourcesToRecreate.push(resourceData);
          }
        }
        
        // Step 4: Delete the existing resources with the old assigned_to
        if (existingResources.length > 0) {
          await trx('ticket_resources')
            .where({
              tenant: tenant,
              ticket_id: id,
              assigned_to: currentTicket.assigned_to
            })
            .delete();
        }
        
        // Step 5: Update the ticket with the new assigned_to
        const [updated] = await trx('tickets')
          .where({ ticket_id: id, tenant: tenant })
          .update(updateData)
          .returning('*');
          
        // Step 6: Re-create the resources with the new assigned_to
        for (const resourceData of resourcesToRecreate) {
          await trx('ticket_resources').insert({
            ...resourceData,
            assigned_to: updateData.assigned_to
          });
        }
        
        updatedTicket = updated;
    } else {
      // Regular update without changing assignment
      [updatedTicket] = await trx('tickets')
        .where({ ticket_id: id, tenant: tenant })
        .update(updateData)
        .returning('*');
    }

    if (!updatedTicket) {
      throw new Error('Ticket not found or update failed');
    }

    // Get the new status if it was updated
    const newStatus = updateData.status_id ? 
      await trx('statuses')
        .where({ 
          status_id: updateData.status_id,
          tenant: tenant
        })
        .first() :
      oldStatus;

    // Emit expanded domain transition events for workflow v2 triggers.
    const occurredAt = new Date().toISOString();
    const workflowCtx = {
      tenantId: tenant,
      actor: isSystemActor
        ? { actorType: 'SYSTEM' as const }
        : { actorType: 'USER' as const, actorUserId: user.user_id },
      occurredAt,
    };

    const transitionEvents = buildTicketTransitionWorkflowEvents({
      before: {
        ticketId: id,
        statusId: currentTicket.status_id,
        priorityId: currentTicket.priority_id,
        assignedTo: currentTicket.assigned_to,
        boardId: currentTicket.board_id,
        escalated: currentTicket.escalated,
      },
      after: {
        ticketId: id,
        statusId: updatedTicket.status_id,
        priorityId: updatedTicket.priority_id,
        assignedTo: updatedTicket.assigned_to,
        boardId: updatedTicket.board_id,
        escalated: updatedTicket.escalated,
      },
      ctx: {
        occurredAt,
        actorUserId: user.user_id,
        previousStatusIsClosed: !!oldStatus?.is_closed,
        newStatusIsClosed: !!newStatus?.is_closed,
      },
    });

    for (const ev of transitionEvents) {
      await publishWorkflowEvent({
        eventType: ev.eventType,
        payload: ev.payload,
        ctx: workflowCtx,
        eventName: ev.workflow?.eventName,
        fromState: ev.workflow?.fromState,
        toState: ev.workflow?.toState,
      });
    }

    // Build structured changes object with old/new values
    const structuredChanges: Record<string, any> = {};

    if (updateData.title !== undefined && updateData.title !== currentTicket.title) {
      structuredChanges.title = {
        old: currentTicket.title,
        new: updateData.title
      };
    }

    if (updateData.url !== undefined && updateData.url !== currentTicket.url) {
      structuredChanges.url = {
        old: currentTicket.url,
        new: updateData.url
      };
    }

    if (updateData.status_id !== undefined && updateData.status_id !== currentTicket.status_id) {
      structuredChanges.status_id = {
        old: currentTicket.status_id,
        new: updateData.status_id
      };
    }

    if (updateData.priority_id !== undefined && updateData.priority_id !== currentTicket.priority_id) {
      structuredChanges.priority_id = {
        old: currentTicket.priority_id,
        new: updateData.priority_id
      };
    }

    if (updateData.assigned_to !== undefined && updateData.assigned_to !== currentTicket.assigned_to) {
      structuredChanges.assigned_to = {
        old: currentTicket.assigned_to,
        new: updateData.assigned_to
      };
    }

    if (updateData.board_id !== undefined && updateData.board_id !== currentTicket.board_id) {
      structuredChanges.board_id = {
        old: currentTicket.board_id,
        new: updateData.board_id
      };
    }

    if (updateData.category_id !== undefined && updateData.category_id !== currentTicket.category_id) {
      structuredChanges.category_id = {
        old: currentTicket.category_id,
        new: updateData.category_id
      };
    }

    if (updateData.subcategory_id !== undefined && updateData.subcategory_id !== currentTicket.subcategory_id) {
      structuredChanges.subcategory_id = {
        old: currentTicket.subcategory_id,
        new: updateData.subcategory_id
      };
    }

    // Keep the ticket row's denormalized close flag aligned with the selected status.
    if (updateData.status_id !== undefined && updateData.status_id !== currentTicket.status_id) {
      const nextIsClosed = !!newStatus?.is_closed;
      await trx('tickets')
        .where({ ticket_id: id, tenant: tenant })
        .update({ is_closed: nextIsClosed });
      updatedTicket.is_closed = nextIsClosed;
    }

    // Record closed_at / closed_by when transitioning to/from closed status.
    // System closes (auto-close engine) leave closed_by null — attribution
    // lives in the audit row instead.
    if (newStatus?.is_closed && !oldStatus?.is_closed) {
      const closedBy = isSystemActor ? null : user.user_id;
      await trx('tickets')
        .where({ ticket_id: id, tenant: tenant })
        .update({ closed_at: occurredAt, closed_by: closedBy });
      updatedTicket.closed_at = occurredAt;
      updatedTicket.closed_by = closedBy;
    } else if (!newStatus?.is_closed && oldStatus?.is_closed) {
      await trx('tickets')
        .where({ ticket_id: id, tenant: tenant })
        .update({ closed_at: null, closed_by: null });
      updatedTicket.closed_at = null;
      updatedTicket.closed_by = null;
    }

    // Auto-apply checklist templates when the ticket's targeting attributes
    // (board/category/subcategory/priority) changed. Idempotent per template.
    const checklistTargetingChanged =
      (updateData.board_id !== undefined && updateData.board_id !== currentTicket.board_id) ||
      (updateData.category_id !== undefined && updateData.category_id !== currentTicket.category_id) ||
      (updateData.subcategory_id !== undefined && updateData.subcategory_id !== currentTicket.subcategory_id) ||
      (updateData.priority_id !== undefined && updateData.priority_id !== currentTicket.priority_id);
    if (checklistTargetingChanged) {
      try {
        await applyMatchingChecklistTemplates(trx, tenant, {
          ticket_id: id,
          board_id: updatedTicket.board_id,
          category_id: updatedTicket.category_id,
          subcategory_id: updatedTicket.subcategory_id,
          priority_id: updatedTicket.priority_id,
        }, isSystemActor
          ? undefined
          : {
              actor: {
                actorType: TICKET_ACTIVITY_ACTOR.USER,
                userId: user.user_id,
                displayName: formatLiveUpdateDisplayName(user),
              },
              source: TICKET_ACTIVITY_SOURCE.UI,
            });
      } catch (error) {
        console.error('Failed to auto-apply checklist templates:', error);
      }
    }

    // Publish appropriate event based on the update — after the save
    // transaction commits, so subscribers never contend with our row locks.
    if (newStatus?.is_closed && !oldStatus?.is_closed) {
      // Ticket was closed. System closes (auto-close engine) omit user
      // attribution — the v2 ticketClosedEventPayloadSchema treats
      // closedByUserId as optional.
      registerAfterCommit(trx, () =>
        publishWorkflowEvent({
          eventType: 'TICKET_CLOSED',
          payload: {
            ticketId: id,
            ...(isSystemActor
              ? {}
              : { userId: user.user_id, closedByUserId: user.user_id }),
            closedAt: occurredAt,
            changes: structuredChanges,
          },
          ctx: workflowCtx,
          eventName: 'Ticket Closed',
          fromState: currentTicket.status_id,
          toState: updatedTicket.status_id,
        }),
        `TICKET_CLOSED ticket=${id}`
      );

      const slaCompletionEvent = buildTicketResolutionSlaStageCompletionEvent({
        tenantId: tenant,
        ticketId: id,
        itilPriorityLevel: currentTicket.itil_priority_level,
        enteredAt: currentTicket.entered_at,
        closedAt: occurredAt,
      });
      if (slaCompletionEvent) {
        registerAfterCommit(trx, () =>
          publishWorkflowEvent({
            eventType: slaCompletionEvent.eventType,
            payload: slaCompletionEvent.payload,
            ctx: workflowCtx,
            idempotencyKey: slaCompletionEvent.idempotencyKey,
          }),
          `${slaCompletionEvent.eventType} ticket=${id}`
        );
      }
    } else if (updateData.assigned_to && updateData.assigned_to !== currentTicket.assigned_to) {
      // Ticket was assigned - userId should be the user being assigned, not the one making the update
      registerAfterCommit(trx, () =>
        publishWorkflowEvent({
          eventType: 'TICKET_ASSIGNED',
          payload: {
            ticketId: id,
            userId: updateData.assigned_to, // Legacy: assigned user
            assignedByUserId: user.user_id,
            previousAssigneeId: currentTicket.assigned_to ?? undefined,
            previousAssigneeType: currentTicket.assigned_to ? 'user' : undefined,
            newAssigneeId: updateData.assigned_to,
            newAssigneeType: 'user',
            assignedAt: occurredAt,
            changes: structuredChanges,
          },
          ctx: workflowCtx,
          eventName: 'Ticket Assigned',
        }),
        `TICKET_ASSIGNED ticket=${id}`
      );
    } else {
      // Regular update
      registerAfterCommit(trx, () =>
        publishWorkflowEvent({
          eventType: 'TICKET_UPDATED',
          payload: {
            ticketId: id,
            userId: user.user_id,
            updatedByUserId: user.user_id,
            changes: structuredChanges,
          },
          ctx: workflowCtx,
          eventName: 'Ticket Updated',
        }),
        `TICKET_UPDATED ticket=${id}`
      );
    }

    // System closes (auto-close engine) skip the live UI update entirely.
    if (!isSystemActor) {
      registerAfterCommit(trx, () =>
        publishTicketUpdate({
          tenantId: tenant,
          ticketId: id,
          updatedFields,
          updatedBy: {
            userId: user.user_id,
            displayName: formatLiveUpdateDisplayName(user),
          },
          updatedAt: toIsoTimestamp(updatedTicket.updated_at, occurredAt),
        }),
        `ticket-live-update ticket=${id}`
      );
    }

    // Write a unified activity-timeline row for this update. We pick the
    // most specific event type so the UI can render a tight, human-readable
    // line ("Morgan changed status from New to In Progress") rather than a
    // generic "ticket updated" entry. The curated diff includes resolved
    // labels for IDs where possible.
    const actorInfo = isSystemActor
      ? { actorType: TICKET_ACTIVITY_ACTOR.SYSTEM }
      : {
          actorType: TICKET_ACTIVITY_ACTOR.USER,
          userId: user.user_id,
          displayName: formatLiveUpdateDisplayName(user),
        };
    const curated = await buildCuratedTicketDiffWithLabels(
      trx,
      tenant,
      currentTicket,
      { ...updateData, closed_at: updatedTicket.closed_at, closed_by: updatedTicket.closed_by },
    );

    if (hasCuratedChanges(curated)) {
      const changedKeys = Object.keys(curated);
      let activityEventType: string = TICKET_ACTIVITY_EVENT.UPDATED;
      if (newStatus?.is_closed && !oldStatus?.is_closed) {
        activityEventType = TICKET_ACTIVITY_EVENT.CLOSED;
      } else if (!newStatus?.is_closed && oldStatus?.is_closed) {
        activityEventType = TICKET_ACTIVITY_EVENT.REOPENED;
      } else if (changedKeys.length === 1) {
        if (changedKeys[0] === 'status_id') {
          activityEventType = TICKET_ACTIVITY_EVENT.STATUS_CHANGED;
        } else if (changedKeys[0] === 'priority_id') {
          activityEventType = TICKET_ACTIVITY_EVENT.PRIORITY_CHANGED;
        } else if (changedKeys[0] === 'assigned_to') {
          activityEventType =
            updateData.assigned_to == null
              ? TICKET_ACTIVITY_EVENT.UNASSIGNED
              : TICKET_ACTIVITY_EVENT.ASSIGNED;
        } else if (changedKeys[0] === 'board_id') {
          activityEventType = TICKET_ACTIVITY_EVENT.BOARD_MOVED;
        } else if (changedKeys[0] === 'response_state') {
          activityEventType = TICKET_ACTIVITY_EVENT.RESPONSE_STATE_CHANGED;
        }
      }

      await writeTicketActivity(trx, {
        tenant,
        ticketId: id,
        eventType: activityEventType,
        entityType: TICKET_ACTIVITY_ENTITY.TICKET,
        entityId: id,
        actor: actorInfo,
        source: isSystemActor ? TICKET_ACTIVITY_SOURCE.SYSTEM : TICKET_ACTIVITY_SOURCE.UI,
        occurredAt,
        changes: curated,
      });
    }

    // Publish response state change event if response_state was explicitly changed
    if ('response_state' in updateData && updateData.response_state !== currentTicket.response_state) {
      registerAfterCommit(trx, () =>
        publishEvent({
          eventType: 'TICKET_RESPONSE_STATE_CHANGED',
          payload: {
            tenantId: tenant,
            ticketId: id,
            userId: user.user_id,
            previousState: currentTicket.response_state || null,
            newState: updateData.response_state || null,
            trigger: 'manual',
          },
        }),
        `TICKET_RESPONSE_STATE_CHANGED ticket=${id}`
      );
    }

    // If this is a bundle master in sync_updates mode, propagate selected workflow updates to children.
    const bundleSettings = await trx('ticket_bundle_settings')
      .where({ tenant, master_ticket_id: id })
      .first();

    if (bundleSettings?.mode === 'sync_updates') {
      const propagateFields: Record<string, any> = {};
      for (const key of ['status_id', 'assigned_to', 'priority_id', 'closed_by', 'closed_at']) {
        if (Object.prototype.hasOwnProperty.call(updateData, key)) {
          propagateFields[key] = (updateData as any)[key];
        }
      }

      if (Object.keys(propagateFields).length > 0) {
        const childTickets = await trx('tickets')
          .where({ tenant, master_ticket_id: id })
          .select(['ticket_id', ...Object.keys(propagateFields)]);

        const childPublishes = childTickets
          .map((childTicket: Record<string, unknown>) => ({
            ticketId: childTicket.ticket_id as string,
            updatedFields: diffTicketFields(childTicket, propagateFields),
          }))
          .filter((childPublish) => childPublish.updatedFields.length > 0);

        const propagate: Record<string, any> = { ...propagateFields };
        propagate.updated_by = user.user_id;
        propagate.updated_at = new Date().toISOString();
        await trx('tickets')
          .where({ tenant, master_ticket_id: id })
          .update(propagate);

        for (const childPublish of childPublishes) {
          registerAfterCommit(trx, () =>
            publishTicketUpdate({
              tenantId: tenant,
              ticketId: childPublish.ticketId,
              updatedFields: childPublish.updatedFields,
              updatedBy: {
                userId: user.user_id,
                displayName: formatLiveUpdateDisplayName(user),
              },
              updatedAt: propagate.updated_at,
            }),
            `ticket-live-update ticket=${childPublish.ticketId}`
          );
        }
      }
    }

    // Revalidate paths to update UI
    revalidatePath(`/msp/tickets/${id}`);
    revalidatePath('/msp/tickets');

    return 'success';
    } catch (error) {
      console.error(error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to update ticket');
    }
}

export const updateTicketWithCache = withAuth(async (
  user,
  { tenant },
  id: string,
  data: Partial<ITicket>,
  options?: Pick<UpdateTicketInTransactionOptions, 'overrideCloseRules' | 'overrideCloseRulesReason'>,
) => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot update ticket');
    }

    return updateTicketInTransaction(trx, user as IUserWithRoles, tenant, id, data, options);
  });
});

/**
 * Client-safe wrapper: resolves current user on the server.
 * Use this from Client Components to avoid importing server-only auth modules into the browser bundle.
 * @deprecated With withAuth pattern, you can call updateTicketWithCache directly - it handles auth internally
 */
export async function updateTicketWithCacheForCurrentUser(id: string, data: Partial<ITicket>) {
  return updateTicketWithCache(id, data);
}

/**
 * Add comment to ticket with proper caching
 */
export const addTicketCommentWithCache = withAuth(async (
  user,
  { tenant },
  ticketId: string,
  content: string,
  isInternal: boolean,
  isResolution: boolean,
  closesTicket: boolean = false
): Promise<IComment> => {
  const {knex: db} = await createTenantKnex();

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot add comment');
    }

    try {
    const authorType: 'internal' | 'client' | 'unknown' =
      user.user_type === 'client' ? 'client' : 'internal';

    if (isInternal && authorType !== 'internal') {
      throw new Error('Only MSP users can create internal comments');
    }

    // Verify ticket exists
    const ticket = await trx('tickets')
      .where({
        ticket_id: ticketId,
        tenant: tenant
      })
      .first();

    if (!ticket) {
      throw new Error('Ticket not found');
    }

    // Use the centralized utility to convert BlockNote JSON to markdown
    let markdownContent = "";
    try {
      markdownContent = await convertBlockNoteToMarkdown(content);
      console.log("Converted markdown content for optimized comment:", markdownContent);
    } catch (e) {
      console.error("Error converting content to markdown:", e);
      // If conversion fails, use a fallback message
      markdownContent = "[Error converting content to markdown]";
    }
    
    // Insert comment with markdown_content. comments.thread_id is NOT NULL, so
    // create the thread row first using IDs generated up-front.
    const idsResult = await trx.raw(
      'SELECT gen_random_uuid() AS comment_id, gen_random_uuid() AS thread_id'
    );
    const generatedIds = idsResult.rows?.[0] as { comment_id: string; thread_id: string } | undefined;
    if (!generatedIds?.comment_id || !generatedIds?.thread_id) {
      throw new Error('Failed to generate comment/thread identifiers');
    }
    const newCommentId = generatedIds.comment_id;
    const threadId = generatedIds.thread_id;
    const effectiveIsInternal = authorType === 'internal' ? isInternal : false;
    const nowIso = new Date().toISOString();

    await trx('comment_threads').insert({
      tenant,
      thread_id: threadId,
      ticket_id: ticketId,
      project_task_id: null,
      root_comment_id: newCommentId,
      is_internal: effectiveIsInternal,
      reply_count: 0,
      last_activity_at: nowIso,
      created_at: nowIso,
      created_by: user.user_id || null,
    });

    const [newComment] = await trx('comments').insert({
      tenant,
      comment_id: newCommentId,
      thread_id: threadId,
      ticket_id: ticketId,
      user_id: user.user_id,
      author_type: authorType,
      note: content,
      is_internal: effectiveIsInternal,
      is_resolution: isResolution,
      markdown_content: markdownContent,
      created_at: nowIso,
      // The email subscriber reads metadata.closes_ticket and skips the
      // comment-added email so the close email is the single source of
      // truth when the UI is closing the ticket immediately after.
      ...(closesTicket ? { metadata: { closes_ticket: true } } : {}),
    }).returning('*');

    // Update ticket response state based on comment visibility and author (F005-F008)
    await updateTicketResponseStateFromComment(
      trx,
      tenant,
      ticketId,
      authorType,
      authorType === 'internal' ? isInternal : false,
      user.user_id ?? null
    );

    // Bundle child→master reopen: a public reply on a bundled child can
    // reopen the closed master when reopen_on_child_reply is set. This
    // mirrors the wiring in commentActions.createComment so the optimized
    // MSP-side comment path doesn't silently skip the reopen.
    if (!isInternal) {
      await maybeReopenBundleMasterFromChildReply(trx, tenant, ticketId, user.user_id ?? null);
    }

    // If this is a bundle master in sync_updates mode, mirror public comments to children (idempotent).
    if (!isInternal) {
      const bundleSettings = await trx('ticket_bundle_settings')
        .where({ tenant, master_ticket_id: ticketId })
        .first();

      if (bundleSettings?.mode === 'sync_updates') {
        const children = await trx('tickets')
          .select('ticket_id')
          .where({ tenant, master_ticket_id: ticketId });

        const now = new Date().toISOString();
        for (const child of children) {
          const existingMirror = await trx('ticket_bundle_mirrors')
            .where({
              tenant,
              source_comment_id: newComment.comment_id,
              child_ticket_id: child.ticket_id,
            })
            .first();

          if (existingMirror) {
            continue;
          }

          const childIds = await trx.raw(
            'SELECT gen_random_uuid() AS comment_id, gen_random_uuid() AS thread_id'
          );
          const childGenerated = childIds.rows?.[0] as
            | { comment_id: string; thread_id: string }
            | undefined;
          if (!childGenerated?.comment_id || !childGenerated?.thread_id) {
            throw new Error('Failed to generate mirrored comment/thread identifiers');
          }

          await trx('comment_threads').insert({
            tenant,
            thread_id: childGenerated.thread_id,
            ticket_id: child.ticket_id,
            project_task_id: null,
            root_comment_id: childGenerated.comment_id,
            is_internal: false,
            reply_count: 0,
            last_activity_at: now,
            created_at: now,
            created_by: null,
          });

          await trx('comments').insert({
            tenant,
            comment_id: childGenerated.comment_id,
            thread_id: childGenerated.thread_id,
            ticket_id: child.ticket_id,
            user_id: null,
            author_type: 'unknown',
            note: content,
            is_internal: false,
            is_resolution: isResolution,
            is_system_generated: true,
            markdown_content: markdownContent,
            created_at: now,
          });

          await trx('ticket_bundle_mirrors')
            .insert({
              tenant,
              source_comment_id: newComment.comment_id,
              child_ticket_id: child.ticket_id,
              child_comment_id: childGenerated.comment_id,
            })
            .onConflict()
            .ignore();
        }
      }
    }

    // Publish comment added event after the comment transaction commits.
    registerAfterCommit(trx, () =>
      publishEvent({
        eventType: 'TICKET_COMMENT_ADDED',
        payload: {
          tenantId: tenant,
          ticketId: ticketId,
          userId: user.user_id,
          comment: {
            id: newComment.comment_id,
            content: content,
            author: `${user.first_name} ${user.last_name}`,
            isInternal,
            authorType,
          }
        }
      }),
      `TICKET_COMMENT_ADDED ticket=${ticketId}`
    );

    // Publish workflow v2 ticket message events (additive).
    try {
      const occurredAt = newComment.created_at ?? new Date().toISOString();
      const workflowCtx = {
        tenantId: tenant,
        actor: { actorType: 'USER' as const, actorUserId: user.user_id },
        occurredAt,
        correlationId: newComment.comment_id,
      };

      const events = buildTicketCommunicationWorkflowEvents({
        ticketId,
        messageId: newComment.comment_id,
        visibility: isInternal ? 'internal' : 'public',
        author: { authorType: 'user', authorId: user.user_id },
        channel: 'ui',
        createdAt: occurredAt,
      });

      for (const ev of events) {
        registerAfterCommit(
          trx,
          () => publishWorkflowEvent({ eventType: ev.eventType, payload: ev.payload, ctx: workflowCtx }),
          `${ev.eventType} ticket=${ticketId}`
        );
      }
    } catch (eventError) {
      console.error('[addTicketCommentWithCache] Failed to build workflow ticket message events:', eventError);
    }

    registerAfterCommit(trx, () =>
      publishTicketUpdate({
        tenantId: tenant,
        ticketId,
        updatedFields: ['comments'],
        updatedBy: {
          userId: user.user_id,
          displayName: formatLiveUpdateDisplayName(user),
        },
        updatedAt: toIsoTimestamp(newComment.created_at, new Date().toISOString()),
      }),
      `ticket-live-update ticket=${ticketId}`
    );

    // Activity-timeline row for the MSP-side "add comment" flow. This path
    // is hit by the ticket detail UI, so source is always 'ui'. Internal
    // notes get a distinct event type for clearer rendering.
    await writeTicketActivity(trx, {
      tenant,
      ticketId,
      eventType: isInternal
        ? TICKET_ACTIVITY_EVENT.INTERNAL_NOTE_ADDED
        : TICKET_ACTIVITY_EVENT.MESSAGE_ADDED,
      entityType: TICKET_ACTIVITY_ENTITY.COMMENT,
      entityId: newComment.comment_id,
      actor: {
        actorType: TICKET_ACTIVITY_ACTOR.USER,
        userId: user.user_id,
        displayName: formatLiveUpdateDisplayName(user),
      },
      source: TICKET_ACTIVITY_SOURCE.UI,
      occurredAt: toIsoTimestamp(newComment.created_at, new Date().toISOString()),
      details: {
        is_internal: !!isInternal,
        is_resolution: !!isResolution,
      },
    });

    // Track comment analytics
    captureAnalytics('ticket_comment_added', {
      is_internal: isInternal,
      is_resolution: isResolution,
      content_length: markdownContent.length,
      has_formatting: content.includes('"type"'), // BlockNote content has type field
    }, user.user_id);

    // Revalidate paths to update UI
    revalidatePath(`/msp/tickets/${ticketId}`);

    return newComment;
    } catch (error) {
      console.error('Failed to add ticket comment:', error);
      throw new Error('Failed to add ticket comment');
    }
  });
});

/**
 * Client-safe wrapper: resolves current user on the server.
 * Use this from Client Components to avoid importing server-only auth modules into the browser bundle.
 * @deprecated With withAuth pattern, you can call addTicketCommentWithCache directly - it handles auth internally
 */
export async function addTicketCommentWithCacheForCurrentUser(
  ticketId: string,
  content: string,
  isInternal: boolean,
  isResolution: boolean,
  closesTicket: boolean = false
): Promise<IComment> {
  return addTicketCommentWithCache(ticketId, content, isInternal, isResolution, closesTicket);
}

/**
 * Get consolidated data for the ticket list page including filter options and tickets
 * This reduces multiple network calls by fetching all related data in a single server action
 */
export const getConsolidatedTicketListData = withAuth(async (
  user,
  { tenant },
  filters: ITicketListFilters,
  page: number = 1,
  pageSize: number = 10
) => {
  const {knex: db} = await createTenantKnex();

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'read', trx)) {
      throw new Error('Permission denied: Cannot view tickets');
    }

    try {
      // Fetch filter options and tickets in parallel
      const [formOptions, ticketsData] = await Promise.all([
        getTicketFormOptions(),
        getTicketsForList(filters, page, pageSize)
      ]);

      // Return consolidated data
      return {
        options: formOptions,
        tickets: ticketsData.tickets,
        totalCount: ticketsData.totalCount,
        metadata: ticketsData.metadata
      };
    } catch (error) {
      console.error('Failed to fetch consolidated ticket list data:', error);
      throw new Error('Failed to fetch ticket list data');
    }
  });
});

/**
 * Fetch tickets with pagination
 * This is used when changing pages or page size
 */
export const fetchTicketsWithPagination = withAuth(async (
  user,
  { tenant },
  filters: ITicketListFilters,
  page: number = 1,
  pageSize: number = 10
) => {
  const {knex: db} = await createTenantKnex();

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'read', trx)) {
      throw new Error('Permission denied: Cannot view tickets');
    }

    try {
      return await getTicketsForList(filters, page, pageSize);
    } catch (error) {
      console.error('Failed to fetch tickets:', error);
      throw new Error('Failed to fetch tickets');
    }
  });
});

/**
 * Fetch bundle children for a given master ticket.
 * Used by the ticket list when in "bundled" view and expanding a master inline.
 */
export const fetchBundleChildrenForMaster = withAuth(async (
  user,
  { tenant },
  masterTicketId: string
): Promise<ITicketListItem[]> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'read', trx)) {
      throw new Error('Permission denied: Cannot view tickets');
    }

    const authorizationContext = await createTicketAuthorizationContext(
      trx,
      tenant,
      user as IUserWithRoles
    );

    const rows = await trx('tickets as t')
      .leftJoin('tickets as mt', function () {
        this.on('t.master_ticket_id', 'mt.ticket_id')
          .andOn('t.tenant', 'mt.tenant');
      })
      .leftJoin('statuses as s', function () {
        this.on('t.status_id', 's.status_id')
          .andOn('t.tenant', 's.tenant');
      })
      .leftJoin('priorities as p', function () {
        this.on('t.priority_id', 'p.priority_id')
          .andOn('t.tenant', 'p.tenant')
          .andOnVal('p.item_type', '=', 'ticket');
      })
      .leftJoin('boards as c', function () {
        this.on('t.board_id', 'c.board_id')
          .andOn('t.tenant', 'c.tenant');
      })
      .leftJoin('categories as cat', function () {
        this.on('t.category_id', 'cat.category_id')
          .andOn('t.tenant', 'cat.tenant');
      })
      .leftJoin('clients as comp', function () {
        this.on('t.client_id', 'comp.client_id')
          .andOn('t.tenant', 'comp.tenant');
      })
      .leftJoin('users as u', function () {
        this.on('t.entered_by', 'u.user_id')
          .andOn('t.tenant', 'u.tenant');
      })
      .leftJoin('users as au', function () {
        this.on('t.assigned_to', 'au.user_id')
          .andOn('t.tenant', 'au.tenant');
      })
      .leftJoin('teams as tm', function () {
        this.on('t.assigned_team_id', 'tm.team_id')
          .andOn('t.tenant', 'tm.tenant');
      })
      .select(
        't.*',
        's.name as status_name',
        'p.priority_name',
        'p.color as priority_color',
        'c.board_name',
        'cat.category_name',
        'comp.client_name as client_name',
        trx.raw("CONCAT(u.first_name, ' ', u.last_name) as entered_by_name"),
        trx.raw("CONCAT(au.first_name, ' ', au.last_name) as assigned_to_name"),
        'tm.team_name as assigned_team_name',
        'mt.ticket_number as bundle_master_ticket_number'
      )
      .where({ 't.tenant': tenant, 't.master_ticket_id': masterTicketId })
      .orderBy('t.updated_at', 'desc');

    const authorizedRows = await filterAuthorizedTickets(trx, authorizationContext, rows);

    return authorizedRows.map((ticket: any): ITicketListItem => {
      const {
        status_id,
        priority_id,
        board_id,
        category_id,
        entered_by,
        status_name,
        priority_name,
        priority_color,
        board_name,
        category_name,
        client_name,
        entered_by_name,
        assigned_to_name,
        assigned_team_name,
        bundle_master_ticket_number,
        ...rest
      } = ticket;

      return {
        ...rest,
        status_id: status_id || null,
        priority_id: priority_id || null,
        board_id: board_id || null,
        category_id: category_id || null,
        entered_by: entered_by || null,
        status_name: status_name || 'Unknown',
        priority_name: priority_name || 'Unknown',
        priority_color: priority_color || '#6B7280',
        board_name: board_name || 'Unknown',
        category_name: category_name || 'Unknown',
        client_name: client_name || 'Unknown',
        entered_by_name: entered_by_name || 'Unknown',
        assigned_to_name: assigned_to_name || 'Unknown',
        assigned_team_name: assigned_team_name || null,
        // Children are not masters; keep these fields stable for the list UI.
        bundle_child_count: 0,
        bundle_distinct_client_count: 0,
        bundle_master_ticket_number: bundle_master_ticket_number ?? null,
      };
    });
  });
});

/**
 * Legacy wrapper for cursor-based pagination - kept for backward compatibility
 * @deprecated Use getTicketsForList with page-based pagination instead
 */
export const getTicketsForListWithCursor = withAuth(async (
  _user,
  _ctx,
  filters: ITicketListFilters,
  cursor?: string,
  limit: number = 50
): Promise<{ tickets: ITicketListItem[], nextCursor: string | null }> => {
  // For backward compatibility, we'll use page 1 with the specified limit
  // This doesn't support cursor pagination anymore, but prevents breaking existing code
  const result = await getTicketsForList(filters, 1, limit);

  return {
    tickets: result.tickets,
    nextCursor: null // No more cursor-based pagination
  };
});

/**
 * Get the previous and next ticket IDs relative to the current ticket,
 * using the same filters and sort order as the ticket list.
 * Used for prev/next navigation on the ticket detail page.
 */
export const getAdjacentTicketIds = withAuth(async (
  user,
  { tenant },
  currentTicketId: string,
  filters: ITicketListFilters
): Promise<{
  prevTicketId: string | null;
  nextTicketId: string | null;
  prevTicketNumber: string | null;
  nextTicketNumber: string | null;
  currentPosition: number;
  totalCount: number;
}> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'read', trx)) {
      throw new Error('Permission denied: Cannot view tickets');
    }

    const validatedFilters = cleanFilterValues(
      validateData(ticketListFiltersSchema, filters) as ITicketListFilters
    );

    const { builder: baseQuery } = await buildTicketListBaseQuery(trx, tenant, user, validatedFilters);
    const authorizationContext = await createTicketAuthorizationContext(
      trx,
      tenant,
      user as IUserWithRoles
    );
    const scopedBaseQuery = baseQuery.clone();
    const authSqlResult = applyTicketReadAuthorizationSql(scopedBaseQuery, trx, tenant, authorizationContext);

    if (authSqlResult.supported) {
      const sortOrderBy = getTicketListSortOrderByClause(validatedFilters);
      const innerQuery = scopedBaseQuery
        .clone()
        .clearSelect()
        .clearOrder()
        .select(
          't.ticket_id',
          't.ticket_number',
          trx.raw(`LAG(t.ticket_id) OVER (ORDER BY ${sortOrderBy}) as prev_ticket_id`),
          trx.raw(`LAG(t.ticket_number) OVER (ORDER BY ${sortOrderBy}) as prev_ticket_number`),
          trx.raw(`LEAD(t.ticket_id) OVER (ORDER BY ${sortOrderBy}) as next_ticket_id`),
          trx.raw(`LEAD(t.ticket_number) OVER (ORDER BY ${sortOrderBy}) as next_ticket_number`),
          trx.raw(`ROW_NUMBER() OVER (ORDER BY ${sortOrderBy}) as rn`),
          trx.raw('COUNT(*) OVER () as total_count')
        );

      const results = await trx
        .select('*')
        .from(innerQuery.as('windowed'))
        .where('ticket_id', currentTicketId);

      if (results.length === 0) {
        const countRow = await scopedBaseQuery
          .clone()
          .clearSelect()
          .clearOrder()
          .countDistinct<{ count: string | number }[]>({ count: 't.ticket_id' })
          .first();

        return {
          prevTicketId: null,
          nextTicketId: null,
          prevTicketNumber: null,
          nextTicketNumber: null,
          currentPosition: 0,
          totalCount: Number((countRow as { count?: string | number } | undefined)?.count ?? 0),
        };
      }

      const row = results[0];
      return {
        prevTicketId: row.prev_ticket_id ?? null,
        nextTicketId: row.next_ticket_id ?? null,
        prevTicketNumber: row.prev_ticket_number ?? null,
        nextTicketNumber: row.next_ticket_number ?? null,
        currentPosition: Number.parseInt(String(row.rn), 10),
        totalCount: Number.parseInt(String(row.total_count), 10),
      };
    }

    const orderedRows = await applyTicketListSort(
      baseQuery.clone().clearSelect().select('t.ticket_id', 't.ticket_number', 't.entered_by', 't.assigned_to', 't.client_id', 't.board_id', 't.assigned_team_id'),
      validatedFilters
    );
    const authorizedRows = await filterAuthorizedTickets(trx, authorizationContext, orderedRows);
    const currentIndex = authorizedRows.findIndex((row) => row.ticket_id === currentTicketId);

    if (currentIndex === -1) {
      return {
        prevTicketId: null,
        nextTicketId: null,
        prevTicketNumber: null,
        nextTicketNumber: null,
        currentPosition: 0,
        totalCount: authorizedRows.length,
      };
    }

    const prevRow = currentIndex > 0 ? authorizedRows[currentIndex - 1] : null;
    const nextRow = currentIndex < authorizedRows.length - 1 ? authorizedRows[currentIndex + 1] : null;

    return {
      prevTicketId: prevRow?.ticket_id ?? null,
      nextTicketId: nextRow?.ticket_id ?? null,
      prevTicketNumber: prevRow?.ticket_number ?? null,
      nextTicketNumber: nextRow?.ticket_number ?? null,
      currentPosition: currentIndex + 1,
      totalCount: authorizedRows.length,
    };
  });
});
