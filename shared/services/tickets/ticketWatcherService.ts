import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { normalizeEmailAddress } from '../../lib/email/addressUtils';
import {
  mergeTicketWatchListRecipients,
  normalizeTicketWatchListEntries,
  parseTicketWatchListAttributes,
  setTicketWatchListOnAttributes,
  type TicketWatchListEntry,
  type TicketWatchListRecipientInput,
} from '../../lib/tickets/watchList';
import { ticketUpdateStamp } from '../../lib/tickets/ticketUpdateStamp';

/**
 * The only writer of ticket watchers.
 *
 * `ticket_watchers` is the source of truth. `tickets.attributes.watch_list` is a
 * derived mirror kept for one release; every write here locks the ticket row
 * (SELECT ... FOR UPDATE), writes the table, then rewrites the mirror from the
 * table in the same transaction. Nothing else may write `watch_list`.
 *
 * Email is the public key (case-insensitive). `contact_id`, `user_id` and bare
 * `email` all resolve to email + name + entity here and nowhere else.
 *
 * Callers pass an open transaction and own events/notifications: this layer
 * reports `changed` so they can publish only when something actually changed.
 */

export interface TicketWatcher {
  email: string;
  name: string | null;
  active: boolean;
  entity_type: 'user' | 'contact' | null;
  entity_id: string | null;
  source: string | null;
}

export type TicketWatcherErrorKind =
  | 'ticket_not_found'
  | 'contact_not_found'
  | 'user_not_found'
  | 'entity_missing_email'
  | 'invalid_email'
  | 'watcher_not_found';

const TICKET_WATCHER_MESSAGES: Record<TicketWatcherErrorKind, string> = {
  ticket_not_found: 'Ticket not found',
  contact_not_found: 'Contact not found',
  user_not_found: 'User not found',
  entity_missing_email: 'The selected contact or user has no email address',
  invalid_email: 'A valid email address is required',
  watcher_not_found: 'Watcher not found on this ticket',
};

// `kind` is what the REST layer switches on (404 / 422).
export class TicketWatcherError extends Error {
  constructor(readonly kind: TicketWatcherErrorKind) {
    super(TICKET_WATCHER_MESSAGES[kind]);
    this.name = 'TicketWatcherError';
  }
}

export interface AddTicketWatcherInput {
  contact_id?: string;
  user_id?: string;
  email?: string;
  name?: string | null;
  /** Defaults to true. */
  active?: boolean;
  source?: string;
}

export interface TicketWatcherWriteResult {
  watchers: TicketWatcher[];
  /** False when the write was a no-op (idempotent re-add, same active flag). */
  changed: boolean;
}

type Conn = Knex | Knex.Transaction;

interface ResolvedWatcher {
  email: string;
  name: string | null;
  entity_type: 'user' | 'contact' | null;
  entity_id: string | null;
}

function toWatcher(row: Record<string, any>): TicketWatcher {
  return {
    email: row.email,
    name: row.name ?? null,
    active: Boolean(row.active),
    entity_type: row.entity_type ?? null,
    entity_id: row.entity_id ?? null,
    source: row.source ?? null,
  };
}

/** True when any of the supplied fields differs from the stored row (null == missing). */
function rowDiffers(row: Record<string, any>, values: Partial<Record<'name' | 'active' | 'entity_type' | 'entity_id' | 'source', unknown>>): boolean {
  return Object.entries(values).some(([key, value]) => {
    if (key === 'active') return Boolean(row.active) !== Boolean(value);
    return (row[key] ?? null) !== (value ?? null);
  });
}

function snapshot(watchers: TicketWatcher[]): string {
  return JSON.stringify(watchers);
}

