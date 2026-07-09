'use server'

import type {
  ITicket,
  ITicketListItem,
  ITicketListFilters,
  IAgentSchedule,
  ITicketResource,
  IUser,
  IUserWithRoles,
  PendingTag,
  TicketResponseState,
} from '@alga-psa/types';
import { TICKET_ORIGINS } from '@alga-psa/types';
import Ticket from '../models/ticket';
import { safeRevalidatePath as revalidatePath } from '../lib/safeRevalidate';
import { getTicketAttributes } from '@alga-psa/auth/actions';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb, withTransaction, registerAfterCommit } from '@alga-psa/db';
import { Knex } from 'knex';
import { deleteEntityWithValidation } from '@alga-psa/core/server';
import { deleteTicketChildRecords } from '../lib/deleteTicketChildRecords';
import { createTagsForEntityWithTransaction, findTagsByEntityIds, isTagActionError } from '@alga-psa/tags/actions';
import { assignTeamToTicket, removeTeamFromTicket } from './teamAssignmentActions';
import type { DeletionValidationResult } from '@alga-psa/types';
import {
  ticketSchema,
  ticketUpdateSchema,
  ticketAttributesQuerySchema,
  ticketListItemSchema,
  ticketListFiltersSchema
} from '../schemas/ticket.schema';
import { z } from 'zod';
import { validateData } from '@alga-psa/validation';
import { publishEvent, publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { getEventBus } from '@alga-psa/event-bus';
import {
  TicketCreatedEvent,
  TicketUpdatedEvent,
  TicketClosedEvent,
  TicketResponseStateChangedEvent
} from '@alga-psa/event-bus/events';

import { TicketModel, CreateTicketInput } from '@alga-psa/shared/models/ticketModel';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  TICKET_ACTIVITY_SOURCE,
  writeTicketActivity,
} from '@alga-psa/shared/lib/ticketActivity';
import { TicketModelEventPublisher } from '../lib/adapters/TicketModelEventPublisher';
import { TicketModelAnalyticsTracker } from '../lib/adapters/TicketModelAnalyticsTracker';
import { calculateItilPriority } from '@alga-psa/tickets/lib/itilUtils';
import { enforceTicketCloseRules, TicketCloseValidationError, type CloseRuleFailure } from '../lib/validateTicketClosure';
import { applyMatchingChecklistTemplates } from '@alga-psa/shared/lib/ticketChecklists';
import { withAuth } from '@alga-psa/auth';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  type AuthorizationRecord,
  type AuthorizationSubject,
} from '@alga-psa/authorization/kernel';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';
import { buildTicketTransitionWorkflowEvents } from '../lib/workflowTicketTransitionEvents';
import { buildTicketCommunicationWorkflowEvents } from '../lib/workflowTicketCommunicationEvents';
import { getTicketOrigin, type ResolvedTicketOrigin } from '../lib/ticketOrigin';
import { getClientContactVisibilityContext } from '../lib/clientPortalVisibility.server';
import { updateTicketWithCache, updateTicketInTransaction } from './optimizedTicketActions';
import {
  buildTicketResolutionSlaStageCompletionEvent,
  buildTicketResolutionSlaStageEnteredEvent,
} from '../lib/workflowTicketSlaStageEvents';
import {
  parseTicketStatusFilterValue,
  shouldApplyOpenOnlyStatusFilter,
} from '../lib/ticketStatusFilter';
import { ticketActionErrorFrom, type TicketActionError } from './ticketActionErrors';
// SLA cancellation is injected by the composition layer to avoid tickets→sla cross-package violation
let _cancelSlaFn: ((tenantId: string, ticketId: string) => Promise<void>) | null = null;

export async function registerSlaCancellation(fn: (tenantId: string, ticketId: string) => Promise<void>): Promise<void> {
  _cancelSlaFn = fn;
}

function ticketBulkFailureMessage(error: unknown, fallback: string): string {
  const expected = ticketActionErrorFrom(error);
  if (expected) {
    const candidate = expected as unknown as { actionError?: unknown; permissionError?: unknown };
    return typeof candidate.actionError === 'string'
      ? candidate.actionError
      : String(candidate.permissionError ?? fallback);
  }

  return fallback;
}

function isTicketActionError(value: unknown): value is TicketActionError {
  const candidate = value as Record<string, unknown>;
  return (
    typeof value === 'object' &&
    value !== null &&
    (
      typeof candidate.actionError === 'string' ||
      typeof candidate.permissionError === 'string'
    )
  );
}

function ticketBulkFailuresForAll(ticketIds: string[], message: string): Array<{ ticketId: string; message: string }> {
  return ticketIds.map((ticketId) => ({ ticketId, message }));
}

// Email event channel constant - inlined to avoid circular dependency with notifications
// Must match the value in @alga-psa/notifications/emailChannel
const EMAIL_EVENT_CHANNEL = 'emailservice::v7';
function getEmailEventChannel(): string {
  return EMAIL_EVENT_CHANNEL;
}

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table) as Knex.QueryBuilder;
}

function captureAnalytics(_event: string, _properties?: Record<string, any>, _userId?: string): void {
  // Intentionally no-op: avoid pulling analytics (and its tenancy/client-portal deps) into tickets.
}

function extractRoleIdsFromUser(user: unknown): string[] {
  const roles = (user as { roles?: unknown }).roles;
  if (!Array.isArray(roles)) {
    return [];
  }

  return roles
    .map((role) => {
      if (typeof role === 'string') {
        return role;
      }
      if (role && typeof role === 'object' && 'role_id' in role) {
        const roleId = (role as { role_id?: unknown }).role_id;
        return typeof roleId === 'string' ? roleId : null;
      }
      return null;
    })
    .filter((value): value is string => Boolean(value));
}

async function resolveAuthorizationSubjectForUser(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles
): Promise<AuthorizationSubject> {
  let roleIds = extractRoleIdsFromUser(user);
  if (roleIds.length === 0) {
    try {
      const roleRows = await tenantScopedTable(trx, 'user_roles', tenant)
        .where({ user_id: user.user_id })
        .select<{ role_id: string }[]>('role_id');
      roleIds = roleRows.map((row) => row.role_id);
    } catch {
      roleIds = [];
    }
  }

  let teamRows: Array<{ team_id: string }> = [];
  let managedRows: Array<{ user_id: string }> = [];
  try {
    teamRows = await tenantScopedTable(trx, 'team_members', tenant)
      .where({ user_id: user.user_id })
      .select<{ team_id: string }[]>('team_id');
  } catch {
    teamRows = [];
  }
  try {
    managedRows = await tenantScopedTable(trx, 'users', tenant)
      .where({ reports_to: user.user_id })
      .select<{ user_id: string }[]>('user_id');
  } catch {
    managedRows = [];
  }

  return {
    tenant,
    userId: user.user_id,
    userType: user.user_type,
    roleIds,
    teamIds: teamRows.map((row) => row.team_id),
    managedUserIds: managedRows.map((row) => row.user_id),
    clientId: user.clientId ?? null,
    portfolioClientIds: [],
  };
}

function toTicketAuthorizationRecord(
  ticket: Partial<ITicket>
): AuthorizationRecord {
  // Only the primary assignee grants ticket read authorization. Do not trust
  // `ticket_resources.additional_user_id` as an authorization assignment because
  // time-entry workflows can create those rows without ticket row-level access.
  const assignees = new Set<string>();
  if (ticket.assigned_to) assignees.add(ticket.assigned_to);
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
    // Fail closed for client portal users when visibility context cannot be resolved safely.
    return [];
  }
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

// Helper function to publish response state change events
async function publishResponseStateChangedEvent(
  tenantId: string,
  ticketId: string,
  userId: string | null,
  previousState: TicketResponseState,
  newState: TicketResponseState,
  trigger: 'comment' | 'manual' | 'close'
) {
  // Only publish if there's an actual change
  if (previousState === newState) {
    return;
  }

  try {
    await publishEvent({
      eventType: 'TICKET_RESPONSE_STATE_CHANGED',
      payload: {
        tenantId,
        ticketId,
        userId,
        previousState,
        newState,
        trigger
      }
    });
    console.log(`[publishResponseStateChangedEvent] Published event: ${previousState} -> ${newState} (trigger: ${trigger})`);
  } catch (error) {
    console.error(`[publishResponseStateChangedEvent] Failed to publish event:`, error);
    // Don't throw - allow the operation to succeed even if event publishing fails
  }
}
interface CreateTicketFromAssetData {
    title: string;
    description: string;
    priority_id: string;
    status_id: string;
    board_id: string;
    asset_id: string;
    client_id: string;
}

