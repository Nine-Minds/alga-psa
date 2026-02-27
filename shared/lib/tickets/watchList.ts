import { normalizeEmailAddress } from '../email/addressUtils';

export type TicketWatchListSource = 'manual' | 'inbound_to' | 'inbound_cc';
export type TicketWatchListEntityType = 'user' | 'contact';

export interface TicketWatchListEntry {
  email: string;
  active: boolean;
  name?: string;
  source?: string;
  entity_type?: TicketWatchListEntityType;
  entity_id?: string;
  created_at?: string;
  updated_at?: string;
  last_seen_at?: string;
}

export interface TicketWatchListRecipientInput {
  email?: string | null;
  active?: boolean;
  name?: string | null;
  source?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_seen_at?: string | null;
}

interface RecipientLike {
  email?: string | null;
  name?: string | null;
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeActive(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return true;
    }
    return !['false', '0', 'off', 'no'].includes(normalized);
  }

  return true;
}

function asEntityType(value: unknown): TicketWatchListEntityType | undefined {
  const normalized = asOptionalString(value)?.toLowerCase();
  if (normalized === 'user' || normalized === 'contact') {
    return normalized;
  }
  return undefined;
}

function mergeEntries(existing: TicketWatchListEntry, incoming: TicketWatchListEntry): TicketWatchListEntry {
  return {
    ...existing,
    active: existing.active || incoming.active,
    name: existing.name || incoming.name,
    source: existing.source || incoming.source,
    created_at: existing.created_at || incoming.created_at,
    updated_at: incoming.updated_at || existing.updated_at,
    last_seen_at: incoming.last_seen_at || existing.last_seen_at,
  };
}

function normalizeEntry(raw: unknown): TicketWatchListEntry | null {
  if (typeof raw === 'string') {
    const email = normalizeEmailAddress(raw);
    if (!email) {
      return null;
    }
    return {
      email,
      active: true,
    };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const email = normalizeEmailAddress(record.email as string | undefined);
  if (!email) {
    return null;
  }

  const entry: TicketWatchListEntry = {
    email,
    active: normalizeActive(record.active),
  };

  const name = asOptionalString(record.name);
  if (name) {
    entry.name = name;
  }

  const source = asOptionalString(record.source);
  if (source) {
    entry.source = source;
  }

  const entityType = asEntityType(record.entity_type);
  if (entityType) {
    entry.entity_type = entityType;
  }

  const entityId = asOptionalString(record.entity_id);
  if (entityId) {
    entry.entity_id = entityId;
  }

  const createdAt = asOptionalString(record.created_at);
  if (createdAt) {
    entry.created_at = createdAt;
  }

  const updatedAt = asOptionalString(record.updated_at);
  if (updatedAt) {
    entry.updated_at = updatedAt;
  }

  const lastSeenAt = asOptionalString(record.last_seen_at);
  if (lastSeenAt) {
    entry.last_seen_at = lastSeenAt;
  }

  return entry;
}

function attributesToObject(attributes: unknown): Record<string, unknown> {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    return {};
  }

  return { ...(attributes as Record<string, unknown>) };
}

export function normalizeTicketWatchListEntries(raw: unknown): TicketWatchListEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const deduped = new Map<string, TicketWatchListEntry>();
  for (const item of raw) {
    const normalized = normalizeEntry(item);
    if (!normalized) {
      continue;
    }

    const existing = deduped.get(normalized.email);
    if (!existing) {
      deduped.set(normalized.email, normalized);
      continue;
    }

    deduped.set(normalized.email, mergeEntries(existing, normalized));
  }

  return Array.from(deduped.values());
}

export function parseTicketWatchListAttributes(attributes: unknown): TicketWatchListEntry[] {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    return [];
  }

  const watchList = (attributes as Record<string, unknown>).watch_list;
  return normalizeTicketWatchListEntries(watchList);
}

