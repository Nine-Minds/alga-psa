import type Stripe from 'stripe';

import { getStripeService } from '../stripe/StripeService';

type AiCheckoutPurpose = 'ai-addon' | 'ai-topup';

function requireConfiguredValue(name: 'AI_ADDON_PRICE_ID'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function checkoutReturnBaseUrl(): string {
  const value = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL)?.trim();
  if (!value) {
    throw new Error('NEXT_PUBLIC_APP_URL or NEXTAUTH_URL is required for AI checkout');
  }
  return value.replace(/\/+$/, '');
}

function checkoutMetadata(
  tenantId: string,
  purpose: AiCheckoutPurpose,
): Stripe.MetadataParam {
  return {
    tenant_id: tenantId,
    deployment_type: 'hosted',
    purpose,
  };
}

function requireCheckoutUrl(session: Stripe.Checkout.Session): string {
  if (!session.url) {
    throw new Error('Stripe checkout session was created without a URL');
  }
  return session.url;
}

function checkoutRedirectUrls(): { success_url: string; cancel_url: string } {
  const accountUrl = `${checkoutReturnBaseUrl()}/msp/account`;
  return {
    success_url: `${accountUrl}?ai_checkout=success`,
    cancel_url: `${accountUrl}?ai_checkout=cancelled`,
  };
}

export async function createAiAddonCheckoutSession(
  tenantId: string,
): Promise<{ checkoutUrl: string }> {
  const stripeService = getStripeService();
  const [stripe, customer] = await Promise.all([
    stripeService.getStripeClient(),
    stripeService.getOrImportCustomer(tenantId),
  ]);
  const metadata = checkoutMetadata(tenantId, 'ai-addon');
  const session = await stripe.checkout.sessions.create({
    customer: customer.stripe_customer_external_id,
    mode: 'subscription',
    line_items: [{ price: requireConfiguredValue('AI_ADDON_PRICE_ID'), quantity: 1 }],
    payment_method_collection: 'always',
    subscription_data: { metadata },
    metadata,
    ...checkoutRedirectUrls(),
  });

  return { checkoutUrl: requireCheckoutUrl(session) };
}

export async function createAiTopupCheckoutSession(
  tenantId: string,
  packPriceId: string,
): Promise<{ checkoutUrl: string }> {
  const normalizedPackPriceId = packPriceId.trim();
  if (!normalizedPackPriceId) {
    throw new Error('packPriceId is required for AI top-up checkout');
  }

  const stripeService = getStripeService();
  const [stripe, customer] = await Promise.all([
    stripeService.getStripeClient(),
    stripeService.getOrImportCustomer(tenantId),
  ]);
  const metadata = checkoutMetadata(tenantId, 'ai-topup');
  const session = await stripe.checkout.sessions.create({
    customer: customer.stripe_customer_external_id,
    mode: 'payment',
    line_items: [{ price: normalizedPackPriceId, quantity: 1 }],
    payment_intent_data: {
      metadata,
      setup_future_usage: 'off_session',
    },
    metadata,
    ...checkoutRedirectUrls(),
  });

  return { checkoutUrl: requireCheckoutUrl(session) };
}