export const createTicketFromAsset = withAuth(async (user, { tenant }, data: CreateTicketFromAssetData): Promise<ITicket | TicketActionError> => {
    try {
        const {knex: db} = await createTenantKnex();

        const result = await withTransaction(db, async (trx) => {
            // Server-specific: Check permissions
            if (!await hasPermission(user, 'ticket', 'create', trx)) {
                throw new Error('Permission denied: Cannot create ticket');
            }

            // Server-specific: Create adapters for dependency injection.
            // Passing trx defers event publishing until the commit.
            const eventPublisher = new TicketModelEventPublisher(trx);
            const analyticsTracker = new TicketModelAnalyticsTracker();

            // Use shared TicketModel for asset ticket creation
            const ticketResult = await TicketModel.createTicketFromAsset(
                data,
                user.user_id,
                tenant,
                trx,
                eventPublisher,
                analyticsTracker
            );

            // Server-specific: Create the asset association
            await tenantScopedTable(trx, 'asset_associations', tenant).insert({
              tenant,
              asset_id: data.asset_id,
              entity_id: ticketResult.ticket_id,
              entity_type: 'ticket',
              relationship_type: 'affected',
              created_by: user.user_id,
              created_at: new Date().toISOString(),
            });

            // Server-specific: Get full ticket data for return
            const fullTicket = await tenantScopedTable(trx, 'tickets', tenant)
                .where({ ticket_id: ticketResult.ticket_id })
                .first();

            if (!fullTicket) {
                throw new Error('Created ticket could not be reloaded after insert.');
            }

            const enteredSlaEvent = buildTicketResolutionSlaStageEnteredEvent({
              tenantId: tenant,
              ticketId: ticketResult.ticket_id,
              itilPriorityLevel: fullTicket.itil_priority_level,
              enteredAt: fullTicket.entered_at,
            });
            if (enteredSlaEvent) {
              registerAfterCommit(trx, () =>
                publishWorkflowEvent({
                  eventType: enteredSlaEvent.eventType,
                  payload: enteredSlaEvent.payload,
                  ctx: {
                    tenantId: tenant,
                    actor: { actorType: 'USER' as const, actorUserId: user.user_id },
                    occurredAt: (fullTicket.entered_at instanceof Date
                      ? fullTicket.entered_at.toISOString()
                      : fullTicket.entered_at) || new Date().toISOString(),
                  },
                  idempotencyKey: enteredSlaEvent.idempotencyKey,
                }),
                `${enteredSlaEvent.eventType} ticket=${ticketResult.ticket_id}`
              );
            }

            return convertDates(fullTicket);
        });

        // Server-specific: Revalidate cache paths
        revalidatePath('/msp/tickets');
        revalidatePath('/msp/assets');

        return result;
    } catch (error) {
        const expected = ticketActionErrorFrom(error);
        if (expected) {
            return expected;
        }
        console.error('Error creating ticket from asset:', error);
        throw error;
    }
});


export const addTicket = withAuth(async (user, { tenant }, data: FormData): Promise<ITicket | TicketActionError | undefined> => {
  try {
    const {knex: db} = await createTenantKnex();

    return await withTransaction(db, async (trx) => {
      // Server-specific: Check permissions
      if (!await hasPermission(user, 'ticket', 'create', trx)) {
        throw new Error('Permission denied: Cannot create ticket');
      }

      // Server-specific: Parse FormData
      const contact_name_id = data.get('contact_name_id');
      const category_id = data.get('category_id');
      const subcategory_id = data.get('subcategory_id');
      const description = data.get('description');
      const location_id = data.get('location_id');
      const asset_id = data.get('asset_id');
      const due_date = data.get('due_date');

      // ITIL-specific fields
      const itil_impact = data.get('itil_impact');
      const itil_urgency = data.get('itil_urgency');

      // For ITIL boards, calculate priority and map to standard_priorities record
      let finalPriorityId = data.get('priority_id') as string;

      if (itil_impact && itil_urgency) {
        // Calculate ITIL priority level
        const priorityLevel = calculateItilPriority(parseInt(itil_impact as string), parseInt(itil_urgency as string));

        // Map priority level to ITIL priority name pattern
        const priorityNamePattern = `P${priorityLevel} -%`;

        // Get the corresponding ITIL priority record from tenant's priorities table
        const itilPriorityRecord = await tenantScopedTable(trx, 'priorities', tenant)
          .where('is_from_itil_standard', true)
          .where('priority_name', 'like', priorityNamePattern)
          .where('item_type', 'ticket')
          .first();

        if (itilPriorityRecord) {
          finalPriorityId = itilPriorityRecord.priority_id;
        }
      }

      // Convert FormData to CreateTicketInput format
      const createTicketInput: CreateTicketInput = {
        title: data.get('title') as string,
        board_id: data.get('board_id') as string,
        client_id: data.get('client_id') as string,
        location_id: location_id === '' ? undefined : (location_id as string),
        contact_id: contact_name_id === '' ? undefined : (contact_name_id as string), // Note: maps to contact_name_id
        status_id: data.get('status_id') as string,
        assigned_to: data.get('assigned_to') as string,
        description: description as string,
        category_id: category_id === '' ? undefined : (category_id as string),
        subcategory_id: subcategory_id === '' ? undefined : (subcategory_id as string),
        priority_id: finalPriorityId, // Always use priority_id (mapped from ITIL if needed)
        // ITIL-specific fields (kept for UI display)
        itil_impact: itil_impact ? parseInt(itil_impact as string) : undefined,
        itil_urgency: itil_urgency ? parseInt(itil_urgency as string) : undefined,
        due_date: due_date === '' ? undefined : (due_date as string),
        entered_by: user.user_id,
        source: 'web_app',
        ticket_origin: TICKET_ORIGINS.INTERNAL,
      };

      // Server-specific: Create adapters for dependency injection.
      // Passing trx defers event publishing until the commit.
      const eventPublisher = new TicketModelEventPublisher(trx);
      const analyticsTracker = new TicketModelAnalyticsTracker();

      // Use shared TicketModel with retry logic
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

      // Server-specific: Create asset association if asset_id is provided
      if (asset_id) {
        await tenantScopedTable(trx, 'asset_associations', tenant).insert({
          tenant,
          asset_id: asset_id as string,
          entity_id: ticketResult.ticket_id,
          entity_type: 'ticket',
          relationship_type: 'affected',
          created_by: user.user_id,
          created_at: new Date().toISOString(),
        });
      }

      // Server-specific: Handle assigned ticket event
      if (createTicketInput.assigned_to) {
        registerAfterCommit(trx, () =>
          publishEvent({
            eventType: 'TICKET_ASSIGNED',
            payload: {
              tenantId: tenant,
              ticketId: ticketResult.ticket_id,
              userId: createTicketInput.assigned_to,  // The user being assigned to the ticket
              assignedByUserId: user.user_id  // The user who created and assigned the ticket
            }
          }),
          `TICKET_ASSIGNED ticket=${ticketResult.ticket_id}`
        );
      }

      // Server-specific: Get full ticket data for return
      const fullTicket = await tenantScopedTable(trx, 'tickets', tenant)
        .where({ ticket_id: ticketResult.ticket_id })
        .first();

      if (!fullTicket) {
        throw new Error('Created ticket could not be reloaded after insert.');
      }

      // Write activity-timeline entry for ticket creation. The details
      // capture a small snapshot of the create payload so the UI can show
      // "Alex created the ticket on board X with status Y" without needing
      // a separate join.
      await writeTicketActivity(trx, {
        tenant,
        ticketId: ticketResult.ticket_id,
        eventType: TICKET_ACTIVITY_EVENT.CREATED,
        entityType: TICKET_ACTIVITY_ENTITY.TICKET,
        entityId: ticketResult.ticket_id,
        actor: {
          actorType: TICKET_ACTIVITY_ACTOR.USER,
          userId: user.user_id,
        },
        source: TICKET_ACTIVITY_SOURCE.UI,
        occurredAt:
          typeof fullTicket.entered_at === 'string'
            ? fullTicket.entered_at
            : fullTicket.entered_at instanceof Date
              ? fullTicket.entered_at.toISOString()
              : new Date().toISOString(),
        details: {
          title: fullTicket.title,
          board_id: fullTicket.board_id,
          status_id: fullTicket.status_id,
          priority_id: fullTicket.priority_id,
          assigned_to: fullTicket.assigned_to,
          client_id: fullTicket.client_id,
          ticket_origin: fullTicket.ticket_origin ?? TICKET_ORIGINS.INTERNAL,
        },
      });

      const enteredSlaEvent = buildTicketResolutionSlaStageEnteredEvent({
        tenantId: tenant,
        ticketId: ticketResult.ticket_id,
        itilPriorityLevel: fullTicket.itil_priority_level,
        enteredAt: fullTicket.entered_at,
      });
      if (enteredSlaEvent) {
        registerAfterCommit(trx, () =>
          publishWorkflowEvent({
            eventType: enteredSlaEvent.eventType,
            payload: enteredSlaEvent.payload,
            ctx: {
              tenantId: tenant,
              actor: { actorType: 'USER' as const, actorUserId: user.user_id },
              occurredAt: (fullTicket.entered_at instanceof Date
                ? fullTicket.entered_at.toISOString()
                : fullTicket.entered_at) || new Date().toISOString(),
            },
            idempotencyKey: enteredSlaEvent.idempotencyKey,
          }),
          `${enteredSlaEvent.eventType} ticket=${ticketResult.ticket_id}`
        );
      }

      // Server-specific: Revalidate cache paths
      revalidatePath('/msp/tickets');

      return convertDates(fullTicket);
    });
  } catch (error) {
    const expected = ticketActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error in addTicket:', error);
    throw error;
  }
});

