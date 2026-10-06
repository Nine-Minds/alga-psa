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
  const [sendingTest, setSendingTest] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<OutboundEmailDiagnosticsReport | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [copyError, setCopyError] = React.useState<string | null>(null);
  const [liveSendEnabled, setLiveSendEnabled] = React.useState(false);
  const [recipient, setRecipient] = React.useState('');
  const [recipientError, setRecipientError] = React.useState<string | null>(null);

  const runDiagnostics = React.useCallback(async (withLiveSend: boolean) => {
    setLoading(true);
    setSendingTest(withLiveSend);
    setReport(null);
    setError(null);
    setCopied(false);
    setCopyError(null);
    try {
      const result = await runOutboundEmailDiagnostics({
        liveSendTest: withLiveSend,
        recipient: withLiveSend ? recipient.trim() : undefined,
      });
      if (!result.success || !result.report) {
        setError(withLiveSend
          ? t('outboundDiagnostics.liveSend.unconfirmed', { defaultValue: 'We could not confirm whether the test email was sent. Check the recipient’s inbox before trying again.' })
          : result.error || t('outboundDiagnostics.states.failed', { defaultValue: 'Could not check email settings. Try again.' }));
        return;
      }
      setReport(result.report);
    } catch {
      setError(withLiveSend
        ? t('outboundDiagnostics.liveSend.unconfirmed', { defaultValue: 'We could not confirm whether the test email was sent. Check the recipient’s inbox before trying again.' })
        : t('outboundDiagnostics.states.failed', { defaultValue: 'Could not check email settings. Try again.' }));
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
    setCopyError(null);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(bundleJson);
      } else {
        // HTTP installations lack the Clipboard API. Keep the selection inside
        // the dialog so its focus trap does not interrupt the copy command.
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const textarea = document.createElement('textarea');
        textarea.value = bundleJson;
        textarea.readOnly = true;
        textarea.tabIndex = -1;
        textarea.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
        const container = document.getElementById('outbound-diagnostics-copy-bundle')?.closest('[role="dialog"]') || document.body;
        container.appendChild(textarea);
        try {
          textarea.focus();
          textarea.select();
          if (!document.execCommand('copy')) throw new Error('Clipboard copy failed');
        } finally {
          textarea.remove();
          previousFocus?.focus();
        }
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
      setCopyError(t('outboundDiagnostics.copyReportFailed', {
        defaultValue: 'Could not copy the report. Use Download report to save it as a file.',
      }));
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
        return <Badge variant="success">{t('outboundDiagnostics.checkStatus.pass', { defaultValue: 'Passed' })}</Badge>;
      case 'warn':
        return <Badge variant="warning">{t('outboundDiagnostics.checkStatus.warn', { defaultValue: 'Needs attention' })}</Badge>;
      case 'fail':
        return <Badge variant="error">{t('outboundDiagnostics.checkStatus.fail', { defaultValue: 'Failed' })}</Badge>;
      case 'skip':
      default:
        return <Badge variant="secondary">{t('outboundDiagnostics.checkStatus.skip', { defaultValue: 'Not checked' })}</Badge>;
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
            {t('outboundDiagnostics.introduction', {
              defaultValue:
                'Check your saved email settings. Sending a test email is optional.',
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
              text={sendingTest
                ? t('outboundDiagnostics.liveSend.sending', { defaultValue: 'Sending test email…' })
                : t('outboundDiagnostics.states.checking', { defaultValue: 'Checking email settings…' })}
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
            <div className="text-sm space-y-2">
              <p className="font-medium" role="status">
                {t(`outboundDiagnostics.result.${report.summary.overallStatus}`, {
                  defaultValue: report.summary.overallStatus === 'pass'
                    ? 'Setup checks passed'
                    : report.summary.overallStatus === 'fail'
                      ? 'An email check failed'
                      : 'Some checks could not be completed',
                })}
              </p>
              {!report.summary.liveSendPerformed && (
                <p className="text-muted-foreground">{t('outboundDiagnostics.noTestSent', { defaultValue: 'These checks did not send an email.' })}</p>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">{t('outboundDiagnostics.emailService', { defaultValue: 'Email service' })}</dt>
                <dd>{{ microsoft: 'Microsoft 365', smtp: 'SMTP', resend: 'Resend' }[report.summary.providerType]}</dd>
                {report.summary.effectiveSender && <>
                  <dt className="text-muted-foreground">{t('outboundDiagnostics.sender', { defaultValue: 'From' })}</dt>
                  <dd className="break-words">{report.summary.effectiveSenderName
                    ? `${report.summary.effectiveSenderName} <${report.summary.effectiveSender}>`
                    : report.summary.effectiveSender}</dd>
                </>}
                {report.summary.authenticatedUserEmail && report.summary.authenticatedUserEmail.toLowerCase() !== report.summary.effectiveSender?.toLowerCase() && <>
                  <dt className="text-muted-foreground">{t('outboundDiagnostics.connectedAccount', { defaultValue: 'Connected account' })}</dt>
                  <dd className="break-words">{report.summary.authenticatedUserEmail}</dd>
                </>}
              </dl>
              <Button id="outbound-diagnostics-rerun" variant="outline" size="sm" onClick={() => void runDiagnostics(false)}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('outboundDiagnostics.checkAgain', { defaultValue: 'Check again' })}
              </Button>
            </div>

            {report.recommendations.length > 0 && (
              <Alert>
                <AlertDescription>
                  <div className="font-medium mb-1">
                    {t('outboundDiagnostics.nextSteps', { defaultValue: 'Next steps' })}
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
              {report.steps.filter(step =>
                !(step.id === 'live_send_test' && step.status === 'skip')
                && !(['outbound_provider_selected', 'mailbox_base_path', 'tokens_present'].includes(step.id) && step.status === 'pass')
              ).map(step => (
                <div key={step.id} className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">{statusIcon(step.status)}<span className="font-medium">{step.title}</span></div>
                    {renderStatusBadge(step.status)}
                  </div>
                  {step.detail && <p className="text-sm text-muted-foreground">{step.detail}</p>}
                  {!step.detail && step.error && <p className="text-sm text-muted-foreground">{step.error.message}</p>}
                </div>
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
                  {t('outboundDiagnostics.liveSend.enableTest', { defaultValue: 'Send a test email' })}
                </Label>
              </div>
              {report.summary.providerType === 'microsoft' && !report.summary.liveSendPerformed && (
                <p className="text-sm text-muted-foreground">
                  {t('outboundDiagnostics.liveSend.permissionHelp', {
                    defaultValue: 'Send a test email to confirm this account can send from the selected mailbox.',
                  })}
                </p>
              )}
              {report.steps.some(step => step.id === 'token_claims' && step.status === 'warn') && (
                <p className="text-sm text-muted-foreground">{t('outboundDiagnostics.limitedChecksHelp', {
                  defaultValue: 'Some account information was unavailable for these checks. Send a test email to check whether sending works.',
                })}</p>
              )}
              {report.steps.some(step => step.id === 'sent_items_writable' && step.status === 'warn' && step.error) && (
                <p className="text-sm text-muted-foreground">{t('outboundDiagnostics.sentItemsHelp', {
                  defaultValue: 'The Sent Items folder could not be checked. After sending a test email, check that a copy appears in the sending mailbox’s Sent Items folder.',
                })}</p>
              )}
              {liveSendEnabled && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex-1">
                    <Label htmlFor="outbound-diagnostics-recipient">
                      {t('outboundDiagnostics.liveSend.sendTo', { defaultValue: 'Send to' })}
                    </Label>
                    <Input
                      id="outbound-diagnostics-recipient"
                      type="email"
                      value={recipient}
                      aria-invalid={!!recipientError}
                      aria-describedby={recipientError ? "outbound-diagnostics-recipient-error" : undefined}
                      placeholder="you@example.com"
                      onChange={(event) => setRecipient(event.target.value)}
                    />
                    {recipientError && <p id="outbound-diagnostics-recipient-error" role="alert" className="text-xs text-destructive mt-1">{recipientError}</p>}
                  </div>
                  <Button
                    id="outbound-diagnostics-run-live-send"
                    onClick={handleLiveSend}
                    disabled={loading}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    {t('outboundDiagnostics.liveSend.sendTest', { defaultValue: 'Send test email' })}
                  </Button>
                </div>
              )}
            </div>
            <div className="border-t pt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button id="outbound-diagnostics-copy-bundle" variant="outline" size="sm" onClick={copySupportBundle}>
                  <Copy className="h-4 w-4 mr-2" />
                  {copied
                    ? t('outboundDiagnostics.actions.copied', { defaultValue: 'Copied' })
                    : t('outboundDiagnostics.copyReport', { defaultValue: 'Copy report' })}
                </Button>
                <Button
                  id="outbound-diagnostics-download-bundle"
                  variant="outline"
                  size="sm"
                  onClick={downloadSupportBundle}
                >
                  <Download className="h-4 w-4 mr-2" />
                  {t('outboundDiagnostics.downloadReport', { defaultValue: 'Download report' })}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {t('outboundDiagnostics.shareHelp', {
                    defaultValue: 'Share this report with support. Email addresses and account identifiers are hidden.',
                  })}
                </span>
              </div>

              {copyError && (
                <Alert variant="destructive">
                  <AlertDescription role="alert">{copyError}</AlertDescription>
                </Alert>
              )}

              {copied && <p role="status" className="text-sm text-muted-foreground">{t('outboundDiagnostics.copyConfirmed', { defaultValue: 'Report copied to clipboard.' })}</p>}
              <details>
                <summary className="cursor-pointer text-sm font-medium">{t('outboundDiagnostics.technicalDetails', { defaultValue: 'Technical details for support' })}</summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted p-3 text-xs">{bundleJson}</pre>
              </details>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
