/**
 * @vitest-environment jsdom
 *
 * alga0002089: the bucket pool overage-rate inputs must show the contract
 * currency symbol (EUR contract in a USD tenant => "€"), and the label must
 * not bake a currency glyph into its text.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€' };

vi.mock('@alga-psa/ui/lib', () => ({
  useCurrencyFormat: () => ({
    symbol: (currency?: string) => (currency ? SYMBOLS[currency] : 'TENANT-DEFAULT'),
  }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key);
  return { useTranslation: () => ({ t }) };
});

vi.mock('@alga-psa/billing/actions/bucketPoolActions', () => ({
  listBucketPoolsForLine: vi.fn(async () => [
    {
      bucket_id: 'b1',
      bucket_name: 'Pool',
      total_minutes: 600,
      overage_rate: 1500,
      allow_rollover: false,
      covers_all_services: false,
      members: [],
      after_hours_multiplier: null,
      business_hours_schedule_id: null,
    },
  ]),
  createBucketPool: vi.fn(),
  updateBucketPool: vi.fn(),
  addBucketPoolMember: vi.fn(),
  removeBucketPoolMember: vi.fn(),
  deleteBucketPool: vi.fn(),
  setBucketPoolAfterHoursRule: vi.fn(),
}));

vi.mock('./SellHourBlockNote', () => ({ SellHourBlockNote: () => null }));

import { BucketPoolEditor } from './BucketPoolEditor';

// The symbol must be the Input wrapper's own adornment: a child of the same
// div.relative as the <input>. A sibling span outside that wrapper is painted
// over by the input background (the original alga0002089 defect).
const adornments = (container: HTMLElement) =>
  [...container.querySelectorAll('div.relative > span[aria-hidden="true"] + input')].map((input) => {
    const span = input.previousElementSibling as HTMLElement;
    expect(span.parentElement).toBe(input.parentElement);
    return span.textContent;
  });

describe('BucketPoolEditor overage rate currency', () => {
  afterEach(() => cleanup());

  const renderEditor = (currencyCode?: string) =>
    render(
      <BucketPoolEditor
        contractLineId="line-1"
        lineServices={[]}
        allServices={[]}
        schedules={[]}
        currencyCode={currencyCode}
      />,
    );

  it('shows the contract currency on the existing-pool and create-form overage inputs', async () => {
    const { container } = renderEditor('EUR');
    await waitFor(() => expect(screen.getAllByText('Overage rate per hour')).toHaveLength(1));
    fireEvent.click(container.querySelector('#add-bucket-pool-button')!);
    await waitFor(() => expect(screen.getAllByText('Overage rate per hour')).toHaveLength(2));
    expect(adornments(container)).toEqual(['€', '€']);
    expect(container.textContent).not.toMatch(/\(\s*[$]/);
    expect(container.querySelectorAll('span.absolute:not([aria-hidden])')).toHaveLength(0);
  });

  it('falls back to the tenant default only when no contract currency is passed', async () => {
    const { container } = renderEditor(undefined);
    await waitFor(() => expect(screen.getAllByText('Overage rate per hour')).toHaveLength(1));
    expect(adornments(container)).toEqual(['TENANT-DEFAULT']);
  });
});
