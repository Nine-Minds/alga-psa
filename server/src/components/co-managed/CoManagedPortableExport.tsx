'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { useProduct } from '@/context/ProductContext';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getCoManagedPortableExportScreenAction } from '@/lib/actions/coManagedPortableExportActions';

export function CoManagedPortableExportEntry() {
  const { productCode } = useProduct(), { t } = useTranslation('msp/licensing');
  if (productCode !== 'co_managed') return null;
  return <div className="mx-auto max-w-5xl px-6 pt-6"><Button id="co-portable-export-open" variant="outline" asChild>
    <Link href="/msp/co-management/export">{t('coManaged.portableExport.title')}</Link>
  </Button></div>;
}

export default function CoManagedPortableExport() {
  const { data: session } = useSession();
  return <ExportContent key={`${session?.session_id}:${session?.user?.tenant}:${session?.user?.id}`} />;
}

function ExportContent() {
  const { t } = useTranslation('msp/licensing');
  const [workspace, setWorkspace] = useState<string | null>(null), [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<'lengthError' | 'matchError' | null>(null), [requested, setRequested] = useState(false);
  useEffect(() => {
    let current = true;
    void getCoManagedPortableExportScreenAction().then(value => { if (current) setWorkspace(value.workspaceName); })
      .catch(() => { if (current) setLoadError(true); });
    return () => { current = false; };
  }, []);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    const form = event.currentTarget, password = form.querySelector<HTMLInputElement>('#co-export-passphrase')!.value;
    const confirmation = form.querySelector<HTMLInputElement>('#co-export-confirm-passphrase')!.value;
    const bytes = new TextEncoder().encode(password).length;
    if (bytes < 16 || bytes > 1024 || password !== confirmation) {
      event.preventDefault(); setError(bytes < 16 || bytes > 1024 ? 'lengthError' : 'matchError'); return;
    }
    setError(null); setRequested(true);
    // Native navigation streams large files directly to the browser's download
    // manager. Uncontrolled password inputs never enter reflection metadata,
    // React state, a query string or a client-side archive Blob.
  };
  return <div className="mx-auto max-w-3xl space-y-5 p-6 text-[rgb(var(--color-text-700))]">
    <Card><CardHeader><CardTitle>{t('coManaged.portableExport.title')}</CardTitle>
      <CardDescription>{t('coManaged.portableExport.description')}</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        {loadError && <p role="alert" className="text-destructive">{t('coManaged.portableExport.loadError')}</p>}
        {workspace === null && !loadError && <p role="status">{t('coManaged.loading')}</p>}
        {workspace !== null && <>
          <p className="font-medium">{workspace}</p>
          <p>{t('coManaged.portableExport.recovery')}</p>
          <p>{t('coManaged.portableExport.connections')}</p>
          <form id="co-export-form" action="/api/co-management/export" method="post" target="_blank" rel="noopener noreferrer" onSubmit={submit} className="space-y-4">
            <Input id="co-export-passphrase" name="passphrase" type="password" label={t('coManaged.portableExport.passphrase')} required autoComplete="new-password" />
            <Input id="co-export-confirm-passphrase" type="password" label={t('coManaged.portableExport.confirmPassphrase')} required autoComplete="new-password" />
            {error && <p role="alert" className="text-destructive">{t(`coManaged.portableExport.${error}`)}</p>}
            <Button id="co-export-download" type="submit">{t('coManaged.portableExport.download')}</Button>
          </form>
          {requested && <p role="status">{t('coManaged.portableExport.requested')}</p>}
        </>}
      </CardContent>
    </Card>
  </div>;
}
