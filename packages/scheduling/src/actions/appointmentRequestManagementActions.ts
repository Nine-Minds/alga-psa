'use server';

import { createTenantKnex, tenantDb, User } from '@alga-psa/db';
import { withTransaction, resolveEffectiveTimeZone } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { v4 as uuidv4 } from 'uuid';
import {
  approveAppointmentRequestSchema,
  declineAppointmentRequestSchema,
  updateAppointmentRequestDateTimeSchema,
  associateRequestToTicketSchema,
  type AppointmentRequestFilters,
  appointmentRequestFilterSchema,
  type ApproveAppointmentRequestInput,
  type DeclineAppointmentRequestInput,
  type UpdateAppointmentRequestDateTimeInput,
  type AssociateRequestToTicketInput
} from '../schemas/appointmentRequestSchemas';
import { SystemEmailService } from '@alga-psa/email';
import ScheduleEntry from '@alga-psa/shared/models/scheduleEntry';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildAppointmentAssignedPayload,
  buildAppointmentCreatedPayload,
} from '@alga-psa/workflow-streams';
import {
  getTenantSettings,
  generateICSLink,
  getRequestNewAppointmentLink,
  getClientUserIdFromContact,
  formatDate,
  formatTime
} from './appointmentHelpers';
import { generateICSBuffer, generateICSFilename, ICSEventData } from '../utils/icsGenerator';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import {
  resolveTeamsMeetingService,
  type CreateTeamsMeetingResult,
  type TeamsMeetingAttendee,
  type TeamsMeetingSkipReason,
} from '../lib/teamsMeetingService';

export interface IAppointmentRequest {
  appointment_request_id: string;
  tenant: string;
  client_id?: string;
  contact_id?: string;
  service_id: string;
  requested_date: string;
  requested_time: string;
  requested_duration: number;
  requester_timezone?: string | null;
  preferred_assigned_user_id?: string;
  status: 'pending' | 'approved' | 'declined' | 'cancelled';
  description?: string;
  ticket_id?: string;
  is_authenticated: boolean;
  requester_name?: string;
  requester_email?: string;
  requester_phone?: string;
  company_name?: string;
  schedule_entry_id?: string;
  approved_by_user_id?: string;
  approved_at?: string;
  declined_reason?: string;
  online_meeting_provider?: string | null;
  online_meeting_url?: string | null;
  online_meeting_id?: string | null;
  online_meeting_artifacts?: OnlineMeetingAppointmentArtifact[];
  created_at: Date;
  updated_at: Date;
}

export interface AppointmentRequestResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  teamsMeetingWarning?: string;
  /**
   * Set when the request itself was not processed because Teams meeting
   * creation failed — the approver can retry or approve without a meeting.
   */
  meetingCreationFailed?: boolean;
}

export interface OnlineMeetingAppointmentArtifact {
  artifact_id: string;
  artifact_type: 'recording' | 'transcript';
  document_id: string | null;
  created_date_time: Date | null;
}

async function loadOnlineMeetingArtifactsForAppointments(
  trx: Knex.Transaction,
  tenant: string,
  appointmentRequestIds: string[],
): Promise<Map<string, OnlineMeetingAppointmentArtifact[]>> {
  const result = new Map<string, OnlineMeetingAppointmentArtifact[]>();
  const ids = [...new Set(appointmentRequestIds.filter(Boolean))];
  if (ids.length === 0) {
    return result;
  }

  const scopedDb = tenantDb(trx, tenant);
  const artifactsQuery = scopedDb.table('online_meeting_artifacts as artifact');
  scopedDb.tenantJoin(
    artifactsQuery,
    'online_meetings as meeting',
    'artifact.meeting_id',
    'meeting.meeting_id',
    { rootTenantColumn: 'artifact.tenant' },
  );
  const rows = await artifactsQuery
    .whereIn('meeting.appointment_request_id', ids)
    .select(
      'meeting.appointment_request_id',
      'artifact.artifact_id',
      'artifact.artifact_type',
      'artifact.document_id',
      'artifact.created_date_time',
    )
    .orderBy('artifact.created_date_time', 'desc');

  for (const row of rows) {
    const appointmentRequestId = row.appointment_request_id as string;
    const artifacts = result.get(appointmentRequestId) ?? [];
    artifacts.push({
      artifact_id: row.artifact_id,
      artifact_type: row.artifact_type,
      document_id: row.document_id ?? null,
      created_date_time: row.created_date_time ?? null,
    });
    result.set(appointmentRequestId, artifacts);
  }

  return result;
}

export const getTeamsMeetingCapability = withAuth(async (
  _user,
  { tenant }
) => {
  const teamsMeetingService = await resolveTeamsMeetingService();
  return teamsMeetingService.getTeamsMeetingCapability(tenant);
});

interface TeamsMeetingParticipant {
  email: string | null;
  name: string | null;
}

/**
 * Attendees drive native Outlook/Teams calendar invites: the client contact
 * and the assigned technician are both required attendees when their email is
 * known. Missing emails are tolerated (the meeting is still created) — the gap
 * is reported through the returned list length.
 */