export function mergeTicketWatchListRecipients(
  existingWatchList: unknown,
  recipients: TicketWatchListRecipientInput[]
): TicketWatchListEntry[] {
  const deduped = new Map<string, TicketWatchListEntry>();
  for (const entry of normalizeTicketWatchListEntries(existingWatchList)) {
    deduped.set(entry.email, entry);
  }

  for (const recipient of recipients) {
    const email = normalizeEmailAddress(recipient?.email ?? undefined);
    if (!email) {
      continue;
    }

    const candidate: TicketWatchListEntry = {
      email,
      active: recipient.active ?? true,
    };

    const candidateName = asOptionalString(recipient.name);
    if (candidateName) {
      candidate.name = candidateName;
    }

    const candidateSource = asOptionalString(recipient.source);
    if (candidateSource) {
      candidate.source = candidateSource;
    }

    const candidateEntityType = asEntityType(recipient.entity_type);
    if (candidateEntityType) {
      candidate.entity_type = candidateEntityType;
    }

    const candidateEntityId = asOptionalString(recipient.entity_id);
    if (candidateEntityId) {
      candidate.entity_id = candidateEntityId;
    }

    const createdAt = asOptionalString(recipient.created_at);
    if (createdAt) {
      candidate.created_at = createdAt;
    }

    const updatedAt = asOptionalString(recipient.updated_at);
    if (updatedAt) {
      candidate.updated_at = updatedAt;
    }

    const lastSeenAt = asOptionalString(recipient.last_seen_at);
    if (lastSeenAt) {
      candidate.last_seen_at = lastSeenAt;
    }

    const existing = deduped.get(email);
    if (!existing) {
      deduped.set(email, candidate);
      continue;
    }

    deduped.set(email, mergeEntries(existing, candidate));
  }

  return Array.from(deduped.values());
}

export function setTicketWatchListOnAttributes(
  attributes: unknown,
  watchList: unknown
): Record<string, unknown> | null {
  const nextAttributes = attributesToObject(attributes);
  const normalizedWatchList = normalizeTicketWatchListEntries(watchList);

  if (normalizedWatchList.length > 0) {
    nextAttributes.watch_list = normalizedWatchList;
  } else {
    delete nextAttributes.watch_list;
  }

  if (Object.keys(nextAttributes).length === 0) {
    return null;
  }

  return nextAttributes;
}

export function getActiveWatchListEmails(attributes: unknown): string[] {
  return parseTicketWatchListAttributes(attributes)
    .filter((entry) => entry.active)
    .map((entry) => entry.email);
}

export function buildInboundWatchListRecipients(params: {
  to?: RecipientLike[] | null;
  cc?: RecipientLike[] | null;
  senderEmail?: string | null;
  providerMailboxEmail?: string | null;
  excludedEmails?: Array<string | null | undefined>;
}): TicketWatchListRecipientInput[] {
  const excluded = new Set<string>();
  const addExcluded = (email: string | null | undefined) => {
    const normalized = normalizeEmailAddress(email);
    if (normalized) {
      excluded.add(normalized);
    }
  };

  addExcluded(params.senderEmail);
  addExcluded(params.providerMailboxEmail);
  for (const excludedEmail of params.excludedEmails ?? []) {
    addExcluded(excludedEmail);
  }

  const deduped = new Map<string, TicketWatchListRecipientInput>();
  const addRecipient = (recipient: RecipientLike, source: TicketWatchListSource) => {
    const email = normalizeEmailAddress(recipient.email);
    if (!email || excluded.has(email)) {
      return;
    }

    const existing = deduped.get(email);
    const normalizedName = asOptionalString(recipient.name);
    if (!existing) {
      deduped.set(email, {
        email,
        active: true,
        source,
        ...(normalizedName ? { name: normalizedName } : {}),
      });
      return;
    }

    if (!existing.name && normalizedName) {
      existing.name = normalizedName;
    }
    if (existing.source !== 'inbound_to' && source === 'inbound_to') {
      existing.source = source;
    }
  };

  for (const recipient of params.to ?? []) {
    addRecipient(recipient, 'inbound_to');
  }

  for (const recipient of params.cc ?? []) {
    addRecipient(recipient, 'inbound_cc');
  }

  return Array.from(deduped.values());
}
