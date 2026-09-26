import { redirect } from 'next/navigation';
import { completeClientPortalCardSetup } from '@alga-psa/client-portal/actions';

export default async function PaymentMethodSetupCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; returnTo?: string }>;
}) {
  const { session_id: sessionId, returnTo } = await searchParams;
  if (!sessionId) redirect('/client-portal/billing');
  const safeReturnTo = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/client-portal/billing';
  let completed = false;
  try { await completeClientPortalCardSetup(sessionId); completed = true; } catch { completed = false; }
  if (!completed) redirect('/client-portal/billing?cardSetup=error');
  redirect(`${safeReturnTo}${safeReturnTo.includes('?') ? '&' : '?'}cardSetup=success`);
}