function buildTeamsMeetingAttendees(participants: {
  contact?: TeamsMeetingParticipant | null;
  technician?: TeamsMeetingParticipant | null;
}): TeamsMeetingAttendee[] {
  const attendees: TeamsMeetingAttendee[] = [];
  const seen = new Set<string>();

  for (const participant of [participants.contact, participants.technician]) {
    const email = participant?.email?.trim();
    if (!email) {
      continue;
    }
    const key = email.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    attendees.push({
      emailAddress: {
        address: email,
        ...(participant?.name?.trim() ? { name: participant.name.trim() } : {}),
      },
      type: 'required',
    });
  }

  return attendees;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Graph event body: appointment context plus a PSA deep link so attendees can
 * jump from their calendar into the record (F015).
 */
function buildAppointmentMeetingBodyHtml(params: {
  serviceName: string;
  appointmentRequestId: string;
  description?: string | null;
}): string {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const psaLink = `${baseUrl}/msp/schedule?requestId=${encodeURIComponent(params.appointmentRequestId)}`;
  const lines = [
    `<p>Appointment: ${escapeHtml(params.serviceName)}</p>`,
    ...(params.description?.trim() ? [`<p>${escapeHtml(params.description.trim())}</p>`] : []),
    `<p><a href="${psaLink}">Open this appointment in Alga PSA</a></p>`,
  ];
  return lines.join('\n');
}

function teamsMeetingSkipWarning(reason: TeamsMeetingSkipReason): string {
  switch (reason) {
    case 'no_organizer':
      return 'Microsoft Teams meeting was not created because no default organizer is configured.';
    case 'ee_disabled':
      return 'Microsoft Teams meetings are only available in Enterprise Edition.';
    case 'addon_inactive':
      return 'Microsoft Teams meeting was not created because the Teams add-on is not active for this tenant.';
    case 'not_configured':
    default:
      return 'Microsoft Teams meeting was not created because Teams is not configured for this tenant.';
  }
}

/**
 * Enqueues the idempotent Graph cleanup job for a cancelled/declined meeting.
 * The online_meetings row stays cancel_pending until the job confirms Graph
 * deletion; the recurring Teams meeting sweep retries rows whose job was lost.
 */
async function enqueueTeamsMeetingCleanupJob(tenantId: string, meetingId: string): Promise<boolean> {
  try {
    const { getJobRunner } = await import('@alga-psa/jobs/runner');
    const runner = await getJobRunner();
    await runner.scheduleJob(
      'teams-meeting-cleanup',
      { tenantId, meetingId },
      { singletonKey: `teams-meeting-cleanup:${tenantId}:${meetingId}` },
    );
    return true;
  } catch (error) {
    console.warn('[TeamsMeetingCleanup] Failed to enqueue cleanup job; the Teams meeting sweep will retry', {
      tenantId,
      meetingId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Builds a knex `.where(...)` callback that matches `availability_settings` rows whose
 * `config_json` configures `userId` (or one of `userTeamIds`) as an appointment approver.
 *
 * Mirrors `readApproverIdsFromConfig` semantics, including the legacy `default_approver_id`
 * fallback that is honored only when both new arrays are empty/absent — preserved by the
 * backfill migration as a compatibility shim for un-migrated rows.
 *
 * The modern-path clauses use `?` / `?|` against the extracted JSONB sub-arrays so the
 * GIN expression indexes on `(config_json -> 'approver_user_ids')` and
 * `(config_json -> 'approver_team_ids')` can be used. The legacy clause is rare and is
 * scanned within the tenant/setting_type prune.
 */
function withApproverMatchClause(userId: string, userTeamIds: string[]) {
  return function (this: any /* Knex.QueryBuilder */) {
    this.whereRaw("config_json -> 'approver_user_ids' \\? ?", [userId]);
    if (userTeamIds.length > 0) {
      this.orWhereRaw(
        "config_json -> 'approver_team_ids' \\?| ?::text[]",
        [userTeamIds]
      );
    }
    this.orWhere(function (this: any) {
      // Legacy `default_approver_id` fallback — applied only when both new arrays are
      // empty/absent, matching readApproverIdsFromConfig. The CASE/jsonb_typeof form
      // tolerates absent keys, JSON null, and (defensively) non-array values without
      // erroring like raw jsonb_array_length would.
      this.whereRaw("(config_json ->> 'default_approver_id') = ?", [userId])
        .whereRaw(
          "CASE jsonb_typeof(config_json -> 'approver_user_ids') " +
          "WHEN 'array' THEN jsonb_array_length(config_json -> 'approver_user_ids') = 0 " +
          "ELSE TRUE END"
        )
        .whereRaw(
          "CASE jsonb_typeof(config_json -> 'approver_team_ids') " +
          "WHEN 'array' THEN jsonb_array_length(config_json -> 'approver_team_ids') = 0 " +
          "ELSE TRUE END"
        );
    });
  };
}

/**
 * Returns true when `userId` is configured as an approver for the given request — either
 * a company-wide approver (general_settings) or a per-technician approver whose
 * user_hours row matches the request's preferred technician. Mirrors the visibility
 * scoping in getAppointmentRequests so admins who configured an approver get the matching
 * authority to act, without needing the broader user_schedule:update permission.
 */
async function isConfiguredApproverFor(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  preferredAssignedUserId: string | null
): Promise<boolean> {
  const scopedDb = tenantDb(trx, tenant);
  const memberships = await scopedDb.table('team_members')
    .where({ user_id: userId })
    .select('team_id');
  const userTeamIds = memberships.map(m => m.team_id);

  const rows = await scopedDb.table('availability_settings')
    .whereIn('setting_type', ['general_settings', 'user_hours'])
    .whereNotNull('config_json')
    .where(withApproverMatchClause(userId, userTeamIds))
    .select('setting_type', 'user_id');

  return rows.some(row => {
    if (row.setting_type === 'general_settings') return true;
    if (row.setting_type === 'user_hours' && row.user_id && preferredAssignedUserId) {
      return row.user_id === preferredAssignedUserId;
    }
    return false;
  });
}

/**
 * Get a single appointment request by ID
 */
export const getAppointmentRequestById = withAuth(async (
  user,
  { tenant },
  appointmentRequestId: string
): Promise<AppointmentRequestResult<IAppointmentRequest>> => {
  try {
    const { knex: db } = await createTenantKnex();

    // Check permissions - use same permission as schedule actions
    const canRead = await hasPermission(user, 'user_schedule', 'read', db) || await hasPermission(user, 'user_schedule', 'update', db);
    if (!canRead) {
      return { success: false, error: 'Insufficient permissions to view appointment requests' };
    }

    const request = await withTransaction(db, async (trx: Knex.Transaction) => {
      const trxTenantDb = tenantDb(trx, tenant);
      const requestQuery = trxTenantDb.table('appointment_requests as ar');
      trxTenantDb.tenantJoin(requestQuery, 'service_catalog as sc', 'ar.service_id', 'sc.service_id', { type: 'left' });
      trxTenantDb.tenantJoin(requestQuery, 'clients as c', 'ar.client_id', 'c.client_id', { type: 'left' });
      trxTenantDb.tenantJoin(requestQuery, 'contacts as con', 'ar.contact_id', 'con.contact_name_id', { type: 'left' });
      trxTenantDb.tenantJoin(requestQuery, 'users as u', 'ar.preferred_assigned_user_id', 'u.user_id', { type: 'left' });
      trxTenantDb.tenantJoin(requestQuery, 'users as approver', 'ar.approved_by_user_id', 'approver.user_id', { type: 'left' });
      const row = await requestQuery
        .where({
          'ar.appointment_request_id': appointmentRequestId
        })
        .select(
          'ar.*',
          'sc.service_name',
          'c.client_name as client_company_name',
          'con.full_name as contact_name',
          'con.email as contact_email',
          'u.first_name as preferred_technician_first_name',
          'u.last_name as preferred_technician_last_name',
          'approver.first_name as approver_first_name',
          'approver.last_name as approver_last_name'
        )
        .first();

      if (!row) {
        return row;
      }

      const artifacts = await loadOnlineMeetingArtifactsForAppointments(
        trx,
        tenant,
        [row.appointment_request_id],
      );

      return {
        ...row,
        online_meeting_artifacts: artifacts.get(row.appointment_request_id) ?? [],
      };
    });

    if (!request) {
      return { success: false, error: 'Appointment request not found' };
    }

    return { success: true, data: request as IAppointmentRequest };
  } catch (error) {
    console.error('Error fetching appointment request:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch appointment request';
    return { success: false, error: message };
  }
});

/**
 * Get all appointment requests for MSP with filtering
 */
export const getAppointmentRequests = withAuth(async (
  user,
  { tenant },
  filters?: AppointmentRequestFilters
): Promise<AppointmentRequestResult<IAppointmentRequest[]>> => {
  try {
    const { knex: db } = await createTenantKnex();

    // Check permissions - use same permission as schedule actions
    const canRead = await hasPermission(user, 'user_schedule', 'read', db) || await hasPermission(user, 'user_schedule', 'update', db);
    if (!canRead) {
      return { success: false, error: 'Insufficient permissions to view appointment requests' };
    }

    // Validate filters if provided
    const validatedFilters = filters ? appointmentRequestFilterSchema.parse(filters) : {};

    const requests = await withTransaction(db, async (trx: Knex.Transaction) => {
      const trxTenantDb = tenantDb(trx, tenant);
      // Check if user has full admin access
      const hasFullAccess = await hasPermission(user, 'user', 'read', trx);

      // If user doesn't have full access, they can only see:
      // 1. Requests for technicians they're scoped to (themselves, team members, reports)
      // 2. Requests for technicians they're a per-technician approver of
      // 3. ALL requests, if they're a company-wide approver
      // Approvers can be configured as individual users or as teams (expanded to members).
      let scopedUserIds: string[] = [];
      // Company-wide approvers (and full-access users) can see every request.
      let canSeeAllRequests = false;

      if (!hasFullAccess) {
        // Add current user
        scopedUserIds.push(user.user_id);

        // Check if user is a team manager and get team member IDs
        const managedTeams = await trxTenantDb.table('teams')
          .where({ manager_id: user.user_id })
          .select('team_id');

        if (managedTeams.length > 0) {
          const teamIds = managedTeams.map(t => t.team_id);
          const teamMembers = await trxTenantDb.table('team_members')
            .whereIn('team_id', teamIds)
            .select('user_id');

          scopedUserIds.push(...teamMembers.map(tm => tm.user_id));
        }

        const subordinateIds = await User.getReportsToSubordinateIds(trx, user.user_id);
        scopedUserIds.push(...subordinateIds);

        // Teams the current user belongs to (for team-based approver matching)
        const memberships = await trxTenantDb.table('team_members')
          .where({ user_id: user.user_id })
          .select('team_id');
        const userTeamIds = memberships.map(m => m.team_id);

        // Pushed into SQL so PostgreSQL can index-prune via the GIN expression indexes
        // on (config_json -> 'approver_user_ids') and (config_json -> 'approver_team_ids').
        // Helper also includes the legacy `default_approver_id` fallback (used only when
        // both arrays are empty/absent) to preserve compatibility with un-backfilled rows.
        const approverSettings = await trxTenantDb.table('availability_settings')
          .whereIn('setting_type', ['general_settings', 'user_hours'])
          .whereNotNull('config_json')
          .where(withApproverMatchClause(user.user_id, userTeamIds))
          .select('setting_type', 'user_id');

        for (const setting of approverSettings) {
          if (setting.setting_type === 'general_settings') {
            // Company-wide approver: can review every request.
            canSeeAllRequests = true;
          } else if (setting.setting_type === 'user_hours' && setting.user_id) {
            // Per-technician approver: can review that technician's requests.
            scopedUserIds.push(setting.user_id);
          }
        }

        // Remove duplicates
        scopedUserIds = [...new Set(scopedUserIds)];
      }

      let query = trxTenantDb.table('appointment_requests as ar')
        .select(
          'ar.*',
          'sc.service_name',
          'c.client_name as client_company_name',
          'con.full_name as contact_name',
          'con.email as contact_email',
          'u.first_name as preferred_technician_first_name',
          'u.last_name as preferred_technician_last_name',
          'approver.first_name as approver_first_name',
          'approver.last_name as approver_last_name',
          't.ticket_number',
          't.title as ticket_title'
        )
        .orderBy('ar.created_at', 'desc');
      trxTenantDb.tenantJoin(query, 'service_catalog as sc', 'ar.service_id', 'sc.service_id', { type: 'left' });
      trxTenantDb.tenantJoin(query, 'clients as c', 'ar.client_id', 'c.client_id', { type: 'left' });
      trxTenantDb.tenantJoin(query, 'contacts as con', 'ar.contact_id', 'con.contact_name_id', { type: 'left' });
      trxTenantDb.tenantJoin(query, 'users as u', 'ar.preferred_assigned_user_id', 'u.user_id', { type: 'left' });
      trxTenantDb.tenantJoin(query, 'users as approver', 'ar.approved_by_user_id', 'approver.user_id', { type: 'left' });
      trxTenantDb.tenantJoin(query, 'tickets as t', 'ar.ticket_id', 't.ticket_id', { type: 'left' });

      // Apply scoped access filter unless the user can see all requests
      // (full access, or a company-wide approver).
      if (!hasFullAccess && !canSeeAllRequests) {
        query = query.whereIn('ar.preferred_assigned_user_id', scopedUserIds);
      }

      // Apply filters
      if (validatedFilters.status) {
        query = query.where('ar.status', validatedFilters.status);
      }

      if (validatedFilters.service_id) {
        query = query.where('ar.service_id', validatedFilters.service_id);
      }

      if (validatedFilters.client_id) {
        query = query.where('ar.client_id', validatedFilters.client_id);
      }

      if (validatedFilters.assigned_user_id) {
        query = query.where('ar.preferred_assigned_user_id', validatedFilters.assigned_user_id);
      }

      if (validatedFilters.start_date) {
        query = query.where('ar.requested_date', '>=', validatedFilters.start_date);
      }

      if (validatedFilters.end_date) {
        query = query.where('ar.requested_date', '<=', validatedFilters.end_date);
      }

      if (validatedFilters.is_authenticated !== undefined && validatedFilters.is_authenticated !== null) {
        query = query.where('ar.is_authenticated', validatedFilters.is_authenticated);
      }

      if (validatedFilters.search_query) {
        const searchTerm = `%${validatedFilters.search_query}%`;
        query = query.where(function() {
          this.whereILike('sc.service_name', searchTerm)
            .orWhereILike('c.client_name', searchTerm)
            .orWhereILike('con.full_name', searchTerm)
            .orWhereILike('ar.requester_name', searchTerm)
            .orWhereILike('ar.description', searchTerm);
        });
      }

      return await query;
    });

    return { success: true, data: requests as IAppointmentRequest[] };
  } catch (error) {
    console.error('Error fetching appointment requests:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch appointment requests';
    return { success: false, error: message };
  }
});

/**
 * Get appointment requests linked to a specific ticket
 */
export const getAppointmentRequestsByTicketId = withAuth(async (
  user,
  { tenant },
  ticketId: string
): Promise<AppointmentRequestResult<IAppointmentRequest[]>> => {
  try {
    const { knex: db } = await createTenantKnex();

    // Check permissions - use same permission as schedule actions
    const canRead = await hasPermission(user, 'user_schedule', 'read', db) || await hasPermission(user, 'user_schedule', 'update', db);
    if (!canRead) {
      return { success: false, error: 'Insufficient permissions to view appointment requests' };
    }

    const requests = await withTransaction(db, async (trx: Knex.Transaction) => {
      const trxTenantDb = tenantDb(trx, tenant);
      const query = trxTenantDb.table('appointment_requests as ar')
        .where('ar.ticket_id', ticketId)
        .select(
          'ar.*',
          'sc.service_name',
          'c.client_name as client_company_name',
          'con.full_name as contact_name',
          'con.email as contact_email',
          'u.first_name as preferred_technician_first_name',
          'u.last_name as preferred_technician_last_name',
          'approver.first_name as approver_first_name',
          'approver.last_name as approver_last_name',
          't.ticket_number'
        )
        .orderBy('ar.created_at', 'desc');
      trxTenantDb.tenantJoin(query, 'service_catalog as sc', 'ar.service_id', 'sc.service_id', { type: 'left' });
      trxTenantDb.tenantJoin(query, 'clients as c', 'ar.client_id', 'c.client_id', { type: 'left' });
      trxTenantDb.tenantJoin(query, 'contacts as con', 'ar.contact_id', 'con.contact_name_id', { type: 'left' });
      trxTenantDb.tenantJoin(query, 'users as u', 'ar.preferred_assigned_user_id', 'u.user_id', { type: 'left' });
      trxTenantDb.tenantJoin(query, 'users as approver', 'ar.approved_by_user_id', 'approver.user_id', { type: 'left' });
      trxTenantDb.tenantJoin(query, 'tickets as t', 'ar.ticket_id', 't.ticket_id', { type: 'left' });
      return await query;
    });

    return { success: true, data: requests as IAppointmentRequest[] };
  } catch (error) {
    console.error('Error fetching appointment requests by ticket ID:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch appointment requests';
    return { success: false, error: message };
  }
});

/**
 * Approve an appointment request and create a schedule entry
 */
export const approveAppointmentRequest = withAuth(async (
  user,
  { tenant },
  data: ApproveAppointmentRequestInput
): Promise<AppointmentRequestResult<IAppointmentRequest>> => {
  try {
    // Validate input
    const validatedData = approveAppointmentRequestSchema.parse(data);

    const { knex: db } = await createTenantKnex();

    // Permission gate: either the global schedule perm, or being a configured approver
    // for this specific request. The latter is checked inside the transaction so we can
    // match against the request's preferred technician.
    const canUpdate = await hasPermission(user, 'user_schedule', 'update', db);
    const interactionSideEffects: Array<() => Promise<void>> = [];
    const teamsMeetingService = validatedData.generate_teams_meeting
      ? await resolveTeamsMeetingService()
      : null;
    let preparedTeamsMeeting: CreateTeamsMeetingResult | null = null;
    let createdMeetingForCompensation: CreateTeamsMeetingResult | null = null;
    let teamsMeetingWarning: string | undefined;
    let failedMeetingErrorCode: string | null = null;

    if (validatedData.generate_teams_meeting && teamsMeetingService) {
      const meetingInput = await withTransaction(db, async (trx: Knex.Transaction) => {
        const trxTenantDb = tenantDb(trx, tenant);
        const request = await trxTenantDb.table('appointment_requests')
          .where({
            appointment_request_id: validatedData.appointment_request_id
          })
          .first();

        if (!request) {
          throw new Error('Appointment request not found');
        }

        if (request.status !== 'pending') {
          throw new Error(`Cannot approve request with status: ${request.status}`);
        }

        if (!canUpdate) {
          const isApprover = await isConfiguredApproverFor(
            trx,
            tenant,
            user.user_id,
            request.preferred_assigned_user_id ?? null
          );
          if (!isApprover) {
            throw new Error('Insufficient permissions to approve appointment requests');
          }
        }

        const assignedUser = await trxTenantDb.table('users')
          .where({
            user_id: validatedData.assigned_user_id
          })
          .first();

        if (!assignedUser) {
          throw new Error('Assigned user not found');
        }

        const service = await trxTenantDb.table('service_catalog')
          .where({
            service_id: request.service_id
          })
          .first();

        if (!service) {
          throw new Error('Service not found');
        }

        const fallbackDate = normalizeDateValue(request.requested_date);
        const fallbackTime = normalizeTimeValue(request.requested_time);

        if (!fallbackDate || !fallbackTime) {
          throw new Error('Invalid requested date/time on appointment request');
        }

        const finalDate = validatedData.final_date ?? fallbackDate;
        const finalTime = (validatedData.final_time ?? fallbackTime).slice(0, 5);
        const approvalUsesRequestedFallback = !validatedData.final_date && !validatedData.final_time;
        const dateStr = normalizeDateValue(finalDate);

        if (!dateStr) {
          throw new Error('Invalid final date provided for approval');
        }

        const scheduledStart = approvalUsesRequestedFallback
          ? fromZonedTime(`${dateStr}T${finalTime}:00`, request.requester_timezone || 'UTC')
          : new Date(`${dateStr}T${finalTime}:00Z`);

        if (isNaN(scheduledStart.getTime())) {
          throw new Error(`Invalid date/time: ${dateStr}T${finalTime}`);
        }

        const scheduledEnd = new Date(scheduledStart.getTime() + request.requested_duration * 60000);

        // The client contact and the assigned technician receive native
        // calendar invites (F011/F012): resolve their emails here so the
        // Graph event carries the attendee list.
        let contactEmail: string | null = request.requester_email || null;
        let contactName: string | null = request.requester_name || null;
        if (request.is_authenticated && request.contact_id) {
          const contact = await trxTenantDb.table('contacts')
            .where({ contact_name_id: request.contact_id })
            .first('email', 'full_name');
          contactEmail = contact?.email || contactEmail;
          contactName = contact?.full_name || contactName;
        }

        return {
          appointmentRequestId: request.appointment_request_id,
          subject: `Appointment: ${service.service_name}`,
          serviceName: service.service_name,
          description: request.description || null,
          startDateTime: scheduledStart.toISOString(),
          endDateTime: scheduledEnd.toISOString(),
          contact: { email: contactEmail, name: contactName },
          technician: {
            email: assignedUser.email || null,
            name: [assignedUser.first_name, assignedUser.last_name].filter(Boolean).join(' ') || null,
          },
        };
      });

      const outcome = await teamsMeetingService.createTeamsMeetingWithResult({
        tenantId: tenant,
        subject: meetingInput.subject,
        startDateTime: meetingInput.startDateTime,
        endDateTime: meetingInput.endDateTime,
        attendees: buildTeamsMeetingAttendees({
          contact: meetingInput.contact,
          technician: meetingInput.technician,
        }),
        bodyHtml: buildAppointmentMeetingBodyHtml({
          serviceName: meetingInput.serviceName,
          appointmentRequestId: meetingInput.appointmentRequestId,
          description: meetingInput.description,
        }),
        appointmentRequestId: meetingInput.appointmentRequestId,
      });

      if (outcome.status === 'created') {
        preparedTeamsMeeting = outcome.meeting;
        createdMeetingForCompensation = outcome.meeting;
      } else if (outcome.status === 'skipped') {
        teamsMeetingWarning = teamsMeetingSkipWarning(outcome.reason);
      } else if (!validatedData.approve_without_meeting) {
        // Graph failure surfaces at approval time (F022): abort so the
        // approver can retry — a silent link-less approval is never produced.
        return {
          success: false,
          error: 'The Microsoft Teams meeting could not be created, so the appointment was not approved. Retry, or approve without a meeting.',
          meetingCreationFailed: true,
        };
      } else {
        failedMeetingErrorCode = outcome.errorCode;
        teamsMeetingWarning = 'Appointment approved without a Microsoft Teams meeting because meeting creation failed. Use "Generate Teams meeting" on the approved request to retry.';
      }
    }

    let result;
    try {
      result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const trxTenantDb = tenantDb(trx, tenant);
      // Get the appointment request
      const request = await trxTenantDb.table('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id
        })
        .first();

      if (!request) {
        throw new Error('Appointment request not found');
      }

      if (request.status !== 'pending') {
        throw new Error(`Cannot approve request with status: ${request.status}`);
      }

      if (!canUpdate) {
        const isApprover = await isConfiguredApproverFor(
          trx,
          tenant,
          user.user_id,
          request.preferred_assigned_user_id ?? null
        );
        if (!isApprover) {
          throw new Error('Insufficient permissions to approve appointment requests');
        }
      }

      // Use final date/time if provided, otherwise use requested
      const fallbackDate = normalizeDateValue(request.requested_date);
      const fallbackTime = normalizeTimeValue(request.requested_time);

      if (!fallbackDate || !fallbackTime) {
        throw new Error('Invalid requested date/time on appointment request');
      }

      const finalDate = validatedData.final_date ?? fallbackDate;
      const finalTime = (validatedData.final_time ?? fallbackTime).slice(0, 5);
      const approvalUsesRequestedFallback = !validatedData.final_date && !validatedData.final_time;

      // Verify assigned user exists
      const assignedUser = await trxTenantDb.table('users')
        .where({
          user_id: validatedData.assigned_user_id
        })
        .first();

      if (!assignedUser) {
        throw new Error('Assigned user not found');
      }

      // Get service details
      const service = await trxTenantDb.table('service_catalog')
        .where({
          service_id: request.service_id
        })
        .first();

      if (!service) {
        throw new Error('Service not found');
      }

      // Create or update schedule entry
      const dateStr = normalizeDateValue(finalDate);
      if (!dateStr) {
        throw new Error('Invalid final date provided for approval');
      }

      const scheduledStart = approvalUsesRequestedFallback
        ? fromZonedTime(`${dateStr}T${finalTime}:00`, request.requester_timezone || 'UTC')
        : new Date(`${dateStr}T${finalTime}:00Z`);

      if (isNaN(scheduledStart.getTime())) {
        throw new Error(`Invalid date/time: ${dateStr}T${finalTime}`);
      }

      const scheduledEnd = new Date(scheduledStart.getTime() + request.requested_duration * 60000);
      let onlineMeetingUrl: string | null = null;
      let onlineMeetingId: string | null = null;
      let onlineMeetingEventId: string | null = null;
      let onlineMeetingOrganizerUpn: string | null = null;
      let onlineMeetingOrganizerUserId: string | null = null;

      let scheduleEntry;

      if (request.schedule_entry_id) {
        // Update existing schedule entry (created when request was submitted)
        const newTitle = `Appointment: ${service.service_name}`;
        console.log('[approveAppointmentRequest] Updating schedule entry title:', {
          entry_id: request.schedule_entry_id,
          old_title_pattern: '[Pending Request] ...',
          new_title: newTitle
        });

        await trxTenantDb.table('schedule_entries')
          .where({
            entry_id: request.schedule_entry_id
          })
          .update({
            title: newTitle, // Remove [Pending Request] prefix
            scheduled_start: scheduledStart.toISOString(),
            scheduled_end: scheduledEnd.toISOString(),
            notes: request.description || '',
            updated_at: new Date()
          });

        // Reconcile the assignee to the approver's selection. The pending entry may
        // have been created unassigned (request had no preferred technician), so we
        // must insert when no assignee row exists yet — not only when one differs.
        const currentAssignee = await trxTenantDb.table('schedule_entry_assignees')
          .where({
            entry_id: request.schedule_entry_id
          })
          .first();

        if ((currentAssignee?.user_id || null) !== validatedData.assigned_user_id) {
          // Clear any existing assignees
          await trxTenantDb.table('schedule_entry_assignees')
            .where({
              entry_id: request.schedule_entry_id
            })
            .delete();

          // Assign the approver-selected user
          await trxTenantDb.table('schedule_entry_assignees').insert({
            entry_id: request.schedule_entry_id,
            user_id: validatedData.assigned_user_id,
            tenant,
            created_at: new Date()
          });
        }

        scheduleEntry = {
          entry_id: request.schedule_entry_id
        };

        // Get the updated schedule entry for the event
        const updatedEntry = await trxTenantDb.table('schedule_entries')
          .where({
            entry_id: request.schedule_entry_id
          })
          .first();

        // Publish SCHEDULE_ENTRY_UPDATED event for calendar sync
        try {
          await publishEvent({
            eventType: 'SCHEDULE_ENTRY_UPDATED',
            payload: {
              tenantId: tenant,
              userId: user.user_id,
              entryId: request.schedule_entry_id,
              changes: {
                after: updatedEntry,
                assignedUserIds: [validatedData.assigned_user_id]
              }
            }
          });
        } catch (eventError) {
          console.error('[AppointmentApproval] Failed to publish SCHEDULE_ENTRY_UPDATED event', eventError);
        }

        try {
          const ctx = {
            tenantId: tenant,
            actor: { actorType: 'USER' as const, actorUserId: user.user_id },
          };
          const previousAssigneeId = currentAssignee?.user_id;
          const newAssigneeId = validatedData.assigned_user_id;
          if (newAssigneeId && newAssigneeId !== previousAssigneeId) {
            await publishWorkflowEvent({
              eventType: 'APPOINTMENT_ASSIGNED',
              ctx,
              payload: buildAppointmentAssignedPayload({
                appointmentId: request.schedule_entry_id,
                ticketId: validatedData.ticket_id || request.ticket_id || undefined,
                previousAssigneeId,
                newAssigneeId,
              }),
            });
          }
        } catch (eventError) {
          console.error('[AppointmentApproval] Failed to publish APPOINTMENT_ASSIGNED workflow event', eventError);
        }
      } else {
        // Create new schedule entry (fallback for old requests)
        const scheduleEntryData = {
          title: `Appointment: ${service.service_name}`,
          scheduled_start: scheduledStart,
          scheduled_end: scheduledEnd,
          work_item_type: 'appointment_request' as const,
          work_item_id: request.appointment_request_id,
          status: 'scheduled',
          notes: request.description || '',
          assigned_user_ids: [validatedData.assigned_user_id],
          is_recurring: false,
          is_private: false
        };

        scheduleEntry = await ScheduleEntry.create(trx, tenant, scheduleEntryData, {
          assignedUserIds: [validatedData.assigned_user_id]
        });

        // Publish SCHEDULE_ENTRY_CREATED event for calendar sync
        try {
          await publishEvent({
            eventType: 'SCHEDULE_ENTRY_CREATED',
            payload: {
              tenantId: tenant,
              userId: user.user_id,
              entryId: scheduleEntry.entry_id,
              changes: {
                after: scheduleEntry,
                assignedUserIds: [validatedData.assigned_user_id]
              }
            }
          });
        } catch (eventError) {
          console.error('[AppointmentApproval] Failed to publish SCHEDULE_ENTRY_CREATED event', eventError);
        }

        try {
          const ctx = {
            tenantId: tenant,
            actor: { actorType: 'USER' as const, actorUserId: user.user_id },
          };

          await publishWorkflowEvent({
            eventType: 'APPOINTMENT_CREATED',
            ctx,
            payload: buildAppointmentCreatedPayload({
              entry: scheduleEntry,
              ticketId: validatedData.ticket_id || request.ticket_id || undefined,
              timezone: 'UTC',
              createdByUserId: user.user_id,
            }),
          });

          await publishWorkflowEvent({
            eventType: 'APPOINTMENT_ASSIGNED',
            ctx,
            payload: buildAppointmentAssignedPayload({
              appointmentId: scheduleEntry.entry_id,
              ticketId: validatedData.ticket_id || request.ticket_id || undefined,
              newAssigneeId: validatedData.assigned_user_id,
            }),
          });
        } catch (eventError) {
          console.error('[AppointmentApproval] Failed to publish APPOINTMENT_CREATED/APPOINTMENT_ASSIGNED workflow events', eventError);
        }
      }

      const now = new Date();

      if (preparedTeamsMeeting) {
        onlineMeetingUrl = preparedTeamsMeeting.joinWebUrl;
        onlineMeetingId = preparedTeamsMeeting.meetingId;
        onlineMeetingEventId = preparedTeamsMeeting.eventId ?? null;
        onlineMeetingOrganizerUpn = preparedTeamsMeeting.organizerUpn ?? null;
        onlineMeetingOrganizerUserId = preparedTeamsMeeting.organizerUserId ?? null;
      }

      let onlineMeetingInteractionId: string | null = null;
      if (onlineMeetingUrl && onlineMeetingId) {
        // Anonymous public bookings have no client/contact; interactions require one,
        // so the meeting is recorded without an interaction in that case.
        if (request.client_id || request.contact_id) {
          const onlineMeetingType = await tenantDb(trx, tenant).table('system_interaction_types')
            .where({ type_name: 'Online Meeting' })
            .first('type_id');

          if (!onlineMeetingType?.type_id) {
            throw new Error('Online Meeting interaction type is not configured');
          }

          // Dynamic import: cross-vertical (scheduling -> clients) idiom; see
          // custom-rules/no-feature-to-feature-imports.
          const { createInteractionWithSideEffects } = await import('@alga-psa/clients/actions/interactionCreateHelper');
          const interactionResult = await createInteractionWithSideEffects({
            tenant,
            trx,
            user,
            interactionData: {
              type_id: onlineMeetingType.type_id,
              client_id: request.client_id ?? null,
              contact_name_id: request.contact_id ?? null,
              user_id: user.user_id,
              ticket_id: validatedData.ticket_id || request.ticket_id || null,
              title: `Online Meeting: ${service.service_name}`,
              notes: `Join Teams Meeting: ${onlineMeetingUrl}`,
              start_time: scheduledStart,
              end_time: scheduledEnd,
              duration: request.requested_duration,
            },
          });

          onlineMeetingInteractionId = interactionResult.interaction.interaction_id;
          interactionSideEffects.push(interactionResult.publishSideEffects);
        }

        await trxTenantDb.table('online_meetings').insert({
          meeting_id: uuidv4(),
          tenant,
          provider: 'teams',
          provider_meeting_id: onlineMeetingId,
          provider_event_id: onlineMeetingEventId,
          organizer_upn: onlineMeetingOrganizerUpn,
          organizer_user_id: onlineMeetingOrganizerUserId,
          subject: `Appointment: ${service.service_name}`,
          join_url: onlineMeetingUrl,
          start_time: scheduledStart,
          end_time: scheduledEnd,
          status: 'scheduled',
          recording_fetch_attempts: 0,
          last_fetch_at: null,
          appointment_request_id: request.appointment_request_id,
          interaction_id: onlineMeetingInteractionId,
          schedule_entry_id: scheduleEntry.entry_id,
          created_by: user.user_id,
          created_at: now,
          updated_at: now,
        });
      } else if (failedMeetingErrorCode) {
        // Failed creation is persisted, never silent absence (F024): the row
        // records the error code and backs the "Generate Teams meeting" retry.
        await trxTenantDb.table('online_meetings').insert({
          meeting_id: uuidv4(),
          tenant,
          provider: 'teams',
          provider_meeting_id: null,
          provider_event_id: null,
          organizer_upn: null,
          organizer_user_id: null,
          subject: `Appointment: ${service.service_name}`,
          join_url: null,
          start_time: scheduledStart,
          end_time: scheduledEnd,
          status: 'failed',
          error_code: failedMeetingErrorCode,
          recording_fetch_attempts: 0,
          last_fetch_at: null,
          appointment_request_id: request.appointment_request_id,
          interaction_id: null,
          schedule_entry_id: scheduleEntry.entry_id,
          created_by: user.user_id,
          created_at: now,
          updated_at: now,
        });
      }

      // Update appointment request
      await trxTenantDb.table('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id
        })
        .update({
          status: 'approved',
          schedule_entry_id: scheduleEntry.entry_id,
          approved_by_user_id: user.user_id,
          approved_at: now,
          ticket_id: validatedData.ticket_id || request.ticket_id,
          online_meeting_provider: onlineMeetingUrl && onlineMeetingId ? 'teams' : request.online_meeting_provider || null,
          online_meeting_url: onlineMeetingUrl || request.online_meeting_url || null,
          online_meeting_id: onlineMeetingId || request.online_meeting_id || null,
          updated_at: now
        });

      // Get updated request
      const updatedRequest = await trxTenantDb.table('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id
        })
        .first();

      // Get client user ID if available
      let clientUserId: string | undefined;
      if (request.is_authenticated && request.contact_id) {
        const clientUser = await trxTenantDb.table('users')
          .select('user_id')
          .where({
            contact_id: request.contact_id,
            user_type: 'client'
          })
          .first();
        clientUserId = clientUser?.user_id;
      }

      // Publish event (will trigger internal notifications automatically)
      await publishEvent({
        eventType: 'APPOINTMENT_REQUEST_APPROVED',
        payload: {
          tenantId: tenant || '',
          appointmentRequestId: request.appointment_request_id,
          clientId: request.client_id,
          contactId: request.contact_id,
          clientUserId,
          serviceId: request.service_id,
          serviceName: service.service_name,
          requestedDate: finalDate,
          requestedTime: finalTime,
          requestedDuration: request.requested_duration,
          isAuthenticated: request.is_authenticated,
          requesterEmail: request.requester_email || '',
          requesterName: request.requester_name,
          approvedByUserId: user.user_id,
          assignedUserId: validatedData.assigned_user_id,
          scheduleEntryId: scheduleEntry.entry_id
        }
      });

      // Send emails using SystemEmailService
      try {
        const emailService = SystemEmailService.getInstance();

        // Shared data for both client and technician emails
        const tenantSettings = await getTenantSettings(tenant);
        const scheduleEntryWithDetails = await trxTenantDb.table('schedule_entries')
          .where({ entry_id: scheduleEntry.entry_id })
          .first();
        const calendarLink = await generateICSLink(scheduleEntryWithDetails);

        // scheduledStart is a UTC instant. Render it per recipient: the requester
        // sees their own local time, the technician theirs, both labeled.
        const requesterTz = (request as any).requester_timezone || 'UTC';
        const requesterFormatted = await formatEmailDateTime(scheduledStart, requesterTz);
        const technicianTz = await resolveEffectiveTimeZone(trx, tenant, validatedData.assigned_user_id);
        const technicianFormatted = await formatEmailDateTime(scheduledStart, technicianTz);

        // Generate ICS file for email attachment
        const icsDescriptionLines = [
          request.description || `Appointment for ${service.service_name}`,
        ];

        if (onlineMeetingUrl) {
          icsDescriptionLines.push(`Join Teams Meeting: ${onlineMeetingUrl}`);
        }

        const icsEventData: ICSEventData = {
          uid: scheduleEntry.entry_id,
          title: `Appointment: ${service.service_name}`,
          description: icsDescriptionLines.join('\n'),
          location: onlineMeetingUrl ? 'Microsoft Teams Meeting' : undefined,
          startDate: new Date(scheduleEntryWithDetails.scheduled_start),
          endDate: new Date(scheduleEntryWithDetails.scheduled_end),
          organizerName: `${assignedUser.first_name} ${assignedUser.last_name}`,
          organizerEmail: assignedUser.email || tenantSettings.contactEmail,
          url: onlineMeetingUrl || undefined,
        };
        const icsBuffer = generateICSBuffer(icsEventData);
        const icsFilename = generateICSFilename(`Appointment-${service.service_name}`);
        const icsAttachment = { filename: icsFilename, content: icsBuffer };

        // 1. Send approval email to client/requester
        let recipientEmail = '';
        let recipientName = '';

        if (request.is_authenticated) {
          const contact = await trxTenantDb.table('contacts')
            .where({ contact_name_id: request.contact_id })
            .first();
          recipientEmail = contact?.email || '';
          recipientName = contact?.full_name || '';
        } else {
          recipientEmail = request.requester_email || '';
          recipientName = request.requester_name || '';
        }

        if (recipientEmail) {
          await emailService.sendAppointmentRequestApproved({
            requesterName: recipientName,
            requesterEmail: recipientEmail,
            serviceName: service.service_name,
            appointmentDate: requesterFormatted.date,
            appointmentTime: requesterFormatted.time,
            duration: request.requested_duration,
            technicianName: `${assignedUser.first_name} ${assignedUser.last_name}`,
            technicianEmail: assignedUser.email || '',
            technicianPhone: assignedUser.phone || '',
            onlineMeetingUrl: onlineMeetingUrl || undefined,
            calendarLink: calendarLink,
            cancellationPolicy: 'Please cancel at least 24 hours in advance.',
            minimumNoticeHours: 24,
            contactEmail: tenantSettings.contactEmail,
            contactPhone: tenantSettings.contactPhone
          }, {
            tenantId: tenant,
            icsAttachment
          });
          console.log(`[AppointmentRequest] Approval email sent to ${recipientEmail}`);
        }

        // 2. Send assignment email to technician with ICS
        if (assignedUser.email) {
          // Get client name for the technician email
          let clientName = '';
          if (request.client_id) {
            const client = await trxTenantDb.table('clients')
              .where({ client_id: request.client_id })
              .select('client_name')
              .first();
            clientName = client?.client_name || recipientName || '';
          } else {
            clientName = recipientName || '';
          }

          await emailService.sendAppointmentAssignedNotification({
            technicianName: `${assignedUser.first_name} ${assignedUser.last_name}`,
            technicianEmail: assignedUser.email,
            serviceName: service.service_name,
            appointmentDate: technicianFormatted.date,
            appointmentTime: technicianFormatted.time,
            duration: request.requested_duration,
            clientName,
            description: request.description || '',
            onlineMeetingUrl: onlineMeetingUrl || undefined,
            calendarLink: calendarLink,
            contactEmail: tenantSettings.contactEmail,
            contactPhone: tenantSettings.contactPhone
          }, {
            tenantId: tenant,
            icsAttachment
          });
          console.log(`[AppointmentRequest] Assignment email with ICS sent to technician ${assignedUser.email}`);
        }

        console.log(`[AppointmentRequest] Request ${request.appointment_request_id} approved by ${user.user_id}`);
      } catch (emailError) {
        console.error('Error sending approval emails:', emailError);
        // Don't fail the approval if email fails
      }

      return {
        updatedRequest,
        teamsMeetingWarning,
      };
      });
      createdMeetingForCompensation = null;
    } catch (transactionError) {
      if (createdMeetingForCompensation && teamsMeetingService) {
        try {
          await teamsMeetingService.deleteTeamsMeeting({
            tenantId: tenant,
            meetingId: createdMeetingForCompensation.meetingId,
            eventId: createdMeetingForCompensation.eventId ?? null,
            appointmentRequestId: validatedData.appointment_request_id,
          });
        } catch (compensationError) {
          console.error('Failed to delete orphaned Teams meeting after approval failure:', compensationError);
        }
      }

      throw transactionError;
    }

    for (const publishSideEffects of interactionSideEffects) {
      try {
        await publishSideEffects();
      } catch (eventError) {
        console.error('[AppointmentApproval] Failed to publish Online Meeting interaction side effects', eventError);
      }
    }

    return {
      success: true,
      data: result.updatedRequest as IAppointmentRequest,
      teamsMeetingWarning: result.teamsMeetingWarning,
    };
  } catch (error) {
    console.error('Error approving appointment request:', error);
    const message = error instanceof Error ? error.message : 'Failed to approve appointment request';
    return { success: false, error: message };
  }
});

/**
 * Decline an appointment request
 */
export const declineAppointmentRequest = withAuth(async (
  user,
  { tenant },
  data: DeclineAppointmentRequestInput
): Promise<AppointmentRequestResult<void>> => {
  try {
    // Validate input
    const validatedData = declineAppointmentRequestSchema.parse(data);

    const { knex: db } = await createTenantKnex();

    // Permission gate: either the global schedule perm, or being a configured approver
    // for this specific request. The latter is checked inside the transaction so we can
    // match against the request's preferred technician.
    const canUpdate = await hasPermission(user, 'user_schedule', 'update', db);

    const meetingsToCleanUp = await withTransaction(db, async (trx: Knex.Transaction) => {
      const trxTenantDb = tenantDb(trx, tenant);
      // Get the appointment request
      const request = await trxTenantDb.table('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id
        })
        .first();

      if (!request) {
        throw new Error('Appointment request not found');
      }

      // Declining a previously-approved request revokes it (F018): the
      // schedule entry is removed and the Teams meeting is cleaned up on
      // Graph, exactly like a client cancellation.
      if (!['pending', 'approved'].includes(request.status)) {
        throw new Error(`Cannot decline request with status: ${request.status}`);
      }

      if (!canUpdate) {
        const isApprover = await isConfiguredApproverFor(
          trx,
          tenant,
          user.user_id,
          request.preferred_assigned_user_id ?? null
        );
        if (!isApprover) {
          throw new Error('Insufficient permissions to decline appointment requests');
        }
      }

      const now = new Date();

      // Delete the schedule entry if it exists
      if (request.schedule_entry_id) {
        // Delete assignees first (foreign key constraint)
        await trxTenantDb.table('schedule_entry_assignees')
          .where({
            entry_id: request.schedule_entry_id
          })
          .delete();

        // Delete the schedule entry
        await trxTenantDb.table('schedule_entries')
          .where({
            entry_id: request.schedule_entry_id
          })
          .delete();
      }

      // Update request status
      await trxTenantDb.table('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id
        })
        .update({
          status: 'declined',
          declined_reason: validatedData.decline_reason,
          approved_by_user_id: user.user_id,
          approved_at: now,
          schedule_entry_id: null, // Clear the schedule entry reference
          updated_at: now
        });

      // Live Teams meetings move to cancel_pending until the idempotent
      // cleanup job confirms Graph deletion (F019); rows without a provider
      // meeting (failed creations) are cancelled directly.
      const meetings = await trxTenantDb.table('online_meetings')
        .where({
          appointment_request_id: validatedData.appointment_request_id,
        })
        .whereNotIn('status', ['cancelled'])
        .select('meeting_id', 'provider', 'provider_meeting_id');

      const cleanupTargets: string[] = [];
      for (const meeting of meetings) {
        const needsGraphCleanup = meeting.provider === 'teams' && meeting.provider_meeting_id;
        await trxTenantDb.table('online_meetings')
          .where({ meeting_id: meeting.meeting_id })
          .update({
            status: needsGraphCleanup ? 'cancel_pending' : 'cancelled',
            updated_at: now,
          });
        if (needsGraphCleanup) {
          cleanupTargets.push(meeting.meeting_id);
        }
      }

      // Get service details
      const service = await trxTenantDb.table('service_catalog')
        .where({
          service_id: request.service_id
        })
        .first();

      if (!service) {
        throw new Error('Service not found');
      }

      // Get client user ID if available
      let clientUserId: string | undefined;
      if (request.is_authenticated && request.contact_id) {
        const clientUser = await trxTenantDb.table('users')
          .select('user_id')
          .where({
            contact_id: request.contact_id,
            user_type: 'client'
          })
          .first();
        clientUserId = clientUser?.user_id;
      }

      // Publish event (will trigger internal notifications automatically)
      await publishEvent({
        eventType: 'APPOINTMENT_REQUEST_DECLINED',
        payload: {
          tenantId: tenant || '',
          appointmentRequestId: request.appointment_request_id,
          clientId: request.client_id,
          contactId: request.contact_id,
          clientUserId,
          serviceId: request.service_id,
          serviceName: service.service_name,
          requestedDate: request.requested_date,
          requestedTime: request.requested_time,
          requestedDuration: request.requested_duration,
          isAuthenticated: request.is_authenticated,
          requesterEmail: request.requester_email || '',
          requesterName: request.requester_name,
          declineReason: validatedData.decline_reason
        }
      });

      // Send notification email
      try {
        const emailService = SystemEmailService.getInstance();
        let recipientEmail = '';
        let recipientName = '';

        if (request.is_authenticated) {
          // Get contact email
          const contact = await trxTenantDb.table('contacts')
            .where({
              contact_name_id: request.contact_id
            })
            .first();

          recipientEmail = contact?.email || '';
          recipientName = contact?.full_name || '';
        } else {
          // Use requester email from request
          recipientEmail = request.requester_email || '';
          recipientName = request.requester_name || '';
        }

        if (recipientEmail && tenant) {
          // Get tenant settings
          const tenantSettings = await getTenantSettings(tenant);
          const requestNewAppointmentLink = await getRequestNewAppointmentLink();

          // requested_date/requested_time are the requester's wall-clock; label their timezone.
          const declineTz = (request as any).requester_timezone || 'UTC';
          const declineDateStr = normalizeDateValue(request.requested_date) || '';
          const declineTimeStr = normalizeTimeValue(request.requested_time) || '';
          const declineTzLabel = declineDateStr && declineTimeStr
            ? ` (${formatInTimeZone(fromZonedTime(`${declineDateStr}T${declineTimeStr}:00`, declineTz), declineTz, 'zzz')})`
            : '';

          await emailService.sendAppointmentRequestDeclined({
            requesterName: recipientName,
            requesterEmail: recipientEmail,
            serviceName: service.service_name,
            requestedDate: await formatDate(declineDateStr),
            requestedTime: `${await formatTime(declineTimeStr)}${declineTzLabel}`,
            referenceNumber: request.appointment_request_id.slice(0, 8).toUpperCase(),
            declineReason: validatedData.decline_reason,
            requestNewAppointmentLink,
            contactEmail: tenantSettings.contactEmail,
            contactPhone: tenantSettings.contactPhone
          }, {
            tenantId: tenant
          });

          console.log(`[AppointmentRequest] Decline email sent to ${recipientEmail}`);
        }

        console.log(`[AppointmentRequest] Request ${request.appointment_request_id} declined by ${user.user_id}`);
      } catch (emailError) {
        console.error('Error sending decline email:', emailError);
        // Don't fail the decline if email fails
      }

      return cleanupTargets;
    });

    for (const meetingId of meetingsToCleanUp) {
      await enqueueTeamsMeetingCleanupJob(tenant, meetingId);
    }

    return { success: true };
  } catch (error) {
    console.error('Error declining appointment request:', error);
    const message = error instanceof Error ? error.message : 'Failed to decline appointment request';
    return { success: false, error: message };
  }
});

/**
 * Update the requested date/time before approval
 */
export const updateAppointmentRequestDateTime = withAuth(async (
  user,
  { tenant },
  data: UpdateAppointmentRequestDateTimeInput
): Promise<AppointmentRequestResult<IAppointmentRequest>> => {
  try {
    // Validate input
    const validatedData = updateAppointmentRequestDateTimeSchema.parse(data);

    const { knex: db } = await createTenantKnex();

    // Permission gate: either the global schedule perm, or being a configured approver
    // for this specific request.
    const canUpdate = await hasPermission(user, 'user_schedule', 'update', db);

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const trxTenantDb = tenantDb(trx, tenant);
      // Get the appointment request
      const request = await trxTenantDb.table('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id
        })
        .first();

      if (!request) {
        throw new Error('Appointment request not found');
      }

      if (!['pending', 'approved'].includes(request.status)) {
        throw new Error(`Cannot update request with status: ${request.status}`);
      }

      if (!canUpdate) {
        const isApprover = await isConfiguredApproverFor(
          trx,
          tenant,
          user.user_id,
          request.preferred_assigned_user_id ?? null
        );
        if (!isApprover) {
          throw new Error('Insufficient permissions to update appointment requests');
        }
      }

      const now = new Date();
      const effectiveTimezone = validatedData.new_timezone ?? request.requester_timezone ?? 'UTC';
      const effectiveDuration = validatedData.new_duration ?? request.requested_duration;
      let teamsMeetingUpdateInput: {
        tenantId: string;
        meetingId: string;
        eventId?: string | null;
        startDateTime: string;
        endDateTime: string;
        subject?: string | null;
        attendees?: TeamsMeetingAttendee[] | null;
        bodyHtml?: string | null;
        appointmentRequestId: string;
      } | null = null;

      // Reschedules PATCH subject + attendees in addition to times (F016) so
      // Graph sends updated invites; the technician attendee reflects the
      // current assignee (refreshed if the assignment changed since approval).
      const buildMeetingUpdateContext = async (): Promise<{
        subject: string | null;
        attendees: TeamsMeetingAttendee[];
        bodyHtml: string | null;
      }> => {
        const service = await trxTenantDb.table('service_catalog')
          .where({ service_id: request.service_id })
          .first('service_name');

        let contactEmail: string | null = request.requester_email || null;
        let contactName: string | null = request.requester_name || null;
        if (request.is_authenticated && request.contact_id) {
          const contact = await trxTenantDb.table('contacts')
            .where({ contact_name_id: request.contact_id })
            .first('email', 'full_name');
          contactEmail = contact?.email || contactEmail;
          contactName = contact?.full_name || contactName;
        }

        let technician: TeamsMeetingParticipant | null = null;
        if (request.schedule_entry_id) {
          const assignee = await trxTenantDb.table('schedule_entry_assignees')
            .where({ entry_id: request.schedule_entry_id })
            .first('user_id');
          if (assignee?.user_id) {
            const technicianUser = await trxTenantDb.table('users')
              .where({ user_id: assignee.user_id })
              .first('email', 'first_name', 'last_name');
            if (technicianUser) {
              technician = {
                email: technicianUser.email || null,
                name: [technicianUser.first_name, technicianUser.last_name].filter(Boolean).join(' ') || null,
              };
            }
          }
        }

        return {
          subject: service?.service_name ? `Appointment: ${service.service_name}` : null,
          attendees: buildTeamsMeetingAttendees({
            contact: { email: contactEmail, name: contactName },
            technician,
          }),
          bodyHtml: service?.service_name
            ? buildAppointmentMeetingBodyHtml({
                serviceName: service.service_name,
                appointmentRequestId: request.appointment_request_id,
                description: request.description || null,
              })
            : null,
        };
      };
      const updateData: any = {
        requested_date: validatedData.new_date,
        requested_time: validatedData.new_time,
        requester_timezone: effectiveTimezone,
        updated_at: now
      };

      if (validatedData.new_duration) {
        updateData.requested_duration = validatedData.new_duration;
      }

      // Update request
      await trxTenantDb.table('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id
        })
        .update(updateData);

      // Keep the linked schedule entry in sync with the new local wall-clock.
      // new_date/new_time are the user's naive local time in effectiveTimezone;
      // schedule_entries.scheduled_start must be the corresponding UTC instant.
      const scheduledStart = fromZonedTime(
        `${validatedData.new_date}T${validatedData.new_time}:00`,
        effectiveTimezone
      );
      const scheduledEnd = new Date(scheduledStart.getTime() + effectiveDuration * 60000);

      if (request.schedule_entry_id) {
        const previousScheduleEntry = await trxTenantDb.table('schedule_entries')
          .where({
            entry_id: request.schedule_entry_id
          })
          .first();

        await trxTenantDb.table('schedule_entries')
          .where({
            entry_id: request.schedule_entry_id
          })
          .update({
            scheduled_start: scheduledStart.toISOString(),
            scheduled_end: scheduledEnd.toISOString(),
            updated_at: now
          });

        if (request.status === 'approved') {
          const updatedScheduleEntry = await trxTenantDb.table('schedule_entries')
            .where({
              entry_id: request.schedule_entry_id
            })
            .first();

          if (previousScheduleEntry && updatedScheduleEntry) {
            try {
              await publishEvent({
                eventType: 'SCHEDULE_ENTRY_UPDATED',
                payload: {
                  tenantId: tenant,
                  userId: user.user_id,
                  entryId: request.schedule_entry_id,
                  changes: {
                    before: previousScheduleEntry,
                    after: updatedScheduleEntry,
                  }
                }
              });
            } catch (eventError) {
              console.error('[AppointmentRequestUpdate] Failed to publish SCHEDULE_ENTRY_UPDATED event', eventError);
            }
          }
        }
      }

      const onlineMeeting = await trxTenantDb.table('online_meetings')
        .where({
          appointment_request_id: request.appointment_request_id,
        })
        .first();

      if (onlineMeeting) {
        await trxTenantDb.table('online_meetings')
          .where({
            meeting_id: onlineMeeting.meeting_id,
          })
          .update({
            start_time: scheduledStart,
            end_time: scheduledEnd,
            updated_at: now,
          });

        if (onlineMeeting.interaction_id) {
          await trxTenantDb.table('interactions')
            .where({
              interaction_id: onlineMeeting.interaction_id,
            })
            .update({
              interaction_date: scheduledStart,
              start_time: scheduledStart,
              end_time: scheduledEnd,
              duration: effectiveDuration,
            });
        }

        if (onlineMeeting.provider === 'teams' && onlineMeeting.provider_meeting_id) {
          const updateContext = await buildMeetingUpdateContext();
          teamsMeetingUpdateInput = {
            tenantId: tenant,
            meetingId: onlineMeeting.provider_meeting_id,
            eventId: onlineMeeting.provider_event_id ?? null,
            startDateTime: scheduledStart.toISOString(),
            endDateTime: scheduledEnd.toISOString(),
            subject: updateContext.subject,
            attendees: updateContext.attendees,
            bodyHtml: updateContext.bodyHtml,
            appointmentRequestId: request.appointment_request_id,
          };
        }
      } else if (request.online_meeting_id && request.online_meeting_provider === 'teams') {
        const updateContext = await buildMeetingUpdateContext();
        teamsMeetingUpdateInput = {
          tenantId: tenant,
          meetingId: request.online_meeting_id,
          eventId: null,
          startDateTime: scheduledStart.toISOString(),
          endDateTime: scheduledEnd.toISOString(),
          subject: updateContext.subject,
          attendees: updateContext.attendees,
          bodyHtml: updateContext.bodyHtml,
          appointmentRequestId: request.appointment_request_id,
        };
      }

      // Get updated request
      const updatedRequest = await trxTenantDb.table('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id
        })
        .first();

      return {
        updatedRequest,
        teamsMeetingUpdateInput,
      };
    });

    let teamsMeetingWarning: string | undefined;
    if (result.teamsMeetingUpdateInput) {
      const teamsMeetingService = await resolveTeamsMeetingService();
      const updateOutcome = await teamsMeetingService.updateTeamsMeetingWithResult(result.teamsMeetingUpdateInput);

      if (updateOutcome.status === 'skipped') {
        teamsMeetingWarning = teamsMeetingSkipWarning(updateOutcome.reason);
      } else if (updateOutcome.status === 'failed') {
        teamsMeetingWarning = 'Appointment updated, but the Microsoft Teams meeting could not be rescheduled. Please update it manually in Teams.';
      }
    }

    return {
      success: true,
      data: result.updatedRequest as IAppointmentRequest,
      teamsMeetingWarning,
    };
  } catch (error) {
    console.error('Error updating appointment request date/time:', error);
    const message = error instanceof Error ? error.message : 'Failed to update appointment request';
    return { success: false, error: message };
  }
});

