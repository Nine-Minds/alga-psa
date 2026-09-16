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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
} from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
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
  EntraClientOutcomeCategory,
  EntraDiagnosticsReadiness,
  EntraDiagnosticsReport,
  EntraDiagnosticsStep,
} from '@alga-psa/types';

interface EntraDiagnosticsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (tab: string) => void;
}

const CONFIRM_THRESHOLD = 20;

const GUID_PATTERN =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Client-side identifier redaction for exports; secrets are already removed server-side. */
function stripIdentifiers(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(GUID_PATTERN, '<id>').replace(EMAIL_PATTERN, '<redacted-email>');
  }
  if (Array.isArray(value)) return value.map(stripIdentifiers);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'requestId' || key === 'clientRequestId') {
        out[key] = entry;
        continue;
      }
      const identifierKey =
        /(tenantid|tenant_id|clientid|client_id|userid|user_id|objectid|object_id|appid|app_id|entratenantid|entra_tenant_id|partnerTenantId)/.test(
          key
        );
      out[key] = identifierKey && entry !== null ? null : stripIdentifiers(entry);
    }
    return out;
  }
  return value;
}

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

const CATEGORY_ORDER: EntraClientOutcomeCategory[] = [
  'ok',
  'need_consent',
  'conditional_access',
  'missing_role',
  'other',
];

