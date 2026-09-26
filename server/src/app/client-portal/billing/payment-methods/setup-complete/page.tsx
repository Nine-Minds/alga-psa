import { redirect } from 'next/navigation';
import { completeClientPortalCardSetup } from '@alga-psa/client-portal/actions';

export default async function PaymentMethodSetupCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; returnTo?: string }>;
}) {
  const { session_id: sessionId, returnTo } = await searchParams;
  if (!sessionId) redirect('/client-portal/billing');
  await completeClientPortalCardSetup(sessionId);
  const safeReturnTo = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/client-portal/billing';
  redirect(safeReturnTo);
}
