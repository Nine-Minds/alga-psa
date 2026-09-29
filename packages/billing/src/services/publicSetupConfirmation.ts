export type SetupInspection = { tenantId: string; clientId: string; billingProfileId: string; status: string };

export async function verifyAndCompletePublicSetup(
  expectedTenantId: string,
  sessionId: string,
  inspect: (tenantId: string, sessionId: string) => Promise<SetupInspection | null>,
  complete: (tenantId: string, sessionId: string) => Promise<{ paymentMethodId: string } | null>,
  expectedClientId?: string,
  expectedBillingProfileId?: string,
): Promise<boolean> {
  const setup = await inspect(expectedTenantId, sessionId);
  if (!setup || setup.tenantId !== expectedTenantId || !setup.clientId || !setup.billingProfileId || setup.status !== 'succeeded'
    || (expectedClientId && setup.clientId !== expectedClientId)
    || (expectedBillingProfileId && setup.billingProfileId !== expectedBillingProfileId)) return false;
  const completed = await complete(expectedTenantId, sessionId);
  return !!completed?.paymentMethodId;
}