export const fetchTicketAttributes = withAuth(async (user, { tenant }, ticketId: string) => {
  try {
    // Validate ticket ID
    const { ticketId: validatedTicketId } = validateData(
      ticketAttributesQuerySchema,
      { ticketId }
    );

    const {knex: db} = await createTenantKnex();

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'ticket', 'read', trx)) {
        throw new Error('Permission denied: Cannot view ticket attributes');
      }

      const attributes = await getTicketAttributes(validatedTicketId);

      const ticketExists = await tenantScopedTable(trx, 'tickets', tenant)
        .where({
          ticket_id: validatedTicketId
        })
        .first();

      if (!ticketExists) {
        throw new Error('Ticket not found or does not belong to the current tenant');
      }

      return { success: true, attributes };
    });

    return result;
  } catch (error) {
    const expected = ticketActionErrorFrom(error);
    if (expected) {
      const candidate = expected as unknown as { actionError?: unknown; permissionError?: unknown };
      return {
        success: false,
        error: typeof candidate.permissionError === 'string'
          ? candidate.permissionError
          : String(candidate.actionError ?? 'Failed to fetch ticket attributes'),
      };
    }
    console.error(error);
    return { success: false, error: 'Failed to fetch ticket attributes' };
  }
});

export interface UpdateTicketOptions {
  /** Close despite unmet close rules; honored only with ticket:close_override. */
  overrideCloseRules?: boolean;
  overrideCloseRulesReason?: string | null;
}

export const updateTicket = withAuth(async (user, { tenant }, id: string, data: Partial<ITicket>, options?: UpdateTicketOptions): Promise<'success' | TicketActionError> => {
  try {
    // Validate update data
    const validatedData = validateData(ticketUpdateSchema, data);

    const {knex: db} = await createTenantKnex();

    const result = await db.transaction(async (trx) => {
      if (!await hasPermission(user, 'ticket', 'update', trx)) {
        throw new Error('Permission denied: Cannot update ticket');
      }

      // Get current ticket state before update
      const currentTicket = await tenantScopedTable(trx, 'tickets', tenant)
        .where({ ticket_id: id })
        .first();

      if (!currentTicket) {
        throw new Error('Ticket not found');
      }

      // Clean up the data before update
      const updateData = { ...validatedData };

      // Handle null values for category, subcategory, location, and due_date
      if ('category_id' in updateData && !updateData.category_id) {
        updateData.category_id = null;
      }
      if ('subcategory_id' in updateData && !updateData.subcategory_id) {
        updateData.subcategory_id = null;
      }
      if ('location_id' in updateData && !updateData.location_id) {
        updateData.location_id = null;
      }
      if ('due_date' in updateData && !updateData.due_date) {
        updateData.due_date = null;
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
          const itilPriorityRecord = await tenantScopedTable(trx, 'priorities', tenant)
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

      // Validate location belongs to the client if provided
      if ('location_id' in updateData && updateData.location_id) {
        const clientId = 'client_id' in updateData ? updateData.client_id : currentTicket.client_id;
        const location = await tenantScopedTable(trx, 'client_locations', tenant)
          .where({
            location_id: updateData.location_id,
            client_id: clientId
          })
          .first();

        if (!location) {
          throw new Error('Invalid location: Location does not belong to the selected client');
        }
      }

      // Check if we're updating the assigned_to field
      const isChangingAssignment = 'assigned_to' in updateData &&
                                  updateData.assigned_to !== currentTicket.assigned_to;
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
          const subcategory = await tenantScopedTable(trx, 'categories', tenant)
            .where({ category_id: newSubcategoryId })
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
      const oldStatus = await tenantScopedTable(trx, 'statuses', tenant)
        .where({
          status_id: currentTicket.status_id
        })
        .first();

      // Pre-close validation gates: when this update flips the ticket from an
      // open to a closed status, enforce the board's close rules before any
      // writes. Throws TicketCloseValidationError (aborting the transaction)
      // unless gates pass or a permissioned override applies.
      if ('status_id' in updateData && updateData.status_id && updateData.status_id !== currentTicket.status_id) {
        const nextStatus = await tenantScopedTable(trx, 'statuses', tenant)
          .where({ status_id: updateData.status_id })
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
            actor: {
              actorType: TICKET_ACTIVITY_ACTOR.USER,
              userId: user.user_id,
            },
            source: TICKET_ACTIVITY_SOURCE.UI,
          });
        }
      }

      let updatedTicket;

      // If we're changing the assigned_to field, we need to handle the ticket_resources table
      if (isChangingAssignment) {
        // Step 1: Delete any ticket_resources where the new assigned_to is an additional_user_id
        // to avoid constraint violations after the update
        await tenantScopedTable(trx, 'ticket_resources', tenant)
          .where({
            ticket_id: id,
            additional_user_id: updateData.assigned_to
          })
          .delete();

        // Step 2: Get existing resources with the old assigned_to value
        const existingResources = await tenantScopedTable(trx, 'ticket_resources', tenant)
          .where({
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
          await tenantScopedTable(trx, 'ticket_resources', tenant)
            .where({
              ticket_id: id,
              assigned_to: currentTicket.assigned_to
            })
            .delete();
        }

        // Step 5: Update the ticket with the new assigned_to
        const [updated] = await tenantScopedTable(trx, 'tickets', tenant)
          .where({ ticket_id: id })
          .update(updateData)
          .returning('*');

        // Step 6: Re-create the resources with the new assigned_to
        for (const resourceData of resourcesToRecreate) {
          await tenantScopedTable(trx, 'ticket_resources', tenant).insert({
            ...resourceData,
            assigned_to: updateData.assigned_to
          });
        }

        updatedTicket = updated;
      } else {
        // Regular update without changing assignment
        const [updated] = await tenantScopedTable(trx, 'tickets', tenant)
          .where({ ticket_id: id })
          .update(updateData)
          .returning('*');

        updatedTicket = updated;
      }

    if (!updatedTicket) {
      throw new Error('Ticket not found or update failed');
    }

      // Get the new status if it was updated
      const newStatus = updateData.status_id ?
        await tenantScopedTable(trx, 'statuses', tenant)
          .where({
            status_id: updateData.status_id
          })
          .first() :
        oldStatus;

      // Emit expanded domain transition events for workflow v2 triggers.
      // These events are additive and emitted in addition to legacy TICKET_* events.
      const occurredAt = new Date().toISOString();
      const workflowCtx = {
        tenantId: tenant,
        actor: { actorType: 'USER' as const, actorUserId: user.user_id },
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

      if (updateData.due_date !== undefined && updateData.due_date !== currentTicket.due_date) {
        structuredChanges.due_date = {
          old: currentTicket.due_date,
          new: updateData.due_date
        };
      }

      // Keep the ticket row's denormalized close flag aligned with the selected status.
      if (updateData.status_id !== undefined && updateData.status_id !== currentTicket.status_id) {
        const nextIsClosed = !!newStatus?.is_closed;
        await tenantScopedTable(trx, 'tickets', tenant)
          .where({ ticket_id: id })
          .update({ is_closed: nextIsClosed });
        updatedTicket.is_closed = nextIsClosed;
      }

      // Record closed_at / closed_by when transitioning to/from closed status
      if (newStatus?.is_closed && !oldStatus?.is_closed) {
        await tenantScopedTable(trx, 'tickets', tenant)
          .where({ ticket_id: id })
          .update({ closed_at: occurredAt, closed_by: user.user_id });
        updatedTicket.closed_at = occurredAt;
        updatedTicket.closed_by = user.user_id;
      } else if (!newStatus?.is_closed && oldStatus?.is_closed) {
        await tenantScopedTable(trx, 'tickets', tenant)
          .where({ ticket_id: id })
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
          }, {
            actor: { actorType: TICKET_ACTIVITY_ACTOR.USER, userId: user.user_id },
            source: TICKET_ACTIVITY_SOURCE.UI,
          });
        } catch (error) {
          console.error('Failed to auto-apply checklist templates:', error);
        }
      }

      // Handle response_state changes
      const previousResponseState = currentTicket.response_state as TicketResponseState;
      let responseStateChanged = false;
      let responseTrigger: 'manual' | 'close' = 'manual';

      // If ticket is being closed and has a response state, clear it
      if (newStatus?.is_closed && !oldStatus?.is_closed && currentTicket.response_state) {
        // Clear response_state on close
        await tenantScopedTable(trx, 'tickets', tenant)
          .where({ ticket_id: id })
          .update({ response_state: null });
        updatedTicket.response_state = null;
        responseStateChanged = true;
        responseTrigger = 'close';
      }

      // Check if response_state was explicitly changed in the update
      if ('response_state' in updateData && updateData.response_state !== currentTicket.response_state) {
        responseStateChanged = true;
        responseTrigger = 'manual';
      }

      // Publish response state change event if needed
      if (responseStateChanged) {
        const newResponseState = updatedTicket.response_state as TicketResponseState;
        await publishResponseStateChangedEvent(
          tenant,
          id,
          user.user_id,
          previousResponseState,
          newResponseState,
          responseTrigger
        );
      }

      // Publish appropriate event based on the update
      if (newStatus?.is_closed && !oldStatus?.is_closed) {
        // Ticket was closed
        await publishWorkflowEvent({
          eventType: 'TICKET_CLOSED',
          payload: {
            ticketId: id,
            userId: user.user_id,
            closedByUserId: user.user_id,
            closedAt: occurredAt,
            changes: structuredChanges,
          },
          ctx: workflowCtx,
          eventName: 'Ticket Closed',
          fromState: currentTicket.status_id,
          toState: updatedTicket.status_id,
        });

        const slaCompletionEvent = buildTicketResolutionSlaStageCompletionEvent({
          tenantId: tenant,
          ticketId: id,
          itilPriorityLevel: currentTicket.itil_priority_level,
          enteredAt: currentTicket.entered_at,
          closedAt: occurredAt,
        });
        if (slaCompletionEvent) {
          await publishWorkflowEvent({
            eventType: slaCompletionEvent.eventType,
            payload: slaCompletionEvent.payload,
            ctx: workflowCtx,
            idempotencyKey: slaCompletionEvent.idempotencyKey,
          });
        }

        // Track ticket resolved analytics
        captureAnalytics('ticket_resolved', {
          time_to_resolution: currentTicket.entered_at ?
            Math.round((Date.now() - new Date(currentTicket.entered_at).getTime()) / 1000 / 60) : 0, // minutes
          priority_id: updatedTicket.priority_id,
          category_id: updatedTicket.category_id,
          had_assignment: !!updatedTicket.assigned_to,
        }, user.user_id);
      } else if (updateData.assigned_to && updateData.assigned_to !== currentTicket.assigned_to) {
        // Ticket was assigned - userId should be the user being assigned, not the one making the update
        await publishWorkflowEvent({
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
        });

        // Track ticket assignment analytics
        captureAnalytics('ticket_assigned', {
          was_reassignment: !!currentTicket.assigned_to,
          time_to_assignment: currentTicket.entered_at && !currentTicket.assigned_to ?
            Math.round((Date.now() - new Date(currentTicket.entered_at).getTime()) / 1000 / 60) : 0, // minutes
        }, user.user_id);
      } else {
        // Regular update
        await publishWorkflowEvent({
          eventType: 'TICKET_UPDATED',
          payload: {
            ticketId: id,
            userId: user.user_id,
            updatedByUserId: user.user_id,
            changes: structuredChanges,
          },
          ctx: workflowCtx,
          eventName: 'Ticket Updated',
        });
      }

      // Track general ticket update analytics
      captureAnalytics('ticket_updated', {
        fields_updated: Object.keys(updateData),
        updated_priority: 'priority_id' in updateData,
        updated_status: 'status_id' in updateData,
        updated_category: 'category_id' in updateData || 'subcategory_id' in updateData,
        updated_assignment: 'assigned_to' in updateData,
      }, user.user_id);

      return updatedTicket;
    });

    return 'success';
  } catch (error) {
    const expected = ticketActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error(error);
    throw error;
  }
});

