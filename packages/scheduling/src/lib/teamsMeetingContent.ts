import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type {
  TeamsMeetingAttendee,
  TeamsMeetingSkipReason,
} from './teamsMeetingService';

export interface TeamsMeetingParticipant {
  email: string | null;
  name: string | null;
}

/**
 * Attendees drive native Outlook/Teams calendar invites: the client contact
 * and the assigned technician are both required attendees when their email is
 * known. Missing emails are tolerated (the meeting is still created/updated) —
 * the gap is reported through the returned list length.
 */
export function buildTeamsMeetingAttendees(participants: {
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

export function escapeHtml(value: string): string {
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
export function buildAppointmentMeetingBodyHtml(params: {
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

export function teamsMeetingSkipWarning(reason: TeamsMeetingSkipReason): string {
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

export interface AppointmentMeetingRequestRow {
  appointment_request_id: string;
  service_id: string;
  is_authenticated?: boolean | null;
  contact_id?: string | null;
  requester_email?: string | null;
  requester_name?: string | null;
  description?: string | null;
  schedule_entry_id?: string | null;
}

export interface AppointmentTeamsMeetingContext {
  subject: string | null;
  attendees: TeamsMeetingAttendee[];
  bodyHtml: string | null;
}

/**
 * Resolves the reschedule/update payload for an appointment's Teams meeting:
 * subject, refreshed attendees (client contact + the CURRENT assignee on the
 * schedule entry), and the context body. Shared by the appointment-request
 * reschedule action and the calendar-drag reschedule so both re-send invites
 * with the same content. Reads are tenant-scoped; pass a transaction or a
 * plain connection.
 */
export async function resolveAppointmentTeamsMeetingContext(params: {
  trx: Knex.Transaction | Knex;
  tenant: string;
  request: AppointmentMeetingRequestRow;
}): Promise<AppointmentTeamsMeetingContext> {
  const { trx, tenant, request } = params;
  const scopedDb = tenantDb(trx, tenant);

  const service = await scopedDb.table('service_catalog')
    .where({ service_id: request.service_id })
    .first('service_name');

  let contactEmail: string | null = request.requester_email || null;
  let contactName: string | null = request.requester_name || null;
  if (request.is_authenticated && request.contact_id) {
    const contact = await scopedDb.table('contacts')
      .where({ contact_name_id: request.contact_id })
      .first('email', 'full_name');
    contactEmail = contact?.email || contactEmail;
    contactName = contact?.full_name || contactName;
  }

  let technician: TeamsMeetingParticipant | null = null;
  if (request.schedule_entry_id) {
    const assignee = await scopedDb.table('schedule_entry_assignees')
      .where({ entry_id: request.schedule_entry_id })
      .first('user_id');
    if (assignee?.user_id) {
      const technicianUser = await scopedDb.table('users')
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
}
