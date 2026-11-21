// @vitest-environment jsdom

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '../../actions/inventoryDashboardActions';
import { AttentionStream } from './AttentionStream';

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, fallback?: string, values?: Record<string, unknown>) =>
    (fallback ?? key).replace(/{{(\w+)}}/g, (_match, name) => String(values?.[name] ?? ''));
  return { useTranslation: () => ({ t }), useOptionalI18n: () => undefined };
});

afterEach(cleanup);

const overdueVendorReturn: AttentionItem = {
  id: 'overdue-vendor-return',
  kind: 'rma_vendor_return',
  band: 'red',
  category: 'fulfillment',
  name: 'RMA-SMOKE2683-OVERDUE',
  href: '/msp/inventory/rma?rmaId=55058b3a-cbff-4b8d-9f12-f1b9ebb17c35',
  params: { return_by: '2026-10-31', overdue_days: 2, rma_reference: 'RMA-SMOKE2683-OVERDUE' },
  amount_cents: null,
  age_days: 2,
  action: { key: 'view', href: '/msp/inventory/rma?rmaId=55058b3a-cbff-4b8d-9f12-f1b9ebb17c35' },
};
const approachingVendorReturn: AttentionItem = {
  ...overdueVendorReturn,
  id: 'approaching-vendor-return',
  band: 'amber',
  name: 'RMA-SMOKE2683-APPROACHING',
  params: { return_by: '2026-11-08', days_until_due: 6 },
  age_days: null,
};

describe('AttentionStream calendar dates', () => {
  it('renders the vendor return deadline as October 31 in UTC and America/New_York', () => {
    const originalTimezone = process.env.TZ;

    try {
      for (const timezone of ['UTC', 'America/New_York']) {
        process.env.TZ = timezone;
        expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(timezone);

        const { container, unmount } = render(<AttentionStream items={[overdueVendorReturn]} urgentCount={1} />);
        const row = container.querySelector('#inventory-dashboard-attention-row-overdue-vendor-return');
        expect(row?.textContent).toContain('RMA-SMOKE2683-OVERDUE — vendor return due Oct 31 — 2d overdue');

        const recordLink = container.querySelector<HTMLAnchorElement>('#inventory-dashboard-attention-name-overdue-vendor-return');
        expect(recordLink?.getAttribute('href')).toBe(overdueVendorReturn.href);
        unmount();
      }
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it('renders approaching attention separately from overdue', () => {
    const { container } = render(<AttentionStream items={[approachingVendorReturn]} urgentCount={0} />);
    const row = container.querySelector('#inventory-dashboard-attention-row-approaching-vendor-return');
    expect(row?.textContent).toContain('RMA-SMOKE2683-APPROACHING — vendor return due Nov 8 — 6d remaining');
  });
});
