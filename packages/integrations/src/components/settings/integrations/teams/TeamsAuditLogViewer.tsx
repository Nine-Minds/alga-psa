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
import { listTeamsAuditEvents, type TeamsAuditLogRow } from '../../../../actions';

const AUDIT_SURFACE_FILTERS = ['bot', 'message_extension', 'quick_action', 'tab'] as const;

function formatTimestamp(value: unknown): string {
  if (typeof value !== 'string' && !(value instanceof Date)) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function isForbidden(err: unknown): boolean {
  return err instanceof Error && /forbidden/i.test(err.message);
}

export function TeamsAuditLogViewer() {
  const { t } = useTranslation('msp/integrations');
  const [rows, setRows] = React.useState<TeamsAuditLogRow[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [surfaceFilter, setSurfaceFilter] = React.useState<string>('');
  const [actionFilter, setActionFilter] = React.useState<string>('');
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
      const page = await listTeamsAuditEvents({
        surface: (surfaceFilter || undefined) as any,
        action_id: actionFilter.trim() || undefined,
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
        setError((err as Error)?.message || t('integrations.teams.settings.auditLog.error', { defaultValue: 'Failed to load Teams audit log' }));
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [surfaceFilter, actionFilter, t]);

  React.useEffect(() => {
    void fetchPage(null, false);
    // Surface changes refetch immediately; the action filter refetches on submit/refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceFilter]);

  return (
    <Card id="teams-audit-log-viewer">
      <CardHeader>
        <CardTitle>{t('integrations.teams.settings.auditLog.title', { defaultValue: 'Teams audit log' })}</CardTitle>
        <CardDescription>
          {t('integrations.teams.settings.auditLog.description', { defaultValue: 'Mutations executed from Teams bot, message extension, and quick-action surfaces.' })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {forbidden ? (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {t('integrations.teams.settings.auditLog.forbidden', { defaultValue: 'You do not have permission to view the Teams audit log.' })}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-4">
              <div className="min-w-[12rem]">
                <Label htmlFor="teams-audit-surface-filter">
                  {t('integrations.teams.settings.auditLog.filter.surfaceLabel', { defaultValue: 'Surface' })}
                </Label>
                <select
                  id="teams-audit-surface-filter"
                  className="mt-2 flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={surfaceFilter}
                  onChange={(event) => setSurfaceFilter(event.target.value)}
                >
                  <option value="">{t('integrations.teams.settings.auditLog.filter.surfaceAll', { defaultValue: 'All surfaces' })}</option>
                  {AUDIT_SURFACE_FILTERS.map((value) => (
                    <option key={value} value={value}>
                      {t(`integrations.teams.settings.auditLog.surface.${value}`, { defaultValue: value })}
                    </option>
                  ))}
                </select>
              </div>

              <div className="min-w-[12rem]">
                <Label htmlFor="teams-audit-action-filter">
                  {t('integrations.teams.settings.auditLog.filter.actionLabel', { defaultValue: 'Action id' })}
                </Label>
                <input
                  id="teams-audit-action-filter"
                  className="mt-2 flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={actionFilter}
                  onChange={(event) => setActionFilter(event.target.value)}
                  placeholder={t('integrations.teams.settings.auditLog.filter.actionPlaceholder', { defaultValue: 'e.g. assign_ticket' })}
                />
              </div>

              <Button
                id="teams-audit-refresh"
                variant="outline"
                onClick={() => void fetchPage(null, false)}
                disabled={loading}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {t('integrations.teams.settings.auditLog.refresh', { defaultValue: 'Refresh' })}
              </Button>
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {rows.length === 0 && !loading ? (
              <p id="teams-audit-log-empty" className="text-sm text-muted-foreground">
                {t('integrations.teams.settings.auditLog.empty', { defaultValue: 'No Teams audit events recorded yet.' })}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('integrations.teams.settings.auditLog.columns.createdAt', { defaultValue: 'Time' })}</TableHead>
                      <TableHead>{t('integrations.teams.settings.auditLog.columns.surface', { defaultValue: 'Surface' })}</TableHead>
                      <TableHead>{t('integrations.teams.settings.auditLog.columns.action', { defaultValue: 'Action' })}</TableHead>
                      <TableHead>{t('integrations.teams.settings.auditLog.columns.target', { defaultValue: 'Target' })}</TableHead>
                      <TableHead>{t('integrations.teams.settings.auditLog.columns.result', { defaultValue: 'Result' })}</TableHead>
                      <TableHead>{t('integrations.teams.settings.auditLog.columns.errorCode', { defaultValue: 'Error code' })}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.event_id}>
                        <TableCell className="whitespace-nowrap text-xs">{formatTimestamp(row.created_at)}</TableCell>
                        <TableCell className="text-xs">
                          {t(`integrations.teams.settings.auditLog.surface.${row.surface}`, { defaultValue: row.surface })}
                        </TableCell>
                        <TableCell className="text-xs">{row.action_id}</TableCell>
                        <TableCell className="text-xs">
                          {row.target_type ? `${row.target_type}${row.target_id ? `:${row.target_id}` : ''}` : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={row.result_status === 'success' ? 'success' : 'error'}>
                            {t(`integrations.teams.settings.auditLog.result.${row.result_status}`, { defaultValue: row.result_status })}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{row.error_code || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {nextCursor ? (
              <Button
                id="teams-audit-load-more"
                variant="secondary"
                onClick={() => void fetchPage(nextCursor, true)}
                disabled={loadingMore}
              >
                {loadingMore
                  ? t('integrations.teams.settings.auditLog.loading', { defaultValue: 'Loading...' })
                  : t('integrations.teams.settings.auditLog.loadMore', { defaultValue: 'Load more' })}
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
