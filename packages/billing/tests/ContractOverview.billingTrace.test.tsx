// @vitest-environment jsdom
//
// The contract overview states which billing profile bills the contract, its
// payment terms and where each value comes from — for a one-profile client and
// for a client whose lines bill several profiles.

import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractBillingTrace } from '@alga-psa/types';

const actionMocks = vi.hoisted(() => ({ getContractOverview: vi.fn() }));

vi.mock('@alga-psa/billing/actions/contractActions', () => ({
  getContractOverview: actionMocks.getContractOverview,
}));
vi.mock('@alga-psa/billing/actions/contractLineSemanticsActions', () => ({
  setUsageMeasurementMode: vi.fn(),
  getNextContractServiceBoundary: vi.fn(),
}));

const translate = (key: string, options?: Record<string, unknown>) => {
  let value = String(options?.defaultValue ?? key);
  for (const [name, replacement] of Object.entries(options ?? {})) {
    if (name === 'defaultValue') continue;
    value = value.replaceAll(`{{${name}}}`, String(replacement));
  }
  return value;
};
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: translate }),
  useFormatters: () => ({ formatCurrency: (n: number, c: string) => `${c} ${n.toFixed(2)}` }),
}));
vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useFormatBillingFrequency: () => (value: string) => value,
  useFormatContractLineType: () => (value: string) => value,
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: () => null,
  DialogContent: () => null,
  DialogFooter: () => null,
}));

const { ContractOverview } = await import('../src/components/billing-dashboard/contracts/ContractOverview');

const terms = (over: Partial<ContractBillingTrace['terms']> = {}): ContractBillingTrace['terms'] => ({
  value: 'net_30',
  source: 'client',
  days: 30,
  dueDateExample: { invoiceDate: '2026-10-22', dueDate: '2026-11-21' },
  ...over,
});
const fields = (): ContractBillingTrace['fields'] => [
  { key: 'bill_to', label: 'Bill to', value: 'Acme Corp', source: 'client' },
  { key: 'payment_method', label: 'Payment method', value: 'check', source: 'profile' },
  { key: 'tax_exemption', label: 'Tax exemption', value: 'taxable', source: 'client' },
  { key: 'tax_region', label: 'Tax region', value: null, source: 'client' },
  { key: 'delivery', label: 'Invoice delivery', value: 'email', source: 'client' },
  { key: 'template', label: 'Invoice template', value: null, source: 'client' },
  { key: 'po_number', label: 'PO number', value: 'PO-7', source: 'profile' },
  { key: 'currency', label: 'Currency', value: 'USD', source: 'contract' },
  { key: 'cadence', label: 'Billing cadence', value: 'monthly', source: 'contract' },
  { key: 'profile_billing_cycle', label: 'Profile billing cycle', value: 'weekly', source: 'profile', applied: false },
];

const self = (billingProfileId: string, name: string, isDefault = false) => ({ billingProfileId, name, isActive: true, isDefault });

const singleTrace: ContractBillingTrace = {
  asOf: '2026-10-22',
  profiles: [
    { billingProfileId: 'p-default', name: 'Acme Corp', source: 'client_default', lineCount: 1, isActive: true, isDefault: true, invoiceProfile: self('p-default', 'Acme Corp', true), invoiceReason: 'same_profile', terms: terms(), fields: fields() },
  ],
  terms: terms(),
  fields: fields(),
  warnings: [],
};

const mixedTrace: ContractBillingTrace = {
  asOf: '2026-10-22',
  profiles: [
    { billingProfileId: 'p-default', name: 'Acme Corp', source: 'contract_line', lineCount: 1, isActive: true, isDefault: true, invoiceProfile: self('p-default', 'Acme Corp', true), invoiceReason: 'same_profile', terms: terms(), fields: fields() },
    { billingProfileId: 'p-north', name: 'North Plant', source: 'contract', lineCount: 1, isActive: false, isDefault: false, invoiceProfile: self('p-north', 'North Plant'), invoiceReason: 'own_invoice', terms: terms({ value: 'net_15', source: 'profile', days: 15, dueDateExample: { invoiceDate: '2026-10-22', dueDate: '2026-11-06' } }), fields: fields() },
  ],
  terms: terms(),
  fields: fields(),
  warnings: [
    { code: 'inactive_profile', billingProfileId: 'p-north', profileName: 'North Plant' },
    { code: 'mixed_profiles', profileCount: 2, invoiceProfileCount: 2, invoiceProfileName: null },
    { code: 'line_override', contractLineId: 'l2', contractLineName: 'Hosting', billingProfileId: 'p-default', profileName: 'Acme Corp' },
  ],
};

