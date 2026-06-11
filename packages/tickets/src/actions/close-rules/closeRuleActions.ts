'use server'

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { Knex } from 'knex';
import {
  CLOSE_RULE_REQUIRED_FIELDS,
  evaluateTicketCloseRules,
  type CloseRuleFailure,
  type CloseRuleRequiredField,
} from '../../lib/validateTicketClosure';

/**
 * Per-board close rule configuration (validation gates) and auto-close rules.
 * See docs/plans/2026-06-10-ticket-close-rules/PRD.md §5.1 / §5.3.
 */

export interface IBoardCloseRules {
  board_id: string;
  require_resolution_comment: boolean;
  require_time_entry: boolean;
  require_checklist_complete: boolean;
  require_no_open_children: boolean;
  required_fields: CloseRuleRequiredField[];
  is_enabled: boolean;
}

export interface BoardCloseRulesInput {
  require_resolution_comment?: boolean;
  require_time_entry?: boolean;
  require_checklist_complete?: boolean;
  require_no_open_children?: boolean;
  required_fields?: string[];
  is_enabled?: boolean;
}

export interface IBoardAutoCloseRule {
  rule_id: string;
  board_id: string;
  trigger_status_id: string;
  inactivity_days: number;
  warning_days_before: number | null;
  close_to_status_id: string;
  is_enabled: boolean;
}

export interface BoardAutoCloseRuleInput {
  trigger_status_id: string;
  inactivity_days: number;
  warning_days_before?: number | null;
  close_to_status_id: string;
  is_enabled?: boolean;
}

const DEFAULT_CLOSE_RULES: Omit<IBoardCloseRules, 'board_id'> = {
  require_resolution_comment: false,
  require_time_entry: false,
  require_checklist_complete: false,
  require_no_open_children: false,
  required_fields: [],
  is_enabled: true,
};

function parseRequiredFields(value: unknown): CloseRuleRequiredField[] {
  const raw = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(raw)) return [];
  return raw.filter((f): f is CloseRuleRequiredField =>
    (CLOSE_RULE_REQUIRED_FIELDS as readonly string[]).includes(f)
  );
}

function validateRequiredFields(fields: string[]): CloseRuleRequiredField[] {
  const invalid = fields.filter(
    (f) => !(CLOSE_RULE_REQUIRED_FIELDS as readonly string[]).includes(f)
  );
  if (invalid.length > 0) {
    throw new Error(
      `Invalid required fields: ${invalid.join(', ')}. Allowed: ${CLOSE_RULE_REQUIRED_FIELDS.join(', ')}`
    );
  }
  return fields as CloseRuleRequiredField[];
}

export const getBoardCloseRules = withAuth(
  async (_user, { tenant }, boardId: string): Promise<IBoardCloseRules> => {
    const { knex: db } = await createTenantKnex();
    const row = await db('board_close_rules')
      .where({ tenant, board_id: boardId })
      .first();

    if (!row) {
      return { board_id: boardId, ...DEFAULT_CLOSE_RULES };
    }

    return {
      board_id: row.board_id,
      require_resolution_comment: row.require_resolution_comment,
      require_time_entry: row.require_time_entry,
      require_checklist_complete: row.require_checklist_complete,
      require_no_open_children: row.require_no_open_children,
      required_fields: parseRequiredFields(row.required_fields),
      is_enabled: row.is_enabled,
    };
  }
);

