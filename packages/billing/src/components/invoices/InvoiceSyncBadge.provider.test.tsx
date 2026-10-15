/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({ formatDate: (value: string) => value }),
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key
  })
}));

// Render the tooltip content inline so link assertions are deterministic
// without simulating Radix pointer/hover behaviour.
vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ content, children }: { content: React.ReactNode; children: React.ReactNode }) => (
    <div>
      {children}
      {content}
    </div>
  )
}));

import { InvoiceSyncBadge, qboInvoiceDeepLink, xeroInvoiceDeepLink } from './InvoiceSyncBadge';

afterEach(() => cleanup());

describe('InvoiceSyncBadge provider-specific links', () => {
  it('builds provider-correct deep links', () => {
    expect(xeroInvoiceDeepLink('xero-inv-1')).toContain('go.xero.com');
    expect(qboInvoiceDeepLink('qbo-inv-1', 'production')).toContain('app.qbo.intuit.com');
    expect(qboInvoiceDeepLink('qbo-inv-1', 'sandbox')).toContain('app.sandbox.qbo.intuit.com');
  });

  it('links a Xero invoice to Xero, never QuickBooks', () => {
    render(
      <InvoiceSyncBadge
        status={{ state: 'synced', externalId: 'xero-inv-1', docNumber: 'INV-1', provider: 'xero' }}
      />
    );

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', expect.stringContaining('go.xero.com'));
    expect(link).toHaveAttribute('href', expect.not.stringContaining('intuit.com'));
    expect(screen.getByText(/Xero #/)).toBeInTheDocument();
  });

  it('links a QBO invoice to QuickBooks', () => {
    render(
      <InvoiceSyncBadge
        status={{ state: 'synced', externalId: 'qbo-inv-9', docNumber: 'Q-9', provider: 'qbo' }}
        environment="sandbox"
      />
    );

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', expect.stringContaining('app.sandbox.qbo.intuit.com'));
    expect(screen.getByText(/QBO #/)).toBeInTheDocument();
  });
});
