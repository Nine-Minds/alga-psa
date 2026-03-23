/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PaymentSuccessContent from './PaymentSuccessContent';

vi.mock('@alga-psa/client-portal/actions/clientPaymentActions', () => ({
  verifyClientPortalPayment: vi.fn(async () => ({
    success: true,
    data: {
      status: 'succeeded',
      invoiceNumber: 'INV-001',
      amount: 12000,
      currencyCode: 'USD',
      servicePeriodStart: '2026-01-01',
      servicePeriodEnd: '2026-02-01',
    },
  })),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, asChild, ...props }: any) => {
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, props);
    }
    return <button {...props}>{children}</button>;
  },
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

afterEach(() => {
  cleanup();
});

describe('PaymentSuccessContent recurring service periods', () => {
  it('renders a canonical recurring service-period summary after payment verification succeeds', async () => {
    render(<PaymentSuccessContent invoiceId="inv-1" sessionId="session-1" />);

    await waitFor(() => {
      expect(screen.getByText('Payment Successful!')).toBeInTheDocument();
    });

    expect(screen.getByText('Service Period Summary')).toBeInTheDocument();
    expect(screen.getByText('2026-01-01 - 2026-02-01')).toBeInTheDocument();
    expect(
      screen.getByText(
        "This summary comes from the invoice's recurring detail periods, not from invoice-header billing dates alone."
      )
    ).toBeInTheDocument();
  });
});
