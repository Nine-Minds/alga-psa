import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
import { isValidEmail } from '@alga-psa/core';
import { normalizeEmailAddress } from '../email/addressUtils';

/**
 * Board notification rules: matching, recipient expansion and exclusion.
 *
 * A rule fires on ticket creation (`notify_on_create`) or when a ticket enters
 * one of the rule's statuses. Recipients are internal users and teams; teams
 * are expanded from `team_members` at send time, never copied into the rule.
 * Rule recipients are never written to the ticket watch list.
 *
 * See docs/plans/2026-10-06-board-notification-rules-plan.md.
 */

type Conn = Knex | Knex.Transaction;

export type BoardNotificationTrigger =
  | { kind: 'created'; boardId: string }
  | { kind: 'status_entered'; statusId: string };

export interface BoardNotificationRule {
  rule_id: string;
  board_id: string;
  notify_on_create: boolean;
  is_enabled: boolean;
  status_ids: string[];
  user_ids: string[];
  team_ids: string[];
  /** Normalized plain-address recipients (e.g. a distribution list). */
  email_addresses: string[];
}

/** Maximum length of a stored recipient address (RFC 5321 path limit). */
export const BOARD_NOTIFICATION_EMAIL_MAX_LENGTH = 254;

/**
 * Normalize a board-notification recipient address: display names, `mailto:`,
 * case and whitespace are stripped (`normalizeEmailAddress`), then the result
 * must be within the length cap and pass `isValidEmail`, the same validator the
 * ticket email send path filters with, so a saved address is never silently
 * dropped at send time. Returns null otherwise.
 * Shared by the save action and the send-time resolver so they cannot disagree.
 */
export function normalizeBoardNotificationEmail(value: string | null | undefined): string | null {
  const normalized = normalizeEmailAddress(value);
  if (!normalized || normalized.length > BOARD_NOTIFICATION_EMAIL_MAX_LENGTH) {
    return null;
  }
  return isValidEmail(normalized) ? normalized : null;
}

export interface ResolvedRecipient {
  userId: string;
  email: string;
  displayName: string;
}

/**
 * A plain address that is not an Alga principal (not an active internal user,
 * contact or client location). It has no principal, so the ticket-read check
 * cannot be applied; it must never be passed to the visibility filter.
 */
export interface AddressRecipient {
  email: string;
}

export interface BoardNotificationAudience {
  /** Principals: pass through `filterRecipientsWhoCanReadTicket` before sending. */
  users: ResolvedRecipient[];
  /** Non-principals: email only, never visibility-filtered, never in-app. */
  addresses: AddressRecipient[];
}

async function hydrateRules(
  conn: Conn,
  tenant: string,
  ruleRows: Array<{ rule_id: string; board_id: string; notify_on_create: boolean; is_enabled: boolean }>
): Promise<BoardNotificationRule[]> {
  if (ruleRows.length === 0) {
    return [];
  }
  const db = tenantDb(conn, tenant);
  const ruleIds = ruleRows.map((row) => row.rule_id);
  const [statusRows, recipientRows] = await Promise.all([
    db.table('board_notification_rule_statuses').select('rule_id', 'status_id').whereIn('rule_id', ruleIds),
    db
      .table('board_notification_rule_recipients')
      .select('rule_id', 'recipient_type', 'user_id', 'team_id', 'email')
      .whereIn('rule_id', ruleIds),
  ]);

  return ruleRows.map((row) => ({
    rule_id: row.rule_id,
    board_id: row.board_id,
    notify_on_create: Boolean(row.notify_on_create),
    is_enabled: Boolean(row.is_enabled),
    status_ids: statusRows.filter((s: any) => s.rule_id === row.rule_id).map((s: any) => s.status_id as string),
    user_ids: recipientRows
      .filter((r: any) => r.rule_id === row.rule_id && r.recipient_type === 'user' && r.user_id)
      .map((r: any) => r.user_id as string),
    team_ids: recipientRows
      .filter((r: any) => r.rule_id === row.rule_id && r.recipient_type === 'team' && r.team_id)
      .map((r: any) => r.team_id as string),
    email_addresses: recipientRows
      .filter((r: any) => r.rule_id === row.rule_id && r.recipient_type === 'email' && r.email)
      .map((r: any) => r.email as string),
  }));
}

/** All rules (enabled or not) for a board, for the settings editor. */
export async function loadBoardNotificationRules(
  conn: Conn,
  tenant: string,
  boardId: string
): Promise<BoardNotificationRule[]> {
  const rows = await tenantDb(conn, tenant)
    .table('board_notification_rules')
    .select('rule_id', 'board_id', 'notify_on_create', 'is_enabled')
    .where({ board_id: boardId })
    .orderBy('created_at', 'asc')
    .orderBy('rule_id', 'asc');
  return hydrateRules(conn, tenant, rows);
}

