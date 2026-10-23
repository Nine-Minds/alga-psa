/**
 * Server-internal bridge from the clients package to the EE auto-pay services.
 *
 * Clients must not depend on @alga-psa/billing (billing already reaches clients
 * through notifications -> telephony), so this loads @enterprise/lib/payments
 * directly, the same way entraClientSyncActions reaches its EE workflow client.
 *
 * These functions take a caller-supplied tenantId and perform NO authorization.
 * They must never live in a 'use server' module: every export of such a module is
 * a publicly callable server action. Callers (withAuth-wrapped actions) are
 * responsible for authenticating the user and checking permissions first.
 */

function isEnterpriseBuild(): boolean {
  return process.env.EDITION === 'ee' || process.env.NEXT_PUBLIC_EDITION === 'enterprise';
}

// LEVERAGE: pattern ee-payments-loader — same dynamic @enterprise/lib/payments loader as
// packages/billing/src/services/autopayBridge.ts; duplicated here to avoid a clients -> billing edge.
async function loadEnterpriseAutopay(): Promise<{ AutopayService?: any; SavedPaymentMethodService?: any } | null> {
  if (!isEnterpriseBuild()) return null;
  const mod = await import('@enterprise/lib/payments');
  return {
    AutopayService: (mod as any).AutopayService,
    SavedPaymentMethodService: (mod as any).SavedPaymentMethodService,
  };
}

export async function startSavedPaymentMethodSetup(tenantId: string, clientId: string, billingProfileId: string, returnTo?: string, publicConfirmation = false): Promise<{ url: string } | null> {
  const ee = await loadEnterpriseAutopay();
  if (!ee?.SavedPaymentMethodService) return null;
  return (await ee.SavedPaymentMethodService.create(tenantId)).startSetup(clientId, billingProfileId, returnTo, publicConfirmation);
}

export async function getAutopayProfileOverview(tenantId: string, billingProfileId: string): Promise<Record<string, unknown> | null> {
  const ee = await loadEnterpriseAutopay();
  if (!ee?.AutopayService) return null;
  return (await ee.AutopayService.create(tenantId)).getProfileOverview(billingProfileId);
}

export async function enrollBillingProfileAutopay(tenantId: string, billingProfileId: string, paymentMethodId: string, authorization: Record<string, unknown>): Promise<boolean> {
  const ee = await loadEnterpriseAutopay();
  if (!ee?.AutopayService) return false;
  await (await ee.AutopayService.create(tenantId)).enroll(billingProfileId, paymentMethodId, authorization);
  return true;
}

export async function disableBillingProfileAutopay(tenantId: string, billingProfileId: string, reason: string, actor: string | null): Promise<boolean> {
  const ee = await loadEnterpriseAutopay();
  if (!ee?.AutopayService) return false;
  await (await ee.AutopayService.create(tenantId)).disenroll(billingProfileId, reason, actor);
  return true;
}
