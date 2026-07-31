import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  writeTicketActivity,
  type TicketActivityActorInfo,
  type TicketActivitySource,
} from '../ticketActivity';

/**
 * Board close-rule helpers shared by the gate chokepoint
 * (packages/tickets/src/lib/validateTicketClosure.ts) and the exempt
 * automation paths (workflow tickets.close, CSV import, auto-close engine,
 * client portal) that audit-log their bypass instead of evaluating gates.
 */

export type CloseRuleBypassSource = 'workflow' | 'import' | 'auto_close' | 'client_portal';

export interface BoardCloseRulesRow {
  require_resolution_comment: boolean;
  require_time_entry: boolean;
  require_checklist_complete: boolean;
  require_no_open_children: boolean;
  required_fields: unknown;
  is_enabled: boolean;
}

export function parseCloseRuleRequiredFields(value: unknown): string[] {
  const raw = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(raw) ? raw.filter((f): f is string => typeof f === 'string') : [];
}

export function closeRulesHaveEnabledGates(rules: BoardCloseRulesRow): boolean {
  return (
    rules.is_enabled &&
    (rules.require_resolution_comment ||
      rules.require_time_entry ||
      rules.require_checklist_complete ||
      rules.require_no_open_children ||
      parseCloseRuleRequiredFields(rules.required_fields).length > 0)
  );
}

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

export async function getBoardCloseRulesRow(
  trx: Knex.Transaction | Knex,
  tenant: string,
  boardId: string
): Promise<BoardCloseRulesRow | undefined> {
  return tenantScopedTable(trx, 'board_close_rules', tenant).where({ board_id: boardId }).first();
}

/**
 * When the board has enabled close gates, records that an exempt automation
 * path closed the ticket without evaluating them. No-op on ungated boards so
 * the audit timeline stays quiet for tenants not using close rules.
 */
export async function auditCloseRulesBypassIfGated(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  boardId: string | null | undefined,
  bypassSource: CloseRuleBypassSource,
  actor: TicketActivityActorInfo,
  source: TicketActivitySource | string
): Promise<boolean> {
  if (!boardId) return false;

  const rules = await getBoardCloseRulesRow(trx, tenant, boardId);
  if (!rules || !closeRulesHaveEnabledGates(rules)) {
    return false;
  }

  await writeTicketActivity(trx, {
    tenant,
    ticketId,
    eventType: TICKET_ACTIVITY_EVENT.CLOSE_RULES_BYPASSED,
    entityType: TICKET_ACTIVITY_ENTITY.TICKET,
    actor,
    source,
    details: { bypass_source: bypassSource },
  });
  return true;
}
