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
const previewQboItemImportMock = vi.hoisted(() => vi.fn());
const executeQboItemImportMock = vi.hoisted(() => vi.fn());
const getServiceTypesForSelectionMock = vi.hoisted(() => vi.fn());
const useFeatureFlagMock = vi.hoisted(() => vi.fn(() => true));
const getQboCustomersMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => [] as unknown[]));

vi.mock('../../actions/qboItemImportActions', () => ({
  previewQboItemImport: async (...args: unknown[]) => previewQboItemImportMock(...args),
  executeQboItemImport: async (...args: unknown[]) => executeQboItemImportMock(...args),
}));

vi.mock('../../actions/serviceActions', () => ({
  getServiceTypesForSelection: async (...args: unknown[]) => getServiceTypesForSelectionMock(...args),
}));

vi.mock('../../actions/qboOnboardingActions', () => ({
  getCustomerMatchCandidates: async () => ({ rows: [] }),
  linkClientToQboCustomer: async () => ({ linked: true }),
  bulkLinkExactCustomerMatches: async () => ({ linked: 0 }),
  createQboCustomerForClient: async () => ({ created: true }),
  createQboSubCustomerForProfile: async () => ({ created: true }),
  getHistoricalInvoiceMatches: async () => ({ confident: [], review: [] }),
  bulkLinkHistoricalInvoices: async () => ({ linked: 0 }),
  backfillPaymentsForLinkedInvoices: async () => ({ processed: 0 }),
  getOnboardingWizardState: async () => ({ completedAt: null, lastRunAt: null, connected: true }),
  completeOnboardingWizard: async () => ({ done: true }),
}));

// The wizard's default Customers step renders QboCustomerMappingPanel, which
// imports getQboCustomers from the qboActions subpath. That resolves to a
// different module than the actions barrel, so mocking only the barrel let the
// real withAuth server action run inside jsdom; its late-resolving promise then
// updated React state after the environment was torn down, surfacing as an
// unhandled "window is not defined" rejection. Mock the exact path the panel
// imports (barrel kept too, so any barrel consumer stays stubbed).
vi.mock('@alga-psa/integrations/actions', () => ({
  getQboCustomers: (...args: unknown[]) => getQboCustomersMock(...args),
}));

vi.mock('@alga-psa/integrations/actions/qboActions', () => ({
  getQboCustomers: (...args: unknown[]) => getQboCustomersMock(...args),
}));

vi.mock('@alga-psa/ui/hooks', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useFeatureFlag: (...args: unknown[]) => useFeatureFlagMock(...(args as [])),
}));

import { QboItemImportStep } from './QboItemImportStep';
import { QboOnboardingWizard } from './QboOnboardingWizard';

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

const serviceTypes = [
  { id: 'type-1', name: 'Managed Services', is_standard: false },
  { id: 'type-2', name: 'Hardware', is_standard: false },
];

const previewFixture = {
  realm: 'realm-1',
  currencyCode: 'USD',
  totalQboItems: 3,
  summary: { create: 1, update: 1, link: 0, skip: 1 },
  rows: [
    {
      qboItemId: 'q1',
      qboName: 'Consulting',
      qboFullyQualifiedName: null,
      qboType: 'Service',
      action: 'create',
      matchedServiceId: null,
      fields: {
        service_name: 'Consulting', item_kind: 'service', sku: null, description: null,
        default_rate: 15000, cost: null, is_active: true, tax_rate_id: null,
      },
      fieldChanges: null,
      flags: [],
      reason: null,
    },
    {
      qboItemId: 'q2',
      qboName: 'Widget',
      qboFullyQualifiedName: null,
      qboType: 'NonInventory',
      action: 'update',
      matchedServiceId: 's-1',
      fields: {
        service_name: 'Widget', item_kind: 'product', sku: 'W-1', description: null,
        default_rate: 1999, cost: 750, is_active: false, tax_rate_id: null,
      },
      fieldChanges: [{ field: 'default_rate', from: 1500, to: 1999 }],
      flags: ['inactive'],
      reason: null,
    },
    {
      qboItemId: 'q3',
      qboName: 'Design',
      qboFullyQualifiedName: null,
      qboType: 'Category',
      action: 'skip',
      matchedServiceId: null,
      fields: null,
      fieldChanges: null,
      flags: ['category_skipped'],
      reason: 'QBO categories are not imported; item names are flattened to their leaf name.',
    },
  ],
};

// Radix Select needs these DOM APIs, which jsdom lacks.
// configurable matters: jsdom is reused across files in the shared fork, and
// a non-configurable descriptor here makes every later file's own
// defineProperty for the same key throw "Cannot redefine property".
beforeEach(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    writable: true,
    value: vi.fn(() => false),
  });
});

