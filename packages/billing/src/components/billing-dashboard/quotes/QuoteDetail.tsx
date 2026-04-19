'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Card, Box } from '@radix-ui/themes';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IClient, IContact, IQuote, QuoteConversionPreview } from '@alga-psa/types';
import { isActionPermissionError, getErrorMessage } from '@alga-psa/ui/lib/errorHandling';
import { getAllClientsForBilling } from '../../../actions/billingClientsActions';
import { getActiveClientLocationsForBilling, type BillingLocationSummary } from '../../../actions/billingClientLocationActions';
import LocationAddress from '../locations/LocationAddress';
import { buildLocationGroups, shouldShowLocationGroups } from '../locations/locationGrouping';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import type { IQuoteDocumentTemplate } from '@alga-psa/types';
import { approveQuote, convertQuoteToBoth, convertQuoteToContract, convertQuoteToInvoice, createQuoteRevision, deleteQuote, downloadQuotePdf, duplicateQuote, getQuote, getQuoteApprovalSettings, getQuoteConversionPreview, listQuoteVersions, renderQuotePreview, requestQuoteApprovalChanges, resendQuote, saveQuoteAsTemplate, sendQuote, sendQuoteReminder, submitQuoteForApproval, updateQuote } from '../../../actions/quoteActions';
import { getQuoteDocumentTemplates } from '../../../actions/quoteDocumentTemplates';
import { getContactsForPicker } from '@alga-psa/user-composition/actions';
import QuoteStatusBadge from './QuoteStatusBadge';
import { QuoteSendRecipientsField, type QuoteRecipient } from './QuoteSendRecipientsField';

interface QuoteDetailProps {
  quoteId: string;
  onBack: () => void;
  onEdit?: () => void;
  onSelectVersion?: (quoteId: string) => void;
}

function formatQuoteNumber(quote: IQuote, templateQuoteLabel: string): string {
  const baseNumber = quote.quote_number || templateQuoteLabel;
  return quote.version > 1 ? `${baseNumber} v${quote.version}` : baseNumber;
}

function hasConvertibleRecurringItems(quote: IQuote | null): boolean {
  return Boolean((quote?.quote_items || []).some((item) => item.is_recurring && !item.is_discount && (!item.is_optional || item.is_selected !== false)));
}

function hasConvertibleOneTimeItems(quote: IQuote | null): boolean {
  const oneTimeItems = (quote?.quote_items || []).filter((item) => !item.is_recurring && (!item.is_optional || item.is_selected !== false));
  if (oneTimeItems.some((item) => !item.is_discount)) {
    return true;
  }

  const oneTimeItemIds = new Set(oneTimeItems.filter((item) => !item.is_discount).map((item) => item.quote_item_id));
  const oneTimeServiceIds = new Set(oneTimeItems.filter((item) => !item.is_discount && item.service_id).map((item) => item.service_id));

  return oneTimeItems.some((item) => item.is_discount && (!item.applies_to_item_id || oneTimeItemIds.has(item.applies_to_item_id) || (item.applies_to_service_id ? oneTimeServiceIds.has(item.applies_to_service_id) : true)));
}

type ConversionMode = 'contract' | 'invoice' | 'both';

