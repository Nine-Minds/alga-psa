'use server'

import { auditLog, createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import {
  BOARD_NOTIFICATION_EMAIL_MAX_LENGTH,
  loadBoardNotificationRules,
  normalizeBoardNotificationEmail,
  type BoardNotificationRule,
} from '@alga-psa/shared/lib/tickets/boardNotificationRules';
import { loadBoardDefaultWatcherUserIds } from '@alga-psa/shared/lib/tickets/boardDefaultWatchers';
import { BoardActionMessageError, boardActionErrorFrom, type BoardActionError } from './boardActionErrors';

/**
 * Per-board notification rules and default watchers.
 * See docs/plans/2026-10-06-board-notification-rules-plan.md §5.7.
 */

export interface BoardNotificationRuleSettings {
  rule_id: string;
  notify_on_create: boolean;
  status_ids: string[];
  user_ids: string[];
  team_ids: string[];
  /** Plain addresses (e.g. a distribution list); normalized, unique per rule. */
  email_addresses: string[];
  is_enabled: boolean;
}

export interface BoardNotificationSettings {
  rules: BoardNotificationRuleSettings[];
  default_watcher_user_ids: string[];
}

export interface BoardNotificationRuleInput {
  /** Reused when provided so rule identities stay stable across saves. */
  rule_id?: string;
  notify_on_create?: boolean;
  status_ids?: string[];
  user_ids?: string[];
  team_ids?: string[];
  email_addresses?: string[];
  is_enabled?: boolean;
}

export interface SaveBoardNotificationSettingsInput {
  rules?: BoardNotificationRuleInput[];
  default_watcher_user_ids?: string[];
}

/** At most this many plain addresses per rule (plan D15). */
const MAX_EMAIL_ADDRESSES_PER_RULE = 25;

const AUDIT_OPERATION_EMAIL_RECIPIENTS = 'board_notification_email_recipients_changed';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dedupe(ids: string[] | undefined): string[] {
  return Array.from(new Set((ids ?? []).filter((id) => typeof id === 'string' && id.length > 0)));
}

function toSettingsRule(rule: BoardNotificationRule): BoardNotificationRuleSettings {
  return {
    rule_id: rule.rule_id,
    notify_on_create: rule.notify_on_create,
    status_ids: rule.status_ids,
    user_ids: rule.user_ids,
    team_ids: rule.team_ids,
    email_addresses: rule.email_addresses,
    is_enabled: rule.is_enabled,
  };
}

type AddressGuardKind = 'user' | 'contact' | 'clientDomain' | 'inboundMailbox';

const ADDRESS_GUARD_MESSAGES: Record<AddressGuardKind, { key: string; text: (rule: number, address: string) => string }> = {
  user: {
    key: 'features/tickets:errors.board.notificationEmailIsUser',
    text: (rule, address) =>
      `Notification rule ${rule}: ${address} is an Alga user's email address. Choose the user instead.`,
  },
  contact: {
    key: 'features/tickets:errors.board.notificationEmailIsContact',
    text: (rule, address) =>
      `Notification rule ${rule}: ${address} belongs to a client contact or location and cannot be a recipient.`,
  },
  clientDomain: {
    key: 'features/tickets:errors.board.notificationEmailClientDomain',
    text: (rule, address) =>
      `Notification rule ${rule}: ${address} is on a client's email domain and cannot be a recipient.`,
  },
  inboundMailbox: {
    key: 'features/tickets:errors.board.notificationEmailInboundMailbox',
    text: (rule, address) =>
      `Notification rule ${rule}: ${address} is a connected inbound mailbox and cannot be a recipient.`,
  },
};

function addressGuardError(kind: AddressGuardKind, rule: number, address: string): BoardActionMessageError {
  const guard = ADDRESS_GUARD_MESSAGES[kind];
  return new BoardActionMessageError(guard.text(rule, address), guard.key, { rule, address });
}

function domainOf(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1);
}

/**
 * Plan D5 (b)-(e). One batched query per guard, run inside the save transaction. Every address in
 * the payload is checked, including ones already stored on the board: a user, contact or mailbox
 * that appeared after the address was saved must not stay valid just because it was.
 */
