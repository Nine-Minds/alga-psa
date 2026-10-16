import { redirect } from 'next/navigation';
import { completeClientPortalCardSetup } from '@alga-psa/client-portal/actions';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('clientPortal.billing.paymentMethods.setupComplete.title', { defaultValue: 'Card Setup' }) };
}

export default async function PaymentMethodSetupCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; returnTo?: string }>;
}) {
  const { session_id: sessionId, returnTo } = await searchParams;
  if (!sessionId) redirect('/client-portal/billing');
  const safeReturnTo = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/client-portal/billing';
  let completed = false;
  try {
    const result = await completeClientPortalCardSetup(sessionId);
    // withAuth actions may return an action error object instead of throwing.
    completed = !!result && typeof result === 'object' && 'success' in result && result.success === true;
  } catch {
    completed = false;
  }
  if (!completed) redirect('/client-portal/billing?cardSetup=error');
  redirect(`${safeReturnTo}${safeReturnTo.includes('?') ? '&' : '?'}cardSetup=success`);
}