/**
 * Enabled rules that fire for the trigger.
 * - created: rules on the board with `notify_on_create`.
 * - status_entered: rules naming the status, whose board is the status's board
 *   (statuses are board-owned, so the status alone identifies the board).
 */
export async function loadMatchingRules(
  conn: Conn,
  tenant: string,
  trigger: BoardNotificationTrigger
): Promise<BoardNotificationRule[]> {
  const db = tenantDb(conn, tenant);

  if (trigger.kind === 'created') {
    const rows = await db
      .table('board_notification_rules')
      .select('rule_id', 'board_id', 'notify_on_create', 'is_enabled')
      .where({ board_id: trigger.boardId, notify_on_create: true, is_enabled: true });
    return hydrateRules(conn, tenant, rows);
  }

  const status = await db.table('statuses').select('board_id').where({ status_id: trigger.statusId }).first();
  if (!status?.board_id) {
    return [];
  }
  const ruleIds = await db
    .table('board_notification_rule_statuses')
    .where({ status_id: trigger.statusId })
    .pluck('rule_id');
  if (ruleIds.length === 0) {
    return [];
  }
  const rows = await db
    .table('board_notification_rules')
    .select('rule_id', 'board_id', 'notify_on_create', 'is_enabled')
    .whereIn('rule_id', ruleIds)
    .where({ board_id: status.board_id, is_enabled: true });
  return hydrateRules(conn, tenant, rows);
}

function domainOf(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1);
}

function toDisplayName(row: { first_name?: string | null; last_name?: string | null; email: string }): string {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return name || row.email;
}

/**
 * Union of directly named users and the live members of named teams. Keeps
 * active internal users with an email, deduped by user id.
 */
export async function expandRuleRecipients(
  conn: Conn,
  tenant: string,
  rules: BoardNotificationRule[]
): Promise<ResolvedRecipient[]> {
  const db = tenantDb(conn, tenant);
  const userIds = new Set<string>();
  const teamIds = new Set<string>();
  for (const rule of rules) {
    rule.user_ids.forEach((id) => userIds.add(id));
    rule.team_ids.forEach((id) => teamIds.add(id));
  }

  if (teamIds.size > 0) {
    const memberIds = await db
      .table('team_members')
      .whereIn('team_id', Array.from(teamIds))
      .pluck('user_id');
    memberIds.forEach((id: string) => userIds.add(id));
  }

  if (userIds.size === 0) {
    return [];
  }

  const users = await db
    .table('users')
    .select('user_id', 'email', 'first_name', 'last_name')
    .whereIn('user_id', Array.from(userIds))
    .where({ is_inactive: false, user_type: 'internal' })
    .whereNotNull('email')
    .where('email', '<>', '');

  const seen = new Set<string>();
  const recipients: ResolvedRecipient[] = [];
  for (const user of users) {
    if (seen.has(user.user_id)) continue;
    seen.add(user.user_id);
    recipients.push({ userId: user.user_id, email: user.email, displayName: toDisplayName(user) });
  }
  return recipients;
}

/**
 * Classify the rules' plain addresses at send time (plan D4).
 *
 * - An address matching an active internal user becomes that user, so the
 *   visibility filter, preferences and in-app delivery apply to them.
 * - An address matching a client contact or client location is dropped (and
 *   logged): a contact created after the rule must not start receiving every
 *   client's tickets.
 * - An address on a domain mapped to a client (`client_inbound_email_domains`)
 *   is dropped and logged for the same reason: the mapping may have been added
 *   after the rule was saved.
 * - An address that is a connected inbound mailbox (`email_providers.mailbox`)
 *   is dropped and logged: sending to it would loop the notification back in.
 * - Everything else is a non-principal address.
 */
