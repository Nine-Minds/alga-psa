'use client';
import type { LicenseStatus } from '@/lib/actions/licenseManagementActions';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@alga-psa/ui/components/Card';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';

export default function TenantLicensePanel({ status, licenseKey, onKeyChange, onActivate, pending, error, success, portalUrl }: {
  status: LicenseStatus; licenseKey: string; onKeyChange: (value: string) => void; onActivate: () => void;
  pending: boolean; error: string | null; success: string | null; portalUrl: string;
}) {
  const { t } = useTranslation('msp/licensing'), { formatDate } = useFormatters();
  const statusKey = status.state === 'licensed' ? 'valid' : status.state === 'license_expired' ? 'expired' : 'required';
  return <div className="mx-auto max-w-3xl space-y-5 p-6 text-[rgb(var(--color-text-700))]">
    <Card>
      <CardHeader><CardTitle>{t('coManaged.tenantLicense.title')}</CardTitle>
        <CardDescription>{t('coManaged.tenantLicense.description')}</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {success && <p role="status">{success}</p>}
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">{t(`coManaged.tenantLicense.${statusKey}`)}</h2>
          {status.customer && <p>{status.customer}</p>}
          {status.expiresAt && <p>{t('coManaged.tenantLicense.expires', { date: formatDate(new Date(status.expiresAt), { dateStyle: 'medium' }) })}</p>}
          <p className="text-sm text-muted-foreground">{t('coManaged.tenantLicense.activationEffect')}</p>
        </div>
        <dl className="rounded-md border border-[rgb(var(--color-border-200))] p-3">
          <dt className="text-sm font-medium">{t('coManaged.tenantLicense.tenantId')}</dt>
          <dd className="mt-1 break-all font-mono text-sm">{status.tenantId}</dd>
        </dl>
        <Button id="tenant-license-manage-in-portal" variant="outline" asChild>
          <a href={portalUrl} target="_blank" rel="noopener noreferrer">
            {t('managementPage.actions.manageInPortal', { defaultValue: 'Manage in portal' })}
          </a>
        </Button>
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (!pending && licenseKey.trim()) onActivate(); }}>
          <TextArea id="tenant-license-key" label={t('coManaged.tenantLicense.key')} value={licenseKey} onChange={event => onKeyChange(event.target.value)}
            disabled={pending} autoComplete="off" spellCheck={false} rows={5} />
          <Button id="tenant-license-activate" type="submit" disabled={pending || !licenseKey.trim()}>
            {t(pending ? 'coManaged.tenantLicense.activating' : 'coManaged.tenantLicense.activate')}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>;
}
