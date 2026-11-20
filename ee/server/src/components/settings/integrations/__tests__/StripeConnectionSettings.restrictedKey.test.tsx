// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({ getPaymentConfigAction: vi.fn() }));
vi.mock('@ee/lib/actions/payment-actions', () => ({
  getPaymentConfigAction: actions.getPaymentConfigAction,
  connectStripeAction: vi.fn(), disconnectStripeAction: vi.fn(), testStripeConnectionAction: vi.fn(),
  retryStripeWebhookConfigurationAction: vi.fn(),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key;
  return { useTranslation: () => ({ t }) };
});
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../billing/StripeCustomerImport', () => ({ default: () => null }));

import { StripeConnectionSettings } from '../StripeConnectionSettings';

describe('StripeConnectionSettings restricted-key replacement UI', () => {
  beforeEach(() => {
    actions.getPaymentConfigAction.mockReset().mockResolvedValue({ success: true, data: {
      provider_type: 'stripe', is_enabled: true, is_default: true,
      created_at: '', updated_at: '', publishable_key: 'pk_test_123',
      has_webhook_secret: true, webhook_status: 'enabled', webhook_events: [], webhook_events_out_of_date: false,
    } });
  });

  it('shows Update API keys for a connection and opens grouped, collapsed permission help', async () => {
    render(<StripeConnectionSettings />);
    const update = await screen.findByRole('button', { name: 'Update API keys' });
    fireEvent.click(update);

    expect(screen.getByLabelText('Secret Key')).toBeTruthy();
    const help = screen.getByText('Using a restricted key? Required permissions').closest('details');
    expect(help).toBeTruthy();
    expect(help!.open).toBe(false);
    fireEvent.click(within(help!).getByText('Using a restricted key? Required permissions'));
    await waitFor(() => expect(help!.open).toBe(true));
    expect(within(help!).getByText('webhooks')).toBeTruthy();
    expect(within(help!).getByText('core-payments')).toBeTruthy();
    expect(within(help!).getAllByText(/checked on first use/).length).toBeGreaterThan(0);
  });
});