function renderQuoteDetailRow(
  quote: IQuote,
  item: NonNullable<IQuote['quote_items']>[number],
  formatCurrencyFn: (amount: number, currencyCode: string) => string,
) {
  const showClientSelection = quote.status === 'accepted' && item.is_optional;
  const clientSelected = item.is_selected !== false;

  return (
    <tr
      key={item.quote_item_id}
      className={showClientSelection ? (clientSelected ? 'bg-emerald-50/60' : 'bg-amber-50/70') : undefined}
    >
      <td className="px-3 py-3 align-top">
        <div className="font-medium text-foreground">{item.description}</div>
        <div className="text-xs text-muted-foreground">
          {item.service_name || 'Custom item'}
          {item.service_sku ? ` • ${item.service_sku}` : ''}
          {item.phase ? ` • Phase: ${item.phase}` : ''}
          {item.is_optional ? ' • Optional' : ''}
          {item.is_recurring ? ` • Recurring${item.billing_frequency ? ` (${item.billing_frequency})` : ''}` : ''}
        </div>
        {showClientSelection ? (
          <div className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs font-medium ${clientSelected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
            {clientSelected ? 'Client selected this optional item' : 'Client declined this optional item'}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-3 align-top text-muted-foreground">{item.billing_method || '—'}</td>
      <td className="px-3 py-3 align-top text-muted-foreground">{item.quantity}</td>
      <td className="px-3 py-3 align-top text-muted-foreground">
        {formatCurrencyFn(item.unit_price, quote.currency_code || 'USD')}
      </td>
      <td className="px-3 py-3 align-top font-medium text-foreground">
        {formatCurrencyFn(item.total_price, quote.currency_code || 'USD')}
      </td>
    </tr>
  );
}

const QuoteDetail: React.FC<QuoteDetailProps> = ({ quoteId, onBack, onEdit, onSelectVersion }) => {
  const { t } = useTranslation('msp/quotes');
  const { formatCurrency, formatDate } = useFormatters();
  const router = useRouter();
  const { t } = useTranslation('features/billing');
  const [quote, setQuote] = useState<IQuote | null>(null);
  const [clientLocations, setClientLocations] = useState<BillingLocationSummary[]>([]);
  const [versions, setVersions] = useState<IQuote[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conversionMode, setConversionMode] = useState<ConversionMode | null>(null);
  const [conversionPreview, setConversionPreview] = useState<QuoteConversionPreview | null>(null);
  const [isConversionDialogOpen, setIsConversionDialogOpen] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [approvalDialogMode, setApprovalDialogMode] = useState<'approve' | 'changes' | null>(null);
  const [approvalComment, setApprovalComment] = useState('');
  const [isSendDialogOpen, setIsSendDialogOpen] = useState(false);
  const [sendMessage, setSendMessage] = useState('');
  const [sendRecipients, setSendRecipients] = useState<QuoteRecipient[]>([]);
  const [additionalEmails, setAdditionalEmails] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<{ html: string; css: string } | null>(null);
  const [isPreviewLoading2, setIsPreviewLoading2] = useState(false);
  const [documentTemplates, setDocumentTemplates] = useState<IQuoteDocumentTemplate[]>([]);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  useEffect(() => {
    void loadQuote();
  }, [quoteId]);

  const loadQuote = async () => {
    try {
      setIsLoading(true);
      const [loadedQuote, loadedClients, loadedContacts, approvalSettings, loadedTemplates] = await Promise.all([
        getQuote(quoteId),
        getAllClientsForBilling(false),
        getContactsForPicker('active'),
        getQuoteApprovalSettings(),
        getQuoteDocumentTemplates(),
      ]);

      if (!loadedQuote || isActionPermissionError(loadedQuote)) {
        throw new Error(
          !loadedQuote
            ? t('quoteDetail.errors.notFound', { defaultValue: 'Quote not found' })
            : getErrorMessage(loadedQuote),
        );
      }

      setQuote(loadedQuote);
      setClients(loadedClients);
      setContacts(loadedContacts);
      setApprovalRequired(!isActionPermissionError(approvalSettings) && approvalSettings.approvalRequired === true);
      setDocumentTemplates(Array.isArray(loadedTemplates) ? loadedTemplates : []);

      const loadedVersions = await listQuoteVersions(quoteId);
      setVersions(Array.isArray(loadedVersions) ? loadedVersions : []);
      setError(null);
    } catch (loadError) {
      console.error('Error loading quote detail:', loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : t('quoteDetail.errors.load', { defaultValue: 'Failed to load quote detail' }),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const client = useMemo(() => clients.find((entry) => entry.client_id === quote?.client_id) ?? null, [clients, quote?.client_id]);
  const contact = useMemo(() => contacts.find((entry) => entry.contact_name_id === quote?.contact_id) ?? null, [contacts, quote?.contact_id]);
  const acceptedOptionalItems = useMemo(
    () => (quote?.quote_items || []).filter((item) => item.is_optional),
    [quote?.quote_items]
  );

  // Location-grouped rendering: 1 distinct location ⇒ flat; ≥2 ⇒ grouped.
  const quoteItems = useMemo(() => quote?.quote_items ?? [], [quote?.quote_items]);
  const showLocationGroupedItems = useMemo(() => shouldShowLocationGroups(quoteItems), [quoteItems]);
  const locationGroups = useMemo(
    () => buildLocationGroups(quoteItems, clientLocations),
    [quoteItems, clientLocations]
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!quote?.client_id) {
        setClientLocations([]);
        return;
      }
      try {
        const locations = await getActiveClientLocationsForBilling(quote.client_id);
        if (!cancelled) setClientLocations(locations);
      } catch (locationError) {
        console.error('Failed to load client locations:', locationError);
        if (!cancelled) setClientLocations([]);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [quote?.client_id]);
  const canConvertToContract = useMemo(() => hasConvertibleRecurringItems(quote), [quote]);
  const canConvertToInvoice = useMemo(() => hasConvertibleOneTimeItems(quote), [quote]);
  const canConvertToBoth = canConvertToContract && canConvertToInvoice;

  const handleDelete = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await deleteQuote(quote.quote_id);

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      if (!result.deleted) {
        throw new Error(
          result.message
            || t('quoteDetail.errors.deleteUnavailable', {
              defaultValue: 'Quote could not be deleted',
            }),
        );
      }

      onBack();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : t('quoteDetail.errors.delete', { defaultValue: 'Failed to delete quote' }),
      );
    } finally {
      setIsWorking(false);
    }
  };

  const handleCancelQuote = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await updateQuote(quote.quote_id, { status: 'cancelled' });

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      setQuote(result);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : t('quoteDetail.errors.cancel', { defaultValue: 'Failed to cancel quote' }),
      );
    } finally {
      setIsWorking(false);
    }
  };

  const handleSubmitForApproval = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await submitQuoteForApproval(quote.quote_id);

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      setQuote(result);
      setNotice(
        t('quoteDetail.notices.submittedForApproval', {
          defaultValue: 'Quote submitted for internal approval.',
        }),
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : t('quoteDetail.errors.submitForApproval', {
            defaultValue: 'Failed to submit quote for approval',
          }),
      );
    } finally {
      setIsWorking(false);
    }
  };

  const handleApproveQuote = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await approveQuote(quote.quote_id, approvalComment);

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      setQuote(result);
      setApprovalDialogMode(null);
      setApprovalComment('');
      setNotice(
        t('quoteDetail.notices.approved', {
          defaultValue: 'Quote approved and is ready to send.',
        }),
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : t('quoteDetail.errors.approve', {
            defaultValue: 'Failed to approve quote',
          }),
      );
    } finally {
      setIsWorking(false);
    }
  };

  const handleRequestChanges = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await requestQuoteApprovalChanges(quote.quote_id, approvalComment);

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      setQuote(result);
      setApprovalDialogMode(null);
      setApprovalComment('');
      setNotice(
        t('quoteDetail.notices.requestedChanges', {
          defaultValue: 'Quote returned to draft with requested changes.',
        }),
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : t('quoteDetail.errors.requestChanges', {
            defaultValue: 'Failed to request quote changes',
          }),
      );
    } finally {
      setIsWorking(false);
    }
  };

  const handleResendQuote = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await resendQuote(quote.quote_id);

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      setQuote(result);
      setNotice(
        t('quoteDetail.notices.resent', {
          defaultValue: 'Quote resent to the configured billing recipients.',
        }),
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : t('quoteDetail.errors.resend', { defaultValue: 'Failed to resend quote' }),
      );
    } finally {
      setIsWorking(false);
    }
  };

  const handleSendReminder = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await sendQuoteReminder(quote.quote_id);

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      setQuote(result);
      setNotice(
        t('quoteDetail.notices.reminderSent', {
          defaultValue: 'Quote reminder sent to the configured billing recipients.',
        }),
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : t('quoteDetail.errors.sendReminder', {
            defaultValue: 'Failed to send quote reminder',
          }),
      );
    } finally {
      setIsWorking(false);
    }
  };

  const handleDuplicateQuote = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await duplicateQuote(quote.quote_id);

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      router.push(`/msp/billing?tab=quotes&quoteId=${result.quote_id}&mode=edit`);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : t('quoteDetail.errors.duplicate', { defaultValue: 'Failed to duplicate quote' }),
      );
    } finally {
      setIsWorking(false);
    }
  };

  const handleSaveAsTemplate = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await saveQuoteAsTemplate(quote.quote_id);

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      router.push(`/msp/billing?tab=quotes&quoteId=${result.quote_id}&mode=edit`);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : t('quoteDetail.errors.saveAsTemplate', {
            defaultValue: 'Failed to save quote as template',
          }),
      );
    } finally {
      setIsWorking(false);
    }
  };

  const handleSendQuote = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const typedEmails = additionalEmails.split(',').map((e) => e.trim()).filter(Boolean);
      const pickedEmails = sendRecipients.map((r) => r.email);
      const seen = new Set<string>();
      const combined: string[] = [];
      for (const email of [...pickedEmails, ...typedEmails]) {
        const key = email.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        combined.push(email);
      }
      const result = await sendQuote(quote.quote_id, {
        message: sendMessage.trim() || undefined,
        email_addresses: combined.length > 0 ? combined : undefined,
      });

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      setQuote(result);
      setIsSendDialogOpen(false);
      setSendMessage('');
      setSendRecipients([]);
      setAdditionalEmails('');
      setNotice(
        t('quoteDetail.notices.sent', { defaultValue: 'Quote sent to the client.' }),
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : t('quoteDetail.errors.send', { defaultValue: 'Failed to send quote' }),
      );
    } finally {
      setIsWorking(false);
    }
  };

  const handleReviseQuote = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await createQuoteRevision(quote.quote_id);

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      router.push(`/msp/billing?tab=quotes&quoteId=${result.quote_id}&mode=edit`);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : t('quoteDetail.errors.revise', {
            defaultValue: 'Failed to create quote revision',
          }),
      );
    } finally {
      setIsWorking(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsGeneratingPdf(true);
      setError(null);

      const result = await downloadQuotePdf(quote.quote_id);
      if (result && typeof result === 'object' && 'permissionError' in result) {
        throw new Error(result.permissionError);
      }

      const { pdfData, quoteNumber } = result as { pdfData: number[]; quoteNumber: string };
      const blob = new Blob([new Uint8Array(pdfData)], { type: 'application/pdf' });
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', `${quoteNumber}.pdf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : t('quoteDetail.errors.downloadPdf', {
            defaultValue: 'Failed to generate quote PDF',
          }),
      );
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleAssignTemplate = async (templateId: string | null) => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await updateQuote(quote.quote_id, { template_id: templateId } as any);

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      setQuote(result);
      setNotice(
        templateId
          ? t('quoteDetail.notices.templateAssigned', {
            defaultValue: 'Document template assigned.',
          })
          : t('quoteDetail.notices.templateCleared', {
            defaultValue: 'Document template cleared (using default).',
          }),
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : t('quoteDetail.errors.assignTemplate', {
            defaultValue: 'Failed to assign template',
          }),
      );
    } finally {
      setIsWorking(false);
    }
  };

  const handlePreviewPdf = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsPreviewLoading2(true);
      setError(null);
      const result = await renderQuotePreview(quote.quote_id);

      if (result && typeof result === 'object' && 'permissionError' in result) {
        throw new Error(result.permissionError);
      }

      setPreviewHtml(result as { html: string; css: string });
      setIsPreviewOpen(true);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : t('quoteDetail.errors.preview', {
            defaultValue: 'Failed to generate quote preview',
          }),
      );
    } finally {
      setIsPreviewLoading2(false);
    }
  };

  const handleOpenConversionDialog = async (mode: ConversionMode) => {
    if (!quote) {
      return;
    }

    try {
      setIsPreviewLoading(true);
      setError(null);
      setNotice(null);
      setConversionMode(mode);
      const preview = await getQuoteConversionPreview(quote.quote_id);

      if ('permissionError' in preview) {
        throw new Error(preview.permissionError);
      }

      setConversionPreview(preview);
      setIsConversionDialogOpen(true);
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : t('quoteDetail.errors.loadConversionPreview', {
            defaultValue: 'Failed to load conversion preview',
          }),
      );
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleConfirmConversion = async () => {
    if (!quote || !conversionMode) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);

      if (conversionMode === 'contract') {
        const result = await convertQuoteToContract(quote.quote_id);
        if ('permissionError' in result) {
          throw new Error(result.permissionError);
        }
        setQuote(result.quote);
        setNotice(
          t('quoteForm.notices.createdDraftContract', {
            defaultValue: 'Created draft contract {{name}}.',
            name: result.contract.contract_name,
          }),
        );
      } else if (conversionMode === 'invoice') {
        const result = await convertQuoteToInvoice(quote.quote_id);
        if ('permissionError' in result) {
          throw new Error(result.permissionError);
        }
        setQuote(result.quote);
        setNotice(
          t('quoteForm.notices.createdDraftInvoice', {
            defaultValue: 'Created draft invoice {{name}}.',
            name: result.invoice.invoice_number,
          }),
        );
      } else {
        const result = await convertQuoteToBoth(quote.quote_id);
        if ('permissionError' in result) {
          throw new Error(result.permissionError);
        }
        setQuote(result.quote);
        setNotice(
          t('quoteForm.notices.createdDraftContractAndInvoice', {
            defaultValue:
              'Created draft contract {{contractName}} and draft invoice {{invoiceName}}.',
            contractName: result.contract.contract_name,
            invoiceName: result.invoice.invoice_number,
          }),
        );
      }

      setIsConversionDialogOpen(false);
      setConversionPreview(null);
      setConversionMode(null);
    } catch (conversionError) {
      setError(
        conversionError instanceof Error
          ? conversionError.message
          : t('quoteDetail.errors.convert', { defaultValue: 'Failed to convert quote' }),
      );
    } finally {
      setIsWorking(false);
    }
  };

  const renderPrimaryActions = () => {
    if (!quote) {
      return null;
    }

    const status = quote.status || 'draft';

    switch (status) {
      case 'draft':
        return (
          <>
            {onEdit ? <Button id="quote-detail-edit" onClick={onEdit} disabled={isWorking}>{t('common.actions.edit', { defaultValue: 'Edit' })}</Button> : null}
            {approvalRequired ? (
              <Button id="quote-detail-submit-approval" onClick={() => void handleSubmitForApproval()} disabled={isWorking}>{t('common.actions.submitForApproval', { defaultValue: 'Submit for Approval' })}</Button>
            ) : (
              <Button id="quote-detail-send" onClick={() => setIsSendDialogOpen(true)} disabled={isWorking}>{t('common.actions.sendToClient', { defaultValue: 'Send to Client' })}</Button>
            )}
            <Button id="quote-detail-delete" variant="outline" onClick={() => void handleDelete()} disabled={isWorking}>{t('common.actions.delete', { defaultValue: 'Delete' })}</Button>
          </>
        );
      case 'pending_approval':
        return (
          <>
            <Button id="quote-detail-approve" onClick={() => setApprovalDialogMode('approve')} disabled={isWorking}>{t('common.actions.approve', { defaultValue: 'Approve' })}</Button>
            <Button id="quote-detail-request-changes" variant="outline" onClick={() => setApprovalDialogMode('changes')} disabled={isWorking}>{t('common.actions.requestChanges', { defaultValue: 'Request Changes' })}</Button>
          </>
        );
      case 'sent':
        return (
          <>
            <Button id="quote-detail-revise" onClick={() => void handleReviseQuote()} disabled={isWorking}>{t('common.actions.revise', { defaultValue: 'Revise' })}</Button>
            <Button id="quote-detail-resend" variant="outline" onClick={() => void handleResendQuote()} disabled={isWorking}>{t('common.actions.resend', { defaultValue: 'Resend' })}</Button>
            <Button id="quote-detail-reminder" variant="outline" onClick={() => void handleSendReminder()} disabled={isWorking}>{t('common.actions.sendReminder', { defaultValue: 'Send Reminder' })}</Button>
            <Button id="quote-detail-cancel" variant="outline" onClick={() => void handleCancelQuote()} disabled={isWorking}>{t('common.actions.cancel', { defaultValue: 'Cancel' })}</Button>
          </>
        );
      case 'accepted':
        return (
          <>
            <Button id="quote-detail-convert-contract" onClick={() => void handleOpenConversionDialog('contract')} disabled={isWorking || isPreviewLoading || !canConvertToContract}>{t('quoteForm.actions.convertToContract', { defaultValue: 'Convert to Contract' })}</Button>
            <Button id="quote-detail-convert-invoice" onClick={() => void handleOpenConversionDialog('invoice')} disabled={isWorking || isPreviewLoading || !canConvertToInvoice}>{t('quoteForm.actions.convertToInvoice', { defaultValue: 'Convert to Invoice' })}</Button>
            <Button id="quote-detail-convert-both" onClick={() => void handleOpenConversionDialog('both')} disabled={isWorking || isPreviewLoading || !canConvertToBoth}>{t('quoteForm.actions.convertToBoth', { defaultValue: 'Convert to Both' })}</Button>
          </>
        );
      case 'approved':
        return <Button id="quote-detail-send-approved" onClick={() => setIsSendDialogOpen(true)} disabled={isWorking}>{t('common.actions.sendToClient', { defaultValue: 'Send to Client' })}</Button>;
      default:
        return onEdit ? <Button id="quote-detail-edit" onClick={onEdit} disabled={isWorking}>{t('common.actions.edit', { defaultValue: 'Edit' })}</Button> : null;
    }
  };

  if (isLoading) {
    return (
      <Card size="2">
        <Box p="4">
          <LoadingIndicator
            className="py-12 text-muted-foreground"
            layout="stacked"
            spinnerProps={{ size: 'md' }}
            text={t('quoteDetail.loading', { defaultValue: 'Loading quote details...' })}
            textClassName="text-muted-foreground"
          />
        </Box>
      </Card>
    );
  }

  if (error || !quote) {
    return (
      <Card size="2">
        <Box p="4" className="space-y-4">
          <Button id="quote-detail-back-error" variant="outline" onClick={onBack}>{t('quoteDetail.actions.backToQuotes', { defaultValue: 'Back to Quotes' })}</Button>
          <Alert variant="destructive">
            <AlertTitle>{t('quoteDetail.title', { defaultValue: 'Quote Detail' })}</AlertTitle>
            <AlertDescription>{error || t('quoteDetail.errors.notFound', { defaultValue: 'Quote not found' })}</AlertDescription>
          </Alert>
        </Box>
      </Card>
    );
  }

  return (
    <Card size="2">
      <Box p="4" className="space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">{formatQuoteNumber(quote, t('quoteDetail.labels.templateQuote', { defaultValue: 'Template quote' }))}</div>
            <h2 className="text-2xl font-semibold text-foreground">{quote.title}</h2>
            <div>
              <QuoteStatusBadge status={quote.status || 'draft'} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button id="quote-detail-back" variant="outline" onClick={onBack}>{t('common.actions.back', { defaultValue: 'Back' })}</Button>
            {renderPrimaryActions()}
            {!quote.is_template ? (
              <>
                <Button id="quote-detail-duplicate" variant="outline" onClick={() => void handleDuplicateQuote()} disabled={isWorking}>{t('common.actions.duplicate', { defaultValue: 'Duplicate' })}</Button>
                <Button id="quote-detail-save-template" variant="outline" onClick={() => void handleSaveAsTemplate()} disabled={isWorking}>{t('quoteDetail.actions.saveAsTemplate', { defaultValue: 'Save as Template' })}</Button>
              </>
            ) : null}
            <Button id="quote-detail-preview-pdf" variant="outline" onClick={() => void handlePreviewPdf()} disabled={isWorking || isPreviewLoading2}>
              {isPreviewLoading2
                ? t('common.states.loading', { defaultValue: 'Loading...' })
                : t('quoteDetail.actions.preview', { defaultValue: 'Preview' })}
            </Button>
            <Button id="quote-detail-view-pdf" variant="outline" onClick={() => void handleDownloadPdf()} disabled={isWorking || isGeneratingPdf}>
              {isGeneratingPdf
                ? t('common.states.generating', { defaultValue: 'Generating...' })
                : t('common.actions.downloadPdf', { defaultValue: 'Download PDF' })}
            </Button>
          </div>
        </div>

        {notice ? (
          <Alert>
            <AlertTitle>{t('quoteDetail.alerts.update', { defaultValue: 'Quote Update' })}</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        {quote.converted_contract_id || quote.converted_invoice_id ? (
          <section className="flex flex-wrap gap-2 rounded-lg border border-border p-4">
            {quote.converted_contract_id ? (
              <Button
                id="quote-detail-open-converted-contract"
                variant="outline"
                onClick={() => router.push(`/msp/billing?tab=client-contracts&contractId=${quote.converted_contract_id}`)}
              >
                {t('quoteDetail.actions.openConvertedContract', { defaultValue: 'Open Converted Contract' })}
              </Button>
            ) : null}
            {quote.converted_invoice_id ? (
              <Button
                id="quote-detail-open-converted-invoice"
                variant="outline"
                onClick={() => router.push(`/msp/billing?tab=invoicing&subtab=drafts&invoiceId=${quote.converted_invoice_id}`)}
              >
                {t('quoteDetail.actions.openConvertedInvoice', { defaultValue: 'Open Converted Invoice' })}
              </Button>
            ) : null}
          </section>
        ) : null}

        <section className="grid gap-4 rounded-lg border border-border p-4 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('common.labels.client', { defaultValue: 'Client' })}</div>
            <div className="mt-1 font-medium">{client?.client_name || quote.client_id || '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('common.labels.contact', { defaultValue: 'Contact' })}</div>
            <div className="mt-1 font-medium">{contact?.full_name || quote.contact_id || '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('common.labels.quoteDate', { defaultValue: 'Quote Date' })}</div>
            <div className="mt-1 font-medium">{formatDate(quote.quote_date)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('common.labels.validUntil', { defaultValue: 'Valid Until' })}</div>
            <div className="mt-1 font-medium">{formatDate(quote.valid_until)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('common.labels.poNumber', { defaultValue: 'PO Number' })}</div>
            <div className="mt-1 font-medium">{quote.po_number || '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('common.labels.total', { defaultValue: 'Total' })}</div>
            <div className="mt-1 font-medium">{formatCurrency(quote.total_amount, quote.currency_code || 'USD')}</div>
          </div>
        </section>

        <section className="grid gap-3 rounded-lg border border-border p-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('common.labels.subtotal', { defaultValue: 'Subtotal' })}</div>
            <div className="mt-1 text-lg font-semibold">{formatCurrency(quote.subtotal, quote.currency_code || 'USD')}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('common.labels.discounts', { defaultValue: 'Discounts' })}</div>
            <div className="mt-1 text-lg font-semibold">{formatCurrency(quote.discount_total, quote.currency_code || 'USD')}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('common.labels.tax', { defaultValue: 'Tax' })}</div>
            <div className="mt-1 text-lg font-semibold">{formatCurrency(quote.tax, quote.currency_code || 'USD')}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('common.labels.total', { defaultValue: 'Total' })}</div>
            <div className="mt-1 text-lg font-semibold">{formatCurrency(quote.total_amount, quote.currency_code || 'USD')}</div>
          </div>
        </section>

        <section className="rounded-lg border border-border p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h3 className="text-base font-semibold">{t('quoteDetail.sections.quoteLayout', { defaultValue: 'Quote Layout' })}</h3>
              <p className="text-sm text-muted-foreground">
                {t('quoteForm.fields.quoteLayoutHelp', {
                  defaultValue: "Choose which layout to use for this quote's PDF. Leave empty to use the default.",
                })}
              </p>
            </div>
            <div className="w-full md:w-72">
              <CustomSelect
                id="quote-detail-template-select"
                value={quote.template_id || undefined}
                onValueChange={(value) => void handleAssignTemplate(value || null)}
                placeholder={t('quoteForm.placeholders.useDefaultLayout', { defaultValue: 'Use default layout' })}
                allowClear
                options={documentTemplates.map((template) => ({
                  value: template.template_id,
                  label: `${template.name}${template.isStandard ? ` (${t('common.badges.standard', { defaultValue: 'Standard' })})` : ''}`,
                }))}
              />
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-base font-semibold">{t('quoteDetail.sections.versionHistory', { defaultValue: 'Version History' })}</h3>
          {versions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {versions.map((version) => (
                <Button
                  key={version.quote_id}
                  id={`quote-version-${version.quote_id}`}
                  type="button"
                  variant={version.quote_id === quote.quote_id ? 'default' : 'outline'}
                  onClick={() => onSelectVersion?.(version.quote_id)}
                  disabled={version.quote_id === quote.quote_id}
                >
                  {formatQuoteNumber(version, t('quoteDetail.labels.templateQuote', { defaultValue: 'Template quote' }))}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('quoteDetail.empty.revisions', { defaultValue: 'No prior revisions for this quote yet.' })}</p>
          )}
        </section>

        <section className="space-y-2 rounded-lg border border-border p-4">
          <h3 className="text-base font-semibold">{t('quoteDetail.sections.scopeOfWork', { defaultValue: 'Scope of Work' })}</h3>
          <p className="whitespace-pre-wrap text-sm text-foreground">{quote.description || '—'}</p>
        </section>

        {quote.status === 'accepted' && (
          <section className="space-y-2 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 p-4">
            <h3 className="text-base font-semibold text-emerald-800 dark:text-emerald-300">{t('quoteForm.alerts.accepted', { defaultValue: 'Quote Accepted' })}</h3>
            <div className="text-sm text-emerald-700 dark:text-emerald-400 space-y-1">
              {quote.accepted_by_name && <p><span className="font-medium">{t('quoteDetail.status.acceptedBy', { defaultValue: 'Accepted by:' })}</span> {quote.accepted_by_name}</p>}
              {quote.accepted_at && <p><span className="font-medium">{t('quoteDetail.status.acceptedOn', { defaultValue: 'Accepted on:' })}</span> {formatDate(quote.accepted_at)}</p>}
            </div>
          </section>
        )}

        {quote.status === 'rejected' && (
          <section className="space-y-2 rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30 p-4">
            <h3 className="text-base font-semibold text-red-800 dark:text-red-300">{t('quoteForm.alerts.rejected', { defaultValue: 'Quote Rejected' })}</h3>
            <div className="text-sm text-red-700 dark:text-red-400 space-y-1">
              {quote.rejected_at && <p><span className="font-medium">{t('quoteDetail.status.rejectedOn', { defaultValue: 'Rejected on:' })}</span> {formatDate(quote.rejected_at)}</p>}
              {quote.rejection_reason && <p><span className="font-medium">{t('quoteDetail.status.reason', { defaultValue: 'Reason:' })}</span> {quote.rejection_reason}</p>}
            </div>
          </section>
        )}

        <section className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-base font-semibold">{t('quoteDetail.sections.lineItems', { defaultValue: 'Line Items' })}</h3>
          {quote.status === 'accepted' && acceptedOptionalItems.length > 0 ? (
            <Alert>
              <AlertTitle>{t('quoteDetail.alerts.clientConfigurationSubmitted', { defaultValue: 'Client Configuration Submitted' })}</AlertTitle>
              <AlertDescription>
                {t('quoteDetail.alerts.clientConfigurationSubmittedDescription', {
                  defaultValue:
                    'Review the optional line items below before converting this quote. Selected items are marked as included, and declined items are highlighted for follow-up.',
                })}
              </AlertDescription>
            </Alert>
          ) : null}
          {quoteItems.length ? (
            showLocationGroupedItems ? (
              <div className="space-y-4">
                {locationGroups.map((group) => {
                  const subtotal = group.items
                    .filter((item) => !item.is_discount && (!item.is_optional || item.is_selected !== false))
                    .reduce((sum, item) => sum + (Number(item.total_price) || 0), 0);
                  return (
                    <div key={group.key} className="overflow-hidden rounded-md border border-border">
                      <div className="flex flex-col gap-2 border-b border-border bg-muted/40 px-4 py-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {t('quotes.locations.groupHeading', { defaultValue: 'Location' })}
                          </div>
                          <div className="mt-1">
                            <LocationAddress
                              location={group.location}
                              showName
                              emptyText={t('quotes.locations.unassigned', { defaultValue: 'Items without a location' })}
                            />
                          </div>
                        </div>
                        <div className="text-sm">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            {t('quotes.locations.subtotal', { defaultValue: 'Location subtotal' })}
                          </div>
                          <div className="mt-1 font-semibold">{formatCurrency(subtotal, quote.currency_code || 'USD')}</div>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-border text-sm">
                          <thead className="bg-background text-left">
                            <tr>
                              <th className="px-3 py-2 font-medium">Description</th>
                              <th className="px-3 py-2 font-medium">Billing</th>
                              <th className="px-3 py-2 font-medium">Qty</th>
                              <th className="px-3 py-2 font-medium">Unit Price</th>
                              <th className="px-3 py-2 font-medium">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border bg-background">
                            {group.items.map((item) => renderQuoteDetailRow(quote, item, formatCurrency))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">Description</th>
                      <th className="px-3 py-2 font-medium">Billing</th>
                      <th className="px-3 py-2 font-medium">Qty</th>
                      <th className="px-3 py-2 font-medium">Unit Price</th>
                      <th className="px-3 py-2 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-background">
                    {quoteItems.map((item) => renderQuoteDetailRow(quote, item, formatCurrency))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <p className="text-sm text-muted-foreground">{t('quoteDetail.empty.lineItems', { defaultValue: 'No line items on this quote yet.' })}</p>
          )}
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2 rounded-lg border border-border p-4">
            <h3 className="text-base font-semibold">{t('quoteDetail.sections.clientNotes', { defaultValue: 'Client Notes' })}</h3>
            <p className="whitespace-pre-wrap text-sm text-foreground">{quote.client_notes || '—'}</p>
          </div>
          <div className="space-y-2 rounded-lg border border-border p-4">
            <h3 className="text-base font-semibold">{t('quoteDetail.sections.internalNotes', { defaultValue: 'Internal Notes' })}</h3>
            <p className="whitespace-pre-wrap text-sm text-foreground">{quote.internal_notes || '—'}</p>
          </div>
        </section>

        <section className="space-y-2 rounded-lg border border-border p-4">
          <h3 className="text-base font-semibold">{t('quoteDetail.sections.termsAndConditions', { defaultValue: 'Terms & Conditions' })}</h3>
          <p className="whitespace-pre-wrap text-sm text-foreground">{quote.terms_and_conditions || '—'}</p>
        </section>

        <section className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-base font-semibold">{t('quoteDetail.sections.activityLog', { defaultValue: 'Activity Log' })}</h3>
          {quote.quote_activities?.length ? (
            <div className="space-y-3">
              {quote.quote_activities.map((activity) => (
                <div key={activity.activity_id} className="rounded-md border border-border p-3">
                  <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                    <div className="font-medium text-foreground">{activity.description}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(activity.created_at)}</div>
                  </div>
                  <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                    {activity.activity_type.replace(/_/g, ' ')}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('quoteDetail.empty.activity', { defaultValue: 'No quote activity recorded yet.' })}</p>
          )}
        </section>
      </Box>
      <Dialog
        id="quote-conversion-preview"
        isOpen={isConversionDialogOpen}
        onClose={() => setIsConversionDialogOpen(false)}
        footer={(
          <div className="flex justify-end space-x-2">
            <Button id="quote-conversion-cancel" variant="outline" onClick={() => setIsConversionDialogOpen(false)} disabled={isWorking}>{t('common.actions.cancel', { defaultValue: 'Cancel' })}</Button>
            <Button id="quote-conversion-confirm" onClick={() => void handleConfirmConversion()} disabled={isWorking || !conversionPreview || (conversionMode === 'contract' && !conversionPreview.contract_items.length) || (conversionMode === 'invoice' && !conversionPreview.invoice_items.length) || (conversionMode === 'both' && (!conversionPreview.contract_items.length || !conversionPreview.invoice_items.length))}>
              {conversionMode === 'contract'
                ? t('quoteConversion.actions.contract', { defaultValue: 'Create Draft Contract' })
                : conversionMode === 'invoice'
                  ? t('quoteConversion.actions.invoice', { defaultValue: 'Create Draft Invoice' })
                  : t('quoteConversion.actions.both', { defaultValue: 'Create Both Records' })}
            </Button>
          </div>
        )}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('quoteForm.dialogs.conversion.title', { defaultValue: 'Conversion Preview' })}</DialogTitle>
            <DialogDescription>
              {t('quoteForm.dialogs.conversion.description', {
                defaultValue: 'Review what this quote conversion will create before confirming.',
              })}
            </DialogDescription>
          </DialogHeader>

          {conversionPreview ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('quoteConversion.sections.contractItems', { defaultValue: 'Contract Items' })}</div>
                  <div className="mt-1 text-lg font-semibold">{conversionPreview.contract_items.length}</div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('quoteConversion.sections.invoiceItems', { defaultValue: 'Invoice Items' })}</div>
                  <div className="mt-1 text-lg font-semibold">{conversionPreview.invoice_items.length}</div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('quoteConversion.sections.excludedItems', { defaultValue: 'Excluded Items' })}</div>
                  <div className="mt-1 text-lg font-semibold">{conversionPreview.excluded_items.length}</div>
                </div>
              </div>

              <section className="space-y-2 rounded-lg border border-border p-4">
                <h3 className="text-base font-semibold">{t('quoteConversion.sections.willBecomeContractLines', { defaultValue: 'Will Become Contract Lines' })}</h3>
                {conversionPreview.contract_items.length ? (
                  <div className="space-y-2">
                    {conversionPreview.contract_items.map((item) => (
                      <div key={item.quote_item_id} className="rounded-md border border-border p-3">
                        <div className="font-medium text-foreground">{item.description}</div>
                        <div className="text-sm text-muted-foreground">
                          {item.billing_method || t('quoteConversion.summary.fixed', { defaultValue: 'fixed' })} • {t('quoteLineItems.columns.quantity', { defaultValue: 'Qty' })} {item.quantity} • {formatCurrency(item.total_price, quote.currency_code || 'USD')}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('quoteConversion.empty.contractItems', { defaultValue: 'No recurring items will convert to a contract.' })}</p>
                )}
              </section>

              <section className="space-y-2 rounded-lg border border-border p-4">
                <h3 className="text-base font-semibold">{t('quoteConversion.sections.willBecomeInvoiceCharges', { defaultValue: 'Will Become Invoice Charges' })}</h3>
                {conversionPreview.invoice_items.length ? (
                  <div className="space-y-2">
                    {conversionPreview.invoice_items.map((item) => (
                      <div key={item.quote_item_id} className="rounded-md border border-border p-3">
                        <div className="font-medium text-foreground">{item.description}</div>
                        <div className="text-sm text-muted-foreground">
                          {item.is_discount
                            ? t('quoteConversion.summary.discount', { defaultValue: 'Discount' })
                            : (item.billing_method || t('quoteConversion.summary.fixed', { defaultValue: 'fixed' }))} • {t('quoteLineItems.columns.quantity', { defaultValue: 'Qty' })} {item.quantity} • {formatCurrency(item.total_price, quote.currency_code || 'USD')}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('quoteConversion.empty.invoiceItems', { defaultValue: 'No one-time items will convert to an invoice.' })}</p>
                )}
              </section>

              {conversionPreview.excluded_items.length ? (
                <section className="space-y-2 rounded-lg border border-border p-4">
                  <h3 className="text-base font-semibold">{t('quoteConversion.sections.excludedFromConversion', { defaultValue: 'Excluded from Conversion' })}</h3>
                  <div className="space-y-2">
                    {conversionPreview.excluded_items.map((item) => (
                      <div key={item.quote_item_id} className="rounded-md border border-border p-3">
                        <div className="font-medium text-foreground">{item.description}</div>
                        <div className="text-sm text-muted-foreground">{item.reason || t('quoteConversion.summary.notConverted', { defaultValue: 'Not converted' })}</div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center justify-center py-10">
              <LoadingIndicator text={t('quoteConversion.loading', { defaultValue: 'Loading conversion preview...' })} spinnerProps={{ size: 'sm' }} />
            </div>
          )}

        </DialogContent>
      </Dialog>
      <Dialog
        id="quote-preview-dialog"
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title={t('quotePreview.title', { defaultValue: 'Quote Preview' })}
        className="max-w-4xl"
        footer={(
          <div className="flex justify-end space-x-2">
            <Button id="quote-preview-close" variant="outline" onClick={() => setIsPreviewOpen(false)}>{t('common.actions.close', { defaultValue: 'Close' })}</Button>
          </div>
        )}
      >
        <DialogContent>
          {previewHtml ? (
            <div className="rounded border border-border p-4 bg-white text-black" style={{ colorScheme: 'light' }}>
              <style dangerouslySetInnerHTML={{ __html: previewHtml.css }} />
              <div dangerouslySetInnerHTML={{ __html: previewHtml.html }} />
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">{t('quoteDetail.preview.loading', { defaultValue: 'Loading preview...' })}</div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        id="quote-send-dialog"
        isOpen={isSendDialogOpen}
        onClose={() => setIsSendDialogOpen(false)}
        title={t('quoteForm.dialogs.send.title', { defaultValue: 'Send Quote to Client' })}
        footer={(
          <div className="flex justify-end space-x-2">
            <Button id="quote-send-cancel" variant="outline" onClick={() => setIsSendDialogOpen(false)} disabled={isWorking}>{t('common.actions.cancel', { defaultValue: 'Cancel' })}</Button>
            <Button id="quote-send-confirm" onClick={() => void handleSendQuote()} disabled={isWorking}>
              {isWorking
                ? t('common.states.sending', { defaultValue: 'Sending...' })
                : t('quoteForm.actions.sendQuote', { defaultValue: 'Send Quote' })}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <DialogDescription>
            {t('quoteForm.dialogs.send.description', {
              defaultValue: 'This will email the quote to the client\'s billing contacts and change its status to "Sent".',
            })}
          </DialogDescription>
          <div className="space-y-3 py-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('quoteForm.fields.recipients', { defaultValue: 'Recipients' })}
              <QuoteSendRecipientsField
                id="quote-send-recipients"
                clientId={quote?.client_id}
                value={sendRecipients}
                onChange={setSendRecipients}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('quoteForm.fields.additionalEmails', { defaultValue: 'Additional email addresses (comma-separated)' })}
              <input
                type="text"
                value={additionalEmails}
                onChange={(event) => setAdditionalEmails(event.target.value)}
                placeholder={t('quoteForm.placeholders.additionalEmails', { defaultValue: 'email@example.com, another@example.com' })}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('quoteDetail.dialogs.send.message', { defaultValue: 'Optional message to include in the email' })}
              <TextArea
                value={sendMessage}
                onChange={(event) => setSendMessage(event.target.value)}
                rows={3}
                placeholder={t('quoteForm.placeholders.message', { defaultValue: 'Add a personal note for the client...' })}
              />
            </label>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        id="quote-approval-dialog"
        isOpen={approvalDialogMode !== null}
        onClose={() => { setApprovalDialogMode(null); setApprovalComment(''); }}
        title={approvalDialogMode === 'approve'
          ? t('quoteForm.dialogs.approval.approveTitle', { defaultValue: 'Approve Quote' })
          : t('quoteForm.dialogs.approval.changesTitle', { defaultValue: 'Request Changes' })}
        footer={(
          <div className="flex justify-end space-x-2">
            <Button
              id="quote-approval-cancel"
              variant="outline"
              onClick={() => { setApprovalDialogMode(null); setApprovalComment(''); }}
              disabled={isWorking}
            >
              {t('common.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id="quote-approval-confirm"
              onClick={() => void (approvalDialogMode === 'approve' ? handleApproveQuote() : handleRequestChanges())}
              disabled={isWorking || (approvalDialogMode === 'changes' && !approvalComment.trim())}
            >
              {isWorking
                ? t('quoteForm.dialogs.approval.processing', { defaultValue: 'Processing...' })
                : approvalDialogMode === 'approve'
                  ? t('common.actions.approve', { defaultValue: 'Approve' })
                  : t('common.actions.requestChanges', { defaultValue: 'Request Changes' })}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <DialogDescription>
            {approvalDialogMode === 'approve'
              ? t('quoteDetail.dialogs.approval.approveDescription', {
                defaultValue: 'Approve this quote so it can be sent to the client. You may add an optional comment.',
              })
              : t('quoteDetail.dialogs.approval.changesDescription', {
                defaultValue: 'Return this quote to draft with requested changes. Please describe what needs to be revised.',
              })}
          </DialogDescription>
          <div className="space-y-3 py-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {approvalDialogMode === 'approve'
                ? t('quoteForm.dialogs.approval.approveComment', { defaultValue: 'Comment (optional)' })
                : t('quoteForm.dialogs.approval.changesComment', { defaultValue: 'Requested changes' })}
              <TextArea
                value={approvalComment}
                onChange={(event) => setApprovalComment(event.target.value)}
                rows={3}
                placeholder={approvalDialogMode === 'approve'
                  ? t('quoteForm.dialogs.approval.approveCommentPlaceholder', { defaultValue: 'Add an optional note...' })
                  : t('quoteForm.dialogs.approval.changesCommentPlaceholder', { defaultValue: 'Describe the changes needed...' })}
              />
            </label>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default QuoteDetail;
