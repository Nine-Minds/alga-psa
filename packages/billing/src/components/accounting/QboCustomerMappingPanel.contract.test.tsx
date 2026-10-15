/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// ──────────────────────────────────────────────────────────────────────────────
// Hoisted mocks
// ──────────────────────────────────────────────────────────────────────────────
const getCustomerMatchCandidatesMock = vi.hoisted(() => vi.fn());
const linkClientToQboCustomerMock = vi.hoisted(() => vi.fn());
const bulkLinkExactCustomerMatchesMock = vi.hoisted(() => vi.fn());
const createQboCustomerForClientMock = vi.hoisted(() => vi.fn());
const getQboCustomersMock = vi.hoisted(() => vi.fn());

vi.mock('../../actions/qboOnboardingActions', () => ({
  getCustomerMatchCandidates: async (...args: unknown[]) => getCustomerMatchCandidatesMock(...args),
  linkClientToQboCustomer: async (...args: unknown[]) => linkClientToQboCustomerMock(...args),
  bulkLinkExactCustomerMatches: async (...args: unknown[]) => bulkLinkExactCustomerMatchesMock(...args),
  createQboCustomerForClient: async (...args: unknown[]) => createQboCustomerForClientMock(...args),
}));

vi.mock('@alga-psa/integrations/actions/qboActions', () => ({
  getQboCustomers: async (...args: unknown[]) => getQboCustomersMock(...args),
}));

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

const baseRows = [
  {
    clientId: 'client-1',
    clientName: 'Acme Corp',
    mappedExternalId: null,
    mappedExternalName: null,
    suggestion: { externalId: 'qbo-1', externalName: 'Acme Corp', exact: true },
  },
  {
    clientId: 'client-2',
    clientName: 'Beta LLC',
    mappedExternalId: null,
    mappedExternalName: null,
    suggestion: { externalId: 'qbo-2', externalName: 'Beta L.L.C.', exact: false },
  },
  {
    clientId: 'client-3',
    clientName: 'Gamma Inc',
    mappedExternalId: null,
    mappedExternalName: null,
    suggestion: null,
  },
];

const mappedRow = {
  clientId: 'client-4',
  clientName: 'Delta Ltd',
  mappedExternalId: 'qbo-4',
  mappedExternalName: 'Delta Limited',
  suggestion: null,
};

const qboCustomers = [
  { id: 'qbo-1', name: 'Acme Corp', active: true },
  { id: 'qbo-2', name: 'Beta L.L.C.', active: true },
  { id: 'qbo-10', name: 'New Customer', active: true },
];

