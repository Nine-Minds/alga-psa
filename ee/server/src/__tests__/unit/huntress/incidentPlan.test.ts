import { describe, expect, it } from 'vitest';
import {
  planIncidentAction,
  isClosedIncidentStatus,
} from '@ee/lib/integrations/huntress/incidents/incidentPlan';
import { parseHuntressSettings } from '@ee/lib/integrations/huntress/settings';
import type { HuntressIncidentReport } from '@ee/interfaces/huntress.interfaces';

const settings = parseHuntressSettings({
  boardId: 'board-sec',
  fallbackClientId: 'client-fallback',
  fallbackBoardId: 'board-triage',
  severityPriorityMap: { critical: 'p-crit', high: 'p-high', low: 'p-low' },
  autoCloseTickets: false,
  closedStatusId: 'status-closed',
});

function incident(overrides: Partial<HuntressIncidentReport> = {}): HuntressIncidentReport {
  return {
    id: 1,
    account_id: 1,
    agent_id: null,
    organization_id: 10,
    subject: 's',
    summary: null,
    body: null,
    severity: 'high',
    status: 'sent',
    platform: null,
    indicator_types: [],
    indicator_counts: {},
    sent_at: '2026-06-09T10:00:00Z',
    closed_at: null,
    status_updated_at: null,
    updated_at: '2026-06-09T10:00:00Z',
    ...overrides,
  };
}

const mappedOrg = { client_id: 'client-1', auto_create_tickets: true };
const unmappedOrg = { client_id: null, auto_create_tickets: true };

describe('isClosedIncidentStatus', () => {
  it('treats closed, dismissed, partner_dismissed as closed', () => {
    expect(isClosedIncidentStatus('closed')).toBe(true);
    expect(isClosedIncidentStatus('dismissed')).toBe(true);
    expect(isClosedIncidentStatus('partner_dismissed')).toBe(true);
    expect(isClosedIncidentStatus('sent')).toBe(false);
    expect(isClosedIncidentStatus('auto_remediating')).toBe(false);
  });
});

describe('planIncidentAction — new incidents', () => {
  it('creates a ticket for an open incident in a mapped org', () => {
    const action = planIncidentAction({
      incident: incident(),
      existingAlert: null,
      mapping: mappedOrg,
      settings,
    });
    expect(action).toEqual({
      kind: 'create_ticket',
      clientId: 'client-1',
      boardId: 'board-sec',
      unmapped: false,
    });
  });

  it('routes an unmapped org to the fallback client and triage board', () => {
    const action = planIncidentAction({
      incident: incident(),
      existingAlert: null,
      mapping: unmappedOrg,
      settings,
    });
    expect(action).toEqual({
      kind: 'create_ticket',
      clientId: 'client-fallback',
      boardId: 'board-triage',
      unmapped: true,
    });
  });

  it('routes a missing mapping row to fallback as well', () => {
    const action = planIncidentAction({
      incident: incident(),
      existingAlert: null,
      mapping: null,
      settings,
    });
    expect(action).toMatchObject({ kind: 'create_ticket', unmapped: true });
  });

  it('records only when the mapping row explicitly opted out (mapped or not)', () => {
    const optedOutMapped = { client_id: 'client-1', auto_create_tickets: false };
    const optedOutUnmapped = { client_id: null, auto_create_tickets: false };
    expect(
      planIncidentAction({ incident: incident(), existingAlert: null, mapping: optedOutMapped, settings })
    ).toEqual({ kind: 'record_only', reason: 'org_opted_out' });
    expect(
      planIncidentAction({ incident: incident(), existingAlert: null, mapping: optedOutUnmapped, settings })
    ).toEqual({ kind: 'record_only', reason: 'org_opted_out' });
  });

  it('records already-closed incidents without a ticket (backfill case)', () => {
    const action = planIncidentAction({
      incident: incident({ status: 'closed' }),
      existingAlert: null,
      mapping: mappedOrg,
      settings,
    });
    expect(action).toEqual({ kind: 'record_only', reason: 'already_closed' });
  });

  it('treats auto_remediating as open', () => {
    const action = planIncidentAction({
      incident: incident({ status: 'auto_remediating' }),
      existingAlert: null,
      mapping: mappedOrg,
      settings,
    });
    expect(action).toMatchObject({ kind: 'create_ticket' });
  });

  it('skips deleting incidents entirely', () => {
    const action = planIncidentAction({
      incident: incident({ status: 'deleting' }),
      existingAlert: null,
      mapping: mappedOrg,
      settings,
    });
    expect(action).toEqual({ kind: 'skip', reason: 'deleting' });
  });
});

describe('planIncidentAction — existing alerts', () => {
  const alertWithTicket = {
    ticket_id: 'ticket-1',
    status: 'sent',
    metadata: { lastProcessedUpdatedAt: '2026-06-09T10:00:00Z' },
  };

  it('skips when nothing changed since last processing', () => {
    const action = planIncidentAction({
      incident: incident(),
      existingAlert: alertWithTicket,
      mapping: mappedOrg,
      settings,
    });
    expect(action).toEqual({ kind: 'skip', reason: 'unchanged' });
  });

  it('appends a note when updated_at moved forward', () => {
    const action = planIncidentAction({
      incident: incident({ updated_at: '2026-06-09T11:00:00Z' }),
      existingAlert: alertWithTicket,
      mapping: mappedOrg,
      settings,
    });
    expect(action).toEqual({ kind: 'append_note', close: false, previousStatus: 'sent' });
  });

  it('appends a note when status changed even if updated_at did not move', () => {
    const action = planIncidentAction({
      incident: incident({ status: 'closed' }),
      existingAlert: alertWithTicket,
      mapping: mappedOrg,
      settings,
    });
    expect(action).toMatchObject({ kind: 'append_note', previousStatus: 'sent' });
  });

  it('closes the ticket only when autoCloseTickets is on and a closed status is configured', () => {
    const closing = incident({ status: 'closed', updated_at: '2026-06-09T11:00:00Z' });
    const off = planIncidentAction({
      incident: closing,
      existingAlert: alertWithTicket,
      mapping: mappedOrg,
      settings,
    });
    expect(off).toMatchObject({ kind: 'append_note', close: false });

    const on = planIncidentAction({
      incident: closing,
      existingAlert: alertWithTicket,
      mapping: mappedOrg,
      settings: { ...settings, autoCloseTickets: true },
    });
    expect(on).toMatchObject({ kind: 'append_note', close: true });

    const noStatus = planIncidentAction({
      incident: closing,
      existingAlert: alertWithTicket,
      mapping: mappedOrg,
      settings: { ...settings, autoCloseTickets: true, closedStatusId: null },
    });
    expect(noStatus).toMatchObject({ kind: 'append_note', close: false });
  });

  it('updates the record only for alert rows without a ticket (no retroactive tickets)', () => {
    const action = planIncidentAction({
      incident: incident({ updated_at: '2026-06-09T11:00:00Z' }),
      existingAlert: { ticket_id: null, status: 'sent', metadata: {} },
      mapping: mappedOrg,
      settings,
    });
    expect(action).toEqual({ kind: 'record_only', reason: 'no_linked_ticket' });
  });
});