function toMirrorEntry(row: Record<string, any>): TicketWatchListEntry {
  const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : undefined);
  const entry: TicketWatchListEntry = { email: String(row.email).toLowerCase(), active: Boolean(row.active) };
  if (row.name) entry.name = row.name;
  if (row.source) entry.source = row.source;
  if (row.entity_type) entry.entity_type = row.entity_type;
  if (row.entity_id) entry.entity_id = row.entity_id;
  const createdAt = iso(row.created_at);
  if (createdAt) entry.created_at = createdAt;
  const updatedAt = iso(row.updated_at);
  if (updatedAt) entry.updated_at = updatedAt;
  return entry;
}

function parseAttributes(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}

function watchersTable(conn: Conn, tenant: string) {
  return tenantDb(conn, tenant).table('ticket_watchers');
}

async function lockTicket(trx: Conn, tenant: string, ticketId: string): Promise<{ attributes: unknown }> {
  const ticket = await tenantDb(trx, tenant)
    .table('tickets')
    .select('attributes')
    .where({ ticket_id: ticketId })
    .forUpdate()
    .first();
  if (!ticket) {
    throw new TicketWatcherError('ticket_not_found');
  }
  return ticket as { attributes: unknown };
}

async function readRows(trx: Conn, tenant: string, ticketId: string): Promise<Array<Record<string, any>>> {
  return watchersTable(trx, tenant)
    .where({ ticket_id: ticketId })
    .orderBy([{ column: 'created_at', order: 'asc' }, { column: 'email', order: 'asc' }]);
}

/**
 * Resolve contact_id / user_id / email to email + name + entity. Unknown or
 * other-tenant ids, and entities without an email, are rejected (422 upstream).
 */
export async function resolveTicketWatcherTarget(
  conn: Conn,
  tenant: string,
  input: Pick<AddTicketWatcherInput, 'contact_id' | 'user_id' | 'email' | 'name'>
): Promise<ResolvedWatcher> {
  const db = tenantDb(conn, tenant);
  const explicitName = input.name?.trim() || null;

  if (input.contact_id) {
    const contact = await db
      .table('contacts')
      .select('contact_name_id', 'full_name', 'email')
      .where({ contact_name_id: input.contact_id })
      .first();
    if (!contact) throw new TicketWatcherError('contact_not_found');
    const email = normalizeEmailAddress(contact.email);
    if (!email) throw new TicketWatcherError('entity_missing_email');
    return {
      email,
      name: explicitName ?? (contact.full_name?.trim() || null),
      entity_type: 'contact',
      entity_id: contact.contact_name_id,
    };
  }

  if (input.user_id) {
    const user = await db
      .table('users')
      .select('user_id', 'first_name', 'last_name', 'email')
      .where({ user_id: input.user_id })
      .first();
    if (!user) throw new TicketWatcherError('user_not_found');
    const email = normalizeEmailAddress(user.email);
    if (!email) throw new TicketWatcherError('entity_missing_email');
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    return {
      email,
      name: explicitName ?? (fullName || null),
      entity_type: 'user',
      entity_id: user.user_id,
    };
  }

  const email = normalizeEmailAddress(input.email);
  if (!email) throw new TicketWatcherError('invalid_email');
  return { email, name: explicitName, entity_type: null, entity_id: null };
}

/**
 * Semantic form of a mirror for comparison: emails lower-cased, entries sorted
 * by email, keys sorted, empty/undefined/null fields dropped. Both sides go
 * through the same parser, so key order and undefined-vs-missing never matter.
 */
function canonicalMirror(entries: unknown): string {
  return JSON.stringify(
    normalizeTicketWatchListEntries(entries)
      .map((entry) =>
        Object.fromEntries(
          Object.entries(entry)
            .filter(([, value]) => value !== undefined && value !== null && value !== '')
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        )
      )
      .sort((a, b) => (String(a.email) < String(b.email) ? -1 : String(a.email) > String(b.email) ? 1 : 0))
  );
}

/**
 * Rewrites `attributes.watch_list` from the table. Caller must hold the ticket lock.
 *
 * Writes nothing when the stored mirror is already equivalent. `stamp` decides
 * whether a needed rewrite also stamps `updated_at`/`updated_by` (true for a
 * real watcher change; false for repairing a drifted mirror, which is
 * bookkeeping and must not look like a user edit).
 */