/**
 * Associate an appointment request to an existing ticket
 */
export const associateRequestToTicket = withAuth(async (
  user,
  { tenant },
  data: AssociateRequestToTicketInput
): Promise<AppointmentRequestResult<void>> => {
  try {
    // Validate input
    const validatedData = associateRequestToTicketSchema.parse(data);

    const { knex: db } = await createTenantKnex();

    // Permission gate: either the global schedule perm, or being a configured approver
    // for this specific request.
    const canUpdate = await hasPermission(user, 'user_schedule', 'update', db);

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const trxTenantDb = tenantDb(trx, tenant);
      // Get the appointment request
      const request = await trxTenantDb.table('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id
        })
        .first();

      if (!request) {
        throw new Error('Appointment request not found');
      }

      if (!canUpdate) {
        const isApprover = await isConfiguredApproverFor(
          trx,
          tenant,
          user.user_id,
          request.preferred_assigned_user_id ?? null
        );
        if (!isApprover) {
          throw new Error('Insufficient permissions to update appointment requests');
        }
      }

      // Verify ticket exists
      const ticket = await trxTenantDb.table('tickets')
        .where({
          ticket_id: validatedData.ticket_id
        })
        .first();

      if (!ticket) {
        throw new Error('Ticket not found');
      }

      // For authenticated requests, verify ticket belongs to same client
      if (request.is_authenticated && request.client_id && ticket.client_id !== request.client_id) {
        throw new Error('Ticket does not belong to the same client as the appointment request');
      }

      const now = new Date();

      // Update request with ticket association
      await trxTenantDb.table('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id
        })
        .update({
          ticket_id: validatedData.ticket_id,
          updated_at: now
        });

      // If request is already approved and has a schedule entry, update that too
      if (request.schedule_entry_id) {
        await trxTenantDb.table('schedule_entries')
          .where({
            entry_id: request.schedule_entry_id
          })
          .update({
            work_item_id: validatedData.ticket_id,
            work_item_type: 'ticket',
            updated_at: now
          });
      }
    });

    return { success: true };
  } catch (error) {
    console.error('Error associating request to ticket:', error);
    const message = error instanceof Error ? error.message : 'Failed to associate request to ticket';
    return { success: false, error: message };
  }
});

