// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  getPaymentConfigAction: vi.fn(), connectStripeAction: vi.fn(),
}));
const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@ee/lib/actions/payment-actions', () => ({
  getPaymentConfigAction: actions.getPaymentConfigAction,
  connectStripeAction: actions.connectStripeAction,
  disconnectStripeAction: vi.fn(), updatePaymentSettingsAction: vi.fn(),
  testStripeConnectionAction: vi.fn(), retryStripeWebhookConfigurationAction: vi.fn(),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
vi.mock('react-hot-toast', () => ({ default: toastMocks }));

import { PaymentSettings } from '../PaymentSettings';

describe('PaymentSettings restricted-key connect outcomes', () => {
  beforeEach(() => {
    actions.getPaymentConfigAction.mockReset().mockResolvedValue({ success: true, data: null });
    actions.connectStripeAction.mockReset();
    toastMocks.success.mockReset();
    toastMocks.error.mockReset();
  });

  it('shows the existing partial-success message when a standard key connects without webhooks', async () => {
    actions.connectStripeAction.mockResolvedValue({
      success: true,
      data: { publishableKey: 'pk_test_example', webhookConfigured: false, unavailableCapabilities: [] },
    });
    const { container } = render(<PaymentSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'payment.stripe.empty.connectButton' }));
    fireEvent.change(container.querySelector('#secretKey')!, { target: { value: 'sk_test_example' } });
    fireEvent.change(container.querySelector('#publishableKey')!, { target: { value: 'pk_test_example' } });
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(toastMocks.success).toHaveBeenCalledWith('payment.messages.connectPartialSuccess'));
    expect(actions.connectStripeAction).toHaveBeenCalledWith({ secretKey: 'sk_test_example', publishableKey: 'pk_test_example' });
  });
});