export const getTickets = withAuth(async (user, { tenant }): Promise<ITicket[] | TicketActionError> => {
  try {
    const {knex} = await createTenantKnex();

    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'ticket', 'read', trx)) {
        throw new Error('Permission denied: Cannot view tickets');
      }

      const tickets = await Ticket.getAll(trx, tenant);
      // Convert dates and handle null fields
      const processedTickets = tickets.map((ticket: any): any => {
        const converted = convertDates(ticket);
        // Clean up null values for optional fields
        if (converted.priority_id === null) {
          converted.priority_id = undefined;
        }
        if (converted.itil_impact === null) {
          converted.itil_impact = undefined;
        }
        if (converted.itil_urgency === null) {
          converted.itil_urgency = undefined;
        }
        if (converted.itil_priority_level === null) {
          converted.itil_priority_level = undefined;
        }
        if (converted.estimated_hours === null) {
          converted.estimated_hours = undefined;
        }
        if (converted.due_date === null) {
          converted.due_date = undefined;
        }
        return converted;
      });
      return processedTickets as ITicket[];
    });

    return result;
  } catch (error) {
    const expected = ticketActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Failed to fetch tickets:', error);
    throw error;
  }
});

export const getTicketsForList = withAuth(async (user, { tenant }, filters: ITicketListFilters): Promise<ITicketListItem[] | TicketActionError> => {
  try {
    const validatedFilters = validateData(ticketListFiltersSchema, filters) as ITicketListFilters;
    const parsedStatusFilter = parseTicketStatusFilterValue(validatedFilters.statusId);
    const {knex: db} = await createTenantKnex();

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'ticket', 'read', trx)) {
        throw new Error('Permission denied: Cannot view tickets');
      }

      const authorizationSubject = await resolveAuthorizationSubjectForUser(
        trx,
        tenant,
        user as IUserWithRoles
      );
      const selectedBoardIds = await resolveClientSelectedBoardIds(trx, tenant, user as IUserWithRoles);
      const relationshipRules =
        selectedBoardIds === undefined ? [] : [{ template: 'selected_boards' as const }];
      const authorizationKernel = createAuthorizationKernel({
        builtinProvider: new BuiltinAuthorizationKernelProvider({
          relationshipRules,
        }),
        bundleProvider: new BundleAuthorizationKernelProvider({
          resolveRules: async (input) => {
            try {
              return await resolveBundleNarrowingRulesForEvaluation(trx, input);
            } catch {
              return [];
            }
          },
        }),
        rbacEvaluator: async () => true,
      });
      const requestCache = new RequestLocalAuthorizationCache();

      const tenantFacade = tenantDb(trx, tenant);
      let query = tenantFacade.table('tickets as t')
      .select(
        't.*',
        's.name as status_name',
        'p.priority_name',
        'c.board_name',
        'cat.category_name',
        'co.client_name as client_name',
        trx.raw("CONCAT(u.first_name, ' ', u.last_name) as entered_by_name"),
        trx.raw("CONCAT(au.first_name, ' ', au.last_name) as assigned_to_name")
      );
      tenantFacade.tenantJoin(query, 'statuses as s', 't.status_id', 's.status_id', { type: 'left' });
      tenantFacade.tenantJoin(query, 'priorities as p', 't.priority_id', 'p.priority_id', { type: 'left' });
      tenantFacade.tenantJoin(query, 'boards as c', 't.board_id', 'c.board_id', { type: 'left' });
      tenantFacade.tenantJoin(query, 'categories as cat', 't.category_id', 'cat.category_id', { type: 'left' });
      tenantFacade.tenantJoin(query, 'users as u', 't.entered_by', 'u.user_id', { type: 'left' });
      tenantFacade.tenantJoin(query, 'users as au', 't.assigned_to', 'au.user_id', { type: 'left' });
      tenantFacade.tenantJoin(query, 'clients as co', 't.client_id', 'co.client_id', { type: 'left' });

    // Apply filters
    if (validatedFilters.boardId) {
      query = query.where('t.board_id', validatedFilters.boardId);
    } else if (validatedFilters.boardFilterState !== 'all') {
      const boardSubquery = tenantScopedTable(trx, 'boards', tenant)
        .select('board_id')
        .where('is_inactive', validatedFilters.boardFilterState === 'inactive');

      query = query.whereIn('t.board_id', boardSubquery);
    }

    if (shouldApplyOpenOnlyStatusFilter(validatedFilters.statusId, validatedFilters.showOpenOnly)) {
      query = query.whereExists(
        tenantScopedTable(trx, 'statuses', tenant)
          .select('*')
          .whereRaw('statuses.status_id = t.status_id')
          .andWhere('statuses.is_closed', false)
      );
    } else if (parsedStatusFilter.kind === 'name') {
      query = query.where('s.name', parsedStatusFilter.statusName);
    } else if (parsedStatusFilter.kind === 'id') {
      query = query.where('t.status_id', parsedStatusFilter.statusId);
    }

    if (validatedFilters.priorityId && validatedFilters.priorityId !== 'all') {
      query = query.where('t.priority_id', validatedFilters.priorityId);
    }

    if (validatedFilters.categoryId) {
      if (validatedFilters.categoryId === 'no-category') {
        query = query.whereNull('t.category_id');
      } else if (validatedFilters.categoryId !== 'all') {
        query = query.where('t.category_id', validatedFilters.categoryId);
      }
    }

    if (validatedFilters.clientId) {
      query = query.where('t.client_id', validatedFilters.clientId);
    }

    if ((user as IUserWithRoles).user_type === 'client' && (user as IUserWithRoles).clientId) {
      query = query.where('t.client_id', (user as IUserWithRoles).clientId);
    }

    if (validatedFilters.searchQuery) {
      const searchTerm = `%${validatedFilters.searchQuery}%`;
      query = query.where(function(this: any) {
        this.where('t.title', 'ilike', searchTerm)
            .orWhere('t.ticket_number', 'ilike', searchTerm);
      });
    }

    if (validatedFilters.tags && validatedFilters.tags.length > 0) {
      const tagSubquery = tenantScopedTable(trx, 'tag_mappings as tm', tenant)
        .select('tm.tagged_id')
        .where('tm.tagged_type', 'ticket')
        .whereIn('td.tag_text', validatedFilters.tags as string[]);
      tenantFacade.tenantJoin(tagSubquery, 'tag_definitions as td', 'tm.tag_id', 'td.tag_id');
      query = query.whereIn('t.ticket_id', tagSubquery);
    }

    if (validatedFilters.assignedToMe) {
      const hasProjectRead = await hasPermission(user, 'project', 'read', trx);
      if (!hasProjectRead) {
        const callerUserId = (user as IUserWithRoles).user_id;
        const ticketResourceSubquery = tenantScopedTable(trx, 'ticket_resources', tenant)
          .select('ticket_id')
          .where('additional_user_id', callerUserId);
        const teamMemberSubquery = tenantScopedTable(trx, 'team_members', tenant)
          .select('team_id')
          .where('user_id', callerUserId);
        query = query.where(function(this: any) {
          this.where('t.assigned_to', callerUserId)
            .orWhereIn('t.ticket_id', ticketResourceSubquery)
            .orWhereIn('t.assigned_team_id', teamMemberSubquery);
        });
      }
    }

      const sortBy = validatedFilters.sortBy ?? 'entered_at';
      const sortDirection: 'asc' | 'desc' = validatedFilters.sortDirection ?? 'desc';
      const sortColumnMap: Record<string, { column?: string; rawExpression?: string }> = {
        ticket_number: { column: 't.ticket_number' },
        title: { column: 't.title' },
        status_name: { column: 's.name' },
        priority_name: { column: 'p.priority_name' },
        board_name: { column: 'c.board_name' },
        category_name: { column: 'cat.category_name' },
        client_name: { column: 'co.client_name' },
        entered_at: { column: 't.entered_at' },
        entered_by_name: { rawExpression: "COALESCE(CONCAT(u.first_name, ' ', u.last_name), '')" }
      };
      const selectedSort = sortColumnMap[sortBy] || sortColumnMap.entered_at;

      const tickets = await query
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


      const decisions = await Promise.all(
        tickets.map((ticket: any) =>
          authorizationKernel.authorizeResource({
            subject: authorizationSubject,
            resource: {
              type: 'ticket',
              action: 'read',
              id: ticket.ticket_id,
            },
            record: toTicketAuthorizationRecord(ticket),
            selectedBoardIds,
            requestCache,
            knex: trx,
          })
        )
      );
      const authorizedTickets = tickets.filter((_ticket: any, index: number) => decisions[index]?.allowed);

      // Transform and validate the data
      const ticketListItems = authorizedTickets.map((ticket: any): ITicketListItem => {
        const {
          status_id,
          priority_id,
          board_id,
          category_id,
          entered_by,
          status_name,
          priority_name,
          board_name,
          category_name,
          client_name,
          entered_by_name,
          assigned_to_name,
          ...rest
        } = ticket;

        return {
          status_id: status_id || null,
          priority_id: priority_id || null,
          board_id: board_id || null,
          category_id: category_id || null,
          entered_by: entered_by || null,
          status_name: status_name || 'Unknown',
          priority_name: priority_name || 'Unknown',
          board_name: board_name || 'Unknown',
          category_name: category_name || 'Unknown',
          client_name: client_name || 'Unknown',
          entered_by_name: entered_by_name || 'Unknown',
          assigned_to_name: assigned_to_name || 'Unknown',
          ...convertDates(rest),
          // Convert null ITIL fields to undefined for proper type compatibility
          itil_impact: rest.itil_impact === null || rest.itil_impact === undefined ? undefined : rest.itil_impact,
          itil_urgency: rest.itil_urgency === null || rest.itil_urgency === undefined ? undefined : rest.itil_urgency,
          itil_priority_level: rest.itil_priority_level === null || rest.itil_priority_level === undefined ? undefined : rest.itil_priority_level,
          // Convert null optional fields to undefined for proper type compatibility
          estimated_hours: rest.estimated_hours === null || rest.estimated_hours === undefined ? undefined : rest.estimated_hours,
          due_date: rest.due_date === null || rest.due_date === undefined ? undefined : rest.due_date
        };
      });

      return ticketListItems as ITicketListItem[];
    });

    return result;
  } catch (error) {
    const expected = ticketActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Failed to fetch tickets:', error);
    throw error;
  }
});

