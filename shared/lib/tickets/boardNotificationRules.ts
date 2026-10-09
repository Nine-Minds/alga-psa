import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

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
}

export interface ResolvedRecipient {
  userId: string;
  email: string;
  displayName: string;
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
      .select('rule_id', 'recipient_type', 'user_id', 'team_id')
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
 * Resolve the recipients of every rule matching the trigger, deduped across
 * rules (each user at most once), minus `excludeUserIds`.
 */
export async function resolveBoardNotificationRecipients(
  conn: Conn,
  tenant: string,
  trigger: BoardNotificationTrigger,
  options: { excludeUserIds?: Iterable<string | null | undefined> } = {}
): Promise<ResolvedRecipient[]> {
  const rules = await loadMatchingRules(conn, tenant, trigger);
  if (rules.length === 0) {
    return [];
  }
  const excluded = new Set<string>();
  for (const id of options.excludeUserIds ?? []) {
    if (id) excluded.add(id);
  }
  const recipients = await expandRuleRecipients(conn, tenant, rules);
  return recipients.filter((recipient) => !excluded.has(recipient.userId));
}
