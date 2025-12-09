'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogFooter } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { Mail, User, Building, AlertCircle, CheckCircle, Loader2, FileText } from 'lucide-react';
import { getInvoiceEmailRecipientAction, InvoiceEmailRecipientInfo } from '../../../lib/actions/job-actions/getInvoiceEmailRecipientAction';
import { sendInvoiceEmailAction } from '../../../lib/actions/job-actions/sendInvoiceEmailAction';
import toast from 'react-hot-toast';

interface SendInvoiceEmailDialogProps {
  isOpen: boolean;
  onClose: () => void;
  invoiceIds: string[];
  onSuccess?: () => void;
}

type RecipientSourceLabel = {
  [key in InvoiceEmailRecipientInfo['recipientSource']]: string;
};

const recipientSourceLabels: RecipientSourceLabel = {
  billing_contact: 'Billing Contact',
  billing_email: 'Billing Email',
  client_email: 'Client Email',
  none: 'No Email Found'
};

export const SendInvoiceEmailDialog: React.FC<SendInvoiceEmailDialogProps> = ({
  isOpen,
  onClose,
  invoiceIds,
  onSuccess
}) => {
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [recipients, setRecipients] = useState<InvoiceEmailRecipientInfo[]>([]);
  const [errors, setErrors] = useState<Array<{ invoiceId: string; error: string }>>([]);
  const [customMessage, setCustomMessage] = useState('');

  useEffect(() => {
    if (isOpen && invoiceIds.length > 0) {
      loadRecipientInfo();
    }
  }, [isOpen, invoiceIds]);

  const loadRecipientInfo = async () => {
    setLoading(true);
    try {
      const result = await getInvoiceEmailRecipientAction(invoiceIds);
      setRecipients(result.recipients);
      setErrors(result.errors);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load recipient info';
      toast.error(errorMessage);
      setErrors([{ invoiceId: 'unknown', error: errorMessage }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    const validRecipients = recipients.filter(r => r.recipientEmail);
    if (validRecipients.length === 0) {
      toast.error('No valid recipients found');
      return;
    }

    setSending(true);
    const toastId = toast.loading(`Sending ${validRecipients.length} invoice${validRecipients.length > 1 ? 's' : ''}...`);

    try {
      const result = await sendInvoiceEmailAction(
        validRecipients.map(r => r.invoiceId),
        customMessage.trim() || undefined
      );

      if (result.failureCount === 0) {
        toast.success(
          `${result.successCount} invoice${result.successCount > 1 ? 's' : ''} sent successfully`,
          { id: toastId }
        );
        onSuccess?.();
        onClose();
      } else if (result.successCount === 0) {
        toast.error(
          `Failed to send ${result.failureCount} invoice${result.failureCount > 1 ? 's' : ''}`,
          { id: toastId }
        );
      } else {
        toast.success(
          `${result.successCount} sent, ${result.failureCount} failed`,
          { id: toastId }
        );
        onSuccess?.();
        onClose();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to send emails';
      toast.error(errorMessage, { id: toastId });
    } finally {
      setSending(false);
    }
  };

  const validRecipientCount = recipients.filter(r => r.recipientEmail).length;
  const invalidRecipientCount = recipients.filter(r => !r.recipientEmail).length;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Send Invoice Email"
      id="send-invoice-email-dialog"
      className="max-w-2xl"
    >
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
          <span className="ml-3 text-gray-600">Loading recipient information...</span>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary-500" />
                <span className="font-medium">{invoiceIds.length} Invoice{invoiceIds.length > 1 ? 's' : ''}</span>
              </div>
              {validRecipientCount > 0 && (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  <span>{validRecipientCount} ready to send</span>
                </div>
              )}
              {invalidRecipientCount > 0 && (
                <div className="flex items-center gap-2 text-amber-600">
                  <AlertCircle className="h-4 w-4" />
                  <span>{invalidRecipientCount} missing email</span>
                </div>
              )}
            </div>
          </div>

          {/* Recipients List */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-700">Recipients</h3>
            <div className="max-h-64 overflow-y-auto space-y-2">
              {recipients.map((recipient) => (
                <div
                  key={recipient.invoiceId}
                  className={`border rounded-lg p-4 ${
                    recipient.recipientEmail
                      ? 'border-gray-200 bg-white'
                      : 'border-amber-200 bg-amber-50'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      {/* Invoice Info */}
                      <div className="flex items-center gap-2 mb-2">
                        <FileText className="h-4 w-4 text-gray-400" />
                        <span className="font-medium">{recipient.invoiceNumber}</span>
                        <span className="text-gray-500">-</span>
                        <span className="font-medium text-primary-600">{recipient.totalAmount}</span>
                      </div>

                      {/* Client */}
                      <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
                        <Building className="h-4 w-4 text-gray-400" />
                        <span>{recipient.clientName}</span>
                      </div>

                      {/* Recipient */}
                      {recipient.recipientEmail ? (
                        <div className="flex items-center gap-2 text-sm">
                          <User className="h-4 w-4 text-gray-400" />
                          <span className="font-medium">{recipient.recipientName}</span>
                          <span className="text-gray-400">&lt;{recipient.recipientEmail}&gt;</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                            {recipientSourceLabels[recipient.recipientSource]}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-sm text-amber-600">
                          <AlertCircle className="h-4 w-4" />
                          <span>No email address configured for this client</span>
                        </div>
                      )}

                      {/* Due Date */}
                      {recipient.dueDate && (
                        <div className="text-xs text-gray-500 mt-1">
                          Due: {recipient.dueDate}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* Errors */}
              {errors.map((error, index) => (
                <div
                  key={`error-${index}`}
                  className="border border-red-200 bg-red-50 rounded-lg p-4"
                >
                  <div className="flex items-center gap-2 text-sm text-red-600">
                    <AlertCircle className="h-4 w-4" />
                    <span>{error.error}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Custom Message (Optional) */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              Additional Message (Optional)
            </label>
            <textarea
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              placeholder="Add a personal note to include in the email..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-primary-500 focus:border-primary-500"
              rows={3}
            />
          </div>

          {/* Email Preview Info */}
          <div className="text-sm text-gray-500 bg-blue-50 border border-blue-100 rounded-lg p-3">
            <p className="flex items-start gap-2">
              <Mail className="h-4 w-4 mt-0.5 text-blue-500" />
              <span>
                Emails will be sent from <strong>{recipients[0]?.fromEmail || 'noreply@example.com'}</strong> on behalf of <strong>{recipients[0]?.companyName || 'Your Company'}</strong>.
                Each invoice will be attached as a PDF.
              </span>
            </p>
          </div>
        </div>
      )}

      <DialogFooter>
        <Button
          variant="outline"
          onClick={onClose}
          disabled={sending}
        >
          Cancel
        </Button>
        <Button
          onClick={handleSend}
          disabled={loading || sending || validRecipientCount === 0}
        >
          {sending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <Mail className="h-4 w-4 mr-2" />
              Send {validRecipientCount > 0 ? `${validRecipientCount} Email${validRecipientCount > 1 ? 's' : ''}` : 'Email'}
            </>
          )}
        </Button>
      </DialogFooter>
    </Dialog>
  );
};
