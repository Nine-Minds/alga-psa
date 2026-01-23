/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

(globalThis as unknown as { React?: typeof React }).React = React;

import { PurchaseOrderSummaryBanner } from '@alga-psa/billing';

describe('PurchaseOrderSummaryBanner', () => {
  it('T009: invoice metadata displays invoice-level PO number and PO summary (authorized/consumed/remaining)', () => {
    render(
      <PurchaseOrderSummaryBanner
        currencyCode="USD"
        poSummary={{
          po_number: 'PO-123',
          po_amount_cents: 10000,
          consumed_cents: 4000,
          remaining_cents: 6000,
        } as any}
      />
    );

    expect(screen.getByText('PO Number')).toBeInTheDocument();
    expect(screen.getByText('PO-123')).toBeInTheDocument();
    expect(screen.getByText('PO Authorized')).toBeInTheDocument();
    expect(screen.getByText('PO Consumed (Finalized)')).toBeInTheDocument();
    expect(screen.getByText('PO Remaining')).toBeInTheDocument();

    expect(screen.getByText('$100.00')).toBeInTheDocument();
    expect(screen.getByText('$40.00')).toBeInTheDocument();
    expect(screen.getByText('$60.00')).toBeInTheDocument();
  });
});
