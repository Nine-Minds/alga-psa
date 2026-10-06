'use server'

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import {
  loadBoardNotificationRules,
  type BoardNotificationRule,
} from '@alga-psa/shared/lib/tickets/boardNotificationRules';
import { loadBoardDefaultWatcherUserIds } from '@alga-psa/shared/lib/tickets/boardDefaultWatchers';
import { boardActionErrorFrom, type BoardActionError } from './boardActionErrors';

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
  is_enabled?: boolean;
}

export interface SaveBoardNotificationSettingsInput {
  rules?: BoardNotificationRuleInput[];
  default_watcher_user_ids?: string[];
}

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
    is_enabled: rule.is_enabled,
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
          is_enabled: rule.is_enabled ?? true,
        };
        if (!normalized.notify_on_create && normalized.status_ids.length === 0) {
          throw new Error(
            `Notification rule ${index + 1} must fire on ticket creation or on at least one status`
          );
        }
        if (normalized.user_ids.length === 0 && normalized.team_ids.length === 0) {
          throw new Error(`Notification rule ${index + 1} must notify at least one user or team`);
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
          ];
          await scoped.table('board_notification_rule_recipients').insert(recipientRows);
        }

        if (defaultWatcherUserIds.length > 0) {
          await scoped
            .table('board_default_watchers')
            .insert(defaultWatcherUserIds.map((user_id) => ({ tenant, board_id: boardId, user_id })));
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
