/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// ──────────────────────────────────────────────────────────────────────────────
// Hoisted mocks
// ──────────────────────────────────────────────────────────────────────────────
const getCustomerMatchCandidatesMock = vi.hoisted(() => vi.fn());
const getHistoricalInvoiceMatchesMock = vi.hoisted(() => vi.fn());
const bulkLinkHistoricalInvoicesMock = vi.hoisted(() => vi.fn());
const backfillPaymentsForLinkedInvoicesMock = vi.hoisted(() => vi.fn());
const completeOnboardingWizardMock = vi.hoisted(() => vi.fn());
const getOnboardingWizardStateMock = vi.hoisted(() => vi.fn());
const getQboCustomersMock = vi.hoisted(() => vi.fn());

vi.mock('../../actions/qboOnboardingActions', () => ({
  getCustomerMatchCandidates: async (...args: unknown[]) => getCustomerMatchCandidatesMock(...args),
  linkClientToQboCustomer: async () => ({ linked: true }),
  bulkLinkExactCustomerMatches: async () => ({ linked: 0 }),
  createQboCustomerForClient: async () => ({ created: true }),
  getHistoricalInvoiceMatches: async (...args: unknown[]) => getHistoricalInvoiceMatchesMock(...args),
  bulkLinkHistoricalInvoices: async (...args: unknown[]) => bulkLinkHistoricalInvoicesMock(...args),
  backfillPaymentsForLinkedInvoices: async (...args: unknown[]) => backfillPaymentsForLinkedInvoicesMock(...args),
  getOnboardingWizardState: async (...args: unknown[]) => getOnboardingWizardStateMock(...args),
  completeOnboardingWizard: async (...args: unknown[]) => completeOnboardingWizardMock(...args),
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  getQboCustomers: async (...args: unknown[]) => getQboCustomersMock(...args),
}));

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────
const emptyRows = { rows: [] };
const emptyMatches = { confident: [], review: [] };
const confidentMatches = {
  confident: [
    {
      invoiceId: 'inv-1',
      invoiceNumber: 'INV-001',
      invoiceTotal: 1000,
      externalId: 'qbo-inv-1',
      externalDocNumber: 'INV-001',
      externalTotal: 1000,
      clientId: 'client-1',
    },
  ],
  review: [],
};