export const addTicketComment = withAuth(async (user, { tenant }, ticketId: string, comment: string, isInternal: boolean): Promise<void | TicketActionError> => {
  try {
    const {knex: db} = await createTenantKnex();

    await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'ticket', 'update', trx)) {
        throw new Error('Permission denied: Cannot add comment');
      }

      // Verify ticket exists
      const ticket = await tenantScopedTable(trx, 'tickets', tenant)
      .where({
        ticket_id: ticketId
      })
      .first();

    if (!ticket) {
      throw new Error('Ticket not found');
    }

      // comments.thread_id is NOT NULL, so create the thread row first.
      const idsResult = await trx.raw(
        'SELECT gen_random_uuid() AS comment_id, gen_random_uuid() AS thread_id'
      );
      const generatedIds = idsResult.rows?.[0] as
        | { comment_id: string; thread_id: string }
        | undefined;
      if (!generatedIds?.comment_id || !generatedIds?.thread_id) {
        throw new Error('Database UUID generation did not return comment/thread identifiers.');
      }
      const nowIso = new Date().toISOString();

      await tenantScopedTable(trx, 'comment_threads', tenant).insert({
        tenant,
        thread_id: generatedIds.thread_id,
        ticket_id: ticketId,
        project_task_id: null,
        root_comment_id: generatedIds.comment_id,
        is_internal: isInternal,
        reply_count: 0,
        last_activity_at: nowIso,
        created_at: nowIso,
        created_by: user.user_id || null,
      });

      const [newComment] = await tenantScopedTable(trx, 'comments', tenant).insert({
        tenant,
        comment_id: generatedIds.comment_id,
        thread_id: generatedIds.thread_id,
        ticket_id: ticketId,
        user_id: user.user_id,
        author_type: 'internal',
        note: comment,
        is_internal: isInternal,
        is_resolution: false,
        created_at: nowIso,
      }).returning('*');

      // Publish comment added event
      await publishEvent({
        eventType: 'TICKET_COMMENT_ADDED',
        payload: {
          tenantId: tenant,
          ticketId: ticketId,
          userId: user.user_id,
          comment: {
            id: (newComment as any).comment_id ?? (newComment as any).id,
            content: comment,
            author: `${user.first_name} ${user.last_name}`,
            isInternal
          }
        }
      });

      // Publish workflow v2 ticket message events (additive).
      try {
        const occurredAt = new Date().toISOString();
        const workflowCtx = {
          tenantId: tenant,
          actor: { actorType: 'USER' as const, actorUserId: user.user_id },
          occurredAt,
          correlationId: (newComment as any).comment_id ?? (newComment as any).id,
        };

        const messageId = (newComment as any).comment_id ?? (newComment as any).id;
        if (!messageId) return;
        const createdAt = (newComment as any).created_at ?? occurredAt;
        const events = buildTicketCommunicationWorkflowEvents({
          ticketId,
          messageId,
          visibility: isInternal ? 'internal' : 'public',
          author: { authorType: 'user', authorId: user.user_id },
          channel: 'ui',
          createdAt,
        });

        for (const ev of events) {
          await publishWorkflowEvent({ eventType: ev.eventType, payload: ev.payload, ctx: workflowCtx });
        }
      } catch (eventError) {
        console.error('[addTicketComment] Failed to publish workflow ticket message events:', eventError);
      }
    });
  } catch (error) {
    const expected = ticketActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Failed to add ticket comment:', error);
    throw error;
  }
});

