// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  getContractLinePrepaidBlockSummary: vi.fn(),
  issueNextPrepaidBlock: vi.fn(),
  removeContractLinePrepaidBlock: vi.fn(),
  upsertContractLinePrepaidBlock: vi.fn(),
}));

const translate = (key: string, options?: Record<string, unknown>) => {
  let value = String(options?.defaultValue ?? key);
  for (const [name, replacement] of Object.entries(options ?? {})) {
    if (name === 'defaultValue') continue;
    value = value.split(`{{${name}}}`).join(String(replacement));
  }
  return value;
};

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: translate }),
  useFormatters: () => ({
    locale: 'en-US',
    formatDate: (value: string) => String(value).slice(0, 10),
  }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value }: any) => <span id={id}>{String(value)}</span>,
}));
vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ id, checked, onCheckedChange }: any) => (
    <input type="checkbox" id={id} checked={Boolean(checked)} onChange={(e) => onCheckedChange?.(e.target.checked)} />
  ),
}));
vi.mock('@alga-psa/ui/components/CurrencyInput', () => ({
  CurrencyInput: ({ id, value, onChange }: any) => (
    <input id={id} value={value ?? ''} onChange={(e) => onChange?.(e.target.value === '' ? undefined : Number(e.target.value))} />
  ),
}));
vi.mock('@alga-psa/billing/actions/prepaidBlockActions', () => actionMocks);

const { PrepaidBlockPanel } = await import('../src/components/billing-dashboard/contracts/PrepaidBlockPanel');

const config = {
  tenant: 't', contract_line_id: 'line-1', block_minutes: 2400, block_price: 440000, sold_as_service_id: 'svc-1',
  expiry_months: 12, trigger_on_exhaustion: true, trigger_threshold_percent: 80, trigger_on_expiry: true,
  trigger_on_renewal: false, replenishment_tier: 'draft',
};

const summary = (patch: Record<string, unknown> = {}) => ({
  contract_line_id: 'line-1',
  display_kind: 'PrepaidBlock',
  config,
  currency_code: 'EUR',
  covered_services: [{ service_id: 'svc-1', service_name: 'Remote Support', hourly_rate: 11000 }],
  balance: { total_minutes: 2400, remaining_minutes: 600, active_block_count: 1 },
  pending_block: null,
  next_issuance: null,
  history: [{
    block_id: 'b1', status: 'active', total_minutes: 2400, remaining_minutes: 600, purchase_amount: 440000,
    currency_code: 'EUR', expiration_date: null, purchased_at: '2026-03-01T00:00:00Z', created_at: '2026-03-01T00:00:00Z',
    invoice_id: 'inv-1', invoice_number: 'INV-1', trigger_kind: 'contract_start',
  }],
  ...patch,
});

const renderPanel = async (props: Record<string, unknown> = {}) => {
  render(<PrepaidBlockPanel contractLineId="line-1" currencyCode="EUR" {...props} />);
  await screen.findByText('Active balance');
};

