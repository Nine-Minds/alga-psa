import { describe, expect, it } from 'vitest';
import {
  escalationTargetKey,
  escalationTargets,
  parseEscalationTargetOrg,
  planEscalationAction,
} from '@ee/lib/integrations/huntress/escalations/escalationPlan';
import { parseHuntressSettings } from '@ee/lib/integrations/huntress/settings';
import type { HuntressEscalation } from '@ee/interfaces/huntress.interfaces';

const settings = parseHuntressSettings({
  boardId: 'board-sec',
  fallbackClientId: 'client-fallback',
  fallbackBoardId: 'board-triage',
  severityPriorityMap: { critical: 'p-crit', high: 'p-high', low: 'p-low' },
  autoCloseTickets: true,
  closedStatusId: 'status-closed',
  ingestEscalations: true,
});

function escalation(overrides: Partial<HuntressEscalation> = {}): HuntressEscalation {
  return {
    id: 84938,
    organizations: [{ id: 10, name: 'Acme' }],
    severity: 'high',
    status: 'open',
    subject: 'Unexpected login from RU',
    type: 'Unwanted Access',
    type_code: 'unexpected_country_access',
    subtype: 'RU',
    psa_ticket_eids: [],
    created_at: '2026-06-09T10:00:00Z',
    resolved_at: null,
    updated_at: '2026-06-09T10:00:00Z',
    ...overrides,
  };
}

describe('escalationTargets', () => {
  it('creates one target per organization, keyed apart from incident ids', () => {
    const targets = escalationTargets(
      escalation({ organizations: [{ id: 10, name: 'Acme' }, { id: 11, name: 'Globex' }] })
    );
    expect(targets.map((t) => t.externalAlertId)).toEqual([
      'escalation:84938:org:10',
      'escalation:84938:org:11',
    ]);
    expect(targets.map((t) => t.organization?.name)).toEqual(['Acme', 'Globex']);
  });

  it('dedups repeated org ids', () => {
    const targets = escalationTargets(escalation({ organizations: [{ id: 10 }, { id: 10 }] }));
    expect(targets).toHaveLength(1);
  });

  it('falls back to a single org-less target when none are listed', () => {
    for (const organizations of [[], undefined as any, null as any]) {
      const targets = escalationTargets(escalation({ organizations }));
      expect(targets).toEqual([{ organization: null, externalAlertId: 'escalation:84938:org:none' }]);
    }
  });

  it('round-trips the org id out of a target key', () => {
    expect(parseEscalationTargetOrg(escalationTargetKey(5, 42))).toEqual({ id: 42 });
    expect(parseEscalationTargetOrg(escalationTargetKey(5, null))).toBeNull();
  });

  it('never produces a key that collides with a bare incident id', () => {
    expect(escalationTargetKey(1234, 5)).not.toBe('1234');
  });
});

describe('planEscalationAction — new escalations', () => {
  it('routes a mapped org to its client on the security board', () => {
    expect(
      planEscalationAction({
        escalation: escalation(),
        existingAlert: null,
        mapping: { client_id: 'client-1', auto_create_tickets: true },
        settings,
      })
    ).toEqual({ kind: 'create_ticket', clientId: 'client-1', boardId: 'board-sec', unmapped: false });
  });

  it('routes an unmapped (or org-less) escalation to the fallback client and board', () => {
    for (const mapping of [{ client_id: null, auto_create_tickets: true }, null]) {
      expect(
        planEscalationAction({ escalation: escalation(), existingAlert: null, mapping, settings })
      ).toEqual({
        kind: 'create_ticket',
        clientId: 'client-fallback',
        boardId: 'board-triage',
        unmapped: true,
      });
    }
  });

  it('records but does not ticket an org that opted out', () => {
    expect(
      planEscalationAction({
        escalation: escalation(),
        existingAlert: null,
        mapping: { client_id: 'client-1', auto_create_tickets: false },
        settings,
      })
    ).toEqual({ kind: 'record_only', reason: 'org_opted_out' });
  });

  it('records an escalation first seen already resolved', () => {
    expect(
      planEscalationAction({
        escalation: escalation({ status: 'resolved' }),
        existingAlert: null,
        mapping: { client_id: 'client-1', auto_create_tickets: true },
        settings,
      })
    ).toEqual({ kind: 'record_only', reason: 'already_closed' });
  });

  it('creates a ticket for an escalation first seen overdue', () => {
    expect(
      planEscalationAction({
        escalation: escalation({ status: 'overdue' }),
        existingAlert: null,
        mapping: { client_id: 'client-1', auto_create_tickets: true },
        settings,
      }).kind
    ).toBe('create_ticket');
  });
});

describe('planEscalationAction — known escalations', () => {
  const processed = (status: string, updatedAt: string) => ({
    ticket_id: 't-1',
    status,
    metadata: { lastProcessedUpdatedAt: updatedAt },
  });

  it('skips when nothing changed', () => {
    expect(
      planEscalationAction({
        escalation: escalation(),
        existingAlert: processed('open', '2026-06-09T10:00:00Z'),
        mapping: null,
        settings,
      })
    ).toEqual({ kind: 'skip', reason: 'unchanged' });
  });

  it('appends a note without closing on open → overdue', () => {
    expect(
      planEscalationAction({
        escalation: escalation({ status: 'overdue', updated_at: '2026-06-10T10:00:00Z' }),
        existingAlert: processed('open', '2026-06-09T10:00:00Z'),
        mapping: null,
        settings,
      })
    ).toEqual({ kind: 'append_note', close: false, previousStatus: 'open' });
  });

  it('closes the ticket on resolved when auto-close is configured', () => {
    expect(
      planEscalationAction({
        escalation: escalation({ status: 'resolved', updated_at: '2026-06-10T10:00:00Z' }),
        existingAlert: processed('overdue', '2026-06-09T10:00:00Z'),
        mapping: null,
        settings,
      })
    ).toEqual({ kind: 'append_note', close: true, previousStatus: 'overdue' });
  });

  it('does not close when auto-close is off', () => {
    const noClose = parseHuntressSettings({ ...settings, autoCloseTickets: false });
    expect(
      planEscalationAction({
        escalation: escalation({ status: 'resolved', updated_at: '2026-06-10T10:00:00Z' }),
        existingAlert: processed('open', '2026-06-09T10:00:00Z'),
        mapping: null,
        settings: noClose,
      })
    ).toEqual({ kind: 'append_note', close: false, previousStatus: 'open' });
  });

  it('records only when the earlier row never got a ticket', () => {
    expect(
      planEscalationAction({
        escalation: escalation({ status: 'overdue', updated_at: '2026-06-10T10:00:00Z' }),
        existingAlert: { ticket_id: null, status: 'open', metadata: {} },
        mapping: null,
        settings,
      })
    ).toEqual({ kind: 'record_only', reason: 'no_linked_ticket' });
  });
});