async function performTicketDelete(
  trx: Knex.Transaction,
  ticketId: string,
  tenant: string,
  user: IUser
): Promise<void> {
  if (!await hasPermission(user, 'ticket', 'delete', trx)) {
    throw new Error('Permission denied: Cannot delete ticket');
  }

  const ticket = await tenantScopedTable(trx, 'tickets', tenant)
    .where({
      ticket_id: ticketId
    })
    .first();

  if (!ticket) {
    throw new Error('Ticket not found');
  }

  // Clean up every child row that references the ticket (shared with the REST
  // API delete path in TicketService) before deleting the ticket itself.
  await deleteTicketChildRecords(trx, ticketId, tenant, ticket);

  await tenantScopedTable(trx, 'tickets', tenant)
    .where({ ticket_id: ticketId })
    .delete();

  await publishEvent({
    eventType: 'TICKET_DELETED',
    payload: {
      tenantId: tenant,
      ticketId: ticketId,
      userId: user.user_id
    }
  });

  captureAnalytics('ticket_deleted', {
    was_resolved: !!ticket.closed_at,
    had_comments: false,
    age_in_days: ticket.entered_at ?
      Math.round((Date.now() - new Date(ticket.entered_at).getTime()) / 1000 / 60 / 60 / 24) : 0,
  }, user.user_id);
}

export const deleteTicket = withAuth(async (
  user,
  { tenant },
  ticketId: string
): Promise<DeletionValidationResult & { success: boolean; deleted?: boolean }> => {
  try {
    const { knex } = await createTenantKnex();
    const result = await deleteEntityWithValidation('ticket', ticketId, knex, tenant, async (trx, tenantId) => {
      await performTicketDelete(trx, ticketId, tenantId, user);
    });

    if (result.deleted) {
      try {
        if (_cancelSlaFn) {
          await _cancelSlaFn(tenant, ticketId);
        }
      } catch (error) {
        console.warn('[deleteTicket] Failed to cancel SLA backend workflow:', error);
      }

      revalidatePath('/msp/tickets');
    }

    return {
      ...result,
      success: result.deleted === true,
      deleted: result.deleted
    };
  } catch (error: unknown) {
    console.error('Failed to delete ticket:', error);
    return {
      success: false,
      canDelete: false,
      code: 'VALIDATION_FAILED',
      message: ticketBulkFailureMessage(error, 'Failed to delete ticket'),
      dependencies: [],
      alternatives: []
    };
  }
});

export const deleteTickets = withAuth(async (user, { tenant }, ticketIds: string[]): Promise<{
  deletedIds: string[];
  failed: Array<{ ticketId: string; message: string }>;
}> => {
  const uniqueIds = Array.from(new Set(ticketIds.filter(id => !!id)));

  if (uniqueIds.length === 0) {
    return { deletedIds: [], failed: [] };
  }

  const deletedIds: string[] = [];
  const failed: Array<{ ticketId: string; message: string }> = [];
  const { knex: ticketKnex } = await createTenantKnex();

  for (const ticketId of uniqueIds) {
    try {
      const result = await deleteEntityWithValidation('ticket', ticketId, ticketKnex, tenant, async (trx, tenantId) => {
        await performTicketDelete(trx, ticketId, tenantId, user);
      });

      if (result.deleted) {
        try {
          if (_cancelSlaFn) {
            await _cancelSlaFn(tenant, ticketId);
          }
        } catch (error) {
          console.warn('[deleteTickets] Failed to cancel SLA backend workflow:', error);
        }
        deletedIds.push(ticketId);
      } else {
        failed.push({
          ticketId,
          message: result.message || 'Ticket could not be deleted'
        });
      }
    } catch (error: unknown) {
      console.error(`Failed to delete ticket ${ticketId}:`, error);
      failed.push({
        ticketId,
        message: ticketBulkFailureMessage(error, 'Failed to delete ticket')
      });
    }
  }

  if (deletedIds.length > 0) {
    revalidatePath('/msp/tickets');
  }

  return { deletedIds, failed };
});

export const moveTicketsToBoard = withAuth(async (
  user,
  { tenant },
  ticketIds: string[],
  destinationBoardId: string,
  destinationStatusId: string
): Promise<{
  movedIds: string[];
  failed: Array<{ ticketId: string; message: string }>;
}> => {
  const uniqueIds = Array.from(new Set(ticketIds.filter((id) => !!id)));

  if (uniqueIds.length === 0) {
    return { movedIds: [], failed: [] };
  }

  const { knex: ticketKnex } = await createTenantKnex();

  const { tenant: tenantAlias } = { tenant };
  const movedIds: string[] = [];
  const failed: Array<{ ticketId: string; message: string }> = [];

  let resolvedStatusId = destinationStatusId;

  try {
    resolvedStatusId = await withTransaction(ticketKnex, async (trx: Knex.Transaction) => {
      if (!destinationStatusId) {
        const defaultStatusId = await TicketModel.getDefaultStatusId(tenantAlias, trx, destinationBoardId);
        if (!defaultStatusId) {
          throw new Error('No default ticket status configured for the selected board');
        }
        return defaultStatusId;
      }

      const statusValidation = await TicketModel.validateStatusBelongsToBoard(
        destinationStatusId,
        destinationBoardId,
        tenantAlias,
        trx
      );

      if (!statusValidation.valid) {
        throw new Error(statusValidation.error || 'Invalid destination status');
      }

      return destinationStatusId;
    });
  } catch (error: unknown) {
    const message = ticketBulkFailureMessage(error, 'Destination board or status is invalid');
    return {
      movedIds: [],
      failed: uniqueIds.map((ticketId) => ({ ticketId, message })),
    };
  }

  for (const ticketId of uniqueIds) {
    try {
      const currentTicket = await withTransaction(ticketKnex, async (trx: Knex.Transaction) => (
        tenantScopedTable(trx, 'tickets', tenantAlias)
          .where({ ticket_id: ticketId })
          .first()
      ));

      if (!currentTicket) {
        throw new Error('Ticket not found');
      }

      const updateData: Partial<ITicket> = {
        board_id: destinationBoardId,
        status_id: resolvedStatusId,
      };

      if (currentTicket.board_id !== destinationBoardId) {
        updateData.category_id = null;
        updateData.subcategory_id = null;
      }

      await updateTicketWithCache(ticketId, updateData);

      movedIds.push(ticketId);
    } catch (error: unknown) {
      failed.push({
        ticketId,
        message: ticketBulkFailureMessage(error, 'Failed to move ticket'),
      });
    }
  }

  if (movedIds.length > 0) {
    revalidatePath('/msp/tickets');
  }

  return { movedIds, failed };
});

export type BulkTicketAssignSelection =
  | { kind: 'user'; userId: string | null }
  | { kind: 'team'; teamId: string };

export const bulkAssignTickets = withAuth(async (
  user,
  { tenant },
  ticketIds: string[],
  selection: BulkTicketAssignSelection,
): Promise<{
  updatedIds: string[];
  failed: Array<{ ticketId: string; message: string }>;
}> => {
  const uniqueIds = Array.from(new Set(ticketIds.filter((id) => !!id)));

  if (uniqueIds.length === 0) {
    return { updatedIds: [], failed: [] };
  }

  // Authorize once up front. The team helpers and the per-ticket update each still
  // verify permission internally, but this entry check avoids any mutation.
  const { knex } = await createTenantKnex();
  if (!(await hasPermission(user, 'ticket', 'update', knex))) {
    return {
      updatedIds: [],
      failed: ticketBulkFailuresForAll(uniqueIds, 'Permission denied: Cannot update tickets'),
    };
  }

  const updatedIds: string[] = [];
  const failed: Array<{ ticketId: string; message: string }> = [];

  for (const ticketId of uniqueIds) {
    try {
      if (selection.kind === 'team') {
        // Canonical team flow: sets assigned_team_id + the team lead as primary assignee and
        // records team members as `team_member` resources, so the team badge/filter persists.
        const result = await assignTeamToTicket(ticketId, selection.teamId);
        if (isTicketActionError(result)) {
          throw result;
        }
      } else {
        // Assigning to a single user clears any team assignment (and its team_member resources)
        // first so a stale assigned_team_id / team badge isn't left behind.
        const result = await removeTeamFromTicket(ticketId, { mode: 'remove_all' });
        if (isTicketActionError(result)) {
          throw result;
        }
        await withTransaction(knex, (trx: Knex.Transaction) =>
          updateTicketInTransaction(trx, user as IUserWithRoles, tenant, ticketId, { assigned_to: selection.userId }),
        );
      }
      updatedIds.push(ticketId);
    } catch (error: unknown) {
      failed.push({
        ticketId,
        message: ticketBulkFailureMessage(error, 'Failed to assign ticket'),
      });
    }
  }

  if (updatedIds.length > 0) {
    revalidatePath('/msp/tickets');
  }

  return { updatedIds, failed };
});

