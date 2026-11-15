// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const history = vi.hoisted(() => vi.fn());

vi.mock('@/lib/actions/coManagedWorkspaceActions', () => ({ getCoManagedRelationshipHistory: history }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o?: any) => o?.defaultValue ?? _k }),
  useFormatters: () => ({ formatDate: (d: Date) => d.toISOString().slice(0, 10) }),
}));

import CoManagedRelationshipHistory from '@/components/co-managed/CoManagedRelationshipHistory';

// Newest first; the three oldest are the ones a 10-row page would drop.
const TYPES = [
  ...Array.from({ length: 12 }, (_v, i) => `seat_change_${12 - i}`),
  'accepted', 'prepared', 'requested',
];
const entries = TYPES.map((eventType, i) => ({
  eventType, revision: TYPES.length - i, party: 'you' as const, partyName: null,
  occurredAt: new Date(Date.UTC(2026, 9, 28 - i, 10)).toISOString(),
}));

beforeEach(() => history.mockReset());
afterEach(cleanup);

describe('CoManagedRelationshipHistory', () => {
  it('renders every returned event, down to Requested', async () => {
    history.mockResolvedValue({ entries });
    const { container } = render(<CoManagedRelationshipHistory idPrefix="t" clientId="c1" relationshipId="r1" />);
    await waitFor(() => expect(screen.getByText('Requested')).toBeInTheDocument());
    expect(entries.length).toBeGreaterThan(10);
    expect(container.querySelectorAll('tbody tr').length).toBe(entries.length);
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(screen.getByText('Prepared')).toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text.indexOf('Accepted')).toBeLessThan(text.indexOf('Prepared'));
    expect(text.indexOf('Prepared')).toBeLessThan(text.indexOf('Requested'));
  });
});
