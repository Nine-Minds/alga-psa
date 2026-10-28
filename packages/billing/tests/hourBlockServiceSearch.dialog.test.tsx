// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// The real Dialog renders role="dialog"; the overlay dropdown portals into it.
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children }: any) => (isOpen ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({ DatePicker: () => null }));
vi.mock('@alga-psa/ui/components/NumericInput', () => ({ NumericInput: () => null }));
vi.mock('@alga-psa/ui/components/CurrencyInput', () => ({
  CurrencyInput: ({ id, value }: any) => <input id={id} value={value ?? ''} readOnly />,
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn() } }));

const translate = (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key);
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: translate }) }));

// cmdk observes its list and scrolls the active item; jsdom has neither API.
if (!('ResizeObserver' in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

import SellHourBlockDialog from '../src/components/hour-blocks/SellHourBlockDialog';
import GrantHourBlockDialog from '../src/components/hour-blocks/GrantHourBlockDialog';

const services = [
  { service_id: 'svc-support', service_name: 'Network Support', default_rate: 12000 },
  { service_id: 'svc-visit', service_name: 'On-site Visit', default_rate: 15000 },
  { service_id: 'svc-desk', service_name: 'Help Desk', default_rate: 9000 },
];

const dialogProps = { clientId: 'client-1', currencyCode: 'USD', isOpen: true, onClose: () => {}, onCreated: () => {} };

const variants = [
  { name: 'Sell', renderDialog: () => render(<SellHourBlockDialog {...dialogProps} />), triggerId: 'hb-service', rateId: 'hb-rate' },
  { name: 'Grant', renderDialog: () => render(<GrantHourBlockDialog {...dialogProps} />), triggerId: 'hb-grant-service', rateId: 'hb-grant-rate' },
];

const optionLabels = () => screen.queryAllByRole('option').map((option) => option.textContent);
const search = (term: string) =>
  fireEvent.change(screen.getByPlaceholderText('Search services...'), { target: { value: term } });

describe.each(variants)('$name hour block service picker', ({ renderDialog, triggerId, rateId }) => {
  beforeEach(() => {
    mocks.getServices.mockReset().mockResolvedValue({ services });
    mocks.getHourBlockContractCoverage.mockReset().mockResolvedValue({ unscoped: false, services: [] });
  });

  afterEach(() => {
    cleanup();
  });

  async function openPicker() {
    const { container } = renderDialog();
    await waitFor(() => expect(container.querySelector(`#${triggerId}`)).not.toBeNull());
    const trigger = container.querySelector(`#${triggerId}`) as HTMLButtonElement;
    fireEvent.click(trigger);
    return { container, trigger };
  }

  it('is a combobox tied to the Service label that starts on the placeholder', async () => {
    const { container } = renderDialog();
    await waitFor(() => expect(container.querySelector(`#${triggerId}`)).not.toBeNull());

    const trigger = screen.getByLabelText('Service');
    expect(trigger).toBe(container.querySelector(`#${triggerId}`));
    expect(trigger.getAttribute('role')).toBe('combobox');
    expect(trigger.textContent).toContain('Select a service');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('only loads active hourly services', async () => {
    await openPicker();

    expect(mocks.getServices).toHaveBeenCalledWith(1, 999, {
      is_active: true,
      item_kind: 'service',
      billing_method: 'hourly',
    });
  });

  it('lists every service, inside the dialog, when opened', async () => {
    await openPicker();

    expect(optionLabels()).toEqual(['Network Support', 'On-site Visit', 'Help Desk']);
    expect(screen.getByRole('dialog').contains(screen.getByRole('listbox'))).toBe(true);
  });

  it('filters the services as you type, ignoring case', async () => {
    await openPicker();

    search('DESK');
    expect(optionLabels()).toEqual(['Help Desk']);

    search('on-site');
    expect(optionLabels()).toEqual(['On-site Visit']);
  });

  it('shows the empty message when nothing matches', async () => {
    await openPicker();

    search('zzz');
    expect(optionLabels()).toEqual([]);
    expect(within(screen.getByRole('listbox')).getByText('No services found')).toBeTruthy();
  });

  it('selecting a filtered result sets the service, defaults the rate, and looks up contract coverage', async () => {
    const { container, trigger } = await openPicker();

    search('visit');
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'On-site Visit' }));
    });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger.textContent).toContain('On-site Visit');
    expect((container.querySelector(`#${rateId}`) as HTMLInputElement).value).toBe('150');
    await waitFor(() =>
      expect(mocks.getHourBlockContractCoverage).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'client-1', serviceId: 'svc-visit' }),
      ),
    );
  });
});
