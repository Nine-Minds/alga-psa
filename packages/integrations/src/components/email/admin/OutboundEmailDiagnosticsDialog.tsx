/**
 * Shared Outbound Email Diagnostics Dialog
 *
 * Reachable from both CE and hosted EE outbound email tabs. Runs the saved
 * provider through the shared diagnostics checklist, shows identities and
 * protocol evidence, and offers an explicit, off-by-default live send.
 */

'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Dialog, DialogContent, DialogDescription, DialogHeader } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { CheckCircle, AlertCircle, XCircle, Clock, Copy, Download, Send, RefreshCw } from 'lucide-react';
import type {
  OutboundEmailDiagnosticsReport,
  OutboundStep,
} from '@alga-psa/email';
import { runOutboundEmailDiagnostics } from '../../../actions/email-actions/emailSettingsActions';

function statusIcon(status: OutboundStep['status']) {
  switch (status) {
    case 'pass':
      return <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />;
    case 'warn':
      return <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />;
    case 'fail':
      return <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />;
    case 'skip':
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function OutboundEmailDiagnosticsDialog({
  isOpen,
  onClose,
  hasUnsavedChanges = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  hasUnsavedChanges?: boolean;
}) {
  const { t } = useTranslation('msp/admin');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<OutboundEmailDiagnosticsReport | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [liveSendEnabled, setLiveSendEnabled] = React.useState(false);
  const [recipient, setRecipient] = React.useState('');
  const [recipientError, setRecipientError] = React.useState<string | null>(null);

  const runDiagnostics = React.useCallback(async (withLiveSend: boolean) => {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const result = await runOutboundEmailDiagnostics({
        liveSendTest: withLiveSend,
        recipient: withLiveSend ? recipient.trim() : undefined,
      });
      if (!result.success || !result.report) {
        setError(result.error || t('outboundDiagnostics.states.failed', { defaultValue: 'Diagnostics failed' }));
        return;
      }
      setReport(result.report);
    } catch (e: any) {
      setError(e?.message || t('outboundDiagnostics.states.failed', { defaultValue: 'Diagnostics failed' }));
    } finally {
      setLoading(false);
    }
  }, [recipient, t]);

  React.useEffect(() => {
    if (!isOpen) return;
    setReport(null);
    setError(null);
    setLiveSendEnabled(false);
    setRecipientError(null);
    void runDiagnostics(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleLiveSend = () => {
    const trimmed = recipient.trim();
    if (!trimmed || !EMAIL_PATTERN.test(trimmed)) {
      setRecipientError(
        t('outboundDiagnostics.liveSend.invalidRecipient', { defaultValue: 'Enter a valid recipient email address.' }),
      );
      return;
    }
    setRecipientError(null);
    void runDiagnostics(true);
  };

  const bundleJson = React.useMemo(
    () => (report ? JSON.stringify(report.supportBundle, null, 2) : ''),
    [report],
  );

  const copySupportBundle = async () => {
    if (!bundleJson) return;
    try {
      await navigator.clipboard.writeText(bundleJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const downloadSupportBundle = () => {
    if (!bundleJson) return;
    const blob = new Blob([bundleJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `outbound-diagnostics-${report?.createdAt ?? 'report'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const renderStatusBadge = (status: OutboundStep['status']) => {
    switch (status) {
      case 'pass':
        return <Badge variant="success">{t('outboundDiagnostics.statuses.pass', { defaultValue: 'Pass' })}</Badge>;
      case 'warn':
        return <Badge variant="warning">{t('outboundDiagnostics.statuses.warn', { defaultValue: 'Warn' })}</Badge>;
      case 'fail':
        return <Badge variant="error">{t('outboundDiagnostics.statuses.fail', { defaultValue: 'Fail' })}</Badge>;
      case 'skip':
      default:
        return <Badge variant="secondary">{t('outboundDiagnostics.statuses.skip', { defaultValue: 'Skip' })}</Badge>;
    }
  };

  const footer = (
    <div className="flex justify-end space-x-2">
      <Button id="outbound-diagnostics-close" variant="outline" onClick={onClose}>
        {t('common.actions.close', { defaultValue: 'Close' })}
      </Button>
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('outboundDiagnostics.title', { defaultValue: 'Outbound Email Diagnostics' })}
      id="outbound-email-diagnostics"
      className="max-w-4xl"
      footer={footer}
    >
      <DialogContent>
        <DialogHeader>
          <DialogDescription>
            {t('outboundDiagnostics.description', {
              defaultValue:
                'Runs the saved outbound configuration through a provider checklist. No message is sent unless you explicitly enable the live send option below.',
            })}
          </DialogDescription>
        </DialogHeader>

        {hasUnsavedChanges && (
          <Alert>
            <AlertDescription>
              {t('outboundDiagnostics.unsavedNotice', {
                defaultValue: 'Unsaved changes on this screen are not included. Save settings before running diagnostics.',
              })}
            </AlertDescription>
          </Alert>
        )}

        {loading && (
          <div className="flex items-center justify-center p-6">
            <LoadingIndicator
              layout="stacked"
              text={t('outboundDiagnostics.states.running', { defaultValue: 'Running diagnostics...' })}
              spinnerProps={{ size: 'md' }}
            />
          </div>
        )}

        {error && !loading && (
          <div className="space-y-3">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button
              id="outbound-diagnostics-retry"
              variant="outline"
              onClick={() => void runDiagnostics(false)}
              disabled={loading}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('outboundDiagnostics.actions.retry', { defaultValue: 'Retry' })}
            </Button>
          </div>
        )}

        {report && !loading && (
          <div className="space-y-4">
            <div className="text-sm space-y-1">
              <div>
                {t('outboundDiagnostics.labels.overall', { defaultValue: 'Overall:' })}{' '}
                <span className="font-medium">
                  {t(`outboundDiagnostics.statuses.${report.summary.overallStatus}`, {
                    defaultValue: report.summary.overallStatus.toUpperCase(),
                  })}
                </span>
              </div>
              <div className="text-muted-foreground">
                {t('outboundDiagnostics.labels.provider', { defaultValue: 'Provider:' })}{' '}
                <span className="text-foreground">{report.summary.providerType}</span>
                {report.summary.effectiveSender && (
                  <>
                    {' · '}
                    {t('outboundDiagnostics.labels.effectiveSender', { defaultValue: 'Effective sender:' })}{' '}
                    <span className="text-foreground">
                      {report.summary.effectiveSenderName
                        ? `${report.summary.effectiveSenderName} <${report.summary.effectiveSender}>`
                        : report.summary.effectiveSender}
                    </span>
                  </>
                )}
                {report.summary.authenticatedUserEmail && (
                  <>
                    {' · '}
                    {t('outboundDiagnostics.labels.authorizedUser', { defaultValue: 'Authorized user:' })}{' '}
                    <span className="text-foreground">{report.summary.authenticatedUserEmail}</span>
                  </>
                )}
                {report.summary.mailboxBasePath && (
                  <>
                    {' · '}
                    {t('outboundDiagnostics.labels.mailboxRoute', { defaultValue: 'Mailbox route:' })}{' '}
                    <span className="text-foreground">{report.summary.mailboxBasePath}</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button id="outbound-diagnostics-copy-bundle" variant="outline" size="sm" onClick={copySupportBundle}>
                <Copy className="h-4 w-4 mr-2" />
                {copied
                  ? t('outboundDiagnostics.actions.copied', { defaultValue: 'Copied' })
                  : t('outboundDiagnostics.actions.copyBundle', { defaultValue: 'Copy Support Bundle' })}
              </Button>
              <Button
                id="outbound-diagnostics-download-bundle"
                variant="outline"
                size="sm"
                onClick={downloadSupportBundle}
              >
                <Download className="h-4 w-4 mr-2" />
                {t('outboundDiagnostics.actions.downloadBundle', { defaultValue: 'Download' })}
              </Button>
              <Button
                id="outbound-diagnostics-rerun"
                variant="outline"
                size="sm"
                onClick={() => void runDiagnostics(false)}
                disabled={loading}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('outboundDiagnostics.actions.rerun', { defaultValue: 'Run again' })}
              </Button>
              <span className="text-xs text-muted-foreground">
                {t('outboundDiagnostics.labels.redacted', {
                  defaultValue: 'Support export redacts mailbox identifiers by default.',
                })}
              </span>
            </div>

            {report.recommendations.length > 0 && (
              <Alert>
                <AlertDescription>
                  <div className="font-medium mb-1">
                    {t('outboundDiagnostics.labels.recommendations', { defaultValue: 'Recommendations' })}
                  </div>
                  <ul className="list-disc pl-5 space-y-1">
                    {report.recommendations.map((recommendation) => (
                      <li key={recommendation}>{recommendation}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="border rounded-md divide-y">
              {report.steps.map((step) => (
                <details key={step.id} className="p-3">
                  <summary className="cursor-pointer select-none flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {statusIcon(step.status)}
                      <span className="font-medium truncate">{step.title}</span>
                      <span className="text-xs text-muted-foreground">({step.durationMs}ms)</span>
                    </div>
                    <div className="shrink-0">{renderStatusBadge(step.status)}</div>
                  </summary>
                  <div className="mt-2 text-sm space-y-2">
                    {step.detail && <div className="text-muted-foreground">{step.detail}</div>}
                    {step.http && (
                      <div className="text-xs text-muted-foreground">
                        {step.http.method} {step.http.path || step.http.url || ''}{' '}
                        {typeof step.http.status === 'number' ? `· ${step.http.status}` : ''}
                        {step.http.requestId ? ` · request-id: ${step.http.requestId}` : ''}
                        {step.http.clientRequestId ? ` · client-request-id: ${step.http.clientRequestId}` : ''}
                      </div>
                    )}
                    {step.error && (
                      <div className="text-destructive bg-destructive/10 border border-destructive/30 rounded p-2">
                        <div className="font-medium">
                          {t('outboundDiagnostics.labels.error', { defaultValue: 'Error' })}
                        </div>
                        <div>{step.error.message}</div>
                        <div className="text-xs mt-1">
                          {step.error.status ? `status: ${step.error.status}` : ''}
                          {step.error.code ? ` · code: ${step.error.code}` : ''}
                          {step.error.requestId ? ` · request-id: ${step.error.requestId}` : ''}
                          {step.error.clientRequestId ? ` · client-request-id: ${step.error.clientRequestId}` : ''}
                        </div>
                      </div>
                    )}
                    {step.data && (
                      <pre className="text-xs bg-muted rounded p-2 overflow-auto">
                        {JSON.stringify(step.data, null, 2)}
                      </pre>
                    )}
                  </div>
                </details>
              ))}
            </div>

            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="outbound-diagnostics-live-send"
                  checked={liveSendEnabled}
                  onChange={(event) => setLiveSendEnabled(event.target.checked)}
                />
                <Label htmlFor="outbound-diagnostics-live-send">
                  {t('outboundDiagnostics.liveSend.label', { defaultValue: 'Send one test message (live)' })}
                </Label>
              </div>
              {liveSendEnabled && (
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Label htmlFor="outbound-diagnostics-recipient">
                      {t('outboundDiagnostics.liveSend.recipient', { defaultValue: 'Recipient' })}
                    </Label>
                    <Input
                      id="outbound-diagnostics-recipient"
                      type="email"
                      value={recipient}
                      placeholder="you@example.com"
                      onChange={(event) => setRecipient(event.target.value)}
                    />
                    {recipientError && <p className="text-xs text-destructive mt-1">{recipientError}</p>}
                  </div>
                  <Button
                    id="outbound-diagnostics-run-live-send"
                    variant="outline"
                    onClick={handleLiveSend}
                    disabled={loading}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    {t('outboundDiagnostics.liveSend.run', { defaultValue: 'Run with live send' })}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
