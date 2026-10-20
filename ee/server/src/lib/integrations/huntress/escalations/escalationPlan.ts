/**
 * Pure lifecycle decisions for Huntress escalations.
 *
 * An escalation can cover several organizations; each one gets its own
 * ticket (routed by that org's mapping) and its own rmm_alerts row, keyed by
 * escalationTargetKey. Escalation and incident ids are separate sequences,
 * so the key is prefixed to stay clear of incident rows' bare numeric ids in
 * the (tenant, integration_id, external_alert_id) unique index.
 */

import type {
  HuntressEscalation,
  HuntressEscalationOrganization,
} from '../../../../interfaces/huntress.interfaces';
import type { HuntressSettings } from '../settings';
import {
  hasAlertChanged,
  type ExistingAlertSummary,
  type IncidentAction,
  type MappingSummary,
} from '../incidents/incidentPlan';

export type EscalationAction = IncidentAction;

export interface EscalationTarget {
  /** null when Huntress lists no organization — routes to the fallback client. */
  organization: HuntressEscalationOrganization | null;
  externalAlertId: string;
}

export function escalationTargetPrefix(escalationId: number): string {
  return `escalation:${escalationId}:org:`;
}

export function escalationTargetKey(escalationId: number, organizationId: number | null): string {
  return `${escalationTargetPrefix(escalationId)}${organizationId ?? 'none'}`;
}

/** Inverse of escalationTargetKey's org part; null for "none" or a malformed key. */
export function parseEscalationTargetOrg(key: string): HuntressEscalationOrganization | null {
  const match = /:org:(\d+)$/.exec(key);
  return match ? { id: Number(match[1]) } : null;
}

/** One target per distinct organization id; a single org-less target if none. */
export function escalationTargets(escalation: HuntressEscalation): EscalationTarget[] {
  const orgs = Array.isArray(escalation.organizations) ? escalation.organizations : [];
  const seen = new Set<number>();
  const targets: EscalationTarget[] = [];
  for (const org of orgs) {
    const id = Number(org?.id);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    targets.push({ organization: { ...org, id }, externalAlertId: escalationTargetKey(escalation.id, id) });
  }
  if (targets.length === 0) {
    targets.push({ organization: null, externalAlertId: escalationTargetKey(escalation.id, null) });
  }
  return targets;
}

export function isClosedEscalationStatus(status: string): boolean {
  return status === 'resolved';
}

export interface PlanEscalationInput {
  escalation: HuntressEscalation;
  existingAlert: ExistingAlertSummary | null;
  mapping: MappingSummary | null;
  /** Must satisfy isRoutingConfigComplete — the poller guarantees this. */
  settings: HuntressSettings;
}

export function planEscalationAction(input: PlanEscalationInput): EscalationAction {
  const { escalation, existingAlert, mapping, settings } = input;

  if (existingAlert) {
    if (!hasAlertChanged(existingAlert, escalation)) {
      return { kind: 'skip', reason: 'unchanged' };
    }
    if (!existingAlert.ticket_id) {
      return { kind: 'record_only', reason: 'no_linked_ticket' };
    }
    const close =
      isClosedEscalationStatus(escalation.status) &&
      settings.autoCloseTickets &&
      Boolean(settings.closedStatusId);
    return { kind: 'append_note', close, previousStatus: existingAlert.status };
  }

  if (mapping && mapping.auto_create_tickets === false) {
    return { kind: 'record_only', reason: 'org_opted_out' };
  }

  if (isClosedEscalationStatus(escalation.status)) {
    return { kind: 'record_only', reason: 'already_closed' };
  }

  if (mapping?.client_id) {
    return {
      kind: 'create_ticket',
      clientId: mapping.client_id,
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
