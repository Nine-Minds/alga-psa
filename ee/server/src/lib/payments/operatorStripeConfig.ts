import Stripe from 'stripe';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';

export interface OperatorStripeConfig {
  secretKey: string;
  webhookSecret: string;
  publishableKey: string;
}

export async function getOperatorStripeSecretKey(): Promise<string | null> {
  const secretProvider = await getSecretProviderInstance();
  return await secretProvider.getAppSecret('stripe_secret_key') || process.env.STRIPE_SECRET_KEY || null;
}

/** Platform Stripe credentials are reserved for explicitly authorized operator flows. */
export async function getOperatorStripeConfig(): Promise<OperatorStripeConfig | null> {
  const secretProvider = await getSecretProviderInstance();
  const secretKey = await secretProvider.getAppSecret('stripe_secret_key') || process.env.STRIPE_SECRET_KEY;
  const webhookSecret = await secretProvider.getAppSecret('stripe_payment_webhook_secret') ||
    await secretProvider.getAppSecret('stripe_webhook_secret') || process.env.STRIPE_WEBHOOK_SECRET;
  const publishableKey = await secretProvider.getAppSecret('stripe_publishable_key') || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!secretKey || !webhookSecret || !publishableKey) return null;
  return { secretKey, webhookSecret, publishableKey };
}

export async function createOperatorStripeClient(): Promise<Stripe> {
  const secretKey = await getOperatorStripeSecretKey();
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY not found in secrets or environment');
  return new Stripe(secretKey, { apiVersion: '2024-12-18.acacia' as any, typescript: true });
}
