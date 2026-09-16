'use client';

import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Play,
  XCircle,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import type { ColumnDefinition } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getEntraConfirmedMappings,
  runEntraClientAccessDiagnostics,
  runEntraConnectionDiagnostics,
  type EntraConfirmedMapping,
} from '@alga-psa/integrations/actions';
import type {
  DiagnosticsRecommendation,
  EntraClientDiagnosticsContinuation,
  EntraClientDiagnosticsResult,
  EntraDiagnosticsReport,
  EntraDiagnosticsStep,
} from '@alga-psa/types';

interface EntraDiagnosticsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (tab: string) => void;
}

const CONFIRM_THRESHOLD = 20;

function statusVariant(status: EntraDiagnosticsStep['status']): BadgeVariant {
  switch (status) {
    case 'pass':
      return 'success';
    case 'warn':
      return 'warning';
    case 'fail':
      return 'error';
    default:
      return 'secondary';
  }
}

function StatusIcon({ status }: { status: EntraDiagnosticsStep['status'] }) {
  switch (status) {
    case 'pass':
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    case 'warn':
      return <AlertCircle className="h-4 w-4 text-yellow-600" />;
    case 'fail':
      return <XCircle className="h-4 w-4 text-red-600" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function RecommendationActions({
  recommendation,
  onNavigate,
}: {
  recommendation: DiagnosticsRecommendation;
  onNavigate?: (tab: string) => void;
}) {
  const { t } = useTranslation('msp/admin');
  const action = recommendation.action;
  if (!action) return null;

  const handle = async () => {
    if (action.kind === 'copy') {
      try {
        await navigator.clipboard.writeText(action.payload);
      } catch {
        // clipboard unavailable
      }
      return;
    }
    if (action.kind === 'open_url') {
      window.open(action.payload, '_blank', 'noopener,noreferrer');
      return;
    }
    onNavigate?.(action.payload);
  };

  if (action.kind === 'navigate') {
    return (
      <Button
        id={`entra-diag-rec-${recommendation.code}`}
        type="button"
        size="sm"
        variant="outline"
        onClick={handle}
      >
        {t('integrations.entra.diagnostics.actions.goToStep', {
          defaultValue: 'Go to step',
        })}
      </Button>
    );
  }

  return (
    <Button
      id={`entra-diag-rec-${recommendation.code}`}
      type="button"
      size="sm"
      variant="outline"
      onClick={handle}
      className="gap-1"
    >
      {action.kind === 'copy' ? (
        <Copy className="h-3.5 w-3.5" />
      ) : (
        <ExternalLink className="h-3.5 w-3.5" />
      )}
      {action.kind === 'copy'
        ? t('integrations.entra.diagnostics.actions.copy', { defaultValue: 'Copy' })
        : t('integrations.entra.diagnostics.actions.open', { defaultValue: 'Open' })}
    </Button>
  );
}

export function EntraDiagnosticsDialog({
  isOpen,
  onClose,
  onNavigate,
}: EntraDiagnosticsDialogProps) {
  const { t } = useTranslation('msp/admin');
  const [report, setReport] = React.useState<EntraDiagnosticsReport | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const [mappings, setMappings] = React.useState<EntraConfirmedMapping[]>([]);
  const [selectedClients, setSelectedClients] = React.useState<string[]>([]);
  const [includeYield, setIncludeYield] = React.useState(false);
  const [clientsRunning, setClientsRunning] = React.useState(false);
  const [clientResults, setClientResults] = React.useState<EntraClientDiagnosticsResult[]>([]);
  const [clientProgress, setClientProgress] = React.useState<{ completed: number; total: number } | null>(null);
  const [clientError, setClientError] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const runConnection = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const result = await runEntraConnectionDiagnostics();
      if ('error' in result) {
        setError(result.error || t('integrations.entra.diagnostics.errors.failed', { defaultValue: 'Diagnostics failed' }));
        return;
      }
      setReport(result.data);
    } catch (e: any) {
      setError(e?.message || t('integrations.entra.diagnostics.errors.failed', { defaultValue: 'Diagnostics failed' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    if (!isOpen) return;
    void runConnection();
    void (async () => {
      try {
        const result = await getEntraConfirmedMappings();
        if (result.success && result.data) {
          const list = ((result.data as any).mappings ?? result.data) as EntraConfirmedMapping[];
          setMappings(list);
          setSelectedClients(list.map((m) => m.clientId));
        }
      } catch {
        // mapping list is optional for connection-only runs
      }
    })();
  }, [isOpen, runConnection]);

  const runClients = React.useCallback(
    async (clientIds: string[]) => {
      setClientsRunning(true);
      setClientError(null);
      setClientResults([]);
      setClientProgress({ completed: 0, total: clientIds.length });
      let continuation: string | undefined;
      let completed = 0;
      const accumulated: EntraClientDiagnosticsResult[] = [];
      try {
        do {
          const response = await runEntraClientAccessDiagnostics({
            clientIds,
            includeUserYield: includeYield,
            continuation,
          });
          if ('error' in response) {
            setClientError(
              response.error ||
                t('integrations.entra.diagnostics.errors.clientFailed', {
                  defaultValue: 'Client diagnostics failed',
                })
            );
            setClientResults(accumulated);
            return;
          }
          const payload: EntraClientDiagnosticsContinuation = response.data;
          if (payload.error) {
            setClientError(payload.error);
            return;
          }
          accumulated.push(...payload.clients);
          completed = payload.completed;
          setClientResults([...accumulated]);
          setClientProgress({ completed, total: payload.total });
          continuation = payload.isDone ? undefined : payload.jobId;
          if (!continuation) break;
        } while (continuation);
      } catch (e: any) {
        setClientError(e?.message || 'Client diagnostics failed');
        setClientResults(accumulated);
      } finally {
        setClientsRunning(false);
      }
    },
    [includeYield, t]
  );

  const handleStartClients = React.useCallback(() => {
    if (selectedClients.length === 0) return;
    if (selectedClients.length > CONFIRM_THRESHOLD) {
      setConfirmOpen(true);
      return;
    }
    void runClients(selectedClients);
  }, [runClients, selectedClients]);

  const supportBundle = report?.supportBundle;
  const copySupportBundle = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(supportBundle ?? report, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const downloadJson = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(supportBundle ?? report, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `entra-connection-diagnostics-${report.createdAt}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const clientRows = React.useMemo(() => {
    if (!report) return clientResults;
    if (report.clients.length > 0) return report.clients;
    return clientResults;
  }, [clientResults, report]);

  const columns: ColumnDefinition<EntraClientDiagnosticsResult>[] = [
    {
      title: t('integrations.entra.diagnostics.clients.columns.client', { defaultValue: 'Client' }),
      dataIndex: 'clientName',
      render: (_v, record) =>
        record.clientName || t('integrations.entra.diagnostics.clients.unavailableName', { defaultValue: 'Unavailable name' }),
    },
    {
      title: t('integrations.entra.diagnostics.clients.columns.tenant', { defaultValue: 'Tenant' }),
      dataIndex: 'entraTenantDisplayName',
      render: (_v, record) =>
        record.entraTenantDisplayName ||
        t('integrations.entra.diagnostics.clients.unavailableName', { defaultValue: 'Unavailable name' }),
    },
    {
      title: t('integrations.entra.diagnostics.clients.columns.status', { defaultValue: 'Status' }),
      dataIndex: 'overallStatus',
      render: (value) => <Badge variant={statusVariant(value as any)}>{String(value)}</Badge>,
    },
    {
      title: t('integrations.entra.diagnostics.clients.columns.remedy', { defaultValue: 'Remedy' }),
      dataIndex: 'remedy',
      render: (value) => (
        <span className="text-sm text-muted-foreground">{value || ''}</span>
      ),
    },
  ];

  const footer = (
    <div className="flex w-full items-center justify-between gap-2">
      <div className="flex gap-2">
        <Button
          id="entra-diag-copy-bundle"
          type="button"
          size="sm"
          variant="outline"
          onClick={copySupportBundle}
          disabled={!report}
        >
          <Copy className="mr-2 h-4 w-4" />
          {copied
            ? t('integrations.entra.diagnostics.actions.copied', { defaultValue: 'Copied' })
            : t('integrations.entra.diagnostics.actions.copySupportBundle', {
                defaultValue: 'Copy support bundle',
              })}
        </Button>
        <Button
          id="entra-diag-download-json"
          type="button"
          size="sm"
          variant="outline"
          onClick={downloadJson}
          disabled={!report}
        >
          <Download className="mr-2 h-4 w-4" />
          {t('integrations.entra.diagnostics.actions.downloadJson', { defaultValue: 'Download JSON' })}
        </Button>
      </div>
      <Button id="entra-diag-close" type="button" variant="outline" onClick={onClose}>
        {t('common.actions.close', { defaultValue: 'Close' })}
      </Button>
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('integrations.entra.diagnostics.title', { defaultValue: 'Entra diagnostics' })}
      id="entra-diagnostics-dialog"
      className="max-w-4xl"
      footer={footer}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogDescription>
            {t('integrations.entra.diagnostics.description', {
              defaultValue:
                'Read-only checks of the Entra connection, partner authentication, discovery, and sync health.',
            })}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="py-6 text-center text-sm text-muted-foreground" id="entra-diag-loading">
            {t('integrations.entra.diagnostics.states.running', { defaultValue: 'Running diagnostics...' })}
          </div>
        )}
        {error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert">
            {error}
          </div>
        )}

        {report && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {t('integrations.entra.diagnostics.labels.overall', { defaultValue: 'Overall' })}:
              </span>
              <Badge variant={statusVariant(report.summary.overallStatus)}>
                {report.summary.overallStatus}
              </Badge>
            </div>

            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">
                  {t('integrations.entra.diagnostics.labels.connectionType', { defaultValue: 'Connection' })}
                </dt>
                <dd>{report.summary.connectionType ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {t('integrations.entra.diagnostics.labels.status', { defaultValue: 'Status' })}
                </dt>
                <dd>{report.summary.connectionStatus ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {t('integrations.entra.diagnostics.labels.mappedClients', { defaultValue: 'Mapped clients' })}
                </dt>
                <dd>{report.summary.mappedClientCount ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {t('integrations.entra.diagnostics.labels.managedTenants', { defaultValue: 'Managed tenants' })}
                </dt>
                <dd>{report.summary.managedTenantCount ?? '—'}</dd>
              </div>
            </dl>

            {report.recommendations.length > 0 && (
              <div className="rounded border p-3" id="entra-diag-recommendations">
                <div className="mb-2 text-sm font-medium">
                  {t('integrations.entra.diagnostics.labels.recommendations', { defaultValue: 'Recommendations' })}
                </div>
                <ul className="space-y-2">
                  {report.recommendations.map((rec) => (
                    <li key={`${rec.code}-${rec.action?.payload ?? ''}`} className="flex items-start justify-between gap-2 text-sm">
                      <span>
                        <Badge
                          size="sm"
                          variant={rec.severity === 'fail' ? 'error' : rec.severity === 'warn' ? 'warning' : 'secondary'}
                        >
                          {rec.severity}
                        </Badge>{' '}
                        {rec.text}
                      </span>
                      <RecommendationActions recommendation={rec} onNavigate={onNavigate} />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="divide-y rounded-md border">
              {report.steps.map((step) => (
                <details key={step.id} className="p-3">
                  <summary className="flex cursor-pointer select-none items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <StatusIcon status={step.status} />
                      <span className="truncate font-medium">{step.title}</span>
                      <span className="text-xs text-muted-foreground">({step.durationMs}ms)</span>
                    </span>
                    <Badge variant={statusVariant(step.status)}>{step.status}</Badge>
                  </summary>
                  <div className="mt-2 space-y-2 text-sm">
                    {step.blockedBy && (
                      <div className="text-xs text-muted-foreground">
                        {t('integrations.entra.diagnostics.labels.blockedBy', {
                          defaultValue: 'Blocked by',
                        })}
                        : {step.blockedBy}
                      </div>
                    )}
                    {step.http && (
                      <div className="text-xs text-muted-foreground">
                        {step.http.method} {step.http.path || step.http.url || ''}{' '}
                        {typeof step.http.status === 'number' ? `· ${step.http.status}` : ''}
                        {step.http.requestId ? ` · request-id: ${step.http.requestId}` : ''}
                      </div>
                    )}
                    {step.error && (
                      <div className="rounded border border-destructive/30 bg-destructive/10 p-2">
                        <div className="font-medium">
                          {t('integrations.entra.diagnostics.labels.error', { defaultValue: 'Error' })}
                        </div>
                        <div>{step.error.message}</div>
                      </div>
                    )}
                    {step.data && (
                      <pre className="overflow-auto rounded bg-muted p-2 text-xs">
                        {JSON.stringify(step.data, null, 2)}
                      </pre>
                    )}
                  </div>
                </details>
              ))}
            </div>

            <div className="space-y-2 rounded border p-3" id="entra-diag-clients">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">
                  {t('integrations.entra.diagnostics.clients.title', {
                    defaultValue: 'Selected client diagnostics',
                  })}
                </div>
                <Badge variant="secondary">
                  {t('integrations.entra.diagnostics.clients.selectedCount', {
                    defaultValue: '{{count}} selected',
                    count: selectedClients.length,
                  })}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    id="entra-diag-yield-toggle"
                    type="checkbox"
                    checked={includeYield}
                    onChange={(e) => setIncludeYield(e.target.checked)}
                    disabled={clientsRunning}
                  />
                  {t('integrations.entra.diagnostics.clients.yieldToggle', {
                    defaultValue: 'User yield preview (more expensive)',
                  })}
                </label>
                <Button
                  id="entra-diag-run-clients"
                  type="button"
                  size="sm"
                  onClick={handleStartClients}
                  disabled={clientsRunning || selectedClients.length === 0}
                  className="gap-1"
                >
                  <Play className="h-3.5 w-3.5" />
                  {clientsRunning
                    ? t('integrations.entra.diagnostics.states.running', { defaultValue: 'Running diagnostics...' })
                    : t('integrations.entra.diagnostics.clients.run', { defaultValue: 'Run client diagnostics' })}
                </Button>
                {clientProgress && (
                  <span className="text-xs text-muted-foreground" id="entra-diag-client-progress">
                    {t('integrations.entra.diagnostics.clients.progress', {
                      defaultValue: '{{completed}} of {{total}} complete',
                      completed: clientProgress.completed,
                      total: clientProgress.total,
                    })}
                  </span>
                )}
              </div>
              {clientError && (
                <div className="text-sm text-destructive" role="alert">
                  {clientError}
                </div>
              )}
              {clientRows.length > 0 && (
                <DataTable
                  id="entra-diagnostics-client-table"
                  data={clientRows}
                  columns={columns}
                  expandedRowRender={(record) => (
                    <pre className="overflow-auto rounded bg-muted p-2 text-xs">
                      {JSON.stringify(record.steps, null, 2)}
                    </pre>
                  )}
                />
              )}
            </div>
          </div>
        )}
      </DialogContent>

      <ConfirmationDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void runClients(selectedClients);
        }}
        title={t('integrations.entra.diagnostics.clients.confirmTitle', {
          defaultValue: 'Run diagnostics for many clients?',
        })}
        message={t('integrations.entra.diagnostics.clients.confirmMessage', {
          defaultValue:
            'You selected {{count}} clients. Each client is issued a token and makes a small number of Graph requests.',
          count: selectedClients.length,
        })}
        confirmLabel={t('integrations.entra.diagnostics.clients.confirmRun', { defaultValue: 'Run' })}
        cancelLabel={t('common.actions.cancel', { defaultValue: 'Cancel' })}
        id="entra-diag-client-confirm"
      />
    </Dialog>
  );
}

export default EntraDiagnosticsDialog;