export const upsertBoardCloseRules = withAuth(
  async (user, { tenant }, boardId: string, input: BoardCloseRulesInput): Promise<IBoardCloseRules> => {
    if (!(await hasPermission(user, 'ticket', 'update'))) {
      throw new Error('Permission denied: Cannot update board close rules');
    }

    const requiredFields = validateRequiredFields(input.required_fields ?? []);
    const { knex: db } = await createTenantKnex();

    return withTransaction(db, async (trx: Knex.Transaction) => {
      const board = await trx('boards').where({ tenant, board_id: boardId }).first();
      if (!board) {
        throw new Error('Board not found');
      }

      const values = {
        require_resolution_comment: input.require_resolution_comment ?? false,
        require_time_entry: input.require_time_entry ?? false,
        require_checklist_complete: input.require_checklist_complete ?? false,
        require_no_open_children: input.require_no_open_children ?? false,
        required_fields: JSON.stringify(requiredFields),
        is_enabled: input.is_enabled ?? true,
        updated_at: trx.fn.now(),
      };

      const [row] = await trx('board_close_rules')
        .insert({ tenant, board_id: boardId, ...values })
        .onConflict(['tenant', 'board_id'])
        .merge(values)
        .returning('*');

      return {
        board_id: row.board_id,
        require_resolution_comment: row.require_resolution_comment,
        require_time_entry: row.require_time_entry,
        require_checklist_complete: row.require_checklist_complete,
        require_no_open_children: row.require_no_open_children,
        required_fields: parseRequiredFields(row.required_fields),
        is_enabled: row.is_enabled,
      };
    });
  }
);

async function validateAutoCloseRule(
  trx: Knex.Transaction,
  tenant: string,
  boardId: string,
  input: BoardAutoCloseRuleInput,
  excludeRuleId?: string
): Promise<void> {
  if (!Number.isInteger(input.inactivity_days) || input.inactivity_days < 1) {
    throw new Error('Inactivity days must be a positive whole number');
  }

  const warning = input.warning_days_before ?? null;
  if (warning !== null) {
    if (!Number.isInteger(warning) || warning < 1 || warning >= input.inactivity_days) {
      throw new Error('Warning lead time must be a positive whole number smaller than the inactivity days');
    }
  }

  const [triggerStatus, closeStatus] = await Promise.all([
    trx('statuses').where({ tenant, status_id: input.trigger_status_id, board_id: boardId }).first(),
    trx('statuses').where({ tenant, status_id: input.close_to_status_id, board_id: boardId }).first(),
  ]);

  if (!triggerStatus) {
    throw new Error('Trigger status not found on this board');
  }
  if (triggerStatus.is_closed) {
    throw new Error('Trigger status must be an open status — closed tickets cannot age toward auto-close');
  }
  if (!closeStatus) {
    throw new Error('Target status not found on this board');
  }
  if (!closeStatus.is_closed) {
    throw new Error('Target status must be a closed status');
  }

  const duplicate = await trx('board_auto_close_rules')
    .where({ tenant, board_id: boardId, trigger_status_id: input.trigger_status_id })
    .modify((qb) => {
      if (excludeRuleId) qb.whereNot('rule_id', excludeRuleId);
    })
    .first();
  if (duplicate) {
    throw new Error('An auto-close rule for this status already exists on this board');
  }
}

export const getBoardAutoCloseRules = withAuth(
  async (_user, { tenant }, boardId: string): Promise<IBoardAutoCloseRule[]> => {
    const { knex: db } = await createTenantKnex();
    return db('board_auto_close_rules')
      .where({ tenant, board_id: boardId })
      .orderBy('created_at', 'asc')
      .select(
        'rule_id',
        'board_id',
        'trigger_status_id',
        'inactivity_days',
        'warning_days_before',
        'close_to_status_id',
        'is_enabled'
      );
  }
);

export const createBoardAutoCloseRule = withAuth(
  async (user, { tenant }, boardId: string, input: BoardAutoCloseRuleInput): Promise<IBoardAutoCloseRule> => {
    if (!(await hasPermission(user, 'ticket', 'update'))) {
      throw new Error('Permission denied: Cannot update board auto-close rules');
    }

    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const board = await trx('boards').where({ tenant, board_id: boardId }).first();
      if (!board) {
        throw new Error('Board not found');
      }

      await validateAutoCloseRule(trx, tenant, boardId, input);

      const [row] = await trx('board_auto_close_rules')
        .insert({
          tenant,
          board_id: boardId,
          trigger_status_id: input.trigger_status_id,
          inactivity_days: input.inactivity_days,
          warning_days_before: input.warning_days_before ?? null,
          close_to_status_id: input.close_to_status_id,
          is_enabled: input.is_enabled ?? true,
        })
        .returning('*');
      return row;
    });
  }
);

