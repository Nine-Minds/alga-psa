/**
 * Gmail Inbound Delivery Diagnostics Dialog
 * Checks live Google state — topic, publisher permission, push audience, watch,
 * and last accepted push — against what this instance expects.
 */

'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Dialog, DialogContent, DialogDescription, DialogHeader } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { CheckCircle, AlertCircle, XCircle, Clock, Copy } from 'lucide-react';
import type { EmailProvider } from '../types';
import { runGmailDiagnostics } from '@alga-psa/integrations/actions';
import type { GmailDiagnosticsReport, GmailDiagnosticsStep } from '@alga-psa/shared/interfaces/gmail-diagnostics.interfaces';

function statusIcon(status: GmailDiagnosticsStep['status']) {
  switch (status) {
    case 'pass':
      return <CheckCircle className="h-4 w-4 text-green-600" />;
    case 'warn':
      return <AlertCircle className="h-4 w-4 text-yellow-600" />;
    case 'fail':
      return <XCircle className="h-4 w-4 text-red-600" />;
    case 'skip':
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

export function GmailDiagnosticsDialog({
  isOpen,
  onClose,
  provider,
}: {
  isOpen: boolean;
  onClose: () => void;
  provider: EmailProvider | null;
}) {
  const { t } = useTranslation('msp/admin');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<GmailDiagnosticsReport | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!isOpen || !provider) return;
      if (provider.providerType !== 'google') return;

      setLoading(true);
      setError(null);
      setReport(null);
      setCopied(false);

      try {
        const result = await runGmailDiagnostics(provider.id);
        if (cancelled) return;
        if (!result.success || !result.report) {
          setError(result.error || t('gmailDiagnostics.states.diagnosticsFailed', { defaultValue: 'Diagnostics failed' }));
          return;
        }
        setReport(result.report);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || t('gmailDiagnostics.states.diagnosticsFailed', { defaultValue: 'Diagnostics failed' }));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [isOpen, provider?.id]);

  const copySupportBundle = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report.supportBundle, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setCopied(false);
    }
  };

  const renderStatusBadge = (status: GmailDiagnosticsStep['status']) => {
    switch (status) {
      case 'pass':
        return <Badge variant="success">{t('gmailDiagnostics.statuses.pass', { defaultValue: 'Pass' })}</Badge>;
      case 'warn':
        return <Badge variant="warning">{t('gmailDiagnostics.statuses.warn', { defaultValue: 'Warn' })}</Badge>;
      case 'fail':
        return <Badge variant="error">{t('gmailDiagnostics.statuses.fail', { defaultValue: 'Fail' })}</Badge>;
      case 'skip':
      default:
        return <Badge variant="secondary">{t('gmailDiagnostics.statuses.skip', { defaultValue: 'Skip' })}</Badge>;
    }
  };

  const overallStatusKey = `gmailDiagnostics.statuses.${report?.summary.overallStatus ?? 'skip'}`;
  const audienceMismatch = Boolean(
    report?.summary.expectedWebhookUrl &&
      report.summary.actualAudience &&
      report.summary.expectedWebhookUrl !== report.summary.actualAudience
  );

  const footer = (
    <div className="flex justify-end space-x-2">
      <Button id="gmail-diag-close" variant="outline" onClick={onClose}>
        {t('common.actions.close', { defaultValue: 'Close' })}
      </Button>
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('gmailDiagnostics.title', { defaultValue: 'Gmail Delivery Diagnostics' })}
      id="gmail-diagnostics"
      footer={footer}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogDescription>
            {t('gmailDiagnostics.description', {
              defaultValue:
                'Checks the Pub/Sub topic, its permissions, the push endpoint and audience, the Gmail watch, and when a push last arrived.',
            })}
          </DialogDescription>
        </DialogHeader>

        {provider && (
          <div className="text-sm text-muted-foreground mb-4">
            {t('gmailDiagnostics.labels.provider', { defaultValue: 'Provider:' })}{' '}
            <span className="font-medium text-foreground">{provider.providerName}</span> ·{' '}
            {t('gmailDiagnostics.labels.mailbox', { defaultValue: 'Mailbox:' })}{' '}
            <span className="font-medium text-foreground">{provider.mailbox}</span>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center p-6">
            <LoadingIndicator
              layout="stacked"
              text={t('gmailDiagnostics.states.running', { defaultValue: 'Running diagnostics...' })}
              spinnerProps={{ size: 'md' }}
            />
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {report && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                {t('gmailDiagnostics.labels.overall', { defaultValue: 'Overall:' })}{' '}
                <span className="font-medium">
                  {t(overallStatusKey, { defaultValue: report.summary.overallStatus.toUpperCase() })}
                </span>
              </div>
              <Button id="gmail-diag-copy-bundle" variant="outline" size="sm" onClick={copySupportBundle}>
                <Copy className="h-4 w-4 mr-2" />
                {copied
                  ? t('gmailDiagnostics.actions.copied', { defaultValue: 'Copied' })
                  : t('gmailDiagnostics.actions.copySupportBundle', { defaultValue: 'Copy Support Bundle' })}
              </Button>
            </div>

            {audienceMismatch && (
              <Alert variant="destructive" id="gmail-diag-audience-mismatch">
                <AlertDescription>
                  <div className="font-medium mb-1">
                    {t('gmailDiagnostics.audienceMismatch.title', { defaultValue: 'Push audience does not match this instance' })}
                  </div>
                  <div className="text-sm">
                    {t('gmailDiagnostics.audienceMismatch.expected', { defaultValue: 'Expected:' })}{' '}
                    <code className="font-mono">{report.summary.expectedWebhookUrl}</code>
                  </div>
                  <div className="text-sm">
                    {t('gmailDiagnostics.audienceMismatch.actual', { defaultValue: 'Google is using:' })}{' '}
                    <code className="font-mono">{report.summary.actualAudience}</code>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {report.recommendations?.length > 0 && (
              <Alert>
                <AlertDescription>
                  <div className="font-medium mb-1">
                    {t('gmailDiagnostics.labels.recommendations', { defaultValue: 'Recommendations' })}
                  </div>
                  <ul className="list-disc pl-5 space-y-1">
                    {report.recommendations.map((r) => (
                      <li key={r}>{r}</li>
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
                    {step.remediation && <div>{step.remediation}</div>}
                    {step.error && (
                      <div className="text-destructive bg-destructive/10 border border-destructive/30 rounded p-2">
                        <div className="font-medium">
                          {t('gmailDiagnostics.labels.error', { defaultValue: 'Error' })}
                        </div>
                        <div>{step.error.message}</div>
                        <div className="text-xs mt-1">
                          {step.error.status ? `status: ${step.error.status}` : ''}
                          {step.error.code ? ` · code: ${step.error.code}` : ''}
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