export async function syncWatchListAttributes(
  trx: Conn,
  tenant: string,
  ticketId: string,
  actorUserId: string | null = null,
  stamp: boolean = true
): Promise<TicketWatchListEntry[]> {
  const ticket = await tenantDb(trx, tenant)
    .table('tickets')
    .select('attributes')
    .where({ ticket_id: ticketId })
    .first();
  if (!ticket) {
    throw new TicketWatcherError('ticket_not_found');
  }
  const entries = (await readRows(trx, tenant, ticketId)).map(toMirrorEntry);
  const current = parseAttributes((ticket as any).attributes);
  const next = setTicketWatchListOnAttributes(current, entries);

  if (canonicalMirror(current.watch_list) !== canonicalMirror(entries)
    || (entries.length === 0 && current.watch_list !== undefined)) {
    await tenantDb(trx, tenant)
      .table('tickets')
      .where({ ticket_id: ticketId })
      .update({
        attributes: next ? JSON.stringify(next) : null,
        ...(stamp ? ticketUpdateStamp(trx as Knex, actorUserId) : {}),
      });
  }
  return entries;
}

async function finish(
  trx: Conn,
  tenant: string,
  ticketId: string,
  before: TicketWatcher[],
  actorUserId: string | null
): Promise<TicketWatcherWriteResult> {
  const after = (await readRows(trx, tenant, ticketId)).map(toWatcher);
  const changed = snapshot(before) !== snapshot(after);
  // Always resync: also repairs a mirror that drifted before this write. Only a
  // real table change stamps the ticket (with the actor); a repair never does.
  await syncWatchListAttributes(trx, tenant, ticketId, actorUserId, changed);
  return { watchers: after, changed };
}

export async function listTicketWatchers(conn: Conn, tenant: string, ticketId: string): Promise<TicketWatcher[]> {
  const ticket = await tenantDb(conn, tenant).table('tickets').select('ticket_id').where({ ticket_id: ticketId }).first();
  if (!ticket) throw new TicketWatcherError('ticket_not_found');
  return (await readRows(conn, tenant, ticketId)).map(toWatcher);
}

/**
 * Idempotent set-add. Re-adding an existing email (any case) updates in place:
 * `active` is set to the request value, name/entity are filled in when new
 * information is supplied, source is kept.
 */
export async function addTicketWatcher(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  input: AddTicketWatcherInput,
  actorUserId: string | null = null
): Promise<TicketWatcherWriteResult> {
  await lockTicket(trx, tenant, ticketId);
  const target = await resolveTicketWatcherTarget(trx, tenant, input);
  const before = (await readRows(trx, tenant, ticketId)).map(toWatcher);
  const active = input.active ?? true;

  const existing = await watchersTable(trx, tenant)
    .where({ ticket_id: ticketId })
    .whereRaw('lower(email) = ?', [target.email])
    .first();

  if (!existing) {
    await watchersTable(trx, tenant).insert({
      tenant,
      ticket_id: ticketId,
      email: target.email,
      name: target.name,
      active,
      entity_type: target.entity_type,
      entity_id: target.entity_id,
      source: input.source ?? 'manual',
    });
  } else {
    const values = {
      active,
      name: existing.name || target.name,
      entity_type: existing.entity_type || target.entity_type,
      entity_id: existing.entity_id || target.entity_id,
    };
    if (rowDiffers(existing, values)) {
      await watchersTable(trx, tenant)
        .where({ watcher_id: existing.watcher_id })
        .update({ ...values, updated_at: trx.fn.now() });
    }
  }
  return finish(trx, tenant, ticketId, before, actorUserId);
}

/**
 * Merge a batch of recipients (team expansion, inbound email, board defaults)
 * with the existing "existing entry wins, active is OR-ed" semantics of
 * mergeTicketWatchListRecipients.
 */
