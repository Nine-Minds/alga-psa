// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StripeConnectionSettings from '@ee/components/settings/integrations/StripeConnectionSettings';
import StripeCustomerImport from '@ee/components/settings/billing/StripeCustomerImport';

const mocks = vi.hoisted(() => ({
  getPaymentConfigAction: vi.fn(),
  previewStripeImportAction: vi.fn(),
  proposeStripeImportMatchesAction: vi.fn(),
  executeStripeImportAction: vi.fn(),
}));

vi.mock('@ee/lib/actions/payment-actions', () => ({
  getPaymentConfigAction: mocks.getPaymentConfigAction,
  connectStripeAction: vi.fn(),
  disconnectStripeAction: vi.fn(),
  testStripeConnectionAction: vi.fn(),
  retryStripeWebhookConfigurationAction: vi.fn(),
}));

vi.mock('@ee/lib/actions/stripe-import-actions', () => ({
  previewStripeImportAction: mocks.previewStripeImportAction,
  proposeStripeImportMatchesAction: mocks.proposeStripeImportMatchesAction,
  executeStripeImportAction: mocks.executeStripeImportAction,
}));

const config = (is_enabled: boolean) => ({
  success: true,
  data: {
    provider_type: 'stripe', is_enabled, is_default: true, created_at: '', updated_at: '',
    publishable_key: 'pk_test_123456789', has_webhook_secret: true, webhook_status: 'enabled', webhook_events: [],
  },
});

describe('StripeConnectionSettings import mount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the customer import card when Stripe is enabled', async () => {
    mocks.getPaymentConfigAction.mockResolvedValue(config(true));
    const { container } = render(<StripeConnectionSettings />);
    await waitFor(() => expect(container.querySelector('#stripe-customer-import-card')).not.toBeNull());
    expect(screen.getByText('Import existing Stripe customers')).toBeTruthy();
  });

  it('omits the customer import card when Stripe is not enabled', async () => {
    mocks.getPaymentConfigAction.mockResolvedValue(config(false));
    const { container } = render(<StripeConnectionSettings />);
    await waitFor(() => expect(container.querySelector('#connect-stripe-button')).not.toBeNull());
    expect(container.querySelector('#stripe-customer-import-card')).toBeNull();
  });
});

describe('StripeCustomerImport assisted + ambiguous merge', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps matched rows when an ambiguous row is added and re-previewed', async () => {
    mocks.proposeStripeImportMatchesAction.mockResolvedValue({
      success: true,
      data: {
        proposals: [{ clientId: 'client-1', billingProfileId: 'profile-1', customerId: 'cus_matched' }],
        ambiguous: [{ customerId: 'cus_amb', matchedBy: 'email', reason: 'multiple-clients' }],
        truncated: false,
      },
    });
    mocks.previewStripeImportAction.mockResolvedValue({ success: true, data: { plan: { rows: [] }, digest: 'd' } });

    const { container } = render(<StripeCustomerImport />);
    fireEvent.click(container.querySelector('#stripe-import-open')!);
    fireEvent.click(container.querySelector('#stripe-import-assisted')!);
    await waitFor(() => expect(container.querySelector('#stripe-import-add-ambiguous-cus_amb')).not.toBeNull());
    expect(mocks.previewStripeImportAction).toHaveBeenCalledTimes(1);
    expect(mocks.previewStripeImportAction.mock.calls[0][0].rows.map((r: any) => r.customerId)).toEqual(['cus_matched']);

    fireEvent.click(container.querySelector('#stripe-import-add-ambiguous-cus_amb')!);
    fireEvent.click(container.querySelector('#stripe-import-preview')!);
    await waitFor(() => expect(mocks.previewStripeImportAction).toHaveBeenCalledTimes(2));
    const rows = mocks.previewStripeImportAction.mock.calls[1][0].rows;
    expect(rows.map((r: any) => r.customerId)).toEqual(['cus_matched', 'cus_amb']);
    expect(rows[0]).toMatchObject({ client: 'client-1', profile: 'profile-1' });
  });
});
