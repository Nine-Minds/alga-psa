import type {
  TicketActivityActorInfo,
  TicketActivitySource,
} from '@alga-psa/shared/lib/ticketActivity';
import type { CloseRuleBypassSource } from '@alga-psa/shared/lib/ticketCloseRules';

/**
 * Client-safe close-rule types, constants, and the validation error.
 *
 * Split out from validateTicketClosure.ts so the settings/ticket UI and the
 * @alga-psa/tickets/lib barrel can import these without pulling in the
 * server-only enforcement code. enforceTicketCloseRules imports hasPermission
 * and runs DB queries, whose transitive deps reach node:async_hooks and must
 * never land in a client bundle. Only `import type` is used here, so this
 * module carries no runtime dependency on those server modules.
 */

export type CloseRuleId =
  | 'resolution_comment'
  | 'time_entry'
  | 'checklist_incomplete'
  | 'open_children'
  | 'required_fields';

export interface CloseRuleFailure {
  rule: CloseRuleId;
  message: string;
  meta?: Record<string, unknown>;
}

export class TicketCloseValidationError extends Error {
  readonly failures: CloseRuleFailure[];

  constructor(failures: CloseRuleFailure[]) {
    super(`Ticket cannot be closed: ${failures.map((f) => f.message).join('; ')}`);
    this.name = 'TicketCloseValidationError';
    this.failures = failures;
  }
}

export type { CloseRuleBypassSource };

export interface EnforceTicketCloseRulesOptions {
  /** Post-update field values relevant to the gates (current row merged with pending changes). */
  ticket: {
    ticket_id: string;
    board_id: string | null;
    category_id?: string | null;
    subcategory_id?: string | null;
    priority_id?: string | null;
    assigned_to?: string | null;
  };
  /** Close-anyway request; honored only when the user holds ticket:close_override. */
  override?: { requested: boolean; reason?: string | null; user: unknown };
  /** Automation exemption; skips gate evaluation and audit-logs the bypass. */
  bypass?: { source: CloseRuleBypassSource };
  actor: TicketActivityActorInfo;
  source: TicketActivitySource | string;
}

export const CLOSE_RULE_REQUIRED_FIELDS = [
  'category_id',
  'subcategory_id',
  'priority_id',
  'assigned_to',
] as const;

export type CloseRuleRequiredField = (typeof CLOSE_RULE_REQUIRED_FIELDS)[number];

export const CLOSE_RULE_REQUIRED_FIELD_LABELS: Record<string, string> = {
  category_id: 'Category',
  subcategory_id: 'Subcategory',
  priority_id: 'Priority',
  assigned_to: 'Assignee',
};

export interface EnforceTicketCloseRulesResult {
  overridden: boolean;
  bypassed: boolean;
}