async function assertEmailRecipientsAllowed(
  trx: Knex.Transaction,
  tenant: string,
  rules: Array<{ email_addresses: string[] }>
): Promise<void> {
  const ruleNumberByAddress = new Map<string, number>();
  rules.forEach((rule, index) => {
    for (const address of rule.email_addresses) {
      if (!ruleNumberByAddress.has(address)) ruleNumberByAddress.set(address, index + 1);
    }
  });
  const addresses = Array.from(ruleNumberByAddress.keys());
  if (addresses.length === 0) return;
  const scoped = tenantDb(trx, tenant);
  const fail = (kind: AddressGuardKind, address: string): never => {
    throw addressGuardError(kind, ruleNumberByAddress.get(address) ?? 1, address);
  };

  // (b) An active internal user's email: choose the user so the read check applies.
  const userRows = await scoped
    .table('users')
    .where({ user_type: 'internal', is_inactive: false })
    .whereRaw('lower(email) = ANY(?)', [addresses])
    .select('email');
  for (const row of userRows) fail('user', String(row.email).toLowerCase());

  // (c) A client contact's (primary or additional) or a client location's email.
  const contactRows = await trx.raw(
    `SELECT lower(email) AS email FROM contacts WHERE tenant = ? AND lower(email) = ANY(?)
     UNION
     SELECT lower(email_address) FROM contact_additional_email_addresses WHERE tenant = ? AND lower(email_address) = ANY(?)
     UNION
     SELECT lower(email) FROM client_locations WHERE tenant = ? AND lower(email) = ANY(?)`,
    [tenant, addresses, tenant, addresses, tenant, addresses]
  );
  for (const row of contactRows.rows as Array<{ email: string }>) fail('contact', row.email);

  // (d) An address on a domain mapped to a client (a board serves many clients).
  const domains = Array.from(new Set(addresses.map(domainOf)));
  const domainRows = await scoped
    .table('client_inbound_email_domains')
    .whereRaw('lower(domain) = ANY(?)', [domains])
    .select('domain');
  const clientDomains = new Set(domainRows.map((row: { domain: string }) => String(row.domain).toLowerCase()));
  if (clientDomains.size > 0) {
    const offender = addresses.find((address) => clientDomains.has(domainOf(address)));
    if (offender) fail('clientDomain', offender);
  }

  // (e) A connected inbound mailbox: sending to it would loop the notification back in.
  const mailboxRows = await scoped
    .table('email_providers')
    .whereRaw('lower(mailbox) = ANY(?)', [addresses])
    .select('mailbox');
  for (const row of mailboxRows) fail('inboundMailbox', String(row.mailbox).toLowerCase());
}

function diffAddresses(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const previous = new Set(before);
  const next = new Set(after);
  return {
    added: after.filter((address) => !previous.has(address)).sort(),
    removed: before.filter((address) => !next.has(address)).sort(),
  };
}