const overviewWith = (billingTrace: ContractBillingTrace | null) => ({
  contractLines: [],
  totalEstimatedMonthlyValue: null,
  serviceCount: 0,
  hasHourlyServices: false,
  hasUsageServices: false,
  hasFixedServices: false,
  currencyCode: 'USD',
  clientId: 'client-1',
  billingTrace,
});

describe('ContractOverview billing terms section', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('names the profile, its source, the terms and the due-date sentence for a one-profile client', async () => {
    actionMocks.getContractOverview.mockResolvedValue(overviewWith(singleTrace));
    render(<ContractOverview contractId="c1" />);

    expect(await screen.findByTestId('billing-profile-name')).toHaveTextContent('Acme Corp');
    expect(screen.getByTestId('billing-profile-source')).toHaveTextContent('client default');
    expect(screen.getByTestId('billing-terms-value')).toHaveTextContent('Net 30');
    expect(screen.getByTestId('billing-terms-source')).toHaveTextContent('from the client');
    expect(screen.getByTestId('billing-due-sentence')).toHaveTextContent(
      'A 2026-10-22 invoice is due 2026-11-21 — Net 30 from the client',
    );
    expect(screen.queryByTestId('billing-warnings')).toBeNull();
  });

  it('says Net 30 is a default when no terms are configured', async () => {
    actionMocks.getContractOverview.mockResolvedValue(
      overviewWith({ ...singleTrace, terms: terms({ source: 'default' }) }),
    );
    render(<ContractOverview contractId="c1" />);
    expect(await screen.findByTestId('billing-terms-source')).toHaveTextContent('default — no terms are set');
  });

  it('gives every disclosed row a source, and never presents the profile cycle as applied', async () => {
    actionMocks.getContractOverview.mockResolvedValue(overviewWith(singleTrace));
    render(<ContractOverview contractId="c1" />);
    fireEvent.click(await screen.findByText('Other billing details'));

    for (const field of fields()) {
      const source = screen.getByTestId(`billing-field-source-${field.key}`);
      expect(source.textContent?.trim()).toBeTruthy();
    }
    expect(screen.getByTestId('billing-field-source-tax_region')).toHaveTextContent('Client');
    expect(screen.getByTestId('billing-field-value-tax_region')).toHaveTextContent(
      'Service region, then contract-line location, then client default',
    );
    expect(screen.getByText('Profile billing cycle (not yet applied)')).toBeInTheDocument();
    expect(screen.getByTestId('billing-field-value-payment_method')).toHaveTextContent('check');
  });

  it('lists every billing profile with line counts and warnings instead of one name', async () => {
    actionMocks.getContractOverview.mockResolvedValue(overviewWith(mixedTrace));
    render(<ContractOverview contractId="c1" />);

    const north = await screen.findByTestId('billing-profile-p-north');
    expect(within(north).getByTestId('billing-profile-name')).toHaveTextContent('North Plant');
    expect(within(north).getByTestId('billing-profile-source')).toHaveTextContent('assigned on contract');
    expect(screen.getByTestId('billing-profile-p-default')).toHaveTextContent('set on line');
    expect(screen.getByTestId('billing-profile-terms-p-north')).toHaveTextContent('Net 15');
    expect(screen.getByTestId('billing-profile-terms-p-north')).toHaveTextContent('due 2026-11-06');
    // One headline terms value would read as covering the whole contract.
    expect(screen.queryByTestId('billing-terms-value')).toBeNull();

    expect(screen.getByTestId('billing-warning-mixed_profiles')).toHaveTextContent('2 different profiles');
    expect(screen.getByTestId('billing-warning-inactive_profile')).toHaveTextContent('North Plant is inactive but still bills');
    expect(screen.getByTestId('billing-warning-line_override')).toHaveTextContent('Line "Hosting" bills Acme Corp');
  });

  it('says where a non-separately-billing profile is invoiced, with the invoice profile\'s terms and due date', async () => {
    const landed: ContractBillingTrace = {
      ...singleTrace,
      profiles: [
        {
          ...singleTrace.profiles[0],
          billingProfileId: 'p-north', name: 'North Plant', source: 'contract', isDefault: false,
          invoiceProfile: self('p-default', 'Acme Corp', true), invoiceReason: 'not_billed_separately',
        },
      ],
    };
    actionMocks.getContractOverview.mockResolvedValue(overviewWith(landed));
    render(<ContractOverview contractId="c1" />);
    expect(await screen.findByTestId('billing-due-sentence')).toHaveTextContent(
      'Attributed to North Plant; invoiced on Acme Corp (North Plant does not bill separately) — Net 30, due 2026-11-21',
    );
  });

  it('uses the single-invoice mixed_profiles text when every profile lands on one invoice', async () => {
    const oneInvoice: ContractBillingTrace = {
      ...mixedTrace,
      warnings: [{ code: 'mixed_profiles', profileCount: 2, invoiceProfileCount: 1, invoiceProfileName: 'Acme Corp' }],
    };
    actionMocks.getContractOverview.mockResolvedValue(overviewWith(oneInvoice));
    render(<ContractOverview contractId="c1" />);
    const warning = await screen.findByTestId('billing-warning-mixed_profiles');
    expect(warning).toHaveTextContent("all land on Acme Corp's invoice, so one set of payment terms applies");
    expect(warning).not.toHaveTextContent('Each invoice uses');
  });

  it('renders no billing section for a template overview', async () => {
    actionMocks.getContractOverview.mockResolvedValue(overviewWith(null));
    render(<ContractOverview contractId="t1" />);
    await screen.findByText("What's Included");
    expect(screen.queryByTestId('billing-terms-section')).toBeNull();
  });

  it('still renders an overview payload that predates billingTrace', async () => {
    const { billingTrace: _omitted, ...legacy } = overviewWith(null);
    actionMocks.getContractOverview.mockResolvedValue(legacy);
    render(<ContractOverview contractId="c1" />);
    await screen.findByText("What's Included");
    expect(screen.queryByTestId('billing-terms-section')).toBeNull();
  });

  it('does not present the client default as final when a work item may bill another profile', async () => {
    const caveated: ContractBillingTrace = {
      ...singleTrace,
      warnings: [
        {
          code: 'work_item_override_possible',
          contractLineIds: ['l1'],
          candidateProfiles: [{ billingProfileId: 'p-b', name: 'Facility B' }],
          bucketCoverage: false,
        },
      ],
      workItemProfiles: [
        {
          billingProfileId: 'p-b', name: 'Facility B', source: 'work_item', lineCount: 1, isActive: true, isDefault: false,
          invoiceProfile: self('p-b', 'Facility B'), invoiceReason: 'own_invoice',
          terms: terms({ value: 'net_15', source: 'profile', days: 15, dueDateExample: { invoiceDate: '2026-10-22', dueDate: '2026-11-06' } }),
          fields: fields(),
        },
      ],
    };
    actionMocks.getContractOverview.mockResolvedValue(overviewWith(caveated));
    render(<ContractOverview contractId="c1" />);

    expect(await screen.findByTestId('billing-warning-work_item_override_possible')).toHaveTextContent('Facility B');
    expect(screen.getByTestId('billing-due-sentence')).toHaveTextContent(
      'unless the ticket or project is billed to another profile',
    );
    expect(screen.getByTestId('billing-work-item-profile-p-b')).toHaveTextContent('2026-11-06');
  });
});
