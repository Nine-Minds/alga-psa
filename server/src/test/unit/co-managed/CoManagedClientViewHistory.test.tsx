// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { HEADER_CASES, relationship, view } from './fixtures';

const history = vi.hoisted(() => vi.fn());

vi.mock('@/lib/actions/coManagedWorkspaceActions', () => ({ getCoManagedRelationshipHistory: history }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o?: any) => (o?.defaultValue ?? _k).replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => String(o?.[k])) }),
  useFormatters: () => ({ formatDate: (d: Date) => d.toISOString().slice(0, 10) }),
}));
vi.mock('@/components/co-managed/CoManagedClientSetup', () => ({ default: () => <div>setup</div> }));
vi.mock('@/components/co-managed/CoManagedClientRecovery', () => ({ default: () => <div>recovery</div> }));

import CoManagedClientView from '@/components/co-managed/CoManagedClientView';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const RELATIONSHIP_ID = '22222222-2222-4222-8222-222222222222';
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const entry = (eventType: string, revision: number, party: 'you' | 'other', partyName: string | null, day: number) => ({
  eventType, revision, party, partyName, occurredAt: `2026-10-0${day}T10:00:00.000Z`,
});

beforeEach(() => history.mockReset());
afterEach(cleanup);

describe('sponsor-side relationship history', () => {
  it('ended relationship: events newest first, read for the client and selected relationship, no UUID text', async () => {
    history.mockResolvedValue({ entries: [
      entry('terminated', 4, 'other', 'Acme Workspace', 4),
      entry('accepted', 3, 'other', 'Acme Workspace', 3),
      entry('prepared', 2, 'you', null, 2),
      entry('requested', 1, 'you', null, 1),
    ] });
    const ended = HEADER_CASES.ended;
    const selected = { ...ended.relationships[0], relationshipId: RELATIONSHIP_ID };
    const { container } = render(<CoManagedClientView view={{ ...ended, selectedRelationshipId: RELATIONSHIP_ID, relationships: [selected] }}
      clientId={CLIENT_ID} clientName="Acme" idPrefix="t" />);
    await waitFor(() => expect(screen.getByText('Prepared')).toBeInTheDocument());
    expect(history).toHaveBeenCalledWith({ clientId: CLIENT_ID, relationshipId: RELATIONSHIP_ID });
    const text = container.textContent ?? '';
    const order = ['Terminated', 'Accepted', 'Prepared', 'Requested'].map((label) => text.toLowerCase().indexOf(label.toLowerCase()));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(screen.getAllByText('You').length).toBe(2);
    expect(screen.getAllByText('Acme Workspace').length).toBeGreaterThan(0);
    expect(text).not.toMatch(UUID);
  });

  it('live relationship also mounts the history', async () => {
    history.mockResolvedValue({ entries: [] });
    const active = HEADER_CASES.active;
    render(<CoManagedClientView view={active} clientId="client-1" clientName="Acme" idPrefix="t" />);
    await waitFor(() => expect(screen.getByText('No relationship events yet.')).toBeInTheDocument());
    expect(history).toHaveBeenCalledWith({ clientId: 'client-1', relationshipId: 'rel-1' });
  });

  it('no selected relationship: no history read', () => {
    render(<CoManagedClientView view={HEADER_CASES.noRelationshipAuthorized} clientId="client-1" clientName="Acme" idPrefix="t" />);
    expect(history).not.toHaveBeenCalled();
  });

  it('an unlabelled event type is humanized, not shown raw', async () => {
    history.mockResolvedValue({ entries: [entry('some_new_event', 5, 'you', null, 5)] });
    render(<CoManagedClientView view={HEADER_CASES.active} clientId="client-1" clientName="Acme" idPrefix="t" />);
    await waitFor(() => expect(screen.getByText('Some new event')).toBeInTheDocument());
  });

  describe('relationship chooser', () => {
    beforeEach(() => history.mockResolvedValue({ entries: [] }));
    const chooser = (v: any, prefix: string) =>
      render(<CoManagedClientView view={v} clientId="client-1" clientName="Acme" idPrefix={prefix} />).container.querySelector(`#${prefix}-relationship`);
    const ended = (id: string, endedAt: string) =>
      relationship({ relationshipId: id, state: 'terminated', ended: true, retained: true, endedAt, usedSeats: null });

    it('cancelled-only with selectionRequired (what managementPolicy produces): no chooser', () => {
      expect(chooser({ ...HEADER_CASES.cancelledOnly, selectionRequired: true }, 'a')).toBeNull();
    });

    it('two retained/ended relationships, none live, one selected: chooser present', () => {
      const v = view({
        selectionRequired: false, canSetUp: false, selectedRelationshipId: 'rel-2',
        relationships: [ended('rel-2', '2026-10-01T00:00:00.000Z'), ended('rel-1', '2026-01-01T00:00:00.000Z')],
      });
      expect(chooser(v, 'b')).not.toBeNull();
    });

    it('several live with selectionRequired: chooser present', () => {
      expect(chooser(HEADER_CASES.severalLive, 'c')).not.toBeNull();
    });
  });
});
