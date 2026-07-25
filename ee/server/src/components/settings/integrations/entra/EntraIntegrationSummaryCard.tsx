'use client';

import React from 'react';
import Link from 'next/link';
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
    <div
      className="rounded-lg border border-border/70 bg-background p-4"
      id="entra-integration-summary-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{t('integrations.entra.summary.title')}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('integrations.entra.summary.description')}
          </p>
        </div>
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
      </div>

      {loading ? (
        <div className="mt-3 h-4 w-48 animate-pulse rounded bg-muted" id="entra-summary-loading" />
      ) : null}

      {error ? (
        <p className="mt-3 text-sm text-destructive" id="entra-summary-error">
          {error}
        </p>
      ) : null}

      {!loading && !error ? (
        <div className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
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
    </div>
  );
}
