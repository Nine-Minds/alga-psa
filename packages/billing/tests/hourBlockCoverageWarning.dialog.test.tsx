// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getServices: vi.fn(),
  getHourBlockContractCoverage: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/serviceActions', () => ({ getServices: mocks.getServices }));
vi.mock('@alga-psa/billing/actions/hourBlockActions', () => ({
  getHourBlockContractCoverage: mocks.getHourBlockContractCoverage,
  createHourBlockPurchaseInvoice: vi.fn(),
  grantHourBlock: vi.fn(),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children }: any) => (isOpen ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/SearchableSelect', () => ({
  default: ({ id, options, onChange }: any) => (
    <select id={id} onChange={(e) => onChange(e.target.value)} defaultValue="">
      <option value="">--</option>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({ DatePicker: () => null }));
vi.mock('@alga-psa/ui/components/CurrencyInput', () => ({ CurrencyInput: () => null }));
vi.mock('@alga-psa/ui/components/NumericInput', () => ({ NumericInput: () => null }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn() } }));

const translate = (key: string, options?: Record<string, unknown>) => {
  let value = String(options?.defaultValue ?? key);
  for (const [name, replacement] of Object.entries(options ?? {})) {
    value = value.replace(`{{${name}}}`, String(replacement));
  }
  return value;
};
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: translate }) }));

import SellHourBlockDialog from '../src/components/hour-blocks/SellHourBlockDialog';
import GrantHourBlockDialog from '../src/components/hour-blocks/GrantHourBlockDialog';

const line = (n: string) => ({
  contract_id: `contract-${n}`,
  contract_name: `Contract ${n}`,
  client_contract_id: `cc-${n}`,
  contract_line_id: `line-${n}`,
  contract_line_name: `Line ${n}`,
  start_date: '2026-01-01',
  end_date: null,
});

async function selectService(container: HTMLElement) {
  await waitFor(() => expect(container.querySelector('#hb-service, #hb-grant-service')).not.toBeNull());
  const select = container.querySelector('#hb-service, #hb-grant-service') as HTMLSelectElement;
  await act(async () => {
    fireEvent.change(select, { target: { value: 'svc-1' } });
  });
}

describe('hour block contract coverage warning', () => {
  beforeEach(() => {
    mocks.getServices.mockReset().mockResolvedValue({
      services: [{ service_id: 'svc-1', service_name: 'Support', default_rate: 10000 }],
    });
    mocks.getHourBlockContractCoverage.mockReset();
  });

  const renderSell = () =>
    render(<SellHourBlockDialog clientId="client-1" currencyCode="USD" isOpen onClose={() => {}} onCreated={() => {}} />);

  it('shows the one-line message with a contract link and keeps submit enabled', async () => {
    mocks.getHourBlockContractCoverage.mockResolvedValue({
      unscoped: false,
      services: [{ service_id: 'svc-1', service_name: 'Support', assignment: 'automatic', lines: [line('a')] }],
    });
    const { container } = renderSell();
    await selectService(container);

    expect(await screen.findByText(/Time on Support bills through Contract a \/ Line a/)).toBeTruthy();
    const link = container.querySelector('#hb-coverage-warning a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toContain('clientContractId=cc-a');
    expect(link.getAttribute('target')).toBe('_blank');
    expect((container.querySelector('#hb-sell-submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the many-line message and lists the lines', async () => {
    mocks.getHourBlockContractCoverage.mockResolvedValue({
      unscoped: false,
      services: [{ service_id: 'svc-1', service_name: 'Support', assignment: 'when_assigned', lines: [line('a'), line('b')] }],
    });
    const { container } = renderSell();
    await selectService(container);

    expect(await screen.findByText(/Time on Support that is assigned to a contract line will not draw this block/)).toBeTruthy();
    expect(screen.getByText(/Contract a \/ Line a/)).toBeTruthy();
    expect(screen.getByText(/Contract b \/ Line b/)).toBeTruthy();
  });

  it('lists up to 5 services for an unscoped block, then "and N more"', async () => {
    const services = Array.from({ length: 7 }, (_, i) => ({
      service_id: `s${i}`,
      service_name: `Service ${i}`,
      assignment: 'automatic',
      lines: [line(String(i))],
    }));
    mocks.getHourBlockContractCoverage.mockResolvedValue({ unscoped: true, services });
    const { container } = renderSell();
    await selectService(container);

    expect(await screen.findByText(/This block covers all labor/)).toBeTruthy();
    expect(screen.getByText(/Service 4 — Contract 4 \/ Line 4/)).toBeTruthy();
    expect(screen.queryByText(/Service 5 —/)).toBeNull();
    expect(screen.getByText('and 2 more')).toBeTruthy();
  });

  it('stays silent when there is no coverage or the lookup fails', async () => {
    mocks.getHourBlockContractCoverage.mockResolvedValue({ unscoped: false, services: [] });
    const { container } = renderSell();
    await selectService(container);
    await waitFor(() => expect(mocks.getHourBlockContractCoverage).toHaveBeenCalled());
    expect(container.querySelector('#hb-coverage-warning')).toBeNull();

    mocks.getHourBlockContractCoverage.mockRejectedValue(new Error('boom'));
    const second = renderSell();
    await selectService(second.container);
    expect(second.container.querySelector('#hb-coverage-warning')).toBeNull();
  });

  it('shows the same notice in the Grant dialog', async () => {
    mocks.getHourBlockContractCoverage.mockResolvedValue({
      unscoped: false,
      services: [{ service_id: 'svc-1', service_name: 'Support', assignment: 'automatic', lines: [line('a')] }],
    });
    const { container } = render(
      <GrantHourBlockDialog clientId="client-1" currencyCode="USD" isOpen onClose={() => {}} onCreated={() => {}} />,
    );
    await selectService(container);
    expect(await screen.findByText(/Time on Support bills through Contract a \/ Line a/)).toBeTruthy();
    expect((container.querySelector('#hb-grant-submit') as HTMLButtonElement).disabled).toBe(false);
  });
});
