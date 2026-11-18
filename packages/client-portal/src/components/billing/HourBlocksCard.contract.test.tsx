/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HourBlocksCard from './HourBlocksCard';

const getClientHourBlocksMock = vi.hoisted(() => vi.fn());
const getClientHourBlockBurnHistoryMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({ locale: 'en' }),
  useTranslation: () => ({
    t: (key: string, fallback?: string | ({ defaultValue?: string } & Record<string, unknown>)) => {
      if (!fallback) return key;
      if (typeof fallback === 'string') return fallback;
      const base = typeof fallback.defaultValue === 'string' ? fallback.defaultValue : key;
      return base.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(fallback[name] ?? ''));
    },
  }),
}));

vi.mock('../../actions/client-portal-actions/client-billing', () => ({
  getClientHourBlocks: (...args: unknown[]) => getClientHourBlocksMock(...args),
  getClientHourBlockBurnHistory: (...args: unknown[]) => getClientHourBlockBurnHistoryMock(...args),
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));
vi.mock('@alga-psa/ui/components/Skeleton', () => ({ Skeleton: () => <div /> }));

describe('HourBlocksCard contract label', () => {
  beforeEach(() => {
    const block = {
      service_id: 's', service_name: 'Support', total_minutes: 600, remaining_minutes: 300,
      hours_total: 10, hours_remaining: 5, expiration_date: null, status: 'active',
    };
    getClientHourBlocksMock.mockResolvedValue([
      { ...block, block_id: 'cb-1', contract_name: 'Acme MSP' },
      { ...block, block_id: 'ab-1', contract_name: null },
    ]);
    getClientHourBlockBurnHistoryMock.mockResolvedValue([]);
  });
  afterEach(() => cleanup());

  it('labels contract blocks with the contract name and leaves ad-hoc blocks unlabeled', async () => {
    render(<HourBlocksCard />);
    expect(await screen.findByText('Contract: Acme MSP')).toBeInTheDocument();
    expect(document.getElementById('hour-block-contract-cb-1')).not.toBeNull();
    expect(document.getElementById('hour-block-contract-ab-1')).toBeNull();
  });

  it('shows hours left with the remaining value in the block currency and the valid-from date', async () => {
    getClientHourBlocksMock.mockResolvedValue([
      {
        service_id: 's', service_name: 'Support', total_minutes: 600, remaining_minutes: 300,
        hours_total: 10, hours_remaining: 5, expiration_date: null, status: 'active', block_id: 'cad-1',
        contract_name: 'Acme MSP', currency_code: 'EUR', remaining_value: 55000, valid_from: '2026-11-01',
      },
      {
        service_id: 's', service_name: 'Support', total_minutes: 600, remaining_minutes: 300,
        hours_total: 10, hours_remaining: 5, expiration_date: null, status: 'active', block_id: 'nov-1',
        contract_name: null, currency_code: 'EUR', remaining_value: 0, valid_from: null,
      },
    ]);
    render(<HourBlocksCard />);
    expect(await screen.findByText('5.0h left · €550.00')).toBeInTheDocument();
    expect(document.getElementById('hour-block-remaining-cad-1')).not.toBeNull();
    expect(document.getElementById('hour-block-valid-from-cad-1')).not.toBeNull();
    // A block without a rate has no value line.
    expect(document.getElementById('hour-block-remaining-nov-1')).toBeNull();
    expect(document.getElementById('hour-block-valid-from-nov-1')).toBeNull();
  });
});