describe('PrepaidBlockPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.getContractLinePrepaidBlockSummary.mockResolvedValue(summary());
    actionMocks.upsertContractLinePrepaidBlock.mockResolvedValue({ config, warnings: [] });
    actionMocks.removeContractLinePrepaidBlock.mockResolvedValue({ removed: true });
    actionMocks.issueNextPrepaidBlock.mockResolvedValue({ issuanceId: 'iss-1' });
  });
  afterEach(() => cleanup());

  it('shows config, balance meter and history with invoice links', async () => {
    await renderPanel();
    expect(document.getElementById('prepaid-block-line-1-config-block')!.textContent).toContain('40 h');
    expect(document.getElementById('prepaid-block-line-1-config-block')!.textContent).toContain('4,400.00');
    expect(document.getElementById('prepaid-block-line-1-balance-value')!.textContent).toBe('10 h of 40 h remaining');
    expect(document.getElementById('prepaid-block-line-1-balance-meter')!.getAttribute('aria-valuenow')).toBe('75');
    expect(document.getElementById('prepaid-block-line-1-history-invoice-b1')!.getAttribute('href'))
      .toBe('/msp/billing?tab=invoicing&subtab=drafts&invoiceId=inv-1');
    expect(document.getElementById('prepaid-block-line-1-history-row-b1')!.textContent).toContain('Initial block');
  });

  it('shows the pending block with its draft invoice link and age, and disables Issue next block', async () => {
    actionMocks.getContractLinePrepaidBlockSummary.mockResolvedValue(summary({
      pending_block: { block_id: 'b2', total_minutes: 2400, invoice_id: 'inv-2', invoice_number: 'DRAFT-2', created_at: '2026-03-01T00:00:00Z', age_days: 16, held_minutes: 90 },
    }));
    await renderPanel();
    expect(document.getElementById('prepaid-block-line-1-pending-invoice-link')!.getAttribute('href'))
      .toBe('/msp/billing?tab=invoicing&subtab=drafts&invoiceId=inv-2');
    expect(document.getElementById('prepaid-block-line-1-pending-age')!.textContent).toBe('16 days old');
    expect(screen.getByText('1.5 h of logged time is held until this block activates.')).toBeTruthy();
    expect((document.getElementById('prepaid-block-line-1-issue-next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps Issue next block enabled for a scheduled expiry issuance, and disabled for a usage or manual one', async () => {
    const next = (trigger_kind: string) => ({ issuance_id: 'i1', trigger_kind, due_date: '2027-03-01' });
    actionMocks.getContractLinePrepaidBlockSummary.mockResolvedValue(summary({ next_issuance: next('expiry') }));
    await renderPanel();
    expect(document.getElementById('prepaid-block-line-1-next-issuance')!.textContent).toContain('Next scheduled issuance');
    expect((document.getElementById('prepaid-block-line-1-issue-next') as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    for (const kind of ['manual', 'exhaustion']) {
      actionMocks.getContractLinePrepaidBlockSummary.mockResolvedValue(summary({ next_issuance: next(kind) }));
      await renderPanel();
      expect((document.getElementById('prepaid-block-line-1-issue-next') as HTMLButtonElement).disabled).toBe(true);
      cleanup();
    }
  });

  it('issues the next block when nothing is open and refreshes', async () => {
    const onChanged = vi.fn();
    await renderPanel({ onChanged });
    const button = document.getElementById('prepaid-block-line-1-issue-next') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(actionMocks.issueNextPrepaidBlock).toHaveBeenCalledWith('line-1'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(actionMocks.getContractLinePrepaidBlockSummary.mock.calls.length).toBeGreaterThan(1);
  });

  it('surfaces action errors from Issue next block', async () => {
    actionMocks.issueNextPrepaidBlock.mockResolvedValue({ actionError: 'Cannot issue a block: a next block is already scheduled for this line' });
    await renderPanel();
    fireEvent.click(document.getElementById('prepaid-block-line-1-issue-next')!);
    expect(await screen.findByText('Cannot issue a block: a next block is already scheduled for this line')).toBeTruthy();
  });

  it('edits the config inline and saves minor units, then shows Risk 1 warnings', async () => {
    actionMocks.upsertContractLinePrepaidBlock.mockResolvedValue({
      config,
      warnings: [{ code: 'covered_service_on_other_active_line', service_id: 'svc-1', service_name: 'Remote Support', other_contract_line_id: 'l2', other_contract_line_name: 'Other hourly' }],
    });
    await renderPanel();
    fireEvent.click(document.getElementById('prepaid-block-line-1-edit')!);
    fireEvent.change(document.getElementById('prepaid-block-line-1-edit-hours')!, { target: { value: '20' } });
    fireEvent.change(document.getElementById('prepaid-block-line-1-edit-price')!, { target: { value: '2100.5' } });
    fireEvent.click(document.getElementById('prepaid-block-line-1-edit-save')!);
    await waitFor(() => expect(actionMocks.upsertContractLinePrepaidBlock).toHaveBeenCalledTimes(1));
    expect(actionMocks.upsertContractLinePrepaidBlock).toHaveBeenCalledWith('line-1', expect.objectContaining({
      block_minutes: 1200, block_price: 210050, expiry_months: 12, trigger_threshold_percent: 80, replenishment_tier: 'draft',
    }));
    expect(await screen.findByText(/is also on another active line \(Other hourly\)/)).toBeTruthy();
  });

  it('keeps the editor open with a message when the config is invalid', async () => {
    await renderPanel();
    fireEvent.click(document.getElementById('prepaid-block-line-1-edit')!);
    fireEvent.change(document.getElementById('prepaid-block-line-1-edit-hours')!, { target: { value: '0' } });
    fireEvent.click(document.getElementById('prepaid-block-line-1-edit-save')!);
    expect(await screen.findByText('Enter a block size greater than zero (fractions of an hour are allowed).')).toBeTruthy();
    expect(actionMocks.upsertContractLinePrepaidBlock).not.toHaveBeenCalled();
  });

  it('removes the config and reports refusals', async () => {
    actionMocks.removeContractLinePrepaidBlock.mockResolvedValueOnce({ actionError: 'Cannot remove prepaid block configuration: pending' });
    await renderPanel();
    fireEvent.click(document.getElementById('prepaid-block-line-1-remove')!);
    expect(await screen.findByText('Cannot remove prepaid block configuration: pending')).toBeTruthy();
    fireEvent.click(document.getElementById('prepaid-block-line-1-remove')!);
    await waitFor(() => expect(actionMocks.removeContractLinePrepaidBlock).toHaveBeenCalledTimes(2));
  });

  it('cadence block: no Issue next block button, and a note that the block fee bills in advance', async () => {
    actionMocks.getContractLinePrepaidBlockSummary.mockResolvedValue(summary({
      config: { ...config, issue_mode: 'cadence', block_minutes: 600, block_price: 150000, expiry_months: null,
        trigger_on_exhaustion: false, trigger_threshold_percent: null, trigger_on_expiry: false, rollover_periods: 0 },
    }));
    await renderPanel();
    expect(document.getElementById('prepaid-block-line-1-issue-next')).toBeNull();
    expect(document.getElementById('prepaid-block-line-1-fee-in-advance-note')!.textContent)
      .toBe('The line bills in arrears; the block fee bills in advance.');
  });

  it('consumption block: keeps Issue next block and shows no advance note', async () => {
    await renderPanel();
    expect(document.getElementById('prepaid-block-line-1-issue-next')).not.toBeNull();
    expect(document.getElementById('prepaid-block-line-1-fee-in-advance-note')).toBeNull();
  });

  it('is read-only when the contract is read-only', async () => {
    await renderPanel({ isReadOnly: true });
    expect(document.getElementById('prepaid-block-line-1-edit')).toBeNull();
    expect(document.getElementById('prepaid-block-line-1-remove')).toBeNull();
    expect(document.getElementById('prepaid-block-line-1-issue-next')).toBeNull();
  });
});
