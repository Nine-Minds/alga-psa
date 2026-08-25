'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Building, CheckCircle, Loader2, Mail, User } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import {
  getErrorMessage,
  handleError,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  getProjectStatusUpdateRecipient,
  sendProjectStatusUpdate,
  type ProjectStatusUpdateRecipient,
} from '../actions/projectStatusUpdateActions';

interface SendStatusUpdateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
}

function isReturnedActionError(value: unknown) {
  return isActionMessageError(value) || isActionPermissionError(value);
}

export default function SendStatusUpdateDialog({ isOpen, onClose, projectId }: SendStatusUpdateDialogProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [recipient, setRecipient] = useState<ProjectStatusUpdateRecipient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customMessage, setCustomMessage] = useState('');

  const loadRecipient = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getProjectStatusUpdateRecipient(projectId);
      if (isReturnedActionError(result)) {
        setRecipient(null);
        setError(getErrorMessage(result));
        return;
      }
      setRecipient(result as ProjectStatusUpdateRecipient);
    } catch (err) {
      const fallback = t('statusUpdate.errors.loadRecipient', 'Failed to load recipient information');
      handleError(err, fallback);
      setError(fallback);
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    if (isOpen) {
      void loadRecipient();
    }
  }, [isOpen, loadRecipient]);

  const handleSend = async () => {
    if (!recipient?.recipientEmail) return;
    setSending(true);
    const toastId = toast.loading(t('statusUpdate.sending', 'Sending status update...'));
    try {
      const result = await sendProjectStatusUpdate(projectId, customMessage.trim() || undefined);
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result), { id: toastId });
        return;
      }
      toast.success(t('statusUpdate.sent', 'Status update sent to {{email}}', { email: recipient.recipientEmail }), {
        id: toastId,
      });
      setCustomMessage('');
      onClose();
    } catch (err) {
      toast.dismiss(toastId);
      handleError(err, t('statusUpdate.errors.sendFailed', 'Failed to send the status update'));
    } finally {
      setSending(false);
    }
  };

  const recipientSourceLabel = (source: ProjectStatusUpdateRecipient['recipientSource']) => {
    switch (source) {
      case 'project_contact':
        return t('statusUpdate.recipientSource.projectContact', 'Project Contact');
      case 'client_location':
        return t('statusUpdate.recipientSource.clientEmail', 'Client Email');
      default:
        return t('statusUpdate.recipientSource.none', 'No Email Found');
    }
  };

  // Mirrors ClientPortalConfigEditor's "Clients will see" summary so the sender
  // knows exactly which numbers leave the building.
  const visibilitySummary = (info: ProjectStatusUpdateRecipient): string[] => {
    const summary = [
      t('statusUpdate.summary.progress', 'Overall progress: {{percent}}% ({{closed}} of {{total}} tasks done)', {
        percent: info.taskCompletionPercent,
        closed: info.tasksClosed,
        total: info.tasksTotal,
      }),
    ];
    if (info.showBudgetHours) {
      summary.push(
        t('statusUpdate.summary.budgetHours', 'Budget hours: {{spent}} of {{budgeted}} hours used', {
          spent: info.spentHours,
          budgeted: info.budgetedHours,
        }),
      );
    } else {
      summary.push(t('statusUpdate.summary.budgetHoursHidden', 'Budget hours are hidden by this project’s client portal settings'));
    }
    if (info.recentlyCompleted.length > 0) {
      summary.push(
        t('statusUpdate.summary.recentlyCompleted', 'Recently completed: {{items}}', {
          items: info.recentlyCompleted.join(', '),
        }),
      );
    }
    summary.push(t('statusUpdate.summary.portalLink', 'A link to the project in the client portal'));
    return summary;
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('statusUpdate.title', 'Send Status Update')}
      id="send-status-update-dialog"
      className="max-w-2xl"
      footer={(
        <div className="flex justify-end space-x-2">
          <Button id="send-status-update-cancel" variant="outline" onClick={onClose} disabled={sending}>
            {t('common:actions.cancel', 'Cancel')}
          </Button>
          <Button
            id="send-status-update-send"
            onClick={handleSend}
            disabled={loading || sending || !recipient?.recipientEmail}
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('statusUpdate.sending', 'Sending status update...')}
              </>
            ) : (
              <>
                <Mail className="h-4 w-4 mr-2" />
                {t('statusUpdate.send', 'Send Update')}
              </>
            )}
          </Button>
        </div>
      )}
    >
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
          <span className="ml-3 text-muted-foreground">
            {t('statusUpdate.loading', 'Loading recipient information...')}
          </span>
        </div>
      ) : (
        <div className="space-y-6">
          {error && (
            <div className="border border-destructive/30 bg-destructive/10 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>{error}</span>
              </div>
            </div>
          )}

          {recipient && (
            <>
              <div
                className={`border rounded-lg p-4 ${
                  recipient.recipientEmail
                    ? 'border-[rgb(var(--color-border-200))] bg-card'
                    : 'border-warning/30 bg-warning/10'
                }`}
              >
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Building className="h-4 w-4 text-muted-foreground" />
                  <span>{recipient.clientName}</span>
                </div>
                {recipient.recipientEmail ? (
                  <div className="flex items-center gap-2 text-sm">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{recipient.recipientName}</span>
                    <span className="text-muted-foreground">&lt;{recipient.recipientEmail}&gt;</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {recipientSourceLabel(recipient.recipientSource)}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-warning">
                    <AlertCircle className="h-4 w-4" />
                    <span>
                      {t('statusUpdate.noRecipient', 'No email address is configured for this project’s client contact.')}
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-medium text-[rgb(var(--color-text-700))]">
                  {t('statusUpdate.whatTheySee', 'Your customer will see:')}
                </h3>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {visibilitySummary(recipient).map((item, index) => (
                    <li key={index} className="flex items-start gap-1.5">
                      <CheckCircle className="mt-0.5 h-4 w-4 text-primary-500" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <TextArea
                  id="send-status-update-message"
                  label={t('statusUpdate.additionalMessage', 'Additional Message')}
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  placeholder={t('statusUpdate.additionalMessagePlaceholder', 'Add a personal note to include in the update...')}
                  rows={3}
                />
              </div>

              <div className="text-sm text-muted-foreground bg-muted rounded-lg p-3">
                <p className="flex items-start gap-2">
                  <Mail className="h-4 w-4 mt-0.5 text-primary-500" />
                  <span>
                    {t('statusUpdate.preview', 'The update will be sent from {{fromEmail}} on behalf of {{companyName}}.', {
                      fromEmail: recipient.fromEmail,
                      companyName: recipient.companyName,
                    })}
                  </span>
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