export async function addTicketWatcherRecipients(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  recipients: TicketWatchListRecipientInput[],
  actorUserId: string | null = null
): Promise<TicketWatcherWriteResult> {
  await lockTicket(trx, tenant, ticketId);
  const rows = await readRows(trx, tenant, ticketId);
  const before = rows.map(toWatcher);
  const merged = mergeTicketWatchListRecipients(rows.map(toMirrorEntry), recipients);
  const existingEmails = new Set(rows.map((row) => String(row.email).toLowerCase()));

  for (const entry of merged) {
    const values = {
      name: entry.name ?? null,
      active: entry.active,
      entity_type: entry.entity_type ?? null,
      entity_id: entry.entity_id ?? null,
      source: entry.source ?? null,
    };
    if (existingEmails.has(entry.email)) {
      const row = rows.find((r) => String(r.email).toLowerCase() === entry.email);
      if (row && !rowDiffers(row, values)) continue;
      await watchersTable(trx, tenant)
        .where({ ticket_id: ticketId })
        .whereRaw('lower(email) = ?', [entry.email])
        .update({ ...values, updated_at: trx.fn.now() });
    } else {
      await watchersTable(trx, tenant).insert({ tenant, ticket_id: ticketId, email: entry.email, ...values });
    }
  }
  return finish(trx, tenant, ticketId, before, actorUserId);
}

export async function setTicketWatcherActive(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  email: string,
  active: boolean,
  actorUserId: string | null = null
): Promise<TicketWatcherWriteResult> {
  await lockTicket(trx, tenant, ticketId);
  const normalized = normalizeEmailAddress(email);
  if (!normalized) throw new TicketWatcherError('invalid_email');
  const before = (await readRows(trx, tenant, ticketId)).map(toWatcher);
  const matching = watchersTable(trx, tenant).where({ ticket_id: ticketId }).whereRaw('lower(email) = ?', [normalized]);
  const existing = await matching.clone().first();
  if (!existing) throw new TicketWatcherError('watcher_not_found');
  if (rowDiffers(existing, { active })) {
    await matching.clone().update({ active, updated_at: trx.fn.now() });
  }
  return finish(trx, tenant, ticketId, before, actorUserId);
}

export async function removeTicketWatcher(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  email: string,
  actorUserId: string | null = null
): Promise<TicketWatcherWriteResult> {
  await lockTicket(trx, tenant, ticketId);
  const normalized = normalizeEmailAddress(email);
  if (!normalized) throw new TicketWatcherError('invalid_email');
  const before = (await readRows(trx, tenant, ticketId)).map(toWatcher);
  const deleted = await watchersTable(trx, tenant)
    .where({ ticket_id: ticketId })
    .whereRaw('lower(email) = ?', [normalized])
    .delete();
  if (!deleted) throw new TicketWatcherError('watcher_not_found');
  return finish(trx, tenant, ticketId, before, actorUserId);
}

/**
 * Create-time seeding: ticket-create paths (TicketModel, inbound email, RMM)
 * insert the ticket with an initial `attributes.watch_list`. Call this right
 * after that insert to bring the table in line with it; the mirror is then
 * rewritten from the table.
 */
export async function seedTicketWatchersFromAttributes(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string
): Promise<TicketWatcherWriteResult> {
  const ticket = await lockTicket(trx, tenant, ticketId);
  const seeded = parseTicketWatchListAttributes(parseAttributes(ticket.attributes));
  if (seeded.length === 0) {
    return { watchers: [], changed: false };
  }
  return addTicketWatcherRecipients(trx, tenant, ticketId, seeded, null);
}

export const TicketWatcherService = {
  list: listTicketWatchers,
  add: addTicketWatcher,
  addRecipients: addTicketWatcherRecipients,
  setActive: setTicketWatcherActive,
  remove: removeTicketWatcher,
  syncWatchListAttributes,
  seedFromAttributes: seedTicketWatchersFromAttributes,
  resolveTarget: resolveTicketWatcherTarget,
};
