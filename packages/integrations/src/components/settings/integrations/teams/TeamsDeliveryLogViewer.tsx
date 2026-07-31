'use client';

import React from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Label } from '@alga-psa/ui/components/Label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { listTeamsDeliveries, type TeamsDeliveryLogRow } from '../../../../actions';

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

const DELIVERY_STATUS_FILTERS = ['delivered', 'sent', 'failed', 'skipped'] as const;
const DELIVERY_CATEGORY_FILTERS = ['assignment', 'customer_reply', 'approval_request', 'escalation', 'sla_risk'] as const;

function formatTimestamp(value: unknown): string {
  if (typeof value !== 'string' && !(value instanceof Date)) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function getStatusVariant(status: string): 'success' | 'error' | 'warning' | 'secondary' {
  switch (status) {
    case 'delivered':
    case 'sent':
      return 'success';
    case 'failed':
      return 'error';
    case 'skipped':
      return 'warning';
    default:
      return 'secondary';
  }
}

function isForbidden(err: unknown): boolean {
  return err instanceof Error && /forbidden/i.test(err.message);
}

export function TeamsDeliveryLogViewer() {
  const { t } = useTranslation('msp/integrations');
  const [rows, setRows] = React.useState<TeamsDeliveryLogRow[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<string>('');
  const [categoryFilter, setCategoryFilter] = React.useState<string>('');
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [forbidden, setForbidden] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchPage = React.useCallback(async (cursor: string | null, append: boolean) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const page = await listTeamsDeliveries({
        status: (statusFilter || undefined) as any,
        category: categoryFilter || undefined,
        cursor: cursor || undefined,
      });
      setForbidden(false);
      setRows((current) => (append ? [...current, ...page.rows] : page.rows));
      setNextCursor(page.nextCursor);
    } catch (err) {
      if (isForbidden(err)) {
        setForbidden(true);
        setRows([]);
        setNextCursor(null);
      } else {
        setError((err as Error)?.message || t('integrations.teams.settings.deliveryLog.error', { defaultValue: 'Failed to load Teams delivery log' }));
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [statusFilter, categoryFilter, t]);

  React.useEffect(() => {
    void fetchPage(null, false);
  }, [fetchPage]);

  return (
    <Card id="teams-delivery-log-viewer">
      <CardHeader>
        <CardTitle>{t('integrations.teams.settings.deliveryLog.title', { defaultValue: 'Teams delivery log' })}</CardTitle>
        <CardDescription>
          {t('integrations.teams.settings.deliveryLog.description', { defaultValue: 'Every Teams notification delivery attempt recorded for this tenant.' })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {forbidden ? (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {t('integrations.teams.settings.deliveryLog.forbidden', { defaultValue: 'You do not have permission to view the Teams delivery log.' })}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-4">
              <div className="min-w-[10rem]">
                <Label htmlFor="teams-delivery-status-filter">
                  {t('integrations.teams.settings.deliveryLog.filter.statusLabel', { defaultValue: 'Status' })}
                </Label>
                <select
                  id="teams-delivery-status-filter"
                  className="mt-2 flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="">{t('integrations.teams.settings.deliveryLog.filter.statusAll', { defaultValue: 'All statuses' })}</option>
                  {DELIVERY_STATUS_FILTERS.map((value) => (
                    <option key={value} value={value}>
                      {t(`integrations.teams.settings.deliveryLog.status.${value}`, { defaultValue: value })}
                    </option>
                  ))}
                </select>
              </div>

              <div className="min-w-[12rem]">
                <Label htmlFor="teams-delivery-category-filter">
                  {t('integrations.teams.settings.deliveryLog.filter.categoryLabel', { defaultValue: 'Category' })}
                </Label>
                <select
                  id="teams-delivery-category-filter"
                  className="mt-2 flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  <option value="">{t('integrations.teams.settings.deliveryLog.filter.categoryAll', { defaultValue: 'All categories' })}</option>
                  {DELIVERY_CATEGORY_FILTERS.map((value) => (
                    <option key={value} value={value}>
                      {t(`integrations.teams.settings.deliveryLog.category.${value}`, { defaultValue: value })}
                    </option>
                  ))}
                </select>
              </div>

              <Button
                id="teams-delivery-refresh"
                variant="outline"
                onClick={() => void fetchPage(null, false)}
                disabled={loading}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {t('integrations.teams.settings.deliveryLog.refresh', { defaultValue: 'Refresh' })}
              </Button>
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {rows.length === 0 && !loading ? (
              <p id="teams-delivery-log-empty" className="text-sm text-muted-foreground">
                {t('integrations.teams.settings.deliveryLog.empty', { defaultValue: 'No Teams deliveries recorded yet.' })}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('integrations.teams.settings.deliveryLog.columns.createdAt', { defaultValue: 'Time' })}</TableHead>
                      <TableHead>{t('integrations.teams.settings.deliveryLog.columns.category', { defaultValue: 'Category' })}</TableHead>
                      <TableHead>{t('integrations.teams.settings.deliveryLog.columns.destination', { defaultValue: 'Destination' })}</TableHead>
                      <TableHead>{t('integrations.teams.settings.deliveryLog.columns.status', { defaultValue: 'Status' })}</TableHead>
                      <TableHead>{t('integrations.teams.settings.deliveryLog.columns.errorCode', { defaultValue: 'Error code' })}</TableHead>
                      <TableHead>{t('integrations.teams.settings.deliveryLog.columns.errorMessage', { defaultValue: 'Error message' })}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.delivery_id}>
                        <TableCell className="whitespace-nowrap text-xs">{formatTimestamp(row.created_at)}</TableCell>
                        <TableCell className="text-xs">{row.category || '—'}</TableCell>
                        <TableCell className="text-xs">{row.destination_type}</TableCell>
                        <TableCell>
                          <Badge variant={getStatusVariant(row.status)}>
                            {t(`integrations.teams.settings.deliveryLog.status.${row.status}`, { defaultValue: row.status })}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{row.error_code || '—'}</TableCell>
                        <TableCell className="max-w-[20rem] break-words text-xs text-muted-foreground">{row.error_message || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {nextCursor ? (
              <Button
                id="teams-delivery-load-more"
                variant="secondary"
                onClick={() => void fetchPage(nextCursor, true)}
                disabled={loadingMore}
              >
                {loadingMore
                  ? t('integrations.teams.settings.deliveryLog.loading', { defaultValue: 'Loading...' })
                  : t('integrations.teams.settings.deliveryLog.loadMore', { defaultValue: 'Load more' })}
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
