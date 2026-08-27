// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TelephonyCallSummary, TelephonyOverview } from '../../actions/integrations/telephonyActions';

const mocks = vi.hoisted(() => ({
  getOverview: vi.fn(),
  resolveCall: vi.fn(async () => ({ success: true })),
  listTargets: vi.fn(async () => ({ success: true, targets: [] as any[] })),
  listLinkableTickets: vi.fn(async () => ({ success: true, tickets: [] as any[] })),
  linkToTicket: vi.fn(async () => ({ success: true })),
  createTicket: vi.fn(async () => ({ success: true })),
}));

vi.mock('../../actions/integrations/telephonyActions', () => ({
  getTelephonyOverview: mocks.getOverview,
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
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: ({ id, clients, onSelect, placeholder, disabled }: any) => (
    <select
      id={`${id}-trigger`}
      aria-label={placeholder}
      value=""
      disabled={disabled}
      onChange={(event) => onSelect(event.target.value || null)}
    >
      <option value="">{placeholder}</option>
      {clients.map((client: any) => (
        <option key={client.client_id} value={client.client_id}>{client.client_name}</option>
      ))}
    </select>
  ),
}));

import { TelephonyCallsPanel } from './TelephonyCallsPanel';

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

// A dispatcher's overview: telephony is live, interaction rights are held,
// config rights are not — the operational surface must not need them.
function operatorOverview(overrides: Partial<TelephonyOverview> = {}): TelephonyOverview {
  return {
    success: true,
    available: true,
    canManage: false,
    canResolve: true,
    providers: [],
    recentCalls: [call()],
    unresolvedCalls: [
      call({
        callRecordId: 'call-2',
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
      }),
    ],
    ...overrides,
  };
}

describe('TelephonyCallsPanel', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.listTargets.mockResolvedValue({ success: true, targets: [] });
    mocks.resolveCall.mockResolvedValue({ success: true });
  });

  it('the operational panel lists recent calls and the attribution queue', async () => {
    mocks.getOverview.mockResolvedValue(operatorOverview());

    render(<TelephonyCallsPanel />);

    expect(await screen.findByText('Calls')).toBeTruthy();
    expect(screen.getByText('Recent calls')).toBeTruthy();
    expect(screen.getByText('3m 30s')).toBeTruthy();
    expect(screen.getByText('Dorothy Gale')).toBeTruthy();
    expect(screen.getByText('Calls needing attribution')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Assign to Toto' })).toBeTruthy();
  });

  it('uses a server-loaded overview without fetching it a second time', () => {
    render(
      <TelephonyCallsPanel
        initialOverview={operatorOverview()}
        showHeading={false}
      />,
    );

    expect(screen.getByText('Recent calls')).toBeTruthy();
    expect(screen.queryByText('Calls')).toBeNull();
    expect(mocks.getOverview).not.toHaveBeenCalled();
  });

  it('resolving a candidate calls resolveTelephonyCall with its attribution', async () => {
    mocks.getOverview.mockResolvedValue(operatorOverview());

    render(<TelephonyCallsPanel />);

    await userEvent.click(await screen.findByRole('button', { name: 'Assign to Dorothy Gale' }));

    await waitFor(() => expect(mocks.resolveCall).toHaveBeenCalledWith({
      callRecordId: 'call-2',
      contactId: 'contact-1',
      clientId: 'client-1',
    }));
  });

  it('an unmatched call is attributed through the client picker dropdown', async () => {
    mocks.getOverview.mockResolvedValue(operatorOverview({
      unresolvedCalls: [call({
        callRecordId: 'call-3',
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
      targets: [{ contactId: null, clientId: 'client-7', label: 'Emerald City', sublabel: null }],
    });

    render(<TelephonyCallsPanel />);

    await waitFor(() => expect(mocks.listTargets).toHaveBeenCalledWith({ clientsOnly: true }));
    await screen.findByRole('option', { name: 'Emerald City' });
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Assign to client…' }),
      'client-7',
    );

    await waitFor(() => expect(mocks.resolveCall).toHaveBeenCalledWith({
      callRecordId: 'call-3',
      contactId: null,
      clientId: 'client-7',
    }));
    expect(screen.queryByRole('button', { name: 'Assign to Emerald City' })).toBeNull();
  });

  it('renders fully without system_settings: no provider controls or settings affordances', async () => {
    mocks.getOverview.mockResolvedValue(operatorOverview({ canManage: false }));

    render(<TelephonyCallsPanel />);

    expect((await screen.findAllByText('+15551234567')).length).toBeGreaterThan(0);
    // Nothing settings-only leaks into the operational surface.
    expect(screen.queryByText('Teams Phone')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disable' })).toBeNull();
    // The operator still works the queue.
    expect(screen.getByRole('button', { name: 'Assign to Dorothy Gale' }).hasAttribute('disabled')).toBe(false);
  });

  it('a viewer without interaction create sees the queue but cannot resolve', async () => {
    mocks.getOverview.mockResolvedValue(operatorOverview({ canResolve: false }));

    render(<TelephonyCallsPanel />);

    const candidate = await screen.findByRole('button', { name: 'Assign to Dorothy Gale' });
    expect(candidate.hasAttribute('disabled')).toBe(true);
  });

  it('a tenant without telephony renders nothing, never an error', async () => {
    mocks.getOverview.mockResolvedValue(operatorOverview({
      available: false,
      reason: 'addon_required',
      error: 'Microsoft Teams add-on required',
      recentCalls: [],
      unresolvedCalls: [],
    }));

    const { container } = render(<TelephonyCallsPanel />);

    await waitFor(() => expect(mocks.getOverview).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(/add-on/i)).toBeNull();
  });

  it('a refused caller renders nothing, never an error', async () => {
    mocks.getOverview.mockResolvedValue(operatorOverview({
      success: false,
      error: 'Permission denied: Cannot read interactions',
      available: false,
      recentCalls: [],
      unresolvedCalls: [],
    }));

    const { container } = render(<TelephonyCallsPanel />);

    await waitFor(() => expect(mocks.getOverview).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(/permission/i)).toBeNull();
  });

  it('interactive elements carry kebab-case reflection ids', async () => {
    mocks.getOverview.mockResolvedValue(operatorOverview());

    const { container } = render(<TelephonyCallsPanel />);

    await screen.findAllByText('+15551234567');
    const ids = [...container.querySelectorAll('[id]')].map((node) => node.id);
    expect(ids).toEqual(expect.arrayContaining([
      'telephony-calls-panel',
      'telephony-recent-calls',
      'telephony-call-row-call-1',
      'telephony-unmatched-queue',
      'telephony-unmatched-row-call-2',
    ]));
    expect(ids.every((id) => /^[a-z0-9-]+$/.test(id))).toBe(true);
  });
});