export const getBoardNotificationSettings = withAuth(
  async (user, { tenant }, boardId: string): Promise<BoardNotificationSettings | BoardActionError> => {
    try {
      const { knex: db } = await createTenantKnex();
      if (!(await hasPermission(user, 'ticket_settings', 'read', db))) {
        throw new Error('Permission denied: Cannot read ticket settings');
      }

      const [rules, defaultWatcherUserIds] = await Promise.all([
        loadBoardNotificationRules(db, tenant, boardId),
        loadBoardDefaultWatcherUserIds(db, tenant, boardId),
      ]);
      return { rules: rules.map(toSettingsRule), default_watcher_user_ids: defaultWatcherUserIds };
    } catch (error) {
      const expected = boardActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  }
);

export const saveBoardNotificationSettings = withAuth(
  async (
    user,
    { tenant },
    boardId: string,
    input: SaveBoardNotificationSettingsInput
  ): Promise<BoardNotificationSettings | BoardActionError> => {
    try {
      const { knex: db } = await createTenantKnex();
      if (!(await hasPermission(user, 'ticket_settings', 'update', db))) {
        throw new Error('Permission denied: Cannot update ticket settings');
      }

      // Normalize and validate everything that needs no database first.
      const rules = (input?.rules ?? []).map((rule, index) => {
        const normalized = {
          rule_id: rule.rule_id && UUID_PATTERN.test(rule.rule_id) ? rule.rule_id : uuidv4(),
          notify_on_create: Boolean(rule.notify_on_create),
          status_ids: dedupe(rule.status_ids),
          user_ids: dedupe(rule.user_ids),
          team_ids: dedupe(rule.team_ids),
          email_addresses: [] as string[],
          is_enabled: rule.is_enabled ?? true,
        };
        const seenAddresses = new Set<string>();
        for (const raw of rule.email_addresses ?? []) {
          const address = normalizeBoardNotificationEmail(raw);
          if (!address) {
            throw new BoardActionMessageError(
              `Notification rule ${index + 1} has an invalid email address (up to ${BOARD_NOTIFICATION_EMAIL_MAX_LENGTH} characters)`,
              'features/tickets:errors.board.notificationEmailInvalid',
              { rule: index + 1, address: String(raw), max: BOARD_NOTIFICATION_EMAIL_MAX_LENGTH }
            );
          }
          seenAddresses.add(address);
        }
        normalized.email_addresses = Array.from(seenAddresses);
        if (normalized.email_addresses.length > MAX_EMAIL_ADDRESSES_PER_RULE) {
          throw new BoardActionMessageError(
            `Notification rule ${index + 1} can have at most ${MAX_EMAIL_ADDRESSES_PER_RULE} email addresses`,
            'features/tickets:errors.board.notificationEmailLimit',
            { rule: index + 1, max: MAX_EMAIL_ADDRESSES_PER_RULE }
          );
        }
        if (!normalized.notify_on_create && normalized.status_ids.length === 0) {
          throw new Error(
            `Notification rule ${index + 1} must fire on ticket creation or on at least one status`
          );
        }
        if (
          normalized.user_ids.length === 0 &&
          normalized.team_ids.length === 0 &&
          normalized.email_addresses.length === 0
        ) {
          throw new BoardActionMessageError(
            `Notification rule ${index + 1} must notify at least one user, team or email address`,
            'features/tickets:errors.board.notificationRecipientRequired',
            { rule: index + 1 }
          );
        }
        return normalized;
      });
      const defaultWatcherUserIds = dedupe(input?.default_watcher_user_ids);

      return await withTransaction(db, async (trx: Knex.Transaction) => {
        const scoped = tenantDb(trx, tenant);

        const board = await scoped.table('boards').where({ board_id: boardId }).first();
        if (!board) {
          throw new Error('Board not found');
        }

        const statusIds = dedupe(rules.flatMap((rule) => rule.status_ids));
        if (statusIds.length > 0) {
          const found = await scoped
            .table('statuses')
            .where({ board_id: boardId, status_type: 'ticket' })
            .whereIn('status_id', statusIds)
            .pluck('status_id');
          const missing = statusIds.filter((id) => !found.includes(id));
          if (missing.length > 0) {
            throw new Error('Notification rule status must be a ticket status on this board');
          }
        }

        const userIds = dedupe([...rules.flatMap((rule) => rule.user_ids), ...defaultWatcherUserIds]);
        if (userIds.length > 0) {
          // Users already stored on this board (as a recipient or default watcher) stay valid
          // even after deactivation: those rows are kept and filtered out at send time, so a
          // board with a deactivated stored user must still save. Only newly chosen users
          // have to be active internal users.
          const storedIds = new Set<string>([
            ...(await scoped
              .table('board_notification_rule_recipients as r')
              .join('board_notification_rules as br', function () {
                this.on('br.tenant', 'r.tenant').andOn('br.rule_id', 'r.rule_id');
              })
              .where('br.board_id', boardId)
              .where('r.recipient_type', 'user')
              .whereIn('r.user_id', userIds)
              .pluck('r.user_id')),
            ...(await scoped
              .table('board_default_watchers')
              .where({ board_id: boardId })
              .whereIn('user_id', userIds)
              .pluck('user_id')),
          ]);
          const newIds = userIds.filter((id) => !storedIds.has(id));
          if (newIds.length > 0) {
            const found = await scoped
              .table('users')
              .where({ user_type: 'internal', is_inactive: false })
              .whereIn('user_id', newIds)
              .pluck('user_id');
            if (newIds.some((id) => !found.includes(id))) {
              throw new Error('Notification recipients and default watchers must be active internal users');
            }
          }
        }

        const teamIds = dedupe(rules.flatMap((rule) => rule.team_ids));
        if (teamIds.length > 0) {
          const found = await scoped.table('teams').whereIn('team_id', teamIds).pluck('team_id');
          if (teamIds.some((id) => !found.includes(id))) {
            throw new Error('Notification rule team not found');
          }
        }

        await assertEmailRecipientsAllowed(trx, tenant, rules);

        // Addresses stored before this save, per rule, for the audit diff below.
        const storedAddressRows = await scoped
          .table('board_notification_rule_recipients as r')
          .join('board_notification_rules as br', function () {
            this.on('br.tenant', 'r.tenant').andOn('br.rule_id', 'r.rule_id');
          })
          .where('br.board_id', boardId)
          .where('r.recipient_type', 'email')
          .select('r.rule_id', 'r.email');
        const storedAddressesByRule = new Map<string, string[]>();
        for (const row of storedAddressRows as Array<{ rule_id: string; email: string }>) {
          storedAddressesByRule.set(row.rule_id, [...(storedAddressesByRule.get(row.rule_id) ?? []), row.email]);
        }

        // Replace: children cascade from the rule rows. Rule ids are re-used when the
        // caller sends them, so identities stay stable across saves.
        const existingRows = await scoped
          .table('board_notification_rules')
          .where({ board_id: boardId })
          .select('rule_id', 'created_by', 'created_at');
        const existingById = new Map<string, { created_by: string | null; created_at: unknown }>(
          existingRows.map((row: any) => [row.rule_id as string, row])
        );

        // A rule id supplied by the caller that belongs to a different board must not be adopted.
        const foreignIds = rules
          .map((rule) => rule.rule_id)
          .filter((id) => !existingById.has(id));
        if (foreignIds.length > 0) {
          const taken = await scoped.table('board_notification_rules').whereIn('rule_id', foreignIds).pluck('rule_id');
          if (taken.length > 0) {
            throw new Error('Notification rule not found on this board');
          }
        }

        await scoped.table('board_notification_rules').where({ board_id: boardId }).delete();
        await scoped.table('board_default_watchers').where({ board_id: boardId }).delete();

        const nowMs = Date.now();
        const now = new Date(nowMs).toISOString();
        for (const [ruleIndex, rule] of rules.entries()) {
          const previous = existingById.get(rule.rule_id);
          await scoped.table('board_notification_rules').insert({
            tenant,
            rule_id: rule.rule_id,
            board_id: boardId,
            notify_on_create: rule.notify_on_create,
            is_enabled: rule.is_enabled,
            created_by: previous ? previous.created_by : user.user_id,
            // Rules list in created_at order; stagger new rules so input order is kept.
            created_at: previous ? previous.created_at : new Date(nowMs + ruleIndex).toISOString(),
            updated_at: now,
          });
          if (rule.status_ids.length > 0) {
            await scoped
              .table('board_notification_rule_statuses')
              .insert(rule.status_ids.map((status_id) => ({ tenant, rule_id: rule.rule_id, status_id })));
          }
          const recipientRows = [
            ...rule.user_ids.map((user_id) => ({
              tenant,
              rule_id: rule.rule_id,
              recipient_type: 'user',
              user_id,
              team_id: null,
            })),
            ...rule.team_ids.map((team_id) => ({
              tenant,
              rule_id: rule.rule_id,
              recipient_type: 'team',
              user_id: null,
              team_id,
            })),
            ...rule.email_addresses.map((email) => ({
              tenant,
              rule_id: rule.rule_id,
              recipient_type: 'email',
              user_id: null,
              team_id: null,
              email,
            })),
          ];
          await scoped.table('board_notification_rule_recipients').insert(recipientRows);
        }

        if (defaultWatcherUserIds.length > 0) {
          await scoped
            .table('board_default_watchers')
            .insert(defaultWatcherUserIds.map((user_id) => ({ tenant, board_id: boardId, user_id })));
        }

        // D10: one audit row per save that changes the board's addresses. The replace-on-save write
        // loses row history, and an address is the one setting that sends ticket data outside the
        // permission model. Rules are matched by id; a deleted rule counts all its addresses removed.
        const auditedRules = [
          ...rules.map((rule) => ({
            rule_id: rule.rule_id,
            ...diffAddresses(storedAddressesByRule.get(rule.rule_id) ?? [], rule.email_addresses),
          })),
          ...Array.from(storedAddressesByRule.entries())
            .filter(([ruleId]) => !rules.some((rule) => rule.rule_id === ruleId))
            .map(([ruleId, before]) => ({ rule_id: ruleId, ...diffAddresses(before, []) })),
        ].filter((change) => change.added.length > 0 || change.removed.length > 0);
        if (auditedRules.length > 0) {
          // auditLog silently skips when app.current_tenant is unset, and nothing on this path sets
          // it. Set it transaction-locally so the row is written, and so audit_logs RLS accepts it.
          await trx.raw('select set_config(?, ?, true)', ['app.current_tenant', tenant]);
          await auditLog(trx, {
            userId: user.user_id,
            operation: AUDIT_OPERATION_EMAIL_RECIPIENTS,
            tableName: 'board_notification_rule_recipients',
            recordId: boardId,
            changedData: { rules: auditedRules },
            details: { board_id: boardId, board_name: board.board_name ?? null },
          });
        }

        const [saved, watchers] = await Promise.all([
          loadBoardNotificationRules(trx, tenant, boardId),
          loadBoardDefaultWatcherUserIds(trx, tenant, boardId),
        ]);
        return { rules: saved.map(toSettingsRule), default_watcher_user_ids: watchers };
      });
    } catch (error) {
      const expected = boardActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  }
);
