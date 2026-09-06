'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { canOpenCoManagedClientProvisioning } from '@/lib/actions/coManagedActions';
import { CoManagedFeatureBoundary } from './CoManagedFeatureBoundary';

function ClientAction({ clientId }: { clientId: string }) {
  const { t } = useTranslation('msp/licensing');
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let cancelled = false; setAllowed(false);
    void canOpenCoManagedClientProvisioning(clientId).then(value => { if (!cancelled) setAllowed(value); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [clientId]);
  return allowed ? <Button id="client-enable-co-managed" variant="outline" size="sm"
    onClick={() => router.push(`/msp/co-managed?clientId=${encodeURIComponent(clientId)}`)}>{t('coManaged.provisioning.create')}</Button> : null;
}

export default function CoManagedClientAction({ clientId }: { clientId: string }) {
  return <CoManagedFeatureBoundary><ClientAction clientId={clientId} /></CoManagedFeatureBoundary>;
}
