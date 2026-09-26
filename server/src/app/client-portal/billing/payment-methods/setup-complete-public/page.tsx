import { completeSavedPaymentMethodSetup, inspectSavedPaymentMethodSetup, resolvePublicSavedPaymentMethodSetupTenant } from '@alga-psa/billing/services/autopayBridge';
import { verifyAndCompletePublicSetup } from '@alga-psa/billing/services';
import { Card } from '@alga-psa/ui/components/Card';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export default async function PublicCardSetupCompletePage({ searchParams }: { searchParams: Promise<{ tenantContext?: string; session_id?: string }> }) {
  const { tenantContext, session_id: sessionId } = await searchParams;
  const { t } = await getServerTranslation(undefined, 'client-portal');
  let saved = false;
  try {
    if (!tenantContext || !sessionId) throw new Error('Missing setup context');
    const expected = await resolvePublicSavedPaymentMethodSetupTenant(tenantContext);
    if (!expected) throw new Error('Missing tenant context');
    const tenantId = expected.tenantId;
    saved = await verifyAndCompletePublicSetup(tenantId, sessionId, inspectSavedPaymentMethodSetup, completeSavedPaymentMethodSetup, expected.clientId, expected.billingProfileId);
  } catch {
    saved = false;
  }
  return <main className="mx-auto max-w-lg p-6"><Card className="p-6"><h1 className="text-xl font-semibold">{saved ? t('account.billing.publicCardSetup.saved', { defaultValue: 'Card saved' }) : t('account.billing.publicCardSetup.failed', { defaultValue: 'We could not save your card' })}</h1><p className="mt-2 text-sm text-muted-foreground">{saved ? t('account.billing.publicCardSetup.savedDescription', { defaultValue: 'Your card is ready for future payments.' }) : t('account.billing.publicCardSetup.failedDescription', { defaultValue: 'The setup could not be verified. Please ask your billing provider for a new link.' })}</p></Card></main>;
}