describe('QboOnboardingWizard contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCustomerMatchCandidatesMock.mockResolvedValue(emptyRows);
    getQboCustomersMock.mockResolvedValue([]);
    getHistoricalInvoiceMatchesMock.mockResolvedValue(emptyMatches);
    bulkLinkHistoricalInvoicesMock.mockResolvedValue({ linked: 1 });
    backfillPaymentsForLinkedInvoicesMock.mockResolvedValue({
      processed: 1,
      paymentsApplied: 1,
      skippedPaid: 0,
      errors: 0,
    });
    completeOnboardingWizardMock.mockResolvedValue({ done: true });
    getOnboardingWizardStateMock.mockResolvedValue({
      completedAt: null,
      lastRunAt: null,
      connected: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('T086: wizard renders step 0 (Customers) by default and can advance to step 1', async () => {
    const { QboOnboardingWizard } = await import('./QboOnboardingWizard');
    render(<QboOnboardingWizard />);

    await waitFor(() => {
      expect(document.getElementById('qbo-onboarding-wizard')).toBeInTheDocument();
      expect(document.getElementById('qbo-wizard-step-0')).toBeInTheDocument();
    });

    const nextBtn = screen.getByRole('button', { name: /^Next$/ });
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(document.getElementById('qbo-wizard-step-1')).toBeInTheDocument();
    });
  });

  it('T087: history step with zero matches renders informative state, not an error', async () => {
    const { QboOnboardingWizard } = await import('./QboOnboardingWizard');
    render(<QboOnboardingWizard />);

    // Navigate to step 1
    const nextBtn = screen.getByRole('button', { name: /^Next$/ });
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(document.getElementById('qbo-wizard-step-1')).toBeInTheDocument();
    });

    // Load matches
    const loadBtn = screen.getByRole('button', { name: /Load matches/i });
    fireEvent.click(loadBtn);

    await waitFor(() => {
      // Zero matches should show informative text, no error alert
      expect(screen.getByText(/No confident matches found/)).toBeInTheDocument();
    });

    // No error text shown — zero matches is informative, not an error
    expect(screen.queryByText(/failed|error/i)).toBeNull();
  });

  it('T088: link-all triggers backfillPaymentsForLinkedInvoices when checkbox is checked', async () => {
    getHistoricalInvoiceMatchesMock.mockResolvedValue(confidentMatches);

    const { QboOnboardingWizard } = await import('./QboOnboardingWizard');
    render(<QboOnboardingWizard />);

    // Navigate to step 1
    fireEvent.click(screen.getByRole('button', { name: /^Next$/ }));

    await waitFor(() => {
      expect(document.getElementById('qbo-wizard-step-1')).toBeInTheDocument();
    });

    // Load matches
    fireEvent.click(screen.getByRole('button', { name: /Load matches/i }));

    // Wait for the Link all button to appear
    const linkBtn = await screen.findByRole('button', { name: /Link all 1/i });
    expect(linkBtn).toBeInTheDocument();

    // Backfill checkbox should be checked by default
    const backfillCheckbox = screen.getByRole('checkbox');
    expect(backfillCheckbox).toBeChecked();

    fireEvent.click(linkBtn);

    await waitFor(() => {
      expect(bulkLinkHistoricalInvoicesMock).toHaveBeenCalledWith(confidentMatches.confident);
    });

    await waitFor(() => {
      expect(backfillPaymentsForLinkedInvoicesMock).toHaveBeenCalledWith(['inv-1']);
    });
  });

  it('T089: backfill checkbox is present and checked by default on the history step', async () => {
    getHistoricalInvoiceMatchesMock.mockResolvedValue(confidentMatches);

    const { QboOnboardingWizard } = await import('./QboOnboardingWizard');
    render(<QboOnboardingWizard />);

    fireEvent.click(screen.getByRole('button', { name: /^Next$/ }));

    await waitFor(() => {
      expect(document.getElementById('qbo-wizard-step-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Load matches/i }));

    await waitFor(() => {
      // Backfill checkbox should be rendered
      const checkbox = screen.getByRole('checkbox');
      expect(checkbox).toBeInTheDocument();
      // Default state: checked
      expect(checkbox).toBeChecked();
    });

    // Ensure the label is present
    expect(screen.getByText(/Backfill payment status for linked invoices/)).toBeInTheDocument();
  });

  it('T090: finish step calls completeOnboardingWizard with date and toggle values', async () => {
    const { QboOnboardingWizard } = await import('./QboOnboardingWizard');
    render(<QboOnboardingWizard />);

    // Navigate to step 2
    fireEvent.click(screen.getByRole('button', { name: /^Next$/ }));
    await waitFor(() => { expect(document.getElementById('qbo-wizard-step-1')).toBeInTheDocument(); });
    fireEvent.click(screen.getByRole('button', { name: /^Next$/ }));
    await waitFor(() => { expect(document.getElementById('qbo-wizard-step-2')).toBeInTheDocument(); });

    // Finish button
    const finishBtn = screen.getByRole('button', { name: /Complete setup/i });
    fireEvent.click(finishBtn);

    await waitFor(() => {
      expect(completeOnboardingWizardMock).toHaveBeenCalledWith(
        expect.objectContaining({
          autoSyncStartDate: expect.any(String),
          enableAutoSync: true,
        })
      );
    });
  });
});

describe('QboOnboardingWizardEntry contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCustomerMatchCandidatesMock.mockResolvedValue(emptyRows);
    getQboCustomersMock.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('T091: renders nothing when not connected', async () => {
    getOnboardingWizardStateMock.mockResolvedValue({
      completedAt: null,
      lastRunAt: null,
      connected: false,
    });

    const { QboOnboardingWizardEntry } = await import('./QboOnboardingWizard');
    const { container } = render(<QboOnboardingWizardEntry />);

    await waitFor(() => {
      expect(getOnboardingWizardStateMock).toHaveBeenCalled();
    });

    // Should render nothing
    expect(container.firstChild).toBeNull();
  });

  it('T092: shows prominent run wizard button when connected but never completed', async () => {
    getOnboardingWizardStateMock.mockResolvedValue({
      completedAt: null,
      lastRunAt: null,
      connected: true,
    });

    const { QboOnboardingWizardEntry } = await import('./QboOnboardingWizard');
    render(<QboOnboardingWizardEntry />);

    const runBtn = await screen.findByRole('button', { name: /Run setup wizard/i });
    expect(runBtn).toBeInTheDocument();
  });

  it('T093: shows re-run link and completedAt when wizard previously completed; wizard opens on click', async () => {
    getOnboardingWizardStateMock.mockResolvedValue({
      completedAt: '2026-06-01T10:00:00.000Z',
      lastRunAt: '2026-06-01T10:00:00.000Z',
      connected: true,
    });

    const { QboOnboardingWizardEntry } = await import('./QboOnboardingWizard');
    render(<QboOnboardingWizardEntry />);

    const rerunBtn = await screen.findByRole('button', { name: /Re-run reconciliation wizard/i });
    expect(rerunBtn).toBeInTheDocument();
    // Should show a date
    expect(screen.getByText(/completed/i)).toBeInTheDocument();

    // Click opens the wizard
    fireEvent.click(rerunBtn);

    await waitFor(() => {
      expect(document.getElementById('qbo-onboarding-wizard')).toBeInTheDocument();
    });
  });
});
