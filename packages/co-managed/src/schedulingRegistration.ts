/**
 * Registers the co-managed shared-work providers on the generic seams (shared/utils/sharedWorkSeam)
 * by NAME, so native packages never import this package. Imported best-effort at server boot from
 * server/src/instrumentation.ts. Each verb answers `{ handled: false }` for a workspace that is not
 * a co-managed one; the seam has already consulted the cached participation gate before calling in.
 *
 * Seams and verbs (final shapes; every verb is `(db, tenant, ...input, identify, publish?)`):
 *   'scheduling'       readSchedules commandSchedule readAppointmentRequests approveAppointment
 *                      approveAppointmentWithMeeting declineAppointment rescheduleAppointment
 *                      associateAppointmentTicket generateAppointmentMeeting
 *   'interaction'      readInteractions readInteractionMeeting createInteraction updateInteraction deleteInteraction
 *   'meetingDocuments' admitMeetingDocuments
 *   'meetingArtifacts' consumeMeetingArtifact
 *   'meetingReconciliation' recoverAppointmentMeeting synchronizeScheduleMeeting   (Teams sweep)
 */
import { sharedWorkSeam } from '@alga-psa/shared/utils/sharedWorkSeam';
import { readCoManagedNativeSchedules } from './nativeScheduleRead';
import { commandCoManagedNativeSchedule } from './nativeScheduleCommand';
import { readCoManagedNativeAppointmentRequests } from './nativeAppointmentRequest';
import { declineCoManagedNativeAppointment, rescheduleCoManagedNativeAppointment } from './nativeAppointmentRequestCommand';
import { approveCoManagedNativeAppointment, associateCoManagedNativeAppointmentTicket } from './nativeAppointmentApproval';
import { approveCoManagedAppointmentWithMeeting, generateCoManagedAppointmentMeeting, recoverCoManagedAppointmentMeeting, type AppointmentMeetingProvider } from './appointmentMeetingCreation';
import { synchronizeNativeScheduleMeeting } from './nativeScheduleMeetingSync';
import { readCoManagedNativeInteractions } from './nativeInteractionRead';
import { createCoManagedNativeInteraction, updateCoManagedNativeInteraction, deleteCoManagedNativeInteraction } from './nativeInteractionCommand';
import { readCoManagedInteractionMeeting, admitCoManagedMeetingDocuments, consumeCoManagedMeetingArtifact } from './nativeMeetingRead';

export const coManagedSchedulingProvider = {
  readSchedules: readCoManagedNativeSchedules,
  commandSchedule: commandCoManagedNativeSchedule,
  readAppointmentRequests: readCoManagedNativeAppointmentRequests,
  approveAppointment: approveCoManagedNativeAppointment,
  approveAppointmentWithMeeting: (db: any, tenant: string, input: any, identify: any, publish: any, meetings: unknown, approveWithoutMeeting?: boolean) =>
    approveCoManagedAppointmentWithMeeting(db, tenant, input, identify, publish, meetings as AppointmentMeetingProvider, approveWithoutMeeting),
  declineAppointment: declineCoManagedNativeAppointment,
  rescheduleAppointment: rescheduleCoManagedNativeAppointment,
  associateAppointmentTicket: associateCoManagedNativeAppointmentTicket,
  generateAppointmentMeeting: (db: any, tenant: string, requestId: string, identify: any, publish: any, meetings: unknown) =>
    generateCoManagedAppointmentMeeting(db, tenant, requestId, identify, publish, meetings as AppointmentMeetingProvider),
};

export const coManagedInteractionProvider = {
  readInteractions: readCoManagedNativeInteractions,
  readInteractionMeeting: readCoManagedInteractionMeeting,
  createInteraction: createCoManagedNativeInteraction,
  updateInteraction: updateCoManagedNativeInteraction,
  deleteInteraction: deleteCoManagedNativeInteraction,
};

export const coManagedMeetingDocumentsProvider = { admitMeetingDocuments: admitCoManagedMeetingDocuments };
export const coManagedMeetingArtifactsProvider = { consumeMeetingArtifact: consumeCoManagedMeetingArtifact };
export const coManagedMeetingReconciliationProvider = {
  recoverAppointmentMeeting: recoverCoManagedAppointmentMeeting,
  synchronizeScheduleMeeting: synchronizeNativeScheduleMeeting,
};

const registrations = {
  scheduling: coManagedSchedulingProvider,
  interaction: coManagedInteractionProvider,
  meetingDocuments: coManagedMeetingDocumentsProvider,
  meetingArtifacts: coManagedMeetingArtifactsProvider,
  meetingReconciliation: coManagedMeetingReconciliationProvider,
} as const;

/** Idempotent: a seam that already has a provider is left alone (hot reload, duplicate bundles). */
export function registerCoManagedSchedulingProviders(): void {
  for (const [name, provider] of Object.entries(registrations)) {
    const seam = sharedWorkSeam<unknown>(name);
    if (!seam.hasProvider()) seam.register(() => provider);
  }
}

registerCoManagedSchedulingProviders();
