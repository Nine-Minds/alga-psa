import { describe, expect, it } from 'vitest';

import {
  defaultBillingSettingsSchema,
  updateBillingSettingsSchema,
} from '../../../lib/api/schemas/financialSchemas';

describe('default billing settings cadence-owner schema', () => {
  it('exposes client cadence rollout metadata on default billing settings responses', () => {
    const parsed = defaultBillingSettingsSchema.parse({
      tenant: '11111111-1111-1111-1111-111111111111',
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      enable_credit_expiration: true,
      credit_expiration_days: 365,
      credit_expiration_notification_days: [30, 7, 1],
      created_at: '2026-03-17T00:00:00.000Z',
      updated_at: '2026-03-17T00:00:00.000Z',
    });

    expect(parsed.default_recurring_cadence_owner).toBe('client');
    expect(parsed.recurring_cadence_rollout_state).toBe('client_only');
    expect(parsed.recurring_cadence_rollout_message).toContain('Contract-owned cadence is not enabled');
  });

  it('rejects contract cadence as a writable billing-settings default during rollout', () => {
    expect(() =>
      updateBillingSettingsSchema.parse({
        default_recurring_cadence_owner: 'contract',
      }),
    ).toThrow();
  });
});
