import type { Knex } from 'knex';
import { hasPermission } from '@alga-psa/auth';
import {
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  writeTicketActivity,
} from '@alga-psa/shared/lib/ticketActivity';
import {
  auditCloseRulesBypassIfGated,
  closeRulesHaveEnabledGates,
  getBoardCloseRulesRow,
  parseCloseRuleRequiredFields,
  type BoardCloseRulesRow,
} from '@alga-psa/shared/lib/ticketCloseRules';
import {
  TicketCloseValidationError,
  CLOSE_RULE_REQUIRED_FIELDS,
  CLOSE_RULE_REQUIRED_FIELD_LABELS,
  type CloseRuleId,
  type CloseRuleFailure,
  type CloseRuleBypassSource,
  type CloseRuleRequiredField,
  type EnforceTicketCloseRulesOptions,
  type EnforceTicketCloseRulesResult,
} from './closeRuleConstants';

/**
 * Pre-close validation gates ("close rules"), evaluated inside the caller's
 * transaction at every human path that flips a ticket from an open to a
 * closed status. Board-scoped config lives in board_close_rules; automation
 * paths (workflow tickets.close, CSV import, auto-close engine, client
 * portal) bypass with an audit trail instead of being blocked.
 * See docs/plans/2026-06-10-ticket-close-rules/PRD.md §5.1.
 *
 * The client-safe types, constants, and TicketCloseValidationError live in
 * ./closeRuleConstants so the settings/ticket UI and the @alga-psa/tickets/lib
 * barrel can use them without pulling in hasPermission/DB (which would drag
 * node:async_hooks into client bundles). They are re-exported here so existing
 * deep-path importers of this module are unchanged. The functions below are
 * server-only.
 */

export {
  TicketCloseValidationError,
  CLOSE_RULE_REQUIRED_FIELDS,
  CLOSE_RULE_REQUIRED_FIELD_LABELS,
};
export type {
  CloseRuleId,
  CloseRuleFailure,
  CloseRuleBypassSource,
  CloseRuleRequiredField,
  EnforceTicketCloseRulesOptions,
  EnforceTicketCloseRulesResult,
};

const REQUIRED_FIELD_LABELS = CLOSE_RULE_REQUIRED_FIELD_LABELS;

/**
 * Evaluates the board's enabled gates against a ticket and returns the
 * failures (empty = closable). Non-throwing variant used by the UI's
 * pre-close check; enforceTicketCloseRules wraps it with override/bypass
 * semantics for the write paths.
 */
export async function evaluateTicketCloseRules(
  trx: Knex.Transaction | Knex,
  tenant: string,
  ticket: EnforceTicketCloseRulesOptions['ticket']
): Promise<CloseRuleFailure[]> {
  if (!ticket.board_id) return [];
  const rules = await getBoardCloseRulesRow(trx, tenant, ticket.board_id);
  if (!rules || !closeRulesHaveEnabledGates(rules)) return [];
  return evaluateGates(trx, tenant, ticket, rules);
}

async function evaluateGates(
  trx: Knex.Transaction | Knex,
  tenant: string,
  ticket: EnforceTicketCloseRulesOptions['ticket'],
  rules: BoardCloseRulesRow
): Promise<CloseRuleFailure[]> {
  const failures: CloseRuleFailure[] = [];
  const ticketId = ticket.ticket_id;

  if (rules.require_resolution_comment) {
    const resolutionComment = await trx('comments')
      .where({ tenant, ticket_id: ticketId })
      .where(function resolutionMarkers() {
        this.where('is_resolution', true).orWhereRaw("metadata->>'closes_ticket' = 'true'");
      })
      .first();
    if (!resolutionComment) {
      failures.push({
        rule: 'resolution_comment',
        message: 'A resolution comment is required before closing',
      });
    }
  }

  if (rules.require_time_entry) {
    const timeEntry = await trx('time_entries')
      .where({ tenant, work_item_id: ticketId, work_item_type: 'ticket' })
      .first();
    if (!timeEntry) {
      failures.push({
        rule: 'time_entry',
        message: 'At least one time entry must be logged before closing',
      });
    }
  }

  if (rules.require_checklist_complete) {
    const incomplete = await trx('ticket_checklist_items')
      .where({ tenant, ticket_id: ticketId, is_required: true, completed: false })
      .count<{ count: string }[]>('* as count');
    const incompleteCount = Number(incomplete[0]?.count ?? 0);
    if (incompleteCount > 0) {
      failures.push({
        rule: 'checklist_incomplete',
        message:
          incompleteCount === 1
            ? '1 required checklist item is incomplete'
            : `${incompleteCount} required checklist items are incomplete`,
        meta: { incomplete_count: incompleteCount },
      });
    }
  }

  if (rules.require_no_open_children) {
    const openChildren = await trx('tickets')
      .where({ tenant, master_ticket_id: ticketId })
      .whereNull('closed_at')
      .count<{ count: string }[]>('* as count');
    const openCount = Number(openChildren[0]?.count ?? 0);
    if (openCount > 0) {
      failures.push({
        rule: 'open_children',
        message:
          openCount === 1
            ? '1 bundled ticket is still open'
            : `${openCount} bundled tickets are still open`,
        meta: { open_children_count: openCount },
      });
    }
  }

  const requiredFields = parseCloseRuleRequiredFields(rules.required_fields);
  if (requiredFields.length > 0) {
    const missing = requiredFields.filter((field) => {
      const value = (ticket as Record<string, unknown>)[field];
      return value === null || value === undefined || value === '';
    });
    if (missing.length > 0) {
      failures.push({
        rule: 'required_fields',
        message: `Required fields are missing: ${missing
          .map((f) => REQUIRED_FIELD_LABELS[f] ?? f)
          .join(', ')}`,
        meta: { missing_fields: missing },
      });
    }
  }

  return failures;
}

/**
 * Throws TicketCloseValidationError when the close must be blocked; returns
 * normally (recording any override/bypass in ticket_audit_logs) otherwise.
 */
export async function enforceTicketCloseRules(
  trx: Knex.Transaction,
  tenant: string,
  options: EnforceTicketCloseRulesOptions
): Promise<EnforceTicketCloseRulesResult> {
  const { ticket, override, bypass, actor, source } = options;

  if (!ticket.board_id) {
    return { overridden: false, bypassed: false };
  }

  if (bypass) {
    const bypassed = await auditCloseRulesBypassIfGated(
      trx,
      tenant,
      ticket.ticket_id,
      ticket.board_id,
      bypass.source,
      actor,
      source
    );
    return { overridden: false, bypassed };
  }

  const failures = await evaluateTicketCloseRules(trx, tenant, ticket);
  if (failures.length === 0) {
    return { overridden: false, bypassed: false };
  }

  if (override?.requested) {
    const canOverride = await hasPermission(override.user as any, 'ticket', 'close_override', trx);
    if (canOverride) {
      await writeTicketActivity(trx, {
        tenant,
        ticketId: ticket.ticket_id,
        eventType: TICKET_ACTIVITY_EVENT.CLOSE_RULES_OVERRIDDEN,
        entityType: TICKET_ACTIVITY_ENTITY.TICKET,
        actor,
        source,
        details: {
          reason: override.reason ?? null,
          failures: failures.map((f) => ({ rule: f.rule, message: f.message, ...f.meta })),
        },
      });
      return { overridden: true, bypassed: false };
    }
  }

  throw new TicketCloseValidationError(failures);
}