export function EntraDiagnosticsDialog({
  isOpen,
  onClose,
  onNavigate,
}: EntraDiagnosticsDialogProps) {
  const { t } = useTranslation('msp/admin');
  const [report, setReport] = React.useState<EntraDiagnosticsReport | null>(null);
  const [readiness, setReadiness] = React.useState<EntraDiagnosticsReadiness | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const [mappings, setMappings] = React.useState<EntraConfirmedMapping[]>([]);
  const [selectedClients, setSelectedClients] = React.useState<string[]>([]);
  const [includeYield, setIncludeYield] = React.useState(false);
  const [includeIdentifiersExport, setIncludeIdentifiersExport] = React.useState(false);
  const [clientsRunning, setClientsRunning] = React.useState(false);
  const [clientResults, setClientResults] = React.useState<EntraClientDiagnosticsResult[]>([]);
  const [clientProgress, setClientProgress] = React.useState<{ completed: number; total: number } | null>(null);
  const [clientError, setClientError] = React.useState<string | null>(null);
  const [clientRecommendations, setClientRecommendations] = React.useState<DiagnosticsRecommendation[]>([]);
  const [clientAggregate, setClientAggregate] = React.useState<Record<EntraClientOutcomeCategory, number> | null>(null);
  const [clientRunStartedAt, setClientRunStartedAt] = React.useState<string | null>(null);
  const [clientRunCompletedAt, setClientRunCompletedAt] = React.useState<string | null>(null);
  const [clientRunComplete, setClientRunComplete] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  // Staleness guard: increments on each open/close so late responses are dropped.
  const runTokenRef = React.useRef(0);
  const abortRef = React.useRef(false);

  const remedyText = React.useCallback(
    (rec: DiagnosticsRecommendation) => {
      if (rec.messageKey) {
        return t(`integrations.entra.diagnostics.remedies.${rec.messageKey}`, {
          defaultValue: rec.text,
          ...(rec.params ?? {}),
        });
      }
      return rec.text;
    },
    [t]
  );

  const stepTitle = React.useCallback(
    (step: EntraDiagnosticsStep) =>
      t(`integrations.entra.diagnostics.steps.${step.id}`, { defaultValue: step.title }),
    [t]
  );

  const runConnection = React.useCallback(
    async (token: number) => {
      setLoading(true);
      setError(null);
      setReadiness(null);
      setReport(null);
      try {
        const result = await runEntraConnectionDiagnostics();
        if (runTokenRef.current !== token) return;
        if ('error' in result) {
          setError(result.error || t('integrations.entra.diagnostics.errors.failed', { defaultValue: 'Diagnostics failed' }));
          setReadiness(((result as any).readiness as EntraDiagnosticsReadiness) ?? null);
          return;
        }
        setReport(result.data);
      } catch (e: any) {
        if (runTokenRef.current !== token) return;
        setError(e?.message || t('integrations.entra.diagnostics.errors.failed', { defaultValue: 'Diagnostics failed' }));
      } finally {
        if (runTokenRef.current === token) setLoading(false);
      }
    },
    [t]
  );

  React.useEffect(() => {
    if (!isOpen) {
      // Closing stops any in-flight continuations and invalidates responses.
      runTokenRef.current += 1;
      abortRef.current = true;
      setClientsRunning(false);
      // Prior client results belong to the previous session and are cleared so
      // they are never shown beside a fresh connection report.
      setClientResults([]);
      setClientProgress(null);
      setClientAggregate(null);
      setClientRecommendations([]);
      setClientError(null);
      setClientRunStartedAt(null);
      setClientRunCompletedAt(null);
      setClientRunComplete(false);
      return;
    }
    abortRef.current = false;
    const token = (runTokenRef.current += 1);
    void runConnection(token);
    void (async () => {
      try {
        const result = await getEntraConfirmedMappings();
        if (runTokenRef.current !== token) return;
        if (result.success && result.data) {
          const list = ((result.data as any).mappings ?? result.data) as EntraConfirmedMapping[];
          setMappings(list);
          setSelectedClients(list.map((m) => m.clientId));
        }
      } catch {
        if (runTokenRef.current === token) setMappings([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, runConnection]);

  const runClients = React.useCallback(
    async (clientIds: string[]) => {
      const token = runTokenRef.current;
      setClientsRunning(true);
      setClientError(null);
      setClientResults([]);
      setClientRecommendations([]);
      setClientAggregate(null);
      setClientProgress({ completed: 0, total: clientIds.length });
      setClientRunStartedAt(new Date().toISOString());
      setClientRunCompletedAt(null);
      setClientRunComplete(false);
      let continuation: string | undefined;
      let completed = 0;
      const accumulated: EntraClientDiagnosticsResult[] = [];
      try {
        do {
          if (abortRef.current || runTokenRef.current !== token) return;
          const response = await runEntraClientAccessDiagnostics({
            clientIds: continuation ? undefined : clientIds,
            includeUserYield: includeYield,
            continuation,
          });
          if (abortRef.current || runTokenRef.current !== token) return;
          if ('error' in response) {
            setClientError(response.error || t('integrations.entra.diagnostics.errors.clientFailed', { defaultValue: 'Client diagnostics failed' }));
            setClientResults([...accumulated]);
            return;
          }
          const payload: EntraClientDiagnosticsContinuation = response.data;
          if (payload.error) {
            setClientError(payload.error);
            setClientResults([...accumulated]);
            return;
          }
          accumulated.push(...payload.clients);
          completed = payload.completed;
          setClientResults([...accumulated]);
          setClientProgress({ completed, total: payload.total });
          setClientAggregate(payload.aggregate);
          if (payload.recommendations?.length) setClientRecommendations(payload.recommendations);
          // Completion requires the terminal response AND every client to be
          // genuinely complete (a resumable preview can leave one incomplete).
          const complete = payload.isDone && accumulated.every((c) => c.isComplete);
          setClientRunComplete(complete);
          setClientRunCompletedAt(complete ? payload.completedAt ?? new Date().toISOString() : null);
          continuation = payload.isDone ? undefined : payload.jobId;
          if (!continuation) break;
        } while (continuation);
      } catch (e: any) {
        if (runTokenRef.current === token) {
          setClientError(e?.message || 'Client diagnostics failed');
          setClientResults([...accumulated]);
        }
      } finally {
        if (runTokenRef.current === token) setClientsRunning(false);
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

  // Cross-reference client results with the latest per-tenant sync failures.
  const latestFailuresByClient = React.useMemo(() => {
    const map = new Map<string, { at: string | null; message: string | null }>();
    const step = report?.steps.find((s) => s.id === 'per_tenant_last_result');
    const failed = (step?.data as any)?.failedTenants;
    if (Array.isArray(failed)) {
      for (const tenant of failed) {
        if (tenant?.clientId) {
          map.set(tenant.clientId, {
            at: tenant.completedAt ?? null,
            message: tenant.errorMessage ?? null,
          });
        }
      }
    }
    return map;
  }, [report]);

  const buildExport = React.useCallback((): Record<string, unknown> => {
    const combined = {
      generatedAt: new Date().toISOString(),
      identifiersIncluded: includeIdentifiersExport,
      connection: report
        ? {
            createdAt: report.createdAt,
            scope: report.scope,
            summary: report.summary,
            steps: report.steps,
            recommendations: report.recommendations,
          }
        : null,
      clientRun: {
        // Honest completion: terminal response AND every client complete.
        isComplete: clientRunComplete,
        startedAt: clientRunStartedAt,
        completedAt: clientRunCompletedAt,
        completed: clientProgress?.completed ?? 0,
        total: clientProgress?.total ?? 0,
        aggregate: clientAggregate,
        recommendations: clientRecommendations,
        clients: clientResults.map((client) => ({
          ...client,
          latestSyncFailure: latestFailuresByClient.get(client.clientId) ?? null,
        })),
      },
    };
    return includeIdentifiersExport ? combined : (stripIdentifiers(combined) as Record<string, unknown>);
  }, [
    clientAggregate,
    clientProgress,
    clientRecommendations,
    clientResults,
    clientRunComplete,
    clientRunCompletedAt,
    clientRunStartedAt,
    includeIdentifiersExport,
    latestFailuresByClient,
    report,
  ]);

  const copySupportBundle = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(buildExport(), null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(buildExport(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `entra-diagnostics-${new Date().toISOString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const columns: ColumnDefinition<EntraClientDiagnosticsResult>[] = [
    {
      title: t('integrations.entra.diagnostics.clients.columns.client', { defaultValue: 'Client' }),
      dataIndex: 'clientName',
      render: (_v, record) =>
        record.clientName ||
        t('integrations.entra.diagnostics.clients.unavailableName', { defaultValue: 'Unavailable name' }),
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
      title: t('integrations.entra.diagnostics.clients.columns.complete', { defaultValue: 'Complete' }),
      dataIndex: 'isComplete',
      render: (_value, record) => (
        <Badge variant={record.isComplete ? 'success' : 'warning'}>
          {record.isComplete
            ? t('integrations.entra.diagnostics.clients.complete', { defaultValue: 'Complete' })
            : t('integrations.entra.diagnostics.clients.partial', { defaultValue: 'Partial' })}
        </Badge>
      ),
    },
    {
      title: t('integrations.entra.diagnostics.clients.columns.remedy', { defaultValue: 'Remedy' }),
      dataIndex: 'remedy',
      render: (value) => <span className="text-sm text-muted-foreground">{value || ''}</span>,
    },
  ];

  const footer = (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            id="entra-diag-export-identifiers"
            type="checkbox"
            checked={includeIdentifiersExport}
            onChange={(e) => setIncludeIdentifiersExport(e.target.checked)}
          />
          {t('integrations.entra.diagnostics.actions.includeIdentifiers', {
            defaultValue: 'Include identifiers in export',
          })}
        </label>
        <Button id="entra-diag-copy-bundle" type="button" size="sm" variant="outline" onClick={copySupportBundle}>
          <Copy className="mr-2 h-4 w-4" />
          {copied
            ? t('integrations.entra.diagnostics.actions.copied', { defaultValue: 'Copied' })
            : t('integrations.entra.diagnostics.actions.copySupportBundle', { defaultValue: 'Copy support bundle' })}
        </Button>
        <Button id="entra-diag-download-json" type="button" size="sm" variant="outline" onClick={downloadJson}>
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

        {readiness && !readiness.ok && (
          <div className="mb-3 rounded border border-destructive/40 bg-destructive/10 p-3" id="entra-diag-readiness">
            <div className="text-sm font-medium">
              {t('integrations.entra.diagnostics.labels.readiness', { defaultValue: 'Access readiness' })}
            </div>
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {readiness.checks.map((check) => (
                <li key={check.key}>
                  {check.ok ? '✓' : '✗'}{' '}
                  {t(`integrations.entra.diagnostics.readiness.${check.key}`, { defaultValue: check.key })}
                  {check.detail ? ` — ${check.detail}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

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
                {t(`integrations.entra.diagnostics.statuses.${report.summary.overallStatus}`, {
                  defaultValue: report.summary.overallStatus,
                })}
              </Badge>
              {report.summary.authenticatedUpn && (
                <span className="text-xs text-muted-foreground">{report.summary.authenticatedUpn}</span>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {[
                ['connectionType', report.summary.connectionType ?? '—'],
                ['status', report.summary.connectionStatus ?? '—'],
                ['mappedClients', report.summary.mappedClientCount ?? '—'],
                ['managedTenants', report.summary.managedTenantCount ?? '—'],
              ].map(([key, value]) => (
                <div key={String(key)}>
                  <dt className="text-muted-foreground">
                    {t(`integrations.entra.diagnostics.labels.${key}`, { defaultValue: String(key) })}
                  </dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>

            {report.recommendations.length > 0 && (
              <div className="rounded border p-3" id="entra-diag-recommendations">
                <div className="mb-2 text-sm font-medium">
                  {t('integrations.entra.diagnostics.labels.recommendations', { defaultValue: 'Recommendations' })}
                </div>
                <ul className="space-y-2">
                  {report.recommendations.map((rec) => (
                    <li
                      key={`${rec.code}-${rec.action?.payload ?? ''}-${JSON.stringify(rec.params ?? {})}`}
                      className="flex items-start justify-between gap-2 text-sm"
                    >
                      <span>
                        <Badge
                          size="sm"
                          variant={rec.severity === 'fail' ? 'error' : rec.severity === 'warn' ? 'warning' : 'secondary'}
                        >
                          {rec.severity}
                        </Badge>{' '}
                        {remedyText(rec)}
                      </span>
                      {rec.action && (
                        <Button
                          id={`entra-diag-rec-${rec.code}`}
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (rec.action!.kind === 'copy') void navigator.clipboard.writeText(rec.action!.payload);
                            else if (rec.action!.kind === 'open_url')
                              window.open(rec.action!.payload, '_blank', 'noopener,noreferrer');
                            else onNavigate?.(rec.action!.payload);
                          }}
                          className="gap-1"
                        >
                          {rec.action.kind === 'copy' ? (
                            <Copy className="h-3.5 w-3.5" />
                          ) : (
                            <ExternalLink className="h-3.5 w-3.5" />
                          )}
                          {t(`integrations.entra.diagnostics.actions.${rec.action.kind}`, {
                            defaultValue: rec.action.kind,
                          })}
                        </Button>
                      )}
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
                      <span className="truncate font-medium">{stepTitle(step)}</span>
                      <span className="text-xs text-muted-foreground">({step.durationMs}ms)</span>
                    </span>
                    <Badge variant={statusVariant(step.status)}>
                      {t(`integrations.entra.diagnostics.statuses.${step.status}`, {
                        defaultValue: step.status,
                      })}
                    </Badge>
                  </summary>
                  <div className="mt-2 space-y-2 text-sm">
                    {step.blockedBy && (
                      <div className="text-xs text-muted-foreground">
                        {t('integrations.entra.diagnostics.labels.blockedBy', { defaultValue: 'Blocked by' })}:{' '}
                        {step.blockedBy}
                      </div>
                    )}
                    {step.http && (
                      <div className="text-xs text-muted-foreground">
                        {step.http.method} {step.http.path || step.http.url || ''}{' '}
                        {typeof step.http.status === 'number' ? `· ${step.http.status}` : ''}
                        {step.http.requestId ? ` · request-id: ${step.http.requestId}` : ''}
                        {step.http.clientRequestId ? ` · client-request-id: ${step.http.clientRequestId}` : ''}
                      </div>
                    )}
                    {step.error && (
                      <div className="rounded border border-destructive/30 bg-destructive/10 p-2">
                        <div className="font-medium">
                          {t('integrations.entra.diagnostics.labels.error', { defaultValue: 'Error' })}
                        </div>
                        <div>{step.error.message}</div>
                        <div className="mt-1 space-x-2 text-xs text-muted-foreground">
                          {step.error.status ? <span>HTTP {step.error.status}</span> : null}
                          {step.error.code ? <span>code: {step.error.code}</span> : null}
                          {step.error.aadstsCode ? <span>{step.error.aadstsCode}</span> : null}
                          {step.error.oauthError ? <span>oauth: {step.error.oauthError}</span> : null}
                          {step.error.suberror ? <span>suberror: {step.error.suberror}</span> : null}
                          {step.error.requestId ? <span>request-id: {step.error.requestId}</span> : null}
                        </div>
                      </div>
                    )}
                    {step.id === 'expected_app_registration_values' && step.data ? (
                      <div className="space-y-1 text-xs">
                        {[
                          ['callbackUrl', (step.data as any).callbackUrl],
                          ['delegatedScopes', ((step.data as any).delegatedScopes ?? []).join(' ')],
                          ['accountTypeRequirement', (step.data as any).accountTypeRequirement],
                          ['boundClientId', (step.data as any).boundClientId],
                        ].map(([key, value]) =>
                          value ? (
                            <div key={String(key)} className="flex items-center gap-2">
                              <span className="font-medium">{String(key)}:</span>
                              <code className="break-all">{String(value)}</code>
                              <Button
                                id={`entra-diag-copy-${key}`}
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => void navigator.clipboard.writeText(String(value))}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : null
                        )}
                      </div>
                    ) : step.data ? (
                      <pre className="overflow-auto rounded bg-muted p-2 text-xs">
                        {JSON.stringify(step.data, null, 2)}
                      </pre>
                    ) : null}
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
                <Button
                  id="entra-diag-select-all"
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedClients(mappings.map((m) => m.clientId))}
                >
                  {t('integrations.entra.diagnostics.clients.selectAll', { defaultValue: 'Select all' })}
                </Button>
                <Button
                  id="entra-diag-clear"
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedClients([])}
                >
                  {t('integrations.entra.diagnostics.clients.clear', { defaultValue: 'Clear' })}
                </Button>
                <Checkbox
                  id="entra-diag-yield-toggle"
                  checked={includeYield}
                  onChange={(event) => setIncludeYield(event.target.checked)}
                  disabled={clientsRunning}
                  label={t('integrations.entra.diagnostics.clients.yieldToggle', {
                    defaultValue: 'User yield preview (more expensive)',
                  })}
                />
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
                {clientRunStartedAt && (
                  <span className="text-xs text-muted-foreground" id="entra-diag-client-run-window">
                    {clientRunStartedAt}
                    {clientRunCompletedAt ? ` → ${clientRunCompletedAt}` : ' …'}
                    {!clientRunComplete && clientProgress ? ' (partial)' : ''}
                  </span>
                )}
              </div>

              {mappings.length > 0 && (
                <div
                  className="max-h-40 overflow-auto rounded border p-2 text-sm"
                  id="entra-diag-client-picker"
                >
                  {mappings.map((mapping) => (
                    <Checkbox
                      key={mapping.clientId}
                      id={`entra-diag-client-${mapping.clientId}`}
                      containerClassName="py-0.5"
                      checked={selectedClients.includes(mapping.clientId)}
                      onChange={(event) =>
                        setSelectedClients((prev) =>
                          event.target.checked
                            ? [...new Set([...prev, mapping.clientId])]
                            : prev.filter((id) => id !== mapping.clientId)
                        )
                      }
                      disabled={clientsRunning}
                      label={
                        mapping.clientName ||
                        mapping.displayName ||
                        t('integrations.entra.diagnostics.clients.unavailableName', {
                          defaultValue: 'Unavailable name',
                        })
                      }
                    />
                  ))}
                </div>
              )}

              {clientError && (
                <div className="text-sm text-destructive" role="alert">
                  {clientError}
                </div>
              )}

              {clientAggregate && (
                <div className="flex flex-wrap gap-2 text-xs" id="entra-diag-client-aggregate">
                  {CATEGORY_ORDER.map((category) => (
                    <Badge key={category} variant={clientAggregate[category] > 0 ? 'secondary' : 'default-muted'}>
                      {t(`integrations.entra.diagnostics.clients.categories.${category}`, {
                        defaultValue: category,
                      })}
                      : {clientAggregate[category]}
                    </Badge>
                  ))}
                </div>
              )}

              {clientRecommendations.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground" id="entra-diag-client-recommendations">
                  {clientRecommendations.map((rec) => (
                    <li key={`${rec.code}-${JSON.stringify(rec.params ?? {})}`}>{remedyText(rec)}</li>
                  ))}
                </ul>
              )}

              {clientResults.length > 0 && (
                <DataTable
                  id="entra-diagnostics-client-table"
                  data={clientResults}
                  columns={columns}
                  expandedRowRender={(record) => (
                    <div className="space-y-2 p-2 text-xs">
                      <div className="text-muted-foreground">
                        {t('integrations.entra.diagnostics.clients.details.completed', {
                          defaultValue: 'Complete',
                        })}
                        : {record.isComplete ? 'yes' : 'no'}
                      </div>
                      {latestFailuresByClient.get(record.clientId) && (
                        <div className="rounded bg-muted p-2">
                          <div className="font-medium">
                            {t('integrations.entra.diagnostics.clients.details.latestSyncFailure', {
                              defaultValue: 'Latest sync failure',
                            })}
                          </div>
                          <div>
                            {latestFailuresByClient.get(record.clientId)?.at ?? ''}{' '}
                            {latestFailuresByClient.get(record.clientId)?.message ?? ''}
                          </div>
                        </div>
                      )}
                      <pre className="overflow-auto rounded bg-muted p-2">{JSON.stringify(record.steps, null, 2)}</pre>
                    </div>
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
