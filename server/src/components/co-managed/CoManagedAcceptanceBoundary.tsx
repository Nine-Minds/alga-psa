'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { acceptCustomerCoManagedRelationship, declineCustomerCoManagedRelationship,
  getCustomerCoManagedAcceptance } from '@/lib/actions/coManagedAcceptanceActions';

type Review = Awaited<ReturnType<typeof getCustomerCoManagedAcceptance>>;

/** Mounted inside the capability boundary. Activation is authoritative in the
 * domain; this screen only presents the initial customer approval experience. */
export default function CoManagedAcceptanceBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation('msp/licensing');
  const router = useRouter();
  const [state, setState] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const reload = useCallback(async () => {
    setError(false); setState(null);
    try { setState(await getCustomerCoManagedAcceptance()); }
    catch { setError(true); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const answer = async (action: typeof acceptCustomerCoManagedRelationship | typeof declineCustomerCoManagedRelationship,
    landOnTickets = false) => {
    if (state?.state !== 'pending_acceptance' || !state.canAccept) return;
    setBusy(true); setError(false);
    try {
      await action({ relationshipId: state.relationshipId, revision: state.revision, scopeFingerprint: state.scopeFingerprint });
      setConfirmingDecline(false);
      await reload();
      // Only a fresh acceptance lands on the queue; an ordinary visit keeps its route.
      if (landOnTickets) router.replace('/msp/tickets');
    } catch {
      // Keep the reviewed terms visible. A failed/stale answer never silently
      // switches to another scope and retries.
      setError(true); setConfirmingDecline(false);
    } finally { setBusy(false); }
  };

  if (state?.state === 'active' || state?.state === 'terminated') return <>{children}</>;
  return <div className="mx-auto max-w-3xl p-6">
    <Card><CardHeader><CardTitle>{t('coManaged.acceptance.title')}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {error && <p role="alert" className="text-destructive">{t('coManaged.acceptance.error')}</p>}
        {!state && !error && <p role="status">{t('coManaged.loading')}</p>}
        {state?.state === 'unavailable' && <p>{t('coManaged.acceptance.preparing')}</p>}
        {state?.state === 'cancelled' && <p>{t('coManaged.acceptance.cancelled', { sponsor: state.sponsorName })}</p>}
        {state?.state === 'destination_unavailable' && <p>{t('coManaged.acceptance.destinationUnavailable', { sponsor: state.sponsorName })}</p>}
        {state?.state === 'pending_acceptance' && <>
          <p>{t('coManaged.acceptance.description', { sponsor: state.scope.sponsorName })}</p>
          <p>{t(state.scope.visibilityMode === 'board_scope'
            ? 'coManaged.acceptance.boardScope' : 'coManaged.acceptance.escalationOnly')}</p>
          {state.scope.boards.length > 0 && <ul className="list-disc space-y-1 pl-6">
            {state.scope.boards.map(board => <li key={board.id}>{board.name} — {t(board.canCollaborate
              ? 'coManaged.acceptance.collaborate' : 'coManaged.acceptance.readOnly')}</li>)}
          </ul>}
          <p>{t('coManaged.acceptance.destination', { board: state.scope.escalationBoard.name })}</p>
          <p>{t('coManaged.acceptance.initialLimits')}</p>
          <p>{t('coManaged.acceptance.control')}</p>
          {state.canAccept ? <div className="flex flex-wrap gap-2">
            <Button id="co-managed-accept-relationship" onClick={() => void answer(acceptCustomerCoManagedRelationship, true)} disabled={busy || error}>
              {t('coManaged.acceptance.accept')}
            </Button>
            <Button id="co-managed-decline-relationship" variant="outline" onClick={() => setConfirmingDecline(true)} disabled={busy || error}>
              {t('coManaged.acceptance.decline')}
            </Button>
          </div> : <p>{t('coManaged.acceptance.administratorRequired')}</p>}
        </>}
        {(error || state?.state === 'unavailable' || state?.state === 'destination_unavailable' || (state?.state === 'pending_acceptance' && !state.canAccept)) && <Button id="co-managed-refresh-acceptance" variant="outline"
          onClick={() => void reload()} disabled={busy}>{t('coManaged.acceptance.refresh')}</Button>}
        {/* This screen replaces the whole MSP shell, header and user menu included. */}
        <Button id="co-managed-acceptance-sign-out" variant="ghost" disabled={busy}
          onClick={() => void signOut({ callbackUrl: '/auth/msp/signin', redirect: true })}>{t('coManaged.acceptance.signOut')}</Button>
      </CardContent>
    </Card>
    <Dialog id="co-managed-decline-confirm" isOpen={confirmingDecline} onClose={() => { if (!busy) setConfirmingDecline(false); }}
      title={t('coManaged.acceptance.declineTitle')}>
      <div className="space-y-4">
        <p>{t('coManaged.acceptance.declineDescription')}</p>
        <div className="flex gap-2">
          <Button id="co-managed-decline-confirm-button" disabled={busy} onClick={() => void answer(declineCustomerCoManagedRelationship)}>
            {t('coManaged.acceptance.confirmDecline')}
          </Button>
          <Button id="co-managed-decline-keep" variant="outline" disabled={busy} onClick={() => setConfirmingDecline(false)}>
            {t('coManaged.acceptance.keepReviewing')}
          </Button>
        </div>
      </div>
    </Dialog>
  </div>;
}