async function selectServiceType() {
  fireEvent.click(document.querySelector('#qbo-item-import-service-type')!);
  const option = await screen.findByText('Managed Services');
  fireEvent.click(option);
}

describe('QboItemImportStep contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFeatureFlagMock.mockReturnValue(true);
    getServiceTypesForSelectionMock.mockResolvedValue(serviceTypes);
    previewQboItemImportMock.mockResolvedValue(previewFixture);
    executeQboItemImportMock.mockResolvedValue({
      created: 1, updated: 1, linked: 0, skipped: 1, errors: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('preview is disabled until a service type is chosen', async () => {
    render(<QboItemImportStep />);
    const previewButton = await screen.findByRole('button', { name: /preview import/i });
    expect(previewButton).toBeDisabled();

    await selectServiceType();
    await waitFor(() => expect(previewButton).not.toBeDisabled());
  });

  it('preview shows summary, grouped rows, flags, per-field diffs, and skip reasons — without writing', async () => {
    render(<QboItemImportStep />);
    await screen.findByRole('button', { name: /preview import/i });
    await selectServiceType();
    fireEvent.click(screen.getByRole('button', { name: /preview import/i }));

    await screen.findByText(/1 to create/);
    expect(previewQboItemImportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        includeInactive: true,
        defaults: expect.objectContaining({ serviceTypeId: 'type-1' }),
      })
    );
    expect(executeQboItemImportMock).not.toHaveBeenCalled();

    expect(screen.getByText('Consulting')).toBeInTheDocument();
    expect(screen.getByText('Inactive in QuickBooks')).toBeInTheDocument();
    expect(screen.getByText(/default_rate: 15\.00 → 19\.99/)).toBeInTheDocument();
    expect(screen.getByText(/categories are not imported/i)).toBeInTheDocument();
  });

  it('execute runs only from an explicit click and reports the result summary', async () => {
    render(<QboItemImportStep />);
    await screen.findByRole('button', { name: /preview import/i });
    await selectServiceType();
    fireEvent.click(screen.getByRole('button', { name: /preview import/i }));
    await screen.findByText(/1 to create/);

    fireEvent.click(screen.getByRole('button', { name: /run import/i }));
    await screen.findByText(/Import complete: 1 created, 1 updated, 0 linked, 1 skipped/);
    expect(executeQboItemImportMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces per-row errors from execute', async () => {
    executeQboItemImportMock.mockResolvedValue({
      created: 0, updated: 0, linked: 0, skipped: 0,
      errors: [{ qboItemId: 'q1', qboName: 'Consulting', message: 'boom' }],
    });

    render(<QboItemImportStep />);
    await screen.findByRole('button', { name: /preview import/i });
    await selectServiceType();
    fireEvent.click(screen.getByRole('button', { name: /preview import/i }));
    await screen.findByText(/1 to create/);
    fireEvent.click(screen.getByRole('button', { name: /run import/i }));

    await screen.findByText(/1 failed/);
    expect(screen.getByText(/Consulting: boom/)).toBeInTheDocument();
  });
});

describe('QboOnboardingWizard flag gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServiceTypesForSelectionMock.mockResolvedValue(serviceTypes);
    getQboCustomersMock.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  // The default Customers step mounts QboCustomerMappingPanel, which loads on
  // mount. Each test awaits that load settling so the panel's state update
  // lands inside the live jsdom environment instead of leaking past teardown.
  it('renders the Products & Services step when qbo-item-import is on', async () => {
    useFeatureFlagMock.mockReturnValue(true);
    render(<QboOnboardingWizard />);
    expect(useFeatureFlagMock).toHaveBeenCalledWith('qbo-item-import');
    expect(screen.getByText('Products & Services')).toBeInTheDocument();
    await screen.findByText('No clients found.');
    expect(getQboCustomersMock).toHaveBeenCalledTimes(1);
  });

  it('omits the step when the flag is off', async () => {
    useFeatureFlagMock.mockReturnValue(false);
    render(<QboOnboardingWizard />);
    expect(screen.queryByText('Products & Services')).not.toBeInTheDocument();
    expect(screen.getByText('Go-live')).toBeInTheDocument();
    await screen.findByText('No clients found.');
  });

  // Regression: the Customers step must load its catalog through the mocked
  // getQboCustomers action. When the mock targeted the wrong module specifier,
  // the real withAuth server action ran and its post-teardown state update threw
  // "window is not defined", failing the whole suite despite green assertions.
  it('loads the customer catalog through the mocked action without leaking past teardown', async () => {
    useFeatureFlagMock.mockReturnValue(true);
    render(<QboOnboardingWizard />);
    await screen.findByText('No clients found.');
    expect(getQboCustomersMock).toHaveBeenCalledTimes(1);
  });
});