export const updateBoardAutoCloseRule = withAuth(
  async (user, { tenant }, ruleId: string, input: BoardAutoCloseRuleInput): Promise<IBoardAutoCloseRule> => {
    if (!(await hasPermission(user, 'ticket', 'update'))) {
      throw new Error('Permission denied: Cannot update board auto-close rules');
    }

    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const existing = await trx('board_auto_close_rules')
        .where({ tenant, rule_id: ruleId })
        .first();
      if (!existing) {
        throw new Error('Auto-close rule not found');
      }

      await validateAutoCloseRule(trx, tenant, existing.board_id, input, ruleId);

      const [row] = await trx('board_auto_close_rules')
        .where({ tenant, rule_id: ruleId })
        .update({
          trigger_status_id: input.trigger_status_id,
          inactivity_days: input.inactivity_days,
          warning_days_before: input.warning_days_before ?? null,
          close_to_status_id: input.close_to_status_id,
          is_enabled: input.is_enabled ?? existing.is_enabled,
          updated_at: trx.fn.now(),
        })
        .returning('*');
      return row;
    });
  }
);

export const deleteBoardAutoCloseRule = withAuth(
  async (user, { tenant }, ruleId: string): Promise<void> => {
    if (!(await hasPermission(user, 'ticket', 'update'))) {
      throw new Error('Permission denied: Cannot update board auto-close rules');
    }

    const { knex: db } = await createTenantKnex();
    await db('board_auto_close_rules').where({ tenant, rule_id: ruleId }).del();
  }
);

export interface TicketClosureCheckResult {
  /** Whether the target status would actually close the ticket. */
  wouldClose: boolean;
  allowed: boolean;
  failures: CloseRuleFailure[];
  /** Whether the current user may use "Close anyway" (ticket:close_override). */
  canOverride: boolean;
}

/**
 * Non-throwing pre-close check used by the UI before submitting a status
 * change to a closed status. The write paths still enforce the rules — this
 * exists so the blocked-close dialog gets structured failures instead of a
 * serialized error message.
 */
export const checkTicketClosure = withAuth(
  async (user, { tenant }, ticketId: string, targetStatusId: string): Promise<TicketClosureCheckResult> => {
    const { knex: db } = await createTenantKnex();

    const ticket = await db('tickets').where({ tenant, ticket_id: ticketId }).first();
    if (!ticket) {
      throw new Error('Ticket not found');
    }

    const [targetStatus, currentStatus] = await Promise.all([
      db('statuses').where({ tenant, status_id: targetStatusId }).first(),
      ticket.status_id
        ? db('statuses').where({ tenant, status_id: ticket.status_id }).first()
        : Promise.resolve(null),
    ]);

    const wouldClose = !!targetStatus?.is_closed && !currentStatus?.is_closed;
    if (!wouldClose) {
      return { wouldClose, allowed: true, failures: [], canOverride: false };
    }

    const failures = await evaluateTicketCloseRules(db, tenant, {
      ticket_id: ticketId,
      board_id: ticket.board_id ?? null,
      category_id: ticket.category_id ?? null,
      subcategory_id: ticket.subcategory_id ?? null,
      priority_id: ticket.priority_id ?? null,
      assigned_to: ticket.assigned_to ?? null,
    });

    const canOverride =
      failures.length > 0 ? await hasPermission(user, 'ticket', 'close_override', db) : false;

    return { wouldClose, allowed: failures.length === 0, failures, canOverride };
  }
);

export interface ITicketAutoCloseState {
  scheduled_close_at: string;
  warning_sent_at: string | null;
}

/** Pending auto-close info for the ticket banner; null when no close is scheduled. */
export const getTicketAutoCloseState = withAuth(
  async (_user, { tenant }, ticketId: string): Promise<ITicketAutoCloseState | null> => {
    const { knex: db } = await createTenantKnex();
    const row = await db('ticket_auto_close_state')
      .where({ tenant, ticket_id: ticketId })
      .first('scheduled_close_at', 'warning_sent_at');
    if (!row) return null;
    return {
      scheduled_close_at: new Date(row.scheduled_close_at).toISOString(),
      warning_sent_at: row.warning_sent_at ? new Date(row.warning_sent_at).toISOString() : null,
    };
  }
);
