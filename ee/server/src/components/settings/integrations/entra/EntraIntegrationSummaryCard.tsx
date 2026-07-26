'use client';

import React from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { EntraSection } from './EntraSection';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getEntraIntegrationStatus,
  type EntraStatusResponse,
} from '@alga-psa/integrations/actions';

export const ENTRA_ROUTE = '/msp/settings/integrations/entra';

/**
 * What the Identity category shows now that Entra has its own route: enough
 * state to know whether anything needs attention, and one way in. The full
 * screen used to render inline here, which is why a category page meant to
 * survey every integration was dominated by one of them.
 */
export default function EntraIntegrationSummaryCard(): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');
  const [status, setStatus] = React.useState<EntraStatusResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const result = await getEntraIntegrationStatus();
        if (cancelled) return;
        if ('error' in result) {
          setStatus(null);
          setError(result.error || t('integrations.entra.settings.errors.loadStatus'));
          return;
        }
        setStatus(result.data || null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const statusLabel = t(
    `integrations.entra.settings.status.values.${status?.status || 'not_connected'}`,
    { defaultValue: t('integrations.entra.settings.status.values.unknown') }
  );

  return (
    <EntraSection
      id="entra-integration-summary-card"
      icon={ShieldCheck}
      title={t('integrations.entra.summary.title')}
      description={t('integrations.entra.summary.description')}
      action={
        <div className="flex flex-shrink-0 items-center gap-2">
          {loading ? null : (
            <Badge
              id="entra-summary-status-badge"
              variant={status?.status === 'connected' ? 'secondary' : 'outline'}
            >
              {statusLabel}
            </Badge>
          )}
          <Link href={ENTRA_ROUTE} id="entra-summary-open-link">
            <Button id="entra-summary-open" type="button" size="sm">
              {t('integrations.entra.summary.open')}
            </Button>
          </Link>
        </div>
      }
    >
      {loading ? (
        <div className="h-4 w-48 animate-pulse rounded bg-muted" id="entra-summary-loading" />
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" id="entra-summary-error">
          {error}
        </p>
      ) : null}

      {!loading && !error ? (
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {t('integrations.entra.settings.overview.connectionTypeLabel')}
            </span>{' '}
            {status?.connectionType
              ? t(`integrations.entra.settings.connection.types.${status.connectionType}`)
              : t('integrations.entra.settings.connection.notConfigured')}
          </p>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {t('integrations.entra.settings.overview.mappedTenantsLabel')}
            </span>{' '}
            {status?.mappedTenantCount ?? 0}
          </p>
        </div>
      ) : null}
    </EntraSection>
  );
}
