function normalizeDate(value?: Date | string): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function deriveInteractionChannel(interactionType: string): string {
  const normalized = interactionType.trim().toLowerCase();
  if (!normalized) return 'other';

  if (normalized.includes('email')) return 'email';
  if (normalized.includes('call') || normalized.includes('phone')) return 'phone';
  if (normalized.includes('meeting')) return 'meeting';
  if (normalized.includes('note')) return 'note';

  return 'other';
}

function buildBodyPreview(value: unknown, maxLength: number): string | undefined {
  let str: string;
  if (typeof value === 'string') {
    str = value;
  } else {
    try {
      str = JSON.stringify(value);
    } catch {
      return undefined;
    }
  }
  const normalized = normalizeString(str)?.replace(/\s+/g, ' ');
  if (!normalized) return undefined;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}

export function buildInteractionLoggedPayload(params: {
  interactionId: string;
  clientId: string;
  contactId?: string;
  interactionType: string;
  channel?: string;
  interactionOccurredAt?: Date | string;
  loggedByUserId?: string;
  subject?: string;
  outcome?: string;
}): Record<string, unknown> {
  const interactionType = normalizeString(params.interactionType) ?? 'interaction';
  const channel = normalizeString(params.channel) ?? deriveInteractionChannel(interactionType);

  return {
    interactionId: params.interactionId,
    clientId: params.clientId,
    ...(params.contactId ? { contactId: params.contactId } : {}),
    interactionType,
    channel,
    ...(params.interactionOccurredAt ? { interactionOccurredAt: normalizeDate(params.interactionOccurredAt) } : {}),
    ...(params.loggedByUserId ? { loggedByUserId: params.loggedByUserId } : {}),
    ...(normalizeString(params.subject) ? { subject: normalizeString(params.subject) } : {}),
    ...(normalizeString(params.outcome) ? { outcome: normalizeString(params.outcome) } : {}),
  };
}

export function buildNoteCreatedPayload(params: {
  noteId: string;
  entityType: 'client' | 'contact';
  entityId: string;
  createdByUserId?: string;
  createdAt?: Date | string;
  visibility?: 'public' | 'internal';
  bodyPreview?: unknown;
}): Record<string, unknown> {
  return {
    noteId: params.noteId,
    entityType: params.entityType,
    entityId: params.entityId,
    ...(params.createdByUserId ? { createdByUserId: params.createdByUserId } : {}),
    ...(params.createdAt ? { createdAt: normalizeDate(params.createdAt) } : {}),
    ...(params.visibility ? { visibility: params.visibility } : {}),
    ...(params.bodyPreview !== undefined ? { bodyPreview: buildBodyPreview(params.bodyPreview, 200) } : {}),
  };
}
