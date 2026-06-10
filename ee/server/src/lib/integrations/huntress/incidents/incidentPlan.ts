/**
 * Pure lifecycle decision for one Huntress incident. All create/note/close/
 * record/skip rules live here; the processor only executes the decision.
 */

import type {
  HuntressIncidentReport,
  HuntressIncidentStatus,
} from '../../../../interfaces/huntress.interfaces';
import type { HuntressSettings } from '../settings';

export type IncidentAction =
  | { kind: 'skip'; reason: 'deleting' | 'unchanged' }
  | { kind: 'record_only'; reason: 'org_opted_out' | 'already_closed' | 'no_linked_ticket' }
  | { kind: 'create_ticket'; clientId: string; boardId: string; unmapped: boolean }
  | { kind: 'append_note'; close: boolean; previousStatus: string };

export interface ExistingAlertSummary {
  ticket_id?: string | null;
  status: string;
  metadata?: unknown;
}

export interface MappingSummary {
  client_id?: string | null;
  auto_create_tickets?: boolean | null;
}

export interface PlanIncidentInput {
  incident: HuntressIncidentReport;
  existingAlert: ExistingAlertSummary | null;
  mapping: MappingSummary | null;
  /** Must satisfy isRoutingConfigComplete — the poller guarantees this. */
  settings: HuntressSettings;
}

const CLOSED_STATUSES: HuntressIncidentStatus[] = ['closed', 'dismissed', 'partner_dismissed'];

export function isClosedIncidentStatus(status: string): boolean {
  return (CLOSED_STATUSES as string[]).includes(status);
}

function lastProcessedUpdatedAt(alert: ExistingAlertSummary): string | undefined {
  const metadata = alert.metadata;
  if (metadata && typeof metadata === 'object') {
    const value = (metadata as Record<string, unknown>).lastProcessedUpdatedAt;
    if (typeof value === 'string') return value;
  }
  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata);
      if (parsed && typeof parsed.lastProcessedUpdatedAt === 'string') {
        return parsed.lastProcessedUpdatedAt;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

function hasIncidentChanged(
  alert: ExistingAlertSummary,
  incident: HuntressIncidentReport
): boolean {
  if (alert.status !== incident.status) return true;
  const last = lastProcessedUpdatedAt(alert);
  if (!last) return true;
  return Date.parse(incident.updated_at) > Date.parse(last);
}

export function planIncidentAction(input: PlanIncidentInput): IncidentAction {
  const { incident, existingAlert, mapping, settings } = input;

  if (incident.status === 'deleting') {
    return { kind: 'skip', reason: 'deleting' };
  }

  if (existingAlert) {
    if (!hasIncidentChanged(existingAlert, incident)) {
      return { kind: 'skip', reason: 'unchanged' };
    }
    if (!existingAlert.ticket_id) {
      return { kind: 'record_only', reason: 'no_linked_ticket' };
    }
    const close =
      isClosedIncidentStatus(incident.status) &&
      settings.autoCloseTickets &&
      Boolean(settings.closedStatusId);
    return { kind: 'append_note', close, previousStatus: existingAlert.status };
  }

  // New incident. An explicit opt-out on the mapping row wins (mapped or not).
  if (mapping && mapping.auto_create_tickets === false) {
    return { kind: 'record_only', reason: 'org_opted_out' };
  }

  if (isClosedIncidentStatus(incident.status)) {
    return { kind: 'record_only', reason: 'already_closed' };
  }

  if (mapping?.client_id) {
    return {
      kind: 'create_ticket',
      clientId: mapping.client_id,
      // boardId/fallback fields are guaranteed by isRoutingConfigComplete.
      boardId: settings.boardId as string,
      unmapped: false,
    };
  }

  return {
    kind: 'create_ticket',
    clientId: settings.fallbackClientId as string,
    boardId: settings.fallbackBoardId as string,
    unmapped: true,
  };
}
