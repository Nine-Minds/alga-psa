import { describe, expect, it, vi } from 'vitest';
import { translateManualInvoiceFailure } from '../../../../../packages/billing/src/components/billing-dashboard/manualInvoiceErrorTranslation';

describe('manual invoice error translation', () => {
  it('renders the specific billing-email message instead of the generic generation error', () => {
    const t = vi.fn((key: string, options?: Record<string, unknown>) => {
      if (key === 'manualInvoices.errors.NO_BILLING_EMAIL') {
        return `${options?.clientName} has no billing email. Set an email address on the client's billing location, then try again.`;
      }
      return 'Error generating invoice';
    });

    const message = translateManualInvoiceFailure(t, {
      success: false,
      code: 'NO_BILLING_EMAIL',
      params: { clientName: 'Omni Energy Partners' },
      message: 'server fallback',
      error: 'server fallback',
    });

    expect(message).toContain('Omni Energy Partners has no billing email');
    expect(message).not.toBe('Error generating invoice');
  });

  it('renders the support reference for unexpected failures', () => {
    const t = vi.fn((_key: string, options?: Record<string, unknown>) => (
      `Something went wrong generating the invoice. Quote reference ${options?.ref} when contacting support.`
    ));

    const message = translateManualInvoiceFailure(t, {
      success: false,
      code: 'UNEXPECTED',
      params: { ref: 'a1b2c3d4' },
      message: 'Unexpected error generating invoice',
      error: 'Unexpected error generating invoice',
      ref: 'a1b2c3d4',
    });

    expect(message).toContain('a1b2c3d4');
  });

  it('shows the server fallback verbatim for unknown codes', () => {
    const t = vi.fn(() => 'Error generating invoice');

    const message = translateManualInvoiceFailure(t, {
      success: false,
      code: 'FUTURE_CODE' as never,
      message: 'A newer server supplied this exact message',
      error: 'A newer server supplied this exact message',
    });

    expect(message).toBe('A newer server supplied this exact message');
    expect(t).not.toHaveBeenCalled();
  });
});