export const bulkAddTagsToTickets = withAuth(async (
  user,
  { tenant },
  ticketIds: string[],
  tagTexts: string[],
): Promise<{
  updatedIds: string[];
  failed: Array<{ ticketId: string; message: string }>;
}> => {
  const uniqueIds = Array.from(new Set(ticketIds.filter((id) => !!id)));
  const normalizedTexts = Array.from(
    new Set(tagTexts.map((t) => t.trim()).filter((t) => t.length > 0)),
  );

  if (uniqueIds.length === 0 || normalizedTexts.length === 0) {
    return { updatedIds: [], failed: [] };
  }

  // Tag writes don't go through updateTicketWithCache, so authorize explicitly here.
  const { knex: authKnex } = await createTenantKnex();
  if (!(await hasPermission(user, 'ticket', 'update', authKnex))) {
    return {
      updatedIds: [],
      failed: ticketBulkFailuresForAll(uniqueIds, 'Permission denied: Cannot update tickets'),
    };
  }

  const existingByTicket = new Map<string, Set<string>>();
  try {
    const existing = await findTagsByEntityIds(uniqueIds, 'ticket');
    if (isTagActionError(existing)) {
      console.warn('[bulkAddTagsToTickets] Failed to load existing tags for dedupe:', existing);
    } else {
      for (const tag of existing) {
        const set = existingByTicket.get(tag.tagged_id) ?? new Set<string>();
        set.add(tag.tag_text.toLowerCase());
        existingByTicket.set(tag.tagged_id, set);
      }
    }
  } catch (error) {
    console.warn('[bulkAddTagsToTickets] Failed to load existing tags for dedupe:', error);
  }

  const { knex: ticketKnex } = await createTenantKnex();
  const updatedIds: string[] = [];
  const failed: Array<{ ticketId: string; message: string }> = [];

  for (const ticketId of uniqueIds) {
    try {
      const alreadyOnTicket = existingByTicket.get(ticketId) ?? new Set<string>();
      const newTexts = normalizedTexts.filter((t) => !alreadyOnTicket.has(t.toLowerCase()));
      if (newTexts.length === 0) {
        updatedIds.push(ticketId);
        continue;
      }
      const pendingTags: PendingTag[] = newTexts.map((text) => ({
        tag_text: text,
        background_color: null,
        text_color: null,
        isNew: true,
      }));
      await withTransaction(ticketKnex, async (trx: Knex.Transaction) => {
        await createTagsForEntityWithTransaction(trx, tenant, ticketId, 'ticket', pendingTags);
      });
      updatedIds.push(ticketId);
    } catch (error: unknown) {
      failed.push({
        ticketId,
        message: ticketBulkFailureMessage(error, 'Failed to add tags to ticket'),
      });
    }
  }

  if (updatedIds.length > 0) {
    revalidatePath('/msp/tickets');
  }

  return { updatedIds, failed };
});

export const bulkUpdateTicketDueDate = withAuth(async (
  user,
  { tenant },
  ticketIds: string[],
  dueDate: string | null,
): Promise<{
  updatedIds: string[];
  failed: Array<{ ticketId: string; message: string }>;
}> => {
  const uniqueIds = Array.from(new Set(ticketIds.filter((id) => !!id)));

  if (uniqueIds.length === 0) {
    return { updatedIds: [], failed: [] };
  }

  // Authorize once up front instead of paying a permission lookup per ticket.
  const { knex } = await createTenantKnex();
  if (!(await hasPermission(user, 'ticket', 'update', knex))) {
    return {
      updatedIds: [],
      failed: ticketBulkFailuresForAll(uniqueIds, 'Permission denied: Cannot update tickets'),
    };
  }

  const updatedIds: string[] = [];
  const failed: Array<{ ticketId: string; message: string }> = [];

  // Per-ticket transactions preserve partial success: one bad ticket fails alone.
  for (const ticketId of uniqueIds) {
    try {
      await withTransaction(knex, (trx: Knex.Transaction) =>
        updateTicketInTransaction(trx, user as IUserWithRoles, tenant, ticketId, { due_date: dueDate } as Partial<ITicket>),
      );
      updatedIds.push(ticketId);
    } catch (error: unknown) {
      failed.push({
        ticketId,
        message: ticketBulkFailureMessage(error, 'Failed to update due date'),
      });
    }
  }

  if (updatedIds.length > 0) {
    revalidatePath('/msp/tickets');
  }

  return { updatedIds, failed };
});

export const bulkUpdateTicketStatus = withAuth(async (
  user,
  { tenant },
  ticketIds: string[],
  statusId: string,
): Promise<{
  updatedIds: string[];
  failed: Array<{ ticketId: string; message: string; closeRuleFailures?: CloseRuleFailure[] }>;
}> => {
  const uniqueIds = Array.from(new Set(ticketIds.filter((id) => !!id)));

  if (uniqueIds.length === 0) {
    return { updatedIds: [], failed: [] };
  }

  // Authorize once up front instead of paying a permission lookup per ticket.
  const { knex } = await createTenantKnex();
  if (!(await hasPermission(user, 'ticket', 'update', knex))) {
    return {
      updatedIds: [],
      failed: ticketBulkFailuresForAll(uniqueIds, 'Permission denied: Cannot update tickets'),
    };
  }

  const updatedIds: string[] = [];
  const failed: Array<{ ticketId: string; message: string; closeRuleFailures?: CloseRuleFailure[] }> = [];

  // Per-ticket transactions preserve partial success: one bad ticket fails alone.
  for (const ticketId of uniqueIds) {
    try {
      await withTransaction(knex, (trx: Knex.Transaction) =>
        updateTicketInTransaction(trx, user as IUserWithRoles, tenant, ticketId, { status_id: statusId }),
      );
      updatedIds.push(ticketId);
    } catch (error: unknown) {
      failed.push({
        ticketId,
        message: error instanceof TicketCloseValidationError
          ? error.message
          : ticketBulkFailureMessage(error, 'Failed to update status'),
        closeRuleFailures: error instanceof TicketCloseValidationError ? error.failures : undefined,
      });
    }
  }

  if (updatedIds.length > 0) {
    revalidatePath('/msp/tickets');
  }

  return { updatedIds, failed };
});

export const bulkUpdateTicketPriority = withAuth(async (
  user,
  { tenant },
  ticketIds: string[],
  priorityId: string,
): Promise<{
  updatedIds: string[];
  failed: Array<{ ticketId: string; message: string }>;
}> => {
  const uniqueIds = Array.from(new Set(ticketIds.filter((id) => !!id)));

  if (uniqueIds.length === 0) {
    return { updatedIds: [], failed: [] };
  }

  // Authorize once up front instead of paying a permission lookup per ticket.
  const { knex } = await createTenantKnex();
  if (!(await hasPermission(user, 'ticket', 'update', knex))) {
    return {
      updatedIds: [],
      failed: ticketBulkFailuresForAll(uniqueIds, 'Permission denied: Cannot update tickets'),
    };
  }

  const updatedIds: string[] = [];
  const failed: Array<{ ticketId: string; message: string }> = [];

  // Per-ticket transactions preserve partial success: one bad ticket fails alone.
  for (const ticketId of uniqueIds) {
    try {
      await withTransaction(knex, (trx: Knex.Transaction) =>
        updateTicketInTransaction(trx, user as IUserWithRoles, tenant, ticketId, { priority_id: priorityId }),
      );
      updatedIds.push(ticketId);
    } catch (error: unknown) {
      failed.push({
        ticketId,
        message: ticketBulkFailureMessage(error, 'Failed to update priority'),
      });
    }
  }

  if (updatedIds.length > 0) {
    revalidatePath('/msp/tickets');
  }

  return { updatedIds, failed };
});

