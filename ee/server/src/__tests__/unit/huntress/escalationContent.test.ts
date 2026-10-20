import { describe, expect, it } from 'vitest';
import {
  agentsFromEntities,
  buildEscalationCreationNote,
  buildEscalationPortalUrl,
  buildEscalationTicketBody,
  buildEscalationTicketTitle,
  buildEscalationUpdateNote,
} from '@ee/lib/integrations/huntress/escalations/escalationContent';
import type { HuntressEscalation } from '@ee/interfaces/huntress.interfaces';

function escalation(overrides: Partial<HuntressEscalation> = {}): HuntressEscalation {
  return {
    id: 84938,
    organizations: [{ id: 10, name: 'Acme' }],
    severity: 'critical',
    status: 'open',
    subject: 'Defender Disabled',
    type: 'Environmental Issue',
    type_code: 'defender_disabled',
    subtype: null,
    created_at: '2026-06-09T10:00:00Z',
    resolved_at: null,
    updated_at: '2026-06-09T10:00:00Z',
    ...overrides,
  };
}

describe('escalation ticket content', () => {
  it('builds the account escalation portal URL', () => {
    expect(buildEscalationPortalUrl('managednerds', 84938)).toBe(
      'https://managednerds.huntress.io/account/escalations/84938'
    );
  });

  it('prefixes titles and flags unmapped orgs', () => {
    expect(buildEscalationTicketTitle(escalation(), { unmapped: false })).toBe(
      '[Huntress Escalation] Defender Disabled'
    );
    expect(buildEscalationTicketTitle(escalation({ subject: null }), { unmapped: true })).toBe(
      '[Huntress Escalation] [Unmapped Org] Environmental Issue'
    );
  });

  it('extracts Agent entities as agents', () => {
    const agents = agentsFromEntities(
      escalation({
        entities: {
          total_count: 2,
          has_more: false,
          items: [
            { id: 1, type: 'Agent', details: { hostname: 'laptop01', os: 'Windows 11' } },
            { id: 2, type: 'Identity', details: { email: 'a@acme.test' } },
          ],
        },
      })
    );
    expect(agents).toEqual([
      { id: 1, hostname: 'laptop01', os: 'Windows 11', platform: null, last_callback_at: null },
    ]);
  });

  describe('multi-org escalations', () => {
    const multi = escalation({
      organizations: [{ id: 10, name: 'Acme' }, { id: 11, name: 'Globex' }],
      entities: {
        total_count: 1,
        has_more: false,
        items: [{ id: 1, type: 'Agent', details: { hostname: 'acme-laptop' } }],
      },
    });

    it("keeps other orgs' names and entities out of the (client-visible) body", () => {
      const body = buildEscalationTicketBody(multi, 'https://x', {
        unmapped: false,
        organization: { id: 11, name: 'Globex' },
        agent: null,
      });
      expect(body).toContain('**Huntress Organization:** Globex');
      expect(body).toContain('also involves other organizations');
      expect(body).not.toContain('Acme');
      expect(body).not.toContain('acme-laptop');
      expect(body).toContain('[View in Huntress portal](https://x)');
    });

    it('lists every org and entity in the internal creation note', () => {
      const note = buildEscalationCreationNote(multi);
      expect(note).toContain('covers 2 organizations');
      expect(note).toContain('- Acme');
      expect(note).toContain('- Globex');
      expect(note).toContain('acme-laptop');
    });

    it('single-org creation notes stay short', () => {
      expect(buildEscalationCreationNote(escalation())).not.toContain('organizations');
    });
  });

  it('survives malformed entity/organization payloads', () => {
    expect(() =>
      buildEscalationTicketBody(
        escalation({ organizations: {} as any, entities: { items: 'bad' } as any }),
        'https://x',
        { unmapped: true, organization: null, agent: null }
      )
    ).not.toThrow();
  });

  it('calls out a newly overdue escalation once', () => {
    expect(buildEscalationUpdateNote('open', escalation({ status: 'overdue' }))).toContain(
      'overdue'
    );
    expect(
      buildEscalationUpdateNote('overdue', escalation({ status: 'overdue' }))
    ).not.toContain('past its expected response time');
  });
});
