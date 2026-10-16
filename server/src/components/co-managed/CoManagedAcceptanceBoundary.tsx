'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { acceptCustomerCoManagedRelationship, getCustomerCoManagedAcceptance } from '@/lib/actions/coManagedAcceptanceActions';

/** Mounted inside the release flag boundary. Activation is authoritative in the
 * domain; this screen only presents the initial customer approval experience. */
export default function CoManagedAcceptanceBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation('msp/licensing');
  const [state, setState] = useState<Awaited<ReturnType<typeof getCustomerCoManagedAcceptance>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const reload = useCallback(async () => {
    setError(false); setState(null);
    try { setState(await getCustomerCoManagedAcceptance()); }
    catch { setError(true); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const accept = async () => {
    if (state?.state !== 'pending_acceptance' || !state.canAccept) return;
    setBusy(true); setError(false);
    try {
      await acceptCustomerCoManagedRelationship({ relationshipId: state.relationshipId,
        revision: state.revision, scopeFingerprint: state.scopeFingerprint });
      await reload();
    } catch {
      // Keep the reviewed terms visible. A failed/stale approval never silently
      // switches to another scope and retries the acceptance.
      setError(true);
    } finally { setBusy(false); }
  };
  if (state?.state === 'active' || state?.state === 'terminated') return <>{children}</>;
  return <div className="mx-auto max-w-3xl p-6">
    <Card><CardHeader><CardTitle>{t('coManaged.acceptance.title')}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {error && <p role="alert" className="text-destructive">{t('coManaged.acceptance.error')}</p>}
        {!state && !error && <p role="status">{t('coManaged.loading')}</p>}
        {state?.state === 'unavailable' && <p>{t('coManaged.acceptance.preparing')}</p>}
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
          {state.canAccept ? <Button id="co-managed-accept-relationship" onClick={() => void accept()} disabled={busy || error}>
            {t('coManaged.acceptance.accept')}
          </Button> : <p>{t('coManaged.acceptance.administratorRequired')}</p>}
        </>}
        {(error || state?.state === 'unavailable' || (state?.state === 'pending_acceptance' && !state.canAccept)) && <Button id="co-managed-refresh-acceptance" variant="outline"
          onClick={() => void reload()} disabled={busy}>{t('coManaged.acceptance.refresh')}</Button>}
      </CardContent>
    </Card>
  </div>;
}
