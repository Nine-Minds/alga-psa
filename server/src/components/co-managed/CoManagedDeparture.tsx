'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useProduct } from '@/context/ProductContext';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@alga-psa/ui/components/Card';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getCoManagedDepartureScreenAction, departCoManagedRelationshipAction } from '@/lib/actions/coManagedDepartureActions';

type Screen = Awaited<ReturnType<typeof getCoManagedDepartureScreenAction>>;
type Request = Parameters<typeof departCoManagedRelationshipAction>[0];

export function CoManagedDepartureEntry({ operationId }: { operationId?: string }) {
  const { productCode } = useProduct(), { t } = useTranslation('msp/licensing');
  if (productCode !== 'co_managed' && !operationId) return null;
  return <div className="mx-auto max-w-5xl px-6 pt-6"><Button id="co-departure-open" variant="outline" asChild>
    <Link href={`/msp/co-management/departure${operationId ? `?operationId=${encodeURIComponent(operationId)}` : ''}`}>
      {t('coManaged.departure.title')}
    </Link>
  </Button></div>;
}

export default function CoManagedDeparture({ operationId }: { operationId?: string }) {
  const { data: session } = useSession();
  return <DepartureContent key={`${session?.session_id}:${session?.user?.tenant}:${session?.user?.id}:${operationId}`} operationId={operationId} />;
}

function DepartureContent({ operationId }: { operationId?: string }) {
  const { t } = useTranslation('msp/licensing');
  const [screen, setScreen] = useState<Screen | null>(null);
  const [error, setError] = useState<'loadError' | 'endError' | null>(null);
  const [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  const command = useRef<Request | null>(null), generation = useRef(0), alive = useRef(true), submitting = useRef(false);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    setError(null); setBusy(true);
    try {
      const next = await getCoManagedDepartureScreenAction(operationId);
      if (!alive.current || current !== generation.current) return;
      setScreen(next);
      if (next.departed || (command.current && next.revision !== command.current.expectedRevision)) {
        command.current = null; setConfirm(false);
      }
    } catch { if (alive.current && current === generation.current) { setScreen(null); setConfirm(false); setError('loadError'); } }
    finally { if (alive.current && current === generation.current) setBusy(false); }
  }, [operationId]);
  useEffect(() => { alive.current = true; void reload(); return () => { alive.current = false; ++generation.current; }; }, [reload]);
  const end = async () => {
    if (submitting.current || busy || !screen || screen.departed) return;
    command.current ??= { provisioningOperationId: operationId, relationshipId: screen.relationshipId,
      expectedRevision: screen.revision, operationId: crypto.randomUUID() };
    submitting.current = true; setBusy(true); setError(null);
    try {
      const receipt = await departCoManagedRelationshipAction(command.current);
      if (!alive.current) return;
      setScreen({ ...screen, departed: true, revision: receipt.appliedRevision, closedAt: receipt.closedAt });
      setConfirm(false); command.current = null;
    } catch { if (alive.current) setError('endError'); }
    finally { submitting.current = false; if (alive.current) setBusy(false); }
  };
  return <div className="mx-auto max-w-3xl space-y-5 p-6 text-[rgb(var(--color-text-700))]">
    <Card><CardHeader><CardTitle>{t('coManaged.departure.title')}</CardTitle>
      <CardDescription>{t('coManaged.departure.description')}</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        {error && <p role="alert" className="text-destructive">{t(`coManaged.departure.${error}`)}</p>}
        {!screen && !error && <p role="status">{t('coManaged.loading')}</p>}
        {screen && <>
          <p className="font-medium">{screen.counterpartName}</p>
          {screen.departed ? <p role="status">{t('coManaged.departure.completed')}</p> : <p>{t('coManaged.departure.immediate')}</p>}
          <p>{t('coManaged.departure.preserved')}</p>
          <p>{t('coManaged.departure.archive')}</p>
          <p className="text-sm text-muted-foreground">{t('coManaged.departure.billing')}</p>
          {screen.side === 'customer' && <Button id="co-departure-upgrade" variant="outline" asChild>
            <Link href="/msp/co-management/upgrade">{t('coManaged.upgrade.title')}</Link>
          </Button>}
          {screen.side === 'customer' && <Button id="co-departure-export" variant="outline" asChild>
            <Link href="/msp/co-management/export">{t('coManaged.portableExport.title')}</Link>
          </Button>}
          {!screen.departed && <Button id="co-departure-review" variant="destructive" disabled={busy}
            onClick={() => setConfirm(true)}>{t('coManaged.departure.review')}</Button>}
        </>}
        <Button id="co-departure-refresh" variant="outline" disabled={busy} onClick={() => void reload()}>{t('coManaged.upgrade.refresh')}</Button>
      </CardContent>
    </Card>
    <ConfirmationDialog id="co-departure-confirm" isOpen={confirm} onClose={() => { if (!busy) setConfirm(false); }} onConfirm={end}
      title={t('coManaged.departure.confirmTitle')} message={t('coManaged.departure.confirmMessage', { name: screen?.counterpartName || '' })}
      confirmLabel={t('coManaged.departure.end')} cancelLabel={t('coManaged.upgrade.cancel')} isConfirming={busy} />
  </div>;
}
