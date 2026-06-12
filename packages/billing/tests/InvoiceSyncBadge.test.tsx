// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

// Mock i18n formatters (used by InvoiceSyncBadge via useFormatters)
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({
    formatDate: (value: string) => new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
    formatCurrency: (value: number) => `$${value}`,
  }),
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }),
}));

// Minimal Badge stub
vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children, id, variant }: { children: React.ReactNode; id?: string; variant?: string }) => (
    <span data-testid="badge" data-variant={variant} id={id}>{children}</span>
  ),
}));

// Minimal Tooltip stub — renders content inline so we can assert on tooltip text
vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ children, content }: { children: React.ReactNode; content: React.ReactNode }) => (
    <div>
      {children}
      <div data-testid="tooltip-content">{content}</div>
    </div>
  ),
}));

import { InvoiceSyncBadge, qboInvoiceDeepLink } from '../src/components/invoices/InvoiceSyncBadge';

describe('InvoiceSyncBadge', () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders "Not synced" for not_synced state', () => {
    render(<InvoiceSyncBadge status={{ state: 'not_synced' }} />);
    // getAllByText because the Tooltip mock also echoes label text in the tooltip-content div
    expect(screen.getAllByText('Not synced').length).toBeGreaterThan(0);
    expect(screen.getByTestId('badge')).toHaveAttribute('data-variant', 'secondary');
  });

  it('renders "Queued" for queued state', () => {
    render(<InvoiceSyncBadge status={{ state: 'queued' }} />);
    expect(screen.getAllByText('Queued').length).toBeGreaterThan(0);
    expect(screen.getByTestId('badge')).toHaveAttribute('data-variant', 'secondary');
  });

  it('renders "Synced" for synced state with success variant', () => {
    render(<InvoiceSyncBadge status={{ state: 'synced' }} />);
    expect(screen.getAllByText('Synced').length).toBeGreaterThan(0);
    expect(screen.getByTestId('badge')).toHaveAttribute('data-variant', 'success');
  });

  it('renders "Drift" for drift state with warning variant', () => {
    render(<InvoiceSyncBadge status={{ state: 'drift' }} />);
    expect(screen.getAllByText('Drift').length).toBeGreaterThan(0);
    expect(screen.getByTestId('badge')).toHaveAttribute('data-variant', 'warning');
  });

  it('renders "Sync error" for error state with error variant', () => {
    render(<InvoiceSyncBadge status={{ state: 'error' }} />);
    expect(screen.getAllByText('Sync error').length).toBeGreaterThan(0);
    expect(screen.getByTestId('badge')).toHaveAttribute('data-variant', 'error');
  });

  it('renders "Voided" for voided state', () => {
    render(<InvoiceSyncBadge status={{ state: 'voided' }} />);
    expect(screen.getAllByText('Voided').length).toBeGreaterThan(0);
    expect(screen.getByTestId('badge')).toHaveAttribute('data-variant', 'secondary');
  });

  it('tooltip contains doc number for synced state', () => {
    render(
      <InvoiceSyncBadge
        status={{ state: 'synced', docNumber: 'INV-1234', externalId: 'ext-abc', lastSyncedAt: '2026-03-15T00:00:00.000Z' }}
      />,
    );
    const tooltip = screen.getByTestId('tooltip-content');
    expect(tooltip).toHaveTextContent('INV-1234');
  });

  it('tooltip contains "View in QuickBooks" link when externalId is present for synced state', () => {
    render(
      <InvoiceSyncBadge
        status={{ state: 'synced', externalId: 'ext-abc-123' }}
      />,
    );
    const link = screen.getByRole('link', { name: 'View in QuickBooks' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('href', expect.stringContaining('ext-abc-123'));
  });

  it('sandbox deep link points to sandbox domain', () => {
    const url = qboInvoiceDeepLink('txn-123', 'sandbox');
    expect(url).toBe('https://app.sandbox.qbo.intuit.com/app/invoice?txnId=txn-123');
  });

  it('production deep link points to production domain', () => {
    const url = qboInvoiceDeepLink('txn-456', 'production');
    expect(url).toBe('https://app.qbo.intuit.com/app/invoice?txnId=txn-456');
  });

  it('default deep link (no environment) points to sandbox domain', () => {
    const url = qboInvoiceDeepLink('txn-789');
    expect(url).toBe('https://app.sandbox.qbo.intuit.com/app/invoice?txnId=txn-789');
  });

  it('badge has correct element id with state suffix', () => {
    render(<InvoiceSyncBadge status={{ state: 'drift' }} />);
    expect(document.getElementById('invoice-sync-badge-drift')).toBeInTheDocument();
  });

  it('renders error text in tooltip when error is present', () => {
    render(
      <InvoiceSyncBadge status={{ state: 'error', error: 'Connection refused' }} />,
    );
    expect(screen.getByTestId('tooltip-content')).toHaveTextContent('Connection refused');
  });
});
