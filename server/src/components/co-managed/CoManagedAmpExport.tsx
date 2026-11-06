'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { useCapability } from '@alga-psa/ui/hooks';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getCoManagedAmpExportScreenAction } from '@/lib/actions/coManagedAmpExportActions';

export function CoManagedAmpExportEntry() {
  const { enabled } = useCapability('co-managed'), { t } = useTranslation('msp/licensing');
  if (!enabled) return null;
  return <div className="mx-auto max-w-5xl px-6 pt-6"><Button id="co-amp-export-open" variant="outline" asChild>
    <Link href="/msp/co-management/export">{t('coManaged.ampExport.title', { defaultValue: 'Export workspace' })}</Link>
  </Button></div>;
}

export default function CoManagedAmpExport({ available = true }: { available?: boolean }) {
  const { data: session, status } = useSession(), { t } = useTranslation('msp/licensing');
  if (!available) return <div className="mx-auto max-w-3xl p-6"><Card><CardHeader><CardTitle>{t('coManaged.ampExport.title', { defaultValue: 'Export workspace' })}</CardTitle></CardHeader>
    <CardContent><p role="status">{t('coManaged.ampExport.unavailable', { defaultValue: 'Workspace export is not available in this edition.' })}</p></CardContent></Card></div>;
  if (status === 'loading') return <div className="mx-auto max-w-3xl p-6"><p role="status">{t('coManaged.ampExport.loading', { defaultValue: 'Loading…' })}</p></div>;
  return <ExportContent key={`${session?.session_id}:${session?.user?.tenant}:${session?.user?.id}`} />;
}

function ExportContent() {
  const { t } = useTranslation('msp/licensing');
  const [workspace, setWorkspace] = useState<string | null>(null), [loadError, setLoadError] = useState(false), [requested, setRequested] = useState(false);
  useEffect(() => {
    let current = true;
    void getCoManagedAmpExportScreenAction().then(value => { if (current) setWorkspace(value.workspaceName); })
      .catch(() => { if (current) setLoadError(true); });
    return () => { current = false; };
  }, []);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    setRequested(true);
    // Native navigation streams the AMP download without buffering a potentially
    // large package in browser memory. Server errors render in the download tab.
    if (event.currentTarget.target !== '_blank') event.preventDefault();
  };
  return <div className="mx-auto max-w-3xl space-y-5 p-6 text-[rgb(var(--color-text-700))]">
    <Card><CardHeader><CardTitle>{t('coManaged.ampExport.title', { defaultValue: 'Export workspace' })}</CardTitle>
      <CardDescription>{t('coManaged.ampExport.description', { defaultValue: 'Download an AMP package containing your workspace records and files.' })}</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        {loadError && <p role="alert" className="text-destructive">{t('coManaged.ampExport.loadError', { defaultValue: 'Workspace export is unavailable. Refresh and try again.' })}</p>}
        {workspace === null && !loadError && <p role="status">{t('coManaged.ampExport.loading', { defaultValue: 'Loading…' })}</p>}
        {workspace !== null && <>
          <p className="font-medium">{workspace}</p>
          <p className="text-sm">{t('coManaged.ampExport.security', { defaultValue: 'The package contains sensitive workspace data. Store it securely. Credentials and provider secrets are excluded.' })}</p>
          <form id="co-amp-export-form" action="/api/co-management/export" method="post" target="_blank" rel="noopener noreferrer" onSubmit={submit}>
            <Button id="co-amp-export-download" type="submit">{t('coManaged.ampExport.download', { defaultValue: 'Prepare and download AMP package' })}</Button>
          </form>
          {requested && <p role="status">{t('coManaged.ampExport.requested', { defaultValue: 'Your request opens in a new tab. Your browser will download the package when it is ready.' })}</p>}
        </>}
      </CardContent>
    </Card>
  </div>;
}
