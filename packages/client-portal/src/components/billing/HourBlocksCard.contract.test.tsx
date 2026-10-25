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
});