/**
 * Retry action for approved requests without a meeting link (F023): creates
 * the Teams meeting (with attendees + context), records/updates the
 * online_meetings row, and stores the join link on the request.
 */
export const generateTeamsMeetingForApprovedRequest = withAuth(async (
  user,
  { tenant },
  appointmentRequestId: string
): Promise<AppointmentRequestResult<IAppointmentRequest>> => {
  try {
    const { knex: db } = await createTenantKnex();
    const canUpdate = await hasPermission(user, 'user_schedule', 'update', db);

    const context = await withTransaction(db, async (trx: Knex.Transaction) => {
      const trxTenantDb = tenantDb(trx, tenant);
      const request = await trxTenantDb.table('appointment_requests')
        .where({ appointment_request_id: appointmentRequestId })
        .first();

      if (!request) {
        throw new Error('Appointment request not found');
      }

      if (request.status !== 'approved') {
        throw new Error('A Teams meeting can only be generated for approved appointment requests');
      }

      if (request.online_meeting_url) {
        throw new Error('This appointment request already has a meeting link');
      }

      if (!canUpdate) {
        const isApprover = await isConfiguredApproverFor(
          trx,
          tenant,
          user.user_id,
          request.preferred_assigned_user_id ?? null
        );
        if (!isApprover) {
          throw new Error('Insufficient permissions to generate Teams meetings');
        }
      }

      const service = await trxTenantDb.table('service_catalog')
        .where({ service_id: request.service_id })
        .first();
      if (!service) {
        throw new Error('Service not found');
      }

      if (!request.schedule_entry_id) {
        throw new Error('The approved request has no schedule entry to attach a meeting to');
      }

      const scheduleEntry = await trxTenantDb.table('schedule_entries')
        .where({ entry_id: request.schedule_entry_id })
        .first('entry_id', 'scheduled_start', 'scheduled_end');
      if (!scheduleEntry) {
        throw new Error('Schedule entry not found for the approved request');
      }

      let contactEmail: string | null = request.requester_email || null;
      let contactName: string | null = request.requester_name || null;
      if (request.is_authenticated && request.contact_id) {
        const contact = await trxTenantDb.table('contacts')
          .where({ contact_name_id: request.contact_id })
          .first('email', 'full_name');
        contactEmail = contact?.email || contactEmail;
        contactName = contact?.full_name || contactName;
      }

      let technician: TeamsMeetingParticipant | null = null;
      const assignee = await trxTenantDb.table('schedule_entry_assignees')
        .where({ entry_id: request.schedule_entry_id })
        .first('user_id');
      if (assignee?.user_id) {
        const technicianUser = await trxTenantDb.table('users')
          .where({ user_id: assignee.user_id })
          .first('email', 'first_name', 'last_name');
        if (technicianUser) {
          technician = {
            email: technicianUser.email || null,
            name: [technicianUser.first_name, technicianUser.last_name].filter(Boolean).join(' ') || null,
          };
        }
      }

      const existingMeetingRow = await trxTenantDb.table('online_meetings')
        .where({ appointment_request_id: appointmentRequestId })
        .whereIn('status', ['failed'])
        .first('meeting_id');

      return {
        request,
        serviceName: service.service_name as string,
        scheduleEntryId: scheduleEntry.entry_id as string,
        startTime: new Date(scheduleEntry.scheduled_start),
        endTime: new Date(scheduleEntry.scheduled_end),
        contact: { email: contactEmail, name: contactName },
        technician,
        existingFailedMeetingId: existingMeetingRow?.meeting_id ?? null,
      };
    });

    const teamsMeetingService = await resolveTeamsMeetingService();
    const outcome = await teamsMeetingService.createTeamsMeetingWithResult({
      tenantId: tenant,
      subject: `Appointment: ${context.serviceName}`,
      startDateTime: context.startTime.toISOString(),
      endDateTime: context.endTime.toISOString(),
      attendees: buildTeamsMeetingAttendees({
        contact: context.contact,
        technician: context.technician,
      }),
      bodyHtml: buildAppointmentMeetingBodyHtml({
        serviceName: context.serviceName,
        appointmentRequestId,
        description: context.request.description || null,
      }),
      appointmentRequestId,
    });

    if (outcome.status === 'skipped') {
      return { success: false, error: teamsMeetingSkipWarning(outcome.reason) };
    }

    if (outcome.status === 'failed') {
      const failedNow = new Date();
      await withTransaction(db, async (trx: Knex.Transaction) => {
        const trxTenantDb = tenantDb(trx, tenant);
        if (context.existingFailedMeetingId) {
          await trxTenantDb.table('online_meetings')
            .where({ meeting_id: context.existingFailedMeetingId })
            .update({ error_code: outcome.errorCode, updated_at: failedNow });
        }
      });
      return {
        success: false,
        error: 'The Microsoft Teams meeting could not be created. Please try again.',
        meetingCreationFailed: true,
      };
    }

    const meeting = outcome.meeting;
    const interactionSideEffects: Array<() => Promise<void>> = [];

    const updatedRequest = await withTransaction(db, async (trx: Knex.Transaction) => {
      const trxTenantDb = tenantDb(trx, tenant);
      const now = new Date();

      let interactionId: string | null = null;
      if (context.request.client_id || context.request.contact_id) {
        const onlineMeetingType = await trxTenantDb.table('system_interaction_types')
          .where({ type_name: 'Online Meeting' })
          .first('type_id');

        if (onlineMeetingType?.type_id) {
          const { createInteractionWithSideEffects } = await import('@alga-psa/clients/actions/interactionCreateHelper');
          const interactionResult = await createInteractionWithSideEffects({
            tenant,
            trx,
            user,
            interactionData: {
              type_id: onlineMeetingType.type_id,
              client_id: context.request.client_id ?? null,
              contact_name_id: context.request.contact_id ?? null,
              user_id: user.user_id,
              ticket_id: context.request.ticket_id || null,
              title: `Online Meeting: ${context.serviceName}`,
              notes: `Join Teams Meeting: ${meeting.joinWebUrl}`,
              start_time: context.startTime,
              end_time: context.endTime,
              duration: Math.max(1, Math.round((context.endTime.getTime() - context.startTime.getTime()) / 60000)),
            },
          });
          interactionId = interactionResult.interaction.interaction_id;
          interactionSideEffects.push(interactionResult.publishSideEffects);
        }
      }

      const meetingRow = {
        provider: 'teams',
        provider_meeting_id: meeting.meetingId,
        provider_event_id: meeting.eventId ?? null,
        organizer_upn: meeting.organizerUpn ?? null,
        organizer_user_id: meeting.organizerUserId ?? null,
        subject: `Appointment: ${context.serviceName}`,
        join_url: meeting.joinWebUrl,
        start_time: context.startTime,
        end_time: context.endTime,
        status: 'scheduled',
        error_code: null,
        interaction_id: interactionId,
        schedule_entry_id: context.scheduleEntryId,
        updated_at: now,
      };

      if (context.existingFailedMeetingId) {
        await trxTenantDb.table('online_meetings')
          .where({ meeting_id: context.existingFailedMeetingId })
          .update(meetingRow);
      } else {
        await trxTenantDb.table('online_meetings').insert({
          meeting_id: uuidv4(),
          tenant,
          ...meetingRow,
          recording_fetch_attempts: 0,
          last_fetch_at: null,
          appointment_request_id: appointmentRequestId,
          created_by: user.user_id,
          created_at: now,
        });
      }

      await trxTenantDb.table('appointment_requests')
        .where({ appointment_request_id: appointmentRequestId })
        .update({
          online_meeting_provider: 'teams',
          online_meeting_url: meeting.joinWebUrl,
          online_meeting_id: meeting.meetingId,
          updated_at: now,
        });

      return trxTenantDb.table('appointment_requests')
        .where({ appointment_request_id: appointmentRequestId })
        .first();
    });

    for (const publishSideEffects of interactionSideEffects) {
      try {
        await publishSideEffects();
      } catch (eventError) {
        console.error('[GenerateTeamsMeeting] Failed to publish Online Meeting interaction side effects', eventError);
      }
    }

    return { success: true, data: updatedRequest as IAppointmentRequest };
  } catch (error) {
    console.error('Error generating Teams meeting for approved request:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate Teams meeting';
    return { success: false, error: message };
  }
});

async function formatEmailDateTime(instant: Date, timeZone: string): Promise<{ date: string; time: string }> {
  const date = await formatDate(formatInTimeZone(instant, timeZone, 'yyyy-MM-dd'));
  const time = await formatTime(formatInTimeZone(instant, timeZone, 'HH:mm'));
  return { date, time: `${time} (${formatInTimeZone(instant, timeZone, 'zzz')})` };
}

function normalizeDateValue(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
  return value.toISOString().split('T')[0];
}

function normalizeTimeValue(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    return value.slice(0, 5);
  }
  const hours = value.getUTCHours().toString().padStart(2, '0');
  const minutes = value.getUTCMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}
