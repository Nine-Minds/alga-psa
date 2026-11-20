import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  STRIPE_PERMISSION_MANIFEST,
  findUncoveredStripeOperations,
  getStripePermissionId,
  isValidStripeSecretKey,
  withStripePermissionErrors,
} from '../../../lib/payments/stripePermissionManifest';

function assertManifestTableParity(document: string) {
  const rows = [...document.matchAll(/^\|\s*(Webhooks|Core payments|Saved cards and auto-pay|Customer import)\s*\|\s*`([^`]+)`\s*\|\s*(Read|Write)\s*\|\s*([^|]+)\|$/gm)];
  const capabilityName: Record<string, string> = {
    webhooks: 'Webhooks', 'core-payments': 'Core payments', 'saved-cards-auto-pay': 'Saved cards and auto-pay', 'customer-import': 'Customer import',
  };
  const documentedGroups = new Set(rows.map(([, capability, permissionId]) => `${capability}|${permissionId}`));
  const expectedGroups = new Set(STRIPE_PERMISSION_MANIFEST.flatMap((permission) => permission.capabilities.map((capability) => `${capabilityName[capability]}|${permission.id}`)));
  expect([...documentedGroups].sort()).toEqual([...expectedGroups].sort());
  for (const permission of STRIPE_PERMISSION_MANIFEST) {
    const documentedOperations = new Set(rows.filter(([, , permissionId]) => permissionId === permission.id)
      .flatMap((row) => [...row[4].matchAll(/`([^`]+)`/g)].map((match) => match[1])));
    expect([...documentedOperations].sort()).toEqual([...permission.operations].sort());
    expect(rows.filter(([, , permissionId]) => permissionId === permission.id).every((row) => row[3].toLowerCase() === (permission.access === 'read' ? 'read' : 'write'))).toBe(true);
  }
}

describe('Stripe restricted key manifest', () => {
  it.each(['sk_live_test123', 'sk_test_test123', 'rk_live_test123', 'rk_test_test123'])(
    'accepts %s', (key) => expect(isValidStripeSecretKey(key)).toBe(true),
  );
  it.each(['pk_test_123', '', '   ', 'sk_live_', 'rk_live_bad-key', 'random'])('rejects %j', (key) => {
    expect(isValidStripeSecretKey(key)).toBe(false);
  });

  it('translates the Stripe invalid request error shape while preserving other error types', () => {
    expect(getStripePermissionId({
      type: 'StripeInvalidRequestError', code: 'parameter_invalid_empty',
      message: 'This API key does not have permission webhook_write.',
    })).toBe('webhook_write');
    expect(getStripePermissionId({ type: 'StripeAuthenticationError', message: 'Invalid key' })).toBeNull();
    expect(getStripePermissionId({ type: 'StripeConnectionError', message: 'timeout' })).toBeNull();
    expect(getStripePermissionId({ type: 'StripePermissionError', statusCode: 403, message: 'Permission denied' }, 'setupIntents.list')).toBe('setup_intent_read');
    expect(STRIPE_PERMISSION_MANIFEST.find(({ id }) => id === 'setup_intent_read')?.capabilities).toEqual(['saved-cards-auto-pay', 'customer-import']);
  });

  it('translates permission errors at deferred nested SDK operations while preserving auth errors', async () => {
    const client = withStripePermissionErrors({
      checkout: { sessions: { create: async () => { throw { type: 'StripePermissionError', statusCode: 403, message: 'Forbidden.' }; } } },
      accounts: { retrieve: async () => { throw { type: 'StripeAuthenticationError', message: 'Bad key' }; } },
    });
    await expect(client.checkout.sessions.create()).rejects.toThrow('core-payments');
    await expect(client.accounts.retrieve()).rejects.toMatchObject({ type: 'StripeAuthenticationError' });
  });

  it('covers Stripe operations in each tenant-key SDK file and detects an uncovered call', () => {
    const root = resolve(process.cwd(), 'src/lib');
    for (const file of [
      resolve(root, 'actions/payment-actions.ts'),
      resolve(root, 'payments/StripePaymentProvider.ts'),
      resolve(root, 'payments/stripeWebhookEvents.ts'),
    ]) {
      expect(findUncoveredStripeOperations(readFileSync(file, 'utf8'))).toEqual([]);
    }
    expect(findUncoveredStripeOperations('await stripe.refunds.create({});')).toEqual(['refunds.create']);
    expect(findUncoveredStripeOperations('await (await this.getStripe()).coupons.list({ limit: 1 });')).toEqual(['coupons.list']);
  });

  it('keeps the repository setup guide permission table in parity with the manifest', () => {
    const guide = readFileSync(resolve(process.cwd(), '../../docs/stripe-integration-setup.md'), 'utf8');
    assertManifestTableParity(guide);
    const publishedPath = process.env.STRIPE_PUBLISHED_DOC_PATH;
    if (publishedPath) assertManifestTableParity(readFileSync(resolve(process.cwd(), publishedPath), 'utf8'));
  });

  it('ships the updated secret-key strings in all supported locales', () => {
    const localesRoot = resolve(process.cwd(), '../../server/public/locales');
    for (const locale of ['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv']) {
      const billing = JSON.parse(readFileSync(resolve(localesRoot, `${locale}/msp/billing-settings.json`), 'utf8'));
      const integrations = JSON.parse(readFileSync(resolve(localesRoot, `${locale}/msp/integrations.json`), 'utf8'));
      expect(billing.payment.messages.invalidSecretKey).not.toMatch(/sk_$/i);
      expect(billing.payment.stripe.connectForm.secretKeyPlaceholder).toContain('rk_live_');
      expect(billing.payment.stripe.connectForm.permissionHelp).toBeTruthy();
      expect(integrations.integrations.stripe.form.secretKeyPlaceholder).toContain('rk_live_');
      expect(integrations.integrations.stripe.errors.secretKeyFormat).not.toMatch(/sk_\s*$/);
      expect(integrations.integrations.stripe.form.checkedOnFirstUse).toBeTruthy();
      expect(integrations.integrations.stripe.actions.updateApiKeys).toBeTruthy();
    }
  });
});
