/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

process.env.TZ = 'UTC';

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DateFormatProvider } from '@alga-psa/ui/lib/dateFormat/useDateFormat';
import type { ClientTimelineEvent } from '../../../lib/commandCenterTypes';
import ClientTimelinePanel from './ClientTimelinePanel';

const listClientTimelineMock = vi.fn();

vi.mock('../../../actions/clientTimelineActions', () => ({
  listClientTimeline: (...args: unknown[]) => listClientTimelineMock(...args),
}));

// Events older than 30 days fall back to an absolute date, which is the part
// that used to follow the browser locale instead of the tenant's country.
const OLD_EVENT: ClientTimelineEvent = {
  id: 'ticket:1',
  type: 'ticket_opened',
  occurredAt: '2026-08-13T09:00:00.000Z',
  refType: 'ticket',
  refId: 'ticket-1',
  refLabel: 'TIC001035',
  summary: 'Munchkin keyboard replacement',
};

const t = (_key: string, options?: Record<string, unknown>) =>
  String(options?.defaultValue ?? _key);

function renderPanel(countryCode?: string) {
  return render(
    <DateFormatProvider countryCode={countryCode}>
      <ClientTimelinePanel
        idPrefix="client"
        clientId="client-1"
        formatMoney={(cents) => `$${cents / 100}`}
        onEventClick={vi.fn()}
        t={t}
      />
    </DateFormatProvider>
  );
}

describe('ClientTimelinePanel absolute dates', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-09-14T12:00:00.000Z'));
    listClientTimelineMock.mockResolvedValue({ events: [OLD_EVENT], nextCursor: null });
  });

  it("writes an old event in the tenant country's order", async () => {
    renderPanel('AU');
    await waitFor(() => expect(screen.getByText('13/08/2026')).toBeInTheDocument());
  });

  it('writes the same event US-style when the country is unset', async () => {
    renderPanel('XX');
    await waitFor(() => expect(screen.getByText('08/13/2026')).toBeInTheDocument());
  });
});
