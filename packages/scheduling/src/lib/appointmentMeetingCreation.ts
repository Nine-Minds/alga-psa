import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { recoverCoManagedAppointmentMeeting, type AppointmentMeetingProvider } from '@alga-psa/co-managed';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { resolveTeamsMeetingService } from './teamsMeetingService';
import { buildAppointmentMeetingBodyHtml, buildTeamsMeetingAttendees } from './teamsMeetingContent';

export async function appointmentMeetingProvider(tenant: string): Promise<AppointmentMeetingProvider> {
  const service = await resolveTeamsMeetingService();
  return {
    target: () => service.getTeamsMeetingCreationTarget(tenant),
    create: (disclosure, identity) => service.createTeamsMeetingWithResult({ tenantId: tenant,
      subject: disclosure.subject, startDateTime: disclosure.startDateTime, endDateTime: disclosure.endDateTime,
      appointmentRequestId: disclosure.appointmentRequestId, bodyHtml: buildAppointmentMeetingBodyHtml(disclosure),
      attendees: identity.target.sendMeetingInvites ? buildTeamsMeetingAttendees(disclosure) : [], creationIdentity: identity }),
    recover: identity => service.recoverTeamsMeetingCreation({ tenantId: tenant, identity }),
    remove: receipt => service.deleteTeamsMeetingWithResult({ tenantId: tenant, meetingId: receipt.eventId, eventId: receipt.eventId,
      organizerUserId: receipt.organizerUserId, microsoftTenantId: receipt.microsoftTenantId }),
  };
}

export async function recoverCoManagedAppointmentMeetings(db: Knex, tenant: string) {
  const pending = await tenantDb(db, tenant).table('co_managed_meeting_creation_operations').whereNull('completed_at')
    .where('next_attempt_at', '<=', db.raw('clock_timestamp()')).orderBy('next_attempt_at').orderBy('operation_id').limit(25).select('operation_id');
  if (!pending.length) return [];
  const provider = await appointmentMeetingProvider(tenant), results = [];
  for (const row of pending) results.push(await recoverCoManagedAppointmentMeeting(db, tenant, row.operation_id, provider, publishEvent));
  return results;
}
