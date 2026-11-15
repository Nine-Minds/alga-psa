import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { resolveTeamsMeetingService } from './teamsMeetingService';
import type { TeamsMeetingCreationIdentity, CreatedTeamsEventReceipt } from './teamsMeetingService';
import { buildAppointmentMeetingBodyHtml, buildTeamsMeetingAttendees } from './teamsMeetingContent';

/**
 * Teams adapter for durable appointment-meeting creation. The shape mirrors the
 * co-managed `AppointmentMeetingProvider`, but this module never imports that
 * package: it is handed to the domain code by the caller (the co-managed
 * provider registration, or the sweep after its participation check).
 */
interface Participant { email: string; name: string | null }
export interface AppointmentMeetingDisclosure {
  subject: string; serviceName: string; description: string | null; appointmentRequestId: string;
  startDateTime: string; endDateTime: string;
  contact: Participant; technician: Participant | null; technicians?: Participant[];
}

export async function appointmentMeetingProvider(tenant: string) {
  const service = await resolveTeamsMeetingService();
  return {
    target: () => service.getTeamsMeetingCreationTarget(tenant),
    create: (disclosure: AppointmentMeetingDisclosure, identity: TeamsMeetingCreationIdentity) =>
      service.createTeamsMeetingWithResult({
        tenantId: tenant, subject: disclosure.subject, startDateTime: disclosure.startDateTime,
        endDateTime: disclosure.endDateTime, appointmentRequestId: disclosure.appointmentRequestId,
        bodyHtml: buildAppointmentMeetingBodyHtml(disclosure),
        attendees: identity.target.sendMeetingInvites ? buildTeamsMeetingAttendees(disclosure) : [],
        creationIdentity: identity,
      }),
    recover: (identity: TeamsMeetingCreationIdentity) => service.recoverTeamsMeetingCreation({ tenantId: tenant, identity }),
    remove: (receipt: CreatedTeamsEventReceipt) => service.deleteTeamsMeetingWithResult({
      tenantId: tenant, meetingId: receipt.eventId, eventId: receipt.eventId,
      organizerUserId: receipt.organizerUserId, microsoftTenantId: receipt.microsoftTenantId,
    }),
  };
}

/**
 * Due durable operations for one tenant. ONLY called by the sweep after the
 * participation check, so a plain PSA tenant never touches this table.
 */
export async function listDueCoManagedAppointmentMeetingOperations(db: Knex, tenant: string): Promise<string[]> {
  const rows = await tenantDb(db, tenant).table('co_managed_meeting_creation_operations').whereNull('completed_at')
    .where('next_attempt_at', '<=', db.raw('clock_timestamp()')).orderBy('next_attempt_at').orderBy('operation_id')
    .limit(25).select('operation_id');
  return rows.map((row: { operation_id: string }) => row.operation_id);
}

/** After-commit publisher for reconciliation (loaded lazily: it pulls session/event-bus code). */
export async function appointmentReconciliationPublisher() {
  return (await import('./sharedWorkActor')).publishScheduleEvent;
}
