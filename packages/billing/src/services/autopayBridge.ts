import logger from '@alga-psa/core/logger';

/**
 * Server-internal bridge from CE packages to the EE saved-card / auto-pay services.
 *
 * These functions take a caller-supplied tenantId and perform NO authorization.
 * They must never live in a 'use server' module: every export of such a module is
 * a publicly callable server action. Callers (withAuth-wrapped actions, the
 * finalize hook) are responsible for authenticating the user and checking
 * permissions before calling in.
 */

function isEnterpriseBuild(): boolean {
  return process.env.EDITION === 'ee' || process.env.NEXT_PUBLIC_EDITION === 'enterprise';
}

// LEVERAGE: pattern ee-payments-loader — same dynamic @enterprise/lib/payments loader as
// actions/paymentActions.ts, webhooks/stripe/payments.ts and invoiceTerminalStatusHandlers.ts.
async function loadEnterpriseAutopay(): Promise<{ AutopayService?: any; SavedPaymentMethodService?: any } | null> {
  if (!isEnterpriseBuild()) return null;
  const mod = await import('@enterprise/lib/payments');
  return {
    AutopayService: (mod as any).AutopayService,
    SavedPaymentMethodService: (mod as any).SavedPaymentMethodService,
  };
}

export type InvoiceAutopayContext = { scheduledFor: string; brand: string | null; last4: string; status: string };

export async function startSavedPaymentMethodSetup(tenantId: string, clientId: string, billingProfileId: string, returnTo?: string): Promise<{ url: string } | null> {
  const ee = await loadEnterpriseAutopay();
  if (!ee?.SavedPaymentMethodService) return null;
  return (await ee.SavedPaymentMethodService.create(tenantId)).startSetup(clientId, billingProfileId, returnTo);
}

export async function inspectSavedPaymentMethodSetup(tenantId: string, sessionId: string): Promise<{ clientId: string; billingProfileId: string; tenantId: string; status: string; paymentMethodId: string | null } | null> {
  const ee = await loadEnterpriseAutopay();
  if (!ee?.SavedPaymentMethodService) return null;
  return (await ee.SavedPaymentMethodService.create(tenantId)).inspectSetup(sessionId);
}

export async function completeSavedPaymentMethodSetup(tenantId: string, sessionId: string): Promise<{ paymentMethodId: string } | null> {
  const ee = await loadEnterpriseAutopay();
  if (!ee?.SavedPaymentMethodService) return null;
  return (await ee.SavedPaymentMethodService.create(tenantId)).completeSetup(sessionId);
}

export async function removeSavedPaymentMethod(tenantId: string, paymentMethodId: string): Promise<boolean> {
  const ee = await loadEnterpriseAutopay();
  if (!ee?.SavedPaymentMethodService) return false;
  await (await ee.SavedPaymentMethodService.create(tenantId)).removeMethod(paymentMethodId);
  return true;
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

/** Caller must already have restricted invoiceIds to what the user may see. */
export async function getInvoiceAutopayContextsForTenant(tenantId: string, invoiceIds: string[]): Promise<Record<string, InvoiceAutopayContext>> {
  if (invoiceIds.length === 0) return {};
  const ee = await loadEnterpriseAutopay();
  if (!ee?.AutopayService) return {};
  return (await ee.AutopayService.create(tenantId)).getInvoiceAutopayContexts(invoiceIds);
}

/** Best-effort finalize producer. It is intentionally isolated from finalize and never throws. */
export async function enqueueInvoiceAutopay(_knex: unknown, tenantId: string, invoiceId: string): Promise<void> {
  try {
    const ee = await loadEnterpriseAutopay();
    if (!ee?.AutopayService) return;
    await ee.AutopayService.enqueueInvoiceAutopay(tenantId, invoiceId);
  } catch (error) {
    logger.error('[billing/autopayBridge] Failed to enqueue invoice auto-pay', { tenantId, invoiceId, error });
  }
}