export const getScheduledHoursForTicket = withAuth(async (user, { tenant }, ticketId: string): Promise<IAgentSchedule[] | TicketActionError> => {
  try {
    const {knex: db} = await createTenantKnex();

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'ticket', 'read', trx)) {
        throw new Error('Permission denied: Cannot view ticket schedule');
      }

      // Query schedule entries for the ticket
      const tenantFacade = tenantDb(trx, tenant);
      const scheduleEntriesQuery = tenantFacade.table('schedule_entries as se')
      .select(
        'se.*',
        'sea.user_id'
      )
      .where({
        'se.work_item_id': ticketId,
        'se.work_item_type': 'ticket'
      });
      tenantFacade.tenantJoin(
        scheduleEntriesQuery,
        'schedule_entry_assignees as sea',
        'se.entry_id',
        'sea.entry_id',
        { type: 'left' }
      );
      const scheduleEntries = await scheduleEntriesQuery;

    // Calculate scheduled hours per agent
    const agentSchedules: Record<string, number> = {};

    scheduleEntries.forEach((entry: any) => {
      const userId = entry.user_id;
      if (!userId) {
        return;
      }

      const startTime = new Date(entry.scheduled_start);
      const endTime = new Date(entry.scheduled_end);
      const durationMs = endTime.getTime() - startTime.getTime();
      const durationMinutes = Math.ceil(durationMs / (1000 * 60));

      if (!agentSchedules[userId]) {
        agentSchedules[userId] = 0;
      }

      agentSchedules[userId] += durationMinutes;
    });

    const result: IAgentSchedule[] = Object.entries(agentSchedules).map(([userId, minutes]) => ({
      userId,
      minutes
    }));

      return result;
    });

    return result;
  } catch (error) {
    const expected = ticketActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error fetching scheduled hours:', error);
    throw error;
  }
});

export type DetailedTicket = ITicket & {
  tenant: string;
  status_name: string;
  is_closed: boolean;
  ticket_origin: ResolvedTicketOrigin;
  board_name?: string;
  assigned_to_first_name?: string;
  assigned_to_last_name?: string;
  assigned_to_name?: string;
  contact_name?: string;
  client_name?: string;

  additionalAgents?: ITicketResource[];
  availableAgents?: IUser[];
};

export const getTicketById = withAuth(async (user, { tenant }, id: string): Promise<DetailedTicket> => {
  try {
    const {knex: db} = await createTenantKnex();

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'ticket', 'read', trx)) {
        throw new Error('Permission denied: Cannot view ticket');
      }

      const authorizationSubject = await resolveAuthorizationSubjectForUser(
        trx,
        tenant,
        user as IUserWithRoles
      );
      const selectedBoardIds = await resolveClientSelectedBoardIds(trx, tenant, user as IUserWithRoles);
      const relationshipRules =
        selectedBoardIds === undefined ? [] : [{ template: 'selected_boards' as const }];
      const authorizationKernel = createAuthorizationKernel({
        builtinProvider: new BuiltinAuthorizationKernelProvider({
          relationshipRules,
        }),
        bundleProvider: new BundleAuthorizationKernelProvider({
          resolveRules: async (input) => {
            try {
              return await resolveBundleNarrowingRulesForEvaluation(trx, input);
            } catch {
              return [];
            }
          },
        }),
        rbacEvaluator: async () => true,
      });
      const requestCache = new RequestLocalAuthorizationCache();

    type TicketQueryResult = ITicket & {
      status_name: string;
      is_closed: boolean;
      board_name?: string;
      assigned_to_first_name?: string;
      assigned_to_last_name?: string;
      entered_by_user_type?: string | null;
      contact_name?: string;
      client_name?: string;
    };

      const tenantFacade = tenantDb(trx, tenant);
      const ticketQuery = tenantFacade.table<TicketQueryResult>('tickets as t')
      .select(
        't.*',
        's.name as status_name',
        's.is_closed',
        'ch.board_name as board_name',
        'u_assignee.first_name as assigned_to_first_name',
        'u_assignee.last_name as assigned_to_last_name',
        'u_creator.user_type as entered_by_user_type',
        'ct.full_name as contact_name',
        'co.client_name'
      );
      tenantFacade.tenantJoin(ticketQuery, 'statuses as s', 't.status_id', 's.status_id', { type: 'left' });
      tenantFacade.tenantJoin(ticketQuery, 'boards as ch', 't.board_id', 'ch.board_id', { type: 'left' });
      tenantFacade.tenantJoin(ticketQuery, 'users as u_assignee', 't.assigned_to', 'u_assignee.user_id', { type: 'left' });
      tenantFacade.tenantJoin(ticketQuery, 'users as u_creator', 't.entered_by', 'u_creator.user_id', { type: 'left' });
      tenantFacade.tenantJoin(ticketQuery, 'contacts as ct', 't.contact_name_id', 'ct.contact_name_id', { type: 'left' });
      tenantFacade.tenantJoin(ticketQuery, 'clients as co', 't.client_id', 'co.client_id', { type: 'left' });
      const ticket: TicketQueryResult | undefined = await ticketQuery
      .where('t.ticket_id', id)
      .first();

      if (!ticket) {
        throw new Error('Ticket not found');
      }

      if ((user as IUserWithRoles).user_type === 'client' && (user as IUserWithRoles).clientId) {
        if (ticket.client_id !== (user as IUserWithRoles).clientId) {
          throw new Error('Permission denied: Cannot view ticket');
        }
      }

      const authorizationDecision = await authorizationKernel.authorizeResource({
        subject: authorizationSubject,
        resource: {
          type: 'ticket',
          action: 'read',
          id,
        },
        record: toTicketAuthorizationRecord(ticket),
        selectedBoardIds,
        requestCache,
        knex: trx,
      });

      if (!authorizationDecision.allowed) {
        throw new Error('Permission denied: Cannot view ticket');
      }

      // Fetch additional resources and available agents in parallel
      const [additionalAgents, availableAgents] = await Promise.all([
        tenantScopedTable(trx, 'ticket_resources', tenant)
          .where({
            ticket_id: id
          }),
        tenantScopedTable(trx, 'users', tenant)
          .orderBy('first_name', 'asc')
      ]);


    const assigned_to_name = (ticket.assigned_to_first_name || ticket.assigned_to_last_name)
      ? `${ticket.assigned_to_first_name || ''} ${ticket.assigned_to_last_name || ''}`.trim()
      : undefined;

    const detailedTicket: DetailedTicket = {
      ...ticket,
      tenant: tenant,
      status_name: ticket.status_name || 'Unknown',
      is_closed: ticket.is_closed || false,
      ticket_origin: getTicketOrigin(ticket),
      board_name: ticket.board_name || undefined,
      assigned_to_name: assigned_to_name,
      contact_name: ticket.contact_name || undefined,
      client_name: ticket.client_name || undefined,
      additionalAgents: additionalAgents,
      availableAgents: availableAgents,
    };

    delete (detailedTicket as any).assigned_to_first_name;
    delete (detailedTicket as any).assigned_to_last_name;
    delete (detailedTicket as any).entered_by_user_type;

    // Track ticket view analytics
    captureAnalytics('ticket_viewed', {
      ticket_id: id,
      status_id: ticket.status_id,
      status_name: ticket.status_name,
      is_closed: ticket.is_closed,
      priority_id: ticket.priority_id,
      category_id: ticket.category_id,
      board_id: ticket.board_id,
      assigned_to: ticket.assigned_to,
      client_id: ticket.client_id,
      has_additional_agents: additionalAgents.length > 0,
      additional_agent_count: additionalAgents.length,
      view_source: 'ticket_by_id'
    }, user.user_id);

      return convertDates(detailedTicket);
    });

    return result;
  } catch (error) {
    const expected = ticketActionErrorFrom(error);
    if (expected) {
      return expected as never;
    }
    console.error('Failed to fetch ticket:', error);
    throw error;
  }
});

/**
 * Get appointment requests linked to a specific ticket.
 * Local query to avoid circular dependency with the scheduling package.
 */
export const getTicketAppointmentRequests = withAuth(async (
  user,
  { tenant },
  ticketId: string
): Promise<{ success: boolean; data?: any[]; error?: string }> => {
  try {
    const { knex: db } = await createTenantKnex();

    const requests = await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'ticket', 'read', trx)) {
        throw new Error('Permission denied');
      }

      const tenantFacade = tenantDb(trx, tenant);
      const appointmentQuery = tenantFacade.table('appointment_requests as ar');
      tenantFacade.tenantJoin(
        appointmentQuery,
        'service_catalog as sc',
        'ar.service_id',
        'sc.service_id',
        { type: 'left' }
      );
      return await appointmentQuery
        .where('ar.ticket_id', ticketId)
        .select(
          'ar.*',
          'sc.service_name'
        )
        .orderBy('ar.created_at', 'desc');
    });

    return { success: true, data: requests };
  } catch (error) {
    const expected = ticketActionErrorFrom(error);
    if (expected) {
      const candidate = expected as unknown as { actionError?: unknown; permissionError?: unknown };
      return {
        success: false,
        error: typeof candidate.permissionError === 'string'
          ? candidate.permissionError
          : String(candidate.actionError ?? 'Failed to fetch appointment requests.'),
      };
    }
    console.error('Error fetching ticket appointment requests:', error);
    return { success: false, error: 'Failed to fetch appointment requests.' };
  }
});
