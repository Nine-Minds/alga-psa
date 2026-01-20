/**
 * Microsoft 365 Inbound Email Diagnostics Dialog
 * Runs a checklist against Microsoft Graph to help troubleshoot mailbox/folder/subscription issues.
 */

'use client';

import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { CheckCircle, AlertCircle, XCircle, Clock, Copy } from 'lucide-react';
import type { EmailProvider } from '../types';
import { runMicrosoft365Diagnostics } from '@alga-psa/integrations/actions';
import type { Microsoft365DiagnosticsReport, Microsoft365DiagnosticsStep } from '@alga-psa/shared/interfaces/microsoft365-diagnostics.interfaces';

function statusIcon(status: Microsoft365DiagnosticsStep['status']) {
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

function statusBadge(status: Microsoft365DiagnosticsStep['status']) {
  switch (status) {
    case 'pass':
      return <Badge className="bg-green-100 text-green-800">Pass</Badge>;
    case 'warn':
      return <Badge className="bg-yellow-100 text-yellow-800">Warn</Badge>;
    case 'fail':
      return <Badge variant="error">Fail</Badge>;
    case 'skip':
    default:
      return <Badge variant="secondary">Skip</Badge>;
  }
}

export function Microsoft365DiagnosticsDialog({
  isOpen,
  onClose,
  provider,
}: {
  isOpen: boolean;
  onClose: () => void;
  provider: EmailProvider | null;
}) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<Microsoft365DiagnosticsReport | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!isOpen || !provider) return;
      if (provider.providerType !== 'microsoft') return;

      setLoading(true);
      setError(null);
      setReport(null);
      setCopied(false);

      try {
        const result = await runMicrosoft365Diagnostics(provider.id);
        if (cancelled) return;
        if (!result.success || !result.report) {
          setError(result.error || 'Diagnostics failed');
          return;
        }
        setReport(result.report);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'Diagnostics failed');
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

  const title = provider?.providerType === 'microsoft'
    ? 'Microsoft 365 Diagnostics'
    : 'Diagnostics';

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={title} id="microsoft-365-diagnostics">
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Runs a live Graph check (including create+delete subscription) to diagnose mailbox, folder, and permission issues.
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <AlertDescription>
            <span className="font-medium">Note:</span> Diagnostics will create a temporary Microsoft Graph subscription and then delete it.
            If deletion fails, you may need to manually remove the subscription in Microsoft 365.
          </AlertDescription>
        </Alert>

        {provider && (
          <div className="text-sm text-muted-foreground mb-4">
            Provider: <span className="font-medium text-foreground">{provider.providerName}</span> · Mailbox:{' '}
            <span className="font-medium text-foreground">{provider.mailbox}</span>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center p-6">
            <LoadingIndicator layout="stacked" text="Running diagnostics..." spinnerProps={{ size: 'md' }} />
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
                Overall: <span className="font-medium">{report.summary.overallStatus.toUpperCase()}</span>{' '}
                {report.summary.targetResource && (
                  <span className="text-muted-foreground">· Resource: {report.summary.targetResource}</span>
                )}
              </div>
              <Button id="m365-diag-copy-bundle" variant="outline" size="sm" onClick={copySupportBundle}>
                <Copy className="h-4 w-4 mr-2" />
                {copied ? 'Copied' : 'Copy Support Bundle'}
              </Button>
            </div>

            {report.recommendations?.length > 0 && (
              <Alert>
                <AlertDescription>
                  <div className="font-medium mb-1">Recommendations</div>
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
                    <div className="shrink-0">{statusBadge(step.status)}</div>
                  </summary>
                  <div className="mt-2 text-sm space-y-2">
                    {step.http && (
                      <div className="text-xs text-muted-foreground">
                        {step.http.method} {step.http.path || step.http.url || ''}{' '}
                        {typeof step.http.status === 'number' ? `· ${step.http.status}` : ''}
                        {step.http.requestId ? ` · request-id: ${step.http.requestId}` : ''}
                        {step.http.clientRequestId ? ` · client-request-id: ${step.http.clientRequestId}` : ''}
                      </div>
                    )}
                    {step.error && (
                      <div className="text-red-700 bg-red-50 border border-red-200 rounded p-2">
                        <div className="font-medium">Error</div>
                        <div>{step.error.message}</div>
                        <div className="text-xs mt-1">
                          {step.error.status ? `status: ${step.error.status}` : ''}
                          {step.error.code ? ` · code: ${step.error.code}` : ''}
                          {step.error.requestId ? ` · request-id: ${step.error.requestId}` : ''}
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

        <DialogFooter>
          <Button id="m365-diag-close" variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
