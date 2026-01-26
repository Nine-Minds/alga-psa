type ScheduleEntryLike = {
  entry_id: string;
  work_item_type?: string | null;
  work_item_id?: string | null;
  scheduled_start?: Date | string | null;
  scheduled_end?: Date | string | null;
  status?: string | null;
  assigned_user_ids?: string[] | null;
  created_at?: Date | string | null;
};

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function shouldEmitAppointmentEvents(entry: ScheduleEntryLike): boolean {
  return entry.work_item_type === 'appointment_request' || entry.work_item_type === 'ticket';
}

export function getTicketIdFromScheduleEntry(entry: ScheduleEntryLike): string | undefined {
  if (entry.work_item_type === 'ticket' && entry.work_item_id) return entry.work_item_id;
  return undefined;
}

export function getSingleUserAssigneeId(entry: ScheduleEntryLike): string | undefined {
  const ids = entry.assigned_user_ids ?? [];
  if (ids.length !== 1) return undefined;
  return ids[0];
}

export function isAppointmentRescheduled(before: ScheduleEntryLike, after: ScheduleEntryLike): boolean {
  const beforeStart = toIsoString(before.scheduled_start);
  const beforeEnd = toIsoString(before.scheduled_end);
  const afterStart = toIsoString(after.scheduled_start);
  const afterEnd = toIsoString(after.scheduled_end);
  return !!(beforeStart && beforeEnd && afterStart && afterEnd && (beforeStart !== afterStart || beforeEnd !== afterEnd));
}

export function normalizeAppointmentStatus(status: string | null | undefined): string {
  return String(status ?? '').trim().toLowerCase();
}

export function isAppointmentCanceledStatus(status: string | null | undefined): boolean {
  const s = normalizeAppointmentStatus(status);
  return s === 'cancelled' || s === 'canceled' || s === 'cancel';
}

export function isAppointmentCompletedStatus(status: string | null | undefined): boolean {
  const s = normalizeAppointmentStatus(status);
  return s === 'completed' || s === 'complete' || s === 'done';
}

export function isAppointmentNoShowStatus(status: string | null | undefined): boolean {
  const s = normalizeAppointmentStatus(status);
  return s === 'no_show' || s === 'no-show' || s === 'noshow' || s === 'no show';
}

export function buildAppointmentCreatedPayload(params: {
  entry: ScheduleEntryLike;
  ticketId?: string;
  timezone: string;
  createdByUserId?: string;
  location?: string;
}): Record<string, unknown> {
  const startAt = toIsoString(params.entry.scheduled_start);
  const endAt = toIsoString(params.entry.scheduled_end);
  if (!startAt || !endAt) throw new Error('Schedule entry is missing scheduled_start/scheduled_end');

  const assigneeId = getSingleUserAssigneeId(params.entry);

  return {
    appointmentId: params.entry.entry_id,
    ...(params.ticketId ? { ticketId: params.ticketId } : {}),
    startAt,
    endAt,
    timezone: params.timezone,
    ...(assigneeId ? { assigneeId, assigneeType: 'user' } : {}),
    ...(params.createdByUserId ? { createdByUserId: params.createdByUserId } : {}),
    ...(toIsoString(params.entry.created_at) ? { createdAt: toIsoString(params.entry.created_at) } : {}),
    ...(params.location ? { location: params.location } : {}),
  };
}

export function buildAppointmentRescheduledPayload(params: {
  before: ScheduleEntryLike;
  after: ScheduleEntryLike;
  ticketId?: string;
  timezone: string;
}): Record<string, unknown> {
  const previousStartAt = toIsoString(params.before.scheduled_start);
  const previousEndAt = toIsoString(params.before.scheduled_end);
  const newStartAt = toIsoString(params.after.scheduled_start);
  const newEndAt = toIsoString(params.after.scheduled_end);
  if (!previousStartAt || !previousEndAt || !newStartAt || !newEndAt) {
    throw new Error('Schedule entry is missing scheduled_start/scheduled_end');
  }

  return {
    appointmentId: params.after.entry_id,
    ...(params.ticketId ? { ticketId: params.ticketId } : {}),
    previousStartAt,
    previousEndAt,
    newStartAt,
    newEndAt,
    timezone: params.timezone,
    rescheduledAt: new Date().toISOString(),
  };
}

export function buildAppointmentCanceledPayload(params: {
  appointmentId: string;
  ticketId?: string;
  reason?: string;
}): Record<string, unknown> {
  return {
    appointmentId: params.appointmentId,
    ...(params.ticketId ? { ticketId: params.ticketId } : {}),
    canceledAt: new Date().toISOString(),
    ...(params.reason ? { reason: params.reason } : {}),
  };
}

export function buildAppointmentCompletedPayload(params: {
  appointmentId: string;
  ticketId?: string;
  outcome?: string;
}): Record<string, unknown> {
  return {
    appointmentId: params.appointmentId,
    ...(params.ticketId ? { ticketId: params.ticketId } : {}),
    completedAt: new Date().toISOString(),
    ...(params.outcome ? { outcome: params.outcome } : {}),
  };
}

export function buildAppointmentNoShowPayload(params: {
  appointmentId: string;
  ticketId?: string;
  party: 'customer' | 'agent';
}): Record<string, unknown> {
  return {
    appointmentId: params.appointmentId,
    ...(params.ticketId ? { ticketId: params.ticketId } : {}),
    markedAt: new Date().toISOString(),
    party: params.party,
  };
}

export function buildAppointmentAssignedPayload(params: {
  appointmentId: string;
  ticketId?: string;
  previousAssigneeId?: string;
  newAssigneeId: string;
}): Record<string, unknown> {
  return {
    appointmentId: params.appointmentId,
    ...(params.ticketId ? { ticketId: params.ticketId } : {}),
    ...(params.previousAssigneeId
      ? { previousAssigneeId: params.previousAssigneeId, previousAssigneeType: 'user' }
      : {}),
    newAssigneeId: params.newAssigneeId,
    newAssigneeType: 'user',
    assignedAt: new Date().toISOString(),
  };
}