async function classifyRuleAddresses(
  conn: Conn,
  tenant: string,
  rules: BoardNotificationRule[]
): Promise<{ users: ResolvedRecipient[]; addresses: AddressRecipient[] }> {
  const boardsByAddress = new Map<string, Set<string>>();
  for (const rule of rules) {
    for (const raw of rule.email_addresses) {
      const address = normalizeBoardNotificationEmail(raw);
      if (!address) continue;
      if (!boardsByAddress.has(address)) boardsByAddress.set(address, new Set());
      boardsByAddress.get(address)!.add(rule.board_id);
    }
  }
  if (boardsByAddress.size === 0) {
    return { users: [], addresses: [] };
  }

  const db = tenantDb(conn, tenant);
  const candidates = Array.from(boardsByAddress.keys());

  // LEVERAGE: pattern principal-address-classification — classifies an address as
  // internal user, contact or unknown; the inbound sender resolution in
  // processInboundEmailInApp.ts does the same. Not extracted here.
  const userRows = await db
    .table('users')
    .select('user_id', 'email', 'first_name', 'last_name')
    .whereRaw('lower(email) = ANY(?)', [candidates])
    .where({ is_inactive: false, user_type: 'internal' });

  const users: ResolvedRecipient[] = [];
  const userAddresses = new Set<string>();
  for (const user of userRows) {
    userAddresses.add(String(user.email).toLowerCase());
    users.push({ userId: user.user_id, email: user.email, displayName: toDisplayName(user) });
  }

  const remaining = candidates.filter((address) => !userAddresses.has(address));
  const contactAddresses = new Set<string>();
  const clientDomains = new Set<string>();
  const inboundMailboxes = new Set<string>();
  if (remaining.length > 0) {
    const remainingDomains = Array.from(new Set(remaining.map(domainOf)));
    // LEVERAGE: pattern principal-address-classification — contact / location lookup.
    const [contactRows, additionalRows, locationRows, domainRows, mailboxRows] = await Promise.all([
      db.table('contacts').select('email').whereRaw('lower(email) = ANY(?)', [remaining]),
      db.table('contact_additional_email_addresses').select('email_address').whereRaw('lower(email_address) = ANY(?)', [remaining]),
      db.table('client_locations').select('email').whereRaw('lower(email) = ANY(?)', [remaining]),
      db.table('client_inbound_email_domains').select('domain').whereRaw('lower(domain) = ANY(?)', [remainingDomains]),
      db.table('email_providers').select('mailbox').whereRaw('lower(mailbox) = ANY(?)', [remaining]),
    ]);
    for (const row of contactRows) contactAddresses.add(String(row.email).toLowerCase());
    for (const row of additionalRows) contactAddresses.add(String(row.email_address).toLowerCase());
    for (const row of locationRows) contactAddresses.add(String(row.email).toLowerCase());
    for (const row of domainRows) clientDomains.add(String(row.domain).toLowerCase());
    for (const row of mailboxRows) inboundMailboxes.add(String(row.mailbox).toLowerCase());
  }

  const addresses: AddressRecipient[] = [];
  for (const address of remaining) {
    const boardIds = () => Array.from(boardsByAddress.get(address) ?? []);
    // The address itself is deliberately not logged; the board is enough to find the rule.
    if (contactAddresses.has(address)) {
      logger.warn('[BoardNotificationRules] Dropped rule address that matches a client contact or location', {
        tenant,
        boardIds: boardIds(),
      });
      continue;
    }
    if (clientDomains.has(domainOf(address))) {
      logger.warn('[BoardNotificationRules] Dropped rule address on a client-mapped email domain', {
        tenant,
        boardIds: boardIds(),
      });
      continue;
    }
    if (inboundMailboxes.has(address)) {
      logger.warn('[BoardNotificationRules] Dropped rule address that is a connected inbound mailbox', {
        tenant,
        boardIds: boardIds(),
      });
      continue;
    }
    addresses.push({ email: address });
  }
  return { users, addresses };
}

/**
 * Resolve the audience of every rule matching the trigger, deduped across
 * rules (each user and address at most once), minus `excludeUserIds`.
 * Principals (`users`) and non-principal addresses (`addresses`) are returned
 * separately so a caller cannot send an address through the user path or skip
 * the visibility check for a user.
 */
export async function resolveBoardNotificationAudience(
  conn: Conn,
  tenant: string,
  trigger: BoardNotificationTrigger,
  options: { excludeUserIds?: Iterable<string | null | undefined> } = {}
): Promise<BoardNotificationAudience> {
  const rules = await loadMatchingRules(conn, tenant, trigger);
  if (rules.length === 0) {
    return { users: [], addresses: [] };
  }
  const excluded = new Set<string>();
  for (const id of options.excludeUserIds ?? []) {
    if (id) excluded.add(id);
  }

  const [expanded, classified] = await Promise.all([
    expandRuleRecipients(conn, tenant, rules),
    classifyRuleAddresses(conn, tenant, rules),
  ]);

  const seen = new Set<string>();
  const users: ResolvedRecipient[] = [];
  for (const recipient of [...expanded, ...classified.users]) {
    if (excluded.has(recipient.userId) || seen.has(recipient.userId)) continue;
    seen.add(recipient.userId);
    users.push(recipient);
  }
  return { users, addresses: classified.addresses };
}
