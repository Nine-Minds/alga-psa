'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useProduct } from '@/context/ProductContext';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@alga-psa/ui/components/Card';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getCoManagedUpgradeScreenAction, startCoManagedUpgradeAction } from '@ee/lib/actions/coManagedUpgradeActions';

type Screen = Awaited<ReturnType<typeof getCoManagedUpgradeScreenAction>>;
type Request = Parameters<typeof startCoManagedUpgradeAction>[0];

export function CoManagedUpgradeEntry() {
  const { productCode } = useProduct();
  const { t } = useTranslation('msp/licensing');
  if (productCode !== 'co_managed') return null;
  return <div className="mx-auto max-w-5xl px-6 pt-6"><Button id="co-upgrade-open" variant="outline" asChild>
    <Link href="/msp/co-management/upgrade">{t('coManaged.upgrade.title')}</Link>
  </Button></div>;
}

export default function CoManagedUpgrade() {
  const { data: session } = useSession();
  return <UpgradeContent key={`${session?.user?.tenant}:${session?.user?.id}`} />;
}

function UpgradeContent() {
  const { t } = useTranslation('msp/licensing');
  const { update } = useSession(), router = useRouter();
  const [screen, setScreen] = useState<Screen | null>(null);
  const [error, setError] = useState<'loadError' | 'startError' | null>(null);
  const [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  const command = useRef<Request | null>(null), generation = useRef(0), alive = useRef(true);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    setError(null);
    try {
      const next = await getCoManagedUpgradeScreenAction();
      if (!alive.current || current !== generation.current) return;
      setScreen(next);
      if (next.state === 'eligible' && command.current && next.revision !== command.current.expectedRevision) {
        command.current = null; setConfirm(false);
      }
    } catch { if (alive.current && current === generation.current) setError('loadError'); }
  }, []);
  useEffect(() => { alive.current = true; void reload(); return () => { alive.current = false; ++generation.current; }; }, [reload]);
  useEffect(() => {
    if (screen?.state !== 'eligible' || screen.progress !== 'running') return;
    const timer = setTimeout(() => void reload(), 3000);
    return () => clearTimeout(timer);
  }, [screen, reload]);
  const start = async () => {
    if (busy || screen?.state !== 'eligible' || !screen.entitlementReady) return;
    command.current ??= { relationshipId: screen.relationshipId, expectedRevision: screen.revision, operationId: crypto.randomUUID() };
    setBusy(true); setError(null);
    try {
      const result = await startCoManagedUpgradeAction(command.current);
      if (!alive.current) return;
      if (!result.completed && !result.enqueued) throw new Error('Upgrade could not be scheduled');
      setConfirm(false);
      await reload();
    } catch { if (alive.current) setError('startError'); }
    finally { if (alive.current) setBusy(false); }
  };
  const openPsa = async () => {
    setBusy(true); setError(null);
    try { await update(); if (alive.current) { router.push('/msp/dashboard'); router.refresh(); } }
    catch { if (alive.current) setError('loadError'); }
    finally { if (alive.current) setBusy(false); }
  };
  return <div className="mx-auto max-w-3xl space-y-5 p-6 text-[rgb(var(--color-text-700))]">
    <Card><CardHeader><CardTitle>{t('coManaged.upgrade.title')}</CardTitle>
      <CardDescription>{t('coManaged.upgrade.description')}</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        {error && <p role="alert" className="text-destructive">{t(`coManaged.upgrade.${error}`)}</p>}
        {!screen && !error && <p role="status">{t('coManaged.loading')}</p>}
        {screen?.state === 'completed' ? <>
          <p role="status">{t('coManaged.upgrade.completed')}</p>
          <Button id="co-upgrade-open-psa" disabled={busy} onClick={() => void openPsa()}>{t('coManaged.upgrade.openPsa')}</Button>
        </> : screen?.state === 'eligible' && <>
          <p>{t('coManaged.upgrade.preserved')}</p>
          <p>{t(screen.departed ? 'coManaged.upgrade.alreadyDeparted' : 'coManaged.upgrade.trustEnds')}</p>
          <p className="font-medium">{t('coManaged.upgrade.seats', { count: screen.seatsRequired })}</p>
          {screen.selfHosted && <p className="text-sm text-muted-foreground">{t('coManaged.upgrade.hosting')}</p>}
          {!screen.entitlementReady && <div className="space-y-3 rounded-md border border-[rgb(var(--color-border-200))] p-4">
            <p>{t(screen.selfHosted ? 'coManaged.upgrade.licenseRequired' : 'coManaged.upgrade.subscriptionRequired')}</p>
            {screen.selfHosted && <Button id="co-upgrade-license" variant="outline" asChild>
              <Link href="/msp/licenses">{t('coManaged.upgrade.manageLicense')}</Link>
            </Button>}
          </div>}
          {screen.progress === 'running' && <p role="status">{t('coManaged.upgrade.running')}</p>}
          {screen.progress === 'failed' && <p role="alert">{t('coManaged.upgrade.failed')}</p>}
          {screen.progress === 'unavailable' && <p role="alert">{t('coManaged.upgrade.unavailable')}</p>}
          <Button id="co-upgrade-start" disabled={busy || !screen.entitlementReady || screen.progress === 'running'}
            onClick={() => setConfirm(true)}>{t('coManaged.upgrade.start')}</Button>
        </>}
        <Button id="co-upgrade-refresh" variant="outline" disabled={busy} onClick={() => void reload()}>{t('coManaged.upgrade.refresh')}</Button>
      </CardContent>
    </Card>
    <ConfirmationDialog id="co-upgrade-confirm" isOpen={confirm} onClose={() => { if (!busy) setConfirm(false); }} onConfirm={start}
      title={t('coManaged.upgrade.confirmTitle')} message={t('coManaged.upgrade.confirmMessage')}
      confirmLabel={t('coManaged.upgrade.start')} cancelLabel={t('coManaged.upgrade.cancel')} isConfirming={busy} />
  </div>;
}
