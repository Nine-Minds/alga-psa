/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CallLinkProvider } from '@alga-psa/ui/components/CallLink';
import { CallsEmailsTile } from './dataTiles';

const interactions = [
  {
    interactionId: 'interaction-1',
    title: 'Discussed the outage',
    typeName: 'Call',
    interactionDate: '2026-08-26T14:00:00.000Z',
    durationMinutes: 10,
    actorDisplayName: 'Agent Smith',
  },
];

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({ locale: 'en-US' }),
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('../../../actions/ticketBentoActions', () => ({
  getTicketInteractions: vi.fn(async () => interactions),
  getTicketScheduleEntries: vi.fn(async () => []),
  getTicketBillingRollup: vi.fn(async () => null),
  getTicketAppointmentRequests: vi.fn(async () => []),
}));

describe('CallsEmailsTile ticket actions', () => {
  it('shows Call only for connected Teams Phone and opens an interaction row', async () => {
    const onInteractionClick = vi.fn();
    const { rerender } = render(
      <CallLinkProvider teamsCallEnabled teamsPhoneConnected={false}>
        <CallsEmailsTile
          id="calls-emails"
          ticketId="ticket-1"
          callPhoneNumber="+15551234567"
          onInteractionClick={onInteractionClick}
        />
      </CallLinkProvider>,
    );

    await screen.findByText('Discussed the outage');
    expect(screen.queryByText('Call')).toBeNull();

    rerender(
      <CallLinkProvider teamsCallEnabled teamsPhoneConnected>
        <CallsEmailsTile
          id="calls-emails"
          ticketId="ticket-1"
          callPhoneNumber="+15551234567"
          onInteractionClick={onInteractionClick}
        />
      </CallLinkProvider>,
    );

    const call = await screen.findByText('Call');
    expect(call.closest('a')).toHaveAttribute('href', expect.stringContaining('teams.microsoft.com/l/call'));

    const interactionButton = document.getElementById('calls-emails-row-interaction-1-open');
    expect(interactionButton).not.toBeNull();
    if (interactionButton) fireEvent.click(interactionButton);
    await waitFor(() => expect(onInteractionClick).toHaveBeenCalledWith('interaction-1'));
  });
});
