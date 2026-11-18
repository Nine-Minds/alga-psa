/**
 * Scheduling side of the shared-work seam (see shared/utils/sharedWorkSeam.ts).
 *
 * Native schedule / appointment actions call `scheduleSeam.delegate(tenant, p => p.verb(...))`
 * and fall through to their own body on `{ handled: false }`. The co-managed package registers a
 * provider at server boot; nothing here imports it. Verb signatures mirror the co-managed
 * providers: (db, tenant, ...input, identify, publish) and answer `{ handled: false }` or
 * `{ handled: true, ... }`.
 *
 * Authority note: a `handled: true` answer owns authorization for the call; the native
 * `hasPermission` checks have NOT run.
 */
import type { Knex } from 'knex';
import { sharedWorkSeam } from '@alga-psa/shared/utils/sharedWorkSeam';

/** Authenticated home identity, supplied by an auth adapter and never by request bodies. */
export type SharedWorkActor =
  | { kind: 'session'; tenant: string; userId: string; sessionId: string }
  | { kind: 'api_key'; tenant: string; userId: string; apiKeyId: string };
export type SharedWorkIdentify = () => Promise<SharedWorkActor>;

type Hit<T> = { handled: false } | ({ handled: true } & T);

export type ScheduleEventPublisher = (event: {
  eventType: 'SCHEDULE_ENTRY_CREATED' | 'SCHEDULE_ENTRY_UPDATED' | 'SCHEDULE_ENTRY_DELETED';
  payload: { tenantId: string; userId: string; entryId: string };
}) => Promise<unknown>;

export type ScheduleCommandInput =
  | { action: 'create'; data: Record<string, any> }
  | { action: 'update'; id: string; data: Record<string, any>; scope?: string }
  | { action: 'delete'; id: string; scope?: string };

export type ApprovalInput = {
  id: string; assignedUserId: string; finalDate?: string | null; finalTime?: string | null;
  ticketId?: string | null; internalNotes?: string | null;
};

/** Teams (or any) meeting provider supplied by the native side; opaque to the seam. */
export type AppointmentMeetingProviderHandle = unknown;

export interface SharedWorkSchedulingProvider {
  readSchedules(db: Knex, tenant: string, identify: SharedWorkIdentify, options: {
    id?: string; start?: string; end?: string; userId?: string;
    calendar?: { start: string; end: string; technicianIds?: string[] };
  }): Promise<Hit<{ entries: any[] }>>;
  commandSchedule(db: Knex, tenant: string, input: ScheduleCommandInput, identify: SharedWorkIdentify,
    publish: ScheduleEventPublisher): Promise<Hit<{ entry: any | null }>>;
  readAppointmentRequests(db: Knex, tenant: string, identify: SharedWorkIdentify,
    options: { id?: string; ticketId?: string; filters?: Record<string, any> }): Promise<Hit<{ requests: any[] }>>;
  approveAppointment(db: Knex, tenant: string, input: ApprovalInput, identify: SharedWorkIdentify,
    publish: ScheduleEventPublisher): Promise<Hit<{ request: any }>>;
  approveAppointmentWithMeeting(db: Knex, tenant: string, input: ApprovalInput, identify: SharedWorkIdentify,
    publish: ScheduleEventPublisher, meetings: AppointmentMeetingProviderHandle, approveWithoutMeeting?: boolean
  ): Promise<Hit<{ request?: any; warning?: string; meetingCreationFailed?: true }>>;
  declineAppointment(db: Knex, tenant: string, input: { id: string; reason: string }, identify: SharedWorkIdentify,
    publish: ScheduleEventPublisher): Promise<Hit<{}>>;
  rescheduleAppointment(db: Knex, tenant: string,
    input: { id: string; date: string; time: string; timezone?: string | null; duration?: number | null },
    identify: SharedWorkIdentify, publish: ScheduleEventPublisher): Promise<Hit<{ request: any }>>;
  associateAppointmentTicket(db: Knex, tenant: string, input: { id: string; ticketId: string },
    identify: SharedWorkIdentify, publish: ScheduleEventPublisher): Promise<Hit<{}>>;
  generateAppointmentMeeting(db: Knex, tenant: string, requestId: string, identify: SharedWorkIdentify,
    publish: ScheduleEventPublisher, meetings: AppointmentMeetingProviderHandle
  ): Promise<Hit<{ request?: any; meetingCreationFailed?: true; unavailable?: boolean }>>;
}

// LEVERAGE: pattern shared-work-seam — scheduling, clients and documents each declare one seam over the same generic registry.
export const scheduleSeam = sharedWorkSeam<SharedWorkSchedulingProvider>('scheduling');
