type ScheduleEntryLike = {
  entry_id: string;
  work_item_type?: string | null;
  work_item_id?: string | null;
  status?: string | null;
  assigned_user_ids?: string[] | null;
};

function normalizeStatus(status: string | null | undefined): string {
  return String(status ?? '').trim().toLowerCase();
}

export function isTechnicianEnRouteStatus(status: string | null | undefined): boolean {
  const s = normalizeStatus(status);
  return s === 'en_route' || s === 'en-route' || s === 'en route' || s === 'enroute';
}

export function isTechnicianArrivedStatus(status: string | null | undefined): boolean {
  const s = normalizeStatus(status);
  return s === 'arrived' || s === 'on_site' || s === 'on-site' || s === 'on site' || s === 'onsite';
}

export function isTechnicianCheckedOutStatus(status: string | null | undefined): boolean {
  const s = normalizeStatus(status);
  return s === 'checked_out' || s === 'checked-out' || s === 'checked out' || s === 'checkedout';
}

export function shouldEmitTechnicianDispatchEvents(entry: ScheduleEntryLike): boolean {
  return entry.work_item_type === 'appointment_request' || entry.work_item_type === 'ticket';
}

export function getTechnicianUserIds(entry: ScheduleEntryLike): string[] {
  const ids = entry.assigned_user_ids ?? [];
  return Array.from(new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0)));
}

export function buildTechnicianDispatchedPayload(params: {
  appointmentId: string;
  ticketId?: string;
  technicianUserId: string;
  dispatchedByUserId?: string;
}): Record<string, unknown> {
  return {
    appointmentId: params.appointmentId,
    ...(params.ticketId ? { ticketId: params.ticketId } : {}),
    technicianUserId: params.technicianUserId,
    ...(params.dispatchedByUserId ? { dispatchedByUserId: params.dispatchedByUserId } : {}),
    dispatchedAt: new Date().toISOString(),
  };
}

export function buildTechnicianEnRoutePayload(params: {
  appointmentId: string;
  ticketId?: string;
  technicianUserId: string;
  eta?: string;
}): Record<string, unknown> {
  return {
    appointmentId: params.appointmentId,
    ...(params.ticketId ? { ticketId: params.ticketId } : {}),
    technicianUserId: params.technicianUserId,
    startedAt: new Date().toISOString(),
    ...(params.eta ? { eta: params.eta } : {}),
  };
}

export function buildTechnicianArrivedPayload(params: {
  appointmentId: string;
  ticketId?: string;
  technicianUserId: string;
  location?: string;
}): Record<string, unknown> {
  return {
    appointmentId: params.appointmentId,
    ...(params.ticketId ? { ticketId: params.ticketId } : {}),
    technicianUserId: params.technicianUserId,
    arrivedAt: new Date().toISOString(),
    ...(params.location ? { location: params.location } : {}),
  };
}

export function buildTechnicianCheckedOutPayload(params: {
  appointmentId: string;
  ticketId?: string;
  technicianUserId: string;
  workSummary?: string;
}): Record<string, unknown> {
  return {
    appointmentId: params.appointmentId,
    ...(params.ticketId ? { ticketId: params.ticketId } : {}),
    technicianUserId: params.technicianUserId,
    checkedOutAt: new Date().toISOString(),
    ...(params.workSummary ? { workSummary: params.workSummary } : {}),
  };
}