describe('QboCustomerMappingPanel contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCustomerMatchCandidatesMock.mockResolvedValue({ rows: baseRows });
    getQboCustomersMock.mockResolvedValue(qboCustomers);
    linkClientToQboCustomerMock.mockResolvedValue({ linked: true });
    bulkLinkExactCustomerMatchesMock.mockResolvedValue({ linked: 1 });
    createQboCustomerForClientMock.mockResolvedValue({ created: true, externalId: 'qbo-new' });
  });

  afterEach(() => {
    cleanup();
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores a stale load that settles via %s after the effect restarts',
    async (outcome) => {
      let resolveOld!: (value: { rows: typeof baseRows }) => void;
      let rejectOld!: (reason: Error) => void;
      const oldLoad = new Promise<{ rows: typeof baseRows }>((resolve, reject) => {
        resolveOld = resolve;
        rejectOld = reject;
      });
      getCustomerMatchCandidatesMock.mockReturnValueOnce(oldLoad);

      const { QboCustomerMappingPanel } = await import('./QboCustomerMappingPanel');
      render(<React.StrictMode><QboCustomerMappingPanel /></React.StrictMode>);

      // StrictMode cleans up the first effect and starts a second request.
      await screen.findByText('Acme Corp');
      expect(getCustomerMatchCandidatesMock).toHaveBeenCalledTimes(2);
      expect(getQboCustomersMock).toHaveBeenCalledTimes(2);

      await act(async () => {
        if (outcome === 'resolve') {
          resolveOld({ rows: [] });
        } else {
          rejectOld(new Error('Obsolete request failed'));
        }
      });

      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
      expect(screen.queryByText('No clients found.')).not.toBeInTheDocument();
      expect(screen.queryByText('Failed to load customer mappings.')).not.toBeInTheDocument();
    }
  );

  it('keeps loading until the current request settles and surfaces its failure', async () => {
    let resolveOld!: (value: { rows: typeof baseRows }) => void;
    let rejectCurrent!: (reason: Error) => void;
    getCustomerMatchCandidatesMock
      .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
      .mockReturnValueOnce(new Promise((_resolve, reject) => { rejectCurrent = reject; }));

    const { QboCustomerMappingPanel } = await import('./QboCustomerMappingPanel');
    render(<React.StrictMode><QboCustomerMappingPanel /></React.StrictMode>);
    await act(async () => { resolveOld({ rows: [] }); });

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText('No clients found.')).not.toBeInTheDocument();

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await act(async () => { rejectCurrent(new Error('Current request failed')); });
      expect(screen.getByText('Failed to load customer mappings.')).toBeInTheDocument();
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('T080: renders client rows from getCustomerMatchCandidates', async () => {
    const { QboCustomerMappingPanel } = await import('./QboCustomerMappingPanel');
    render(<QboCustomerMappingPanel />);

    await waitFor(() => {
      expect(document.getElementById('qbo-customer-mapping-panel')).toBeInTheDocument();
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
      expect(screen.getByText('Beta LLC')).toBeInTheDocument();
      expect(screen.getByText('Gamma Inc')).toBeInTheDocument();
    });
  });

  it('T081: bulk accept bar shown for exact matches; clicking calls bulkLinkExactCustomerMatches', async () => {
    const { QboCustomerMappingPanel } = await import('./QboCustomerMappingPanel');
    render(<QboCustomerMappingPanel />);

    const bulkBtn = await screen.findByRole('button', { name: /Accept.*exact match/i });
    expect(bulkBtn).toBeInTheDocument();

    fireEvent.click(bulkBtn);

    await waitFor(() => {
      expect(bulkLinkExactCustomerMatchesMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText(/Linked 1 exact match/)).toBeInTheDocument();
    });
  });

  it('T082: exact suggestion row shows Accept button; clicking calls linkClientToQboCustomer', async () => {
    const { QboCustomerMappingPanel } = await import('./QboCustomerMappingPanel');
    render(<QboCustomerMappingPanel />);

    // Each exact-match row should have an Accept button
    const acceptBtns = await screen.findAllByRole('button', { name: /^Accept$/ });
    expect(acceptBtns.length).toBeGreaterThan(0);

    fireEvent.click(acceptBtns[0]);

    await waitFor(() => {
      expect(linkClientToQboCustomerMock).toHaveBeenCalledWith({
        clientId: 'client-1',
        externalId: 'qbo-1',
        externalName: 'Acme Corp',
      });
    });
  });

  it('T083: fuzzy suggestion row shows Confirm button distinct from exact', async () => {
    const { QboCustomerMappingPanel } = await import('./QboCustomerMappingPanel');
    render(<QboCustomerMappingPanel />);

    await waitFor(() => {
      // Fuzzy suggestion for "Beta LLC" shows suggested name
      expect(screen.getByText(/Beta L\.L\.C\./)).toBeInTheDocument();
    });

    const confirmBtns = screen.queryAllByRole('button', { name: /^Confirm$/ });
    expect(confirmBtns.length).toBeGreaterThan(0);
  });

  it('T084: unmapped row with no suggestion shows Create in QuickBooks button; clicking calls createQboCustomerForClient', async () => {
    const { QboCustomerMappingPanel } = await import('./QboCustomerMappingPanel');
    render(<QboCustomerMappingPanel />);

    const createBtn = await screen.findByRole('button', { name: /Create in QuickBooks/i });
    expect(createBtn).toBeInTheDocument();

    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(createQboCustomerForClientMock).toHaveBeenCalledWith('client-3');
    });
  });

  it('T085: mapped row shows linked name and a Re-link button', async () => {
    getCustomerMatchCandidatesMock.mockResolvedValue({ rows: [mappedRow] });

    const { QboCustomerMappingPanel } = await import('./QboCustomerMappingPanel');
    render(<QboCustomerMappingPanel />);

    await waitFor(() => {
      expect(screen.getAllByText('Delta Limited').length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: /Re-link/i })).toBeInTheDocument();
    });
  });
});
