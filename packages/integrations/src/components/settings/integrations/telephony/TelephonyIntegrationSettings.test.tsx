// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TelephonyCallSummary, TelephonyOverview } from '../../../../actions/integrations/telephonyActions';

const mocks = vi.hoisted(() => ({
  getOverview: vi.fn(),
  setProviderEnabled: vi.fn(async () => ({ success: true })),
  setAutoTicketPolicy: vi.fn(async () => ({ success: true })),
  resolveCall: vi.fn(async () => ({ success: true })),
  listTargets: vi.fn(async () => ({ success: true, targets: [] as any[] })),
  listLinkableTickets: vi.fn(async () => ({ success: true, tickets: [] as any[] })),
  linkToTicket: vi.fn(async () => ({ success: true })),
  createTicket: vi.fn(async () => ({ success: true })),
}));

vi.mock('../../../../actions/integrations/telephonyActions', () => ({
  getTelephonyOverview: mocks.getOverview,
  setTelephonyProviderEnabled: mocks.setProviderEnabled,
  setTelephonyAutoTicketPolicy: mocks.setAutoTicketPolicy,
  resolveTelephonyCall: mocks.resolveCall,
  listTelephonyResolutionTargets: mocks.listTargets,
  listTelephonyLinkableTickets: mocks.listLinkableTickets,
  linkTelephonyCallToTicket: mocks.linkToTicket,
  createTicketFromTelephonyCall: mocks.createTicket,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
  return { useTranslation: () => ({ t }), useFormatters: () => ({ locale: 'en' }) };
});

import { TelephonyIntegrationSettings } from './TelephonyIntegrationSettings';

function call(overrides: Partial<TelephonyCallSummary> = {}): TelephonyCallSummary {
  return {
    callRecordId: 'call-1',
    provider: 'teams-phone',
    direction: 'inbound',
    counterpartyNumber: '+15551234567',
    counterpartyLabel: null,
    startedAt: '2026-08-22T15:00:00.000Z',
    durationSeconds: 210,
    matchStatus: 'matched',
    matchedContactId: 'contact-1',
    matchedContactName: 'Dorothy Gale',
    matchedClientId: 'client-1',
    matchedClientName: 'Emerald City',
    interactionId: 'interaction-1',
    ticketId: null,
    candidates: [],
    ...overrides,
  };
}

function overview(overrides: Partial<TelephonyOverview> = {}): TelephonyOverview {
  return {
    success: true,
    available: true,
    canManage: true,
    providers: [
      {
        provider: 'teams-phone',
        status: 'active',
        autoCreateTickets: false,
        subscriptionId: 'sub-1',
        subscriptionExpiresAt: '2026-08-25T00:00:00.000Z',
        lastError: null,
        lastNotificationAt: null,
        prerequisiteMet: true,
      },
    ],
    recentCalls: [call()],
    unresolvedCalls: [],
    ...overrides,
  };
}

describe('TelephonyIntegrationSettings', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.listTargets.mockResolvedValue({ success: true, targets: [] });
    mocks.resolveCall.mockResolvedValue({ success: true });
  });

  it('T007: renders the Teams Phone provider card with its current status', async () => {
    mocks.getOverview.mockResolvedValue(overview());

    render(<TelephonyIntegrationSettings />);

    expect(await screen.findByText('Teams Phone')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disable' })).toBeTruthy();
  });

  it('T007: an unconfigured provider explains the Teams prerequisite', async () => {
    mocks.getOverview.mockResolvedValue(overview({
      providers: [{
        provider: 'teams-phone',
        status: 'not_configured',
        autoCreateTickets: false,
        subscriptionId: null,
        subscriptionExpiresAt: null,
        lastError: null,
        lastNotificationAt: null,
        prerequisiteMet: false,
      }],
    }));

    render(<TelephonyIntegrationSettings />);

    expect(await screen.findByText('Not configured')).toBeTruthy();
    expect(screen.getByText(/Configure the Microsoft Teams integration first/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enable' }).hasAttribute('disabled')).toBe(true);
  });

  it('T007: the card reports when Graph last delivered a call notification', async () => {
    mocks.getOverview.mockResolvedValue(overview({
      providers: [{
        provider: 'teams-phone',
        status: 'active',
        autoCreateTickets: false,
        subscriptionId: 'sub-1',
        subscriptionExpiresAt: null,
        lastError: null,
        lastNotificationAt: '2026-08-22T15:04:00.000Z',
        prerequisiteMet: true,
      }],
    }));

    const { container } = render(<TelephonyIntegrationSettings />);

    await screen.findByText('Teams Phone');
    // A silent subscription and a quiet phone look identical without this.
    expect(container.querySelector('#telephony-provider-last-notification-teams-phone')?.textContent)
      .toContain('Last call notification');
  });

  it('T008: a tenant without the add-on gets the paywall and no provider controls', async () => {
    mocks.getOverview.mockResolvedValue({
      success: true,
      available: false,
      reason: 'addon_required',
      error: 'Microsoft Teams add-on required',
      canManage: true,
      providers: [],
      recentCalls: [],
      unresolvedCalls: [],
    });

    render(<TelephonyIntegrationSettings />);

    expect(await screen.findByText('Microsoft Teams add-on')).toBeTruthy();
    expect(screen.queryByText('Teams Phone')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull();
  });

  it('T009: the recent-calls strip lists direction, number, duration and match state', async () => {
    mocks.getOverview.mockResolvedValue(overview());

    render(<TelephonyIntegrationSettings />);

    expect(await screen.findByText('+15551234567')).toBeTruthy();
    expect(screen.getByText('3m 30s')).toBeTruthy();
    expect(screen.getByText('Dorothy Gale')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create ticket' })).toBeTruthy();
  });

  it('T009: a call already filed on a ticket offers the ticket instead of creating another', async () => {
    mocks.getOverview.mockResolvedValue(overview({
      recentCalls: [call({ ticketId: 'ticket-9' })],
    }));

    render(<TelephonyIntegrationSettings />);

    const link = await screen.findByRole('link', { name: 'Open ticket' });
    expect(link.getAttribute('href')).toBe('/msp/tickets/ticket-9');
    expect(screen.queryByRole('button', { name: 'Create ticket' })).toBeNull();
  });

  it('T010: an ambiguous call offers its candidates and no guessed attribution', async () => {
    mocks.getOverview.mockResolvedValue(overview({
      recentCalls: [],
      unresolvedCalls: [call({
        matchStatus: 'ambiguous',
        matchedContactId: null,
        matchedContactName: null,
        matchedClientId: null,
        matchedClientName: null,
        interactionId: null,
        candidates: [
          { contactId: 'contact-1', clientId: 'client-1', contactName: 'Dorothy Gale' },
          { contactId: 'contact-2', clientId: 'client-2', contactName: 'Toto' },
        ],
      })],
    }));

    render(<TelephonyIntegrationSettings />);

    const candidate = await screen.findByRole('button', { name: 'Assign to Dorothy Gale' });
    expect(screen.getByRole('button', { name: 'Assign to Toto' })).toBeTruthy();

    await userEvent.click(candidate);

    await waitFor(() => expect(mocks.resolveCall).toHaveBeenCalledWith({
      callRecordId: 'call-1',
      contactId: 'contact-1',
      clientId: 'client-1',
    }));
  });

  it('T010: an unmatched call with no candidates can still be attributed by search', async () => {
    // The ladder returns no candidates for an unmatched number by definition, so
    // without a picker this row would be a dead end.
    mocks.getOverview.mockResolvedValue(overview({
      recentCalls: [],
      unresolvedCalls: [call({
        matchStatus: 'unmatched',
        matchedContactId: null,
        matchedContactName: null,
        matchedClientId: null,
        matchedClientName: null,
        interactionId: null,
        candidates: [],
      })],
    }));
    mocks.listTargets.mockResolvedValue({
      success: true,
      targets: [
        { contactId: 'contact-7', clientId: 'client-7', label: 'Glinda', sublabel: 'Emerald City' },
        { contactId: null, clientId: 'client-8', label: 'Munchkin Co', sublabel: null },
      ],
    });

    render(<TelephonyIntegrationSettings />);

    await userEvent.click(await screen.findByRole('button', { name: 'Assign to a contact or client…' }));

    const search = await screen.findByPlaceholderText('Search contacts and clients…');
    await userEvent.type(search, 'glin');
    await waitFor(() => expect(mocks.listTargets).toHaveBeenCalledWith({ search: 'glin' }));

    await userEvent.click(screen.getByRole('button', { name: 'Assign to Glinda · Emerald City' }));

    await waitFor(() => expect(mocks.resolveCall).toHaveBeenCalledWith({
      callRecordId: 'call-1',
      contactId: 'contact-7',
      clientId: 'client-7',
    }));
  });

  it('T010: a client-only target resolves the call to the client', async () => {
    mocks.getOverview.mockResolvedValue(overview({
      recentCalls: [],
      unresolvedCalls: [call({ matchStatus: 'unmatched', interactionId: null, candidates: [] })],
    }));
    mocks.listTargets.mockResolvedValue({
      success: true,
      targets: [{ contactId: null, clientId: 'client-8', label: 'Munchkin Co', sublabel: null }],
    });

    render(<TelephonyIntegrationSettings />);

    await userEvent.click(await screen.findByRole('button', { name: 'Assign to a contact or client…' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Assign to Munchkin Co' }));

    await waitFor(() => expect(mocks.resolveCall).toHaveBeenCalledWith({
      callRecordId: 'call-1',
      contactId: null,
      clientId: 'client-8',
    }));
  });

  it('T010: an empty queue says so rather than showing an empty list', async () => {
    mocks.getOverview.mockResolvedValue(overview());

    render(<TelephonyIntegrationSettings />);

    expect(await screen.findByText('Every captured call is attributed.')).toBeTruthy();
  });

  it('T011: the interactive elements carry kebab-case reflection ids', async () => {
    mocks.getOverview.mockResolvedValue(overview({
      unresolvedCalls: [call({ matchStatus: 'unmatched', interactionId: null, candidates: [] })],
    }));

    const { container } = render(<TelephonyIntegrationSettings />);

    await screen.findByText('Teams Phone');
    const ids = [...container.querySelectorAll('[id]')].map((node) => node.id);
    expect(ids).toEqual(expect.arrayContaining([
      'telephony-integrations-setup',
      'telephony-provider-card-teams-phone',
      'telephony-recent-calls',
      'telephony-unmatched-queue',
      'telephony-unmatched-row-call-1',
    ]));
    expect(ids.every((id) => /^[a-z0-9-]+$/.test(id))).toBe(true);
  });
});
