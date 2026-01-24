type ScheduleEntryLike = {
  entry_id: string;
  work_item_type?: string | null;
  work_item_id?: string | null;
  is_private?: boolean | null;
  scheduled_start?: Date | string | null;
  scheduled_end?: Date | string | null;
  assigned_user_ids?: string[] | null;
  created_at?: Date | string | null;
  title?: string | null;
  notes?: string | null;
};

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function isScheduleBlockEntry(entry: ScheduleEntryLike): boolean {
  return (
    entry.is_private === true &&
    entry.work_item_type === 'ad_hoc' &&
    !entry.work_item_id &&
    (entry.assigned_user_ids ?? []).length === 1
  );
}

export function getScheduleBlockOwnerUserId(entry: ScheduleEntryLike): string | undefined {
  const ids = entry.assigned_user_ids ?? [];
  if (ids.length !== 1) return undefined;
  return ids[0];
}

export function buildScheduleBlockCreatedPayload(params: {
  entry: ScheduleEntryLike;
  timezone: string;
  reason?: string;
}): Record<string, unknown> {
  const startAt = toIsoString(params.entry.scheduled_start);
  const endAt = toIsoString(params.entry.scheduled_end);
  if (!startAt || !endAt) throw new Error('Schedule block entry is missing scheduled_start/scheduled_end');

  const ownerId = getScheduleBlockOwnerUserId(params.entry);
  if (!ownerId) throw new Error('Schedule block entry must have exactly one assigned user id');

  const title = String(params.entry.title ?? '').trim();
  const notes = String(params.entry.notes ?? '').trim();
  const inferredReason = title && title.toLowerCase() !== 'busy' ? title : notes || undefined;

  return {
    scheduleBlockId: params.entry.entry_id,
    ownerId,
    ownerType: 'user',
    startAt,
    endAt,
    timezone: params.timezone,
    ...(toIsoString(params.entry.created_at) ? { createdAt: toIsoString(params.entry.created_at) } : {}),
    ...(params.reason ? { reason: params.reason } : inferredReason ? { reason: inferredReason } : {}),
  };
}

export function buildScheduleBlockDeletedPayload(params: {
  scheduleBlockId: string;
  reason?: string;
}): Record<string, unknown> {
  return {
    scheduleBlockId: params.scheduleBlockId,
    deletedAt: new Date().toISOString(),
    ...(params.reason ? { reason: params.reason } : {}),
  };
}
