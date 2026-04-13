'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { CURRENCY_OPTIONS } from '@alga-psa/core';
import type { IClient, IContact, IQuote, IQuoteDocumentTemplate, IQuoteListItem, QuoteConversionPreview, QuoteStatus } from '@alga-psa/types';
import { isActionPermissionError, getErrorMessage } from '@alga-psa/ui/lib/errorHandling';
import { getDefaultBillingSettings } from '@alga-psa/billing/actions';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import { getAllClientsForBilling } from '../../../actions/billingClientsActions';
import { addQuoteItem, approveQuote, convertQuoteToBoth, convertQuoteToContract, convertQuoteToInvoice, createQuote, createQuoteFromTemplate, createQuoteRevision, downloadQuotePdf, duplicateQuote, getQuote, getQuoteApprovalSettings, getQuoteConversionPreview, listQuotes, removeQuoteItem, reorderQuoteItems, requestQuoteApprovalChanges, resendQuote, sendQuote, sendQuoteReminder, submitQuoteForApproval, updateQuote, updateQuoteItem } from '../../../actions/quoteActions';
import { getQuoteDocumentTemplates } from '../../../actions/quoteDocumentTemplates';
import { getContactsForPicker } from '@alga-psa/user-composition/actions';
import QuoteLineItemsEditor from './QuoteLineItemsEditor';
import { QuoteSendRecipientsField, type QuoteRecipient } from './QuoteSendRecipientsField';
import QuoteStatusBadge from './QuoteStatusBadge';
import { calculateDraftQuoteTotals, createDraftQuoteItemFromQuoteItem, formatDraftQuoteMoney, type DraftQuoteItem } from './quoteLineItemDraft';

interface QuoteFormProps {
  quoteId?: string | null;
  initialIsTemplate?: boolean;
  onCancel: () => void;
  onSaved: (quoteId: string) => void;
}

interface QuoteFormState {
  client_id: string;
  contact_id: string;
  template_id: string;
  title: string;
  description: string;
  quote_date: string;
  valid_until: string;
  po_number: string;
  opportunity_id: string;
  client_notes: string;
  terms_and_conditions: string;
  currency_code: string;
}

const EMPTY_FORM: QuoteFormState = {
  client_id: '',
  contact_id: '',
  template_id: '',
  title: '',
  description: '',
  quote_date: '',
  valid_until: '',
  po_number: '',
  opportunity_id: '',
  client_notes: '',
  terms_and_conditions: '',
  currency_code: 'USD',
};

const toDateInputValue = (value?: string | Date | null): string => {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === 'string' ? value.slice(0, 10) : String(value).slice(0, 10);
};

const QuoteForm: React.FC<QuoteFormProps> = ({ quoteId, initialIsTemplate = false, onCancel, onSaved }) => {
  const isEditMode = Boolean(quoteId && quoteId !== 'new');
  const [defaultCurrency, setDefaultCurrency] = useState('USD');
  const [form, setForm] = useState<QuoteFormState>(EMPTY_FORM);

  useEffect(() => {
    getDefaultBillingSettings()
      .then((settings) => {
        const currency = settings.defaultCurrencyCode || 'USD';
        setDefaultCurrency(currency);
        setForm((prev) => prev.currency_code === 'USD' ? { ...prev, currency_code: currency } : prev);
      })
      .catch(() => {});
  }, []);
  const [isTemplate, setIsTemplate] = useState(initialIsTemplate);
  const [clients, setClients] = useState<IClient[]>([]);
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [templates, setTemplates] = useState<IQuoteListItem[]>([]);
  const [documentTemplates, setDocumentTemplates] = useState<IQuoteDocumentTemplate[]>([]);
  const [documentTemplateId, setDocumentTemplateId] = useState<string>('');
  const [lineItems, setLineItems] = useState<DraftQuoteItem[]>([]);
  const [persistedQuoteItemIds, setPersistedQuoteItemIds] = useState<string[]>([]);
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Workflow state — sourced from the persisted quote for status-based actions
  const [quote, setQuote] = useState<IQuote | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [isSendDialogOpen, setIsSendDialogOpen] = useState(false);
  const [sendRecipients, setSendRecipients] = useState<QuoteRecipient[]>([]);
  const [sendAdditionalEmails, setSendAdditionalEmails] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [approvalDialogMode, setApprovalDialogMode] = useState<'approve' | 'changes' | null>(null);
  const [approvalComment, setApprovalComment] = useState('');
  const [conversionMode, setConversionMode] = useState<'contract' | 'invoice' | 'both' | null>(null);
  const [conversionPreview, setConversionPreview] = useState<QuoteConversionPreview | null>(null);
  const [isConversionDialogOpen, setIsConversionDialogOpen] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  useEffect(() => {
    void loadFormData();
  }, [quoteId]);

  const loadFormData = async () => {
    try {
      setIsLoading(true);

      const [fetchedClients, fetchedContacts, fetchedTemplates, fetchedDocTemplates, approvalSettings] = await Promise.all([
        getAllClientsForBilling(false),
        getContactsForPicker('active'),
        listQuotes({ is_template: true, pageSize: 200 }),
        getQuoteDocumentTemplates(),
        getQuoteApprovalSettings(),
      ]);

      setApprovalRequired(!isActionPermissionError(approvalSettings) && approvalSettings.approvalRequired === true);

      setClients(fetchedClients);
      setContacts(fetchedContacts);
      setTemplates(isActionPermissionError(fetchedTemplates) ? [] : fetchedTemplates.data);
      setDocumentTemplates(Array.isArray(fetchedDocTemplates) ? fetchedDocTemplates : []);

      if (isEditMode && quoteId) {
        const quote = await getQuote(quoteId);
        if (!quote || isActionPermissionError(quote)) {
          throw new Error(!quote ? 'Quote not found' : getErrorMessage(quote));
        }

        setQuote(quote);
        setIsTemplate(quote.is_template === true);
        setDocumentTemplateId(quote.template_id || '');
        setForm({
          client_id: quote.client_id || '',
          contact_id: quote.contact_id || '',
          template_id: quote.template_id || '',
          title: quote.title || '',
          description: quote.description || '',
          quote_date: toDateInputValue(quote.quote_date),
          valid_until: toDateInputValue(quote.valid_until),
          po_number: quote.po_number || '',
          opportunity_id: quote.opportunity_id || '',
          client_notes: quote.client_notes || '',
          terms_and_conditions: quote.terms_and_conditions || '',
          currency_code: quote.currency_code || defaultCurrency,
        });
        setLineItems((quote.quote_items || []).map(createDraftQuoteItemFromQuoteItem));
        setPersistedQuoteItemIds((quote.quote_items || []).map((item) => item.quote_item_id));
      } else {
        const today = new Date();
        const validUntil = new Date(today);
        validUntil.setDate(validUntil.getDate() + 30);

        setForm({
          ...EMPTY_FORM,
          currency_code: defaultCurrency,
          quote_date: today.toISOString().slice(0, 10),
          valid_until: validUntil.toISOString().slice(0, 10),
        });
        setLineItems([]);
        setPersistedQuoteItemIds([]);
      }

      setError(null);
    } catch (loadError) {
      console.error('Error loading quote form:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load quote form');
    } finally {
      setIsLoading(false);
    }
  };

  const availableContacts = useMemo(() => {
    if (!form.client_id) {
      return contacts;
    }

    return contacts.filter((contact) => contact.client_id === form.client_id);
  }, [contacts, form.client_id]);

  const draftTotals = useMemo(() => calculateDraftQuoteTotals(lineItems), [lineItems]);

  const handleChange = (field: keyof QuoteFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleTemplateChange = async (templateId: string) => {
    handleChange('template_id', templateId);

    if (!templateId) {
      setLineItems([]);
      return;
    }

    try {
      const template = await getQuote(templateId);
      if (!template || isActionPermissionError(template)) return;

      setForm((current) => ({
        ...current,
        template_id: templateId,
        title: current.title || template.title || '',
        description: current.description || template.description || '',
        client_notes: current.client_notes || template.client_notes || '',
        terms_and_conditions: current.terms_and_conditions || template.terms_and_conditions || '',
        currency_code: current.currency_code || template.currency_code || defaultCurrency,
        po_number: current.po_number || template.po_number || '',
      }));

      if (template.quote_items?.length) {
        setLineItems(template.quote_items.map((item) => ({
          ...createDraftQuoteItemFromQuoteItem(item),
          local_id: crypto.randomUUID(),
          quote_item_id: undefined,
        })));
      }
    } catch (err) {
      console.error('Failed to load template:', err);
    }
  };

  const handleSubmit = async () => {
    try {
      setIsSaving(true);
      setError(null);

      if (!isTemplate && !form.client_id) {
        throw new Error('Client is required');
      }

      if (!form.title && !form.template_id) {
        throw new Error('Title is required unless creating from template');
      }

      const payload = {
        client_id: form.client_id || null,
        contact_id: form.contact_id || null,
        title: form.title,
        description: form.description || null,
        quote_date: form.quote_date || null,
        valid_until: form.valid_until || null,
        po_number: form.po_number || null,
        opportunity_id: form.opportunity_id || null,
        client_notes: form.client_notes || null,
        terms_and_conditions: form.terms_and_conditions || null,
        subtotal: 0,
        discount_total: 0,
        tax: 0,
        total_amount: 0,
        currency_code: form.currency_code,
        is_template: isTemplate,
        template_id: documentTemplateId || null,
      };

      let result: IQuote | { permissionError: string } | null;

      if (isEditMode && quoteId) {
        result = await updateQuote(quoteId, payload as Partial<IQuote>);
      } else if (form.template_id) {
        result = await createQuoteFromTemplate(form.template_id, payload as any);
      } else {
        result = await createQuote(payload as any);
      }

      if (!result || isActionPermissionError(result)) {
        throw new Error(result ? getErrorMessage(result) : 'Quote save failed');
      }

      // When creating from a template, the server already created all line items.
      // Skip client-side item persistence to avoid duplicates.
      const createdFromTemplate = !isEditMode && Boolean(form.template_id);

      let nextLineItems = createdFromTemplate
        ? (result.quote_items || []).map(createDraftQuoteItemFromQuoteItem)
        : lineItems;

      if (!createdFromTemplate) {
        const quoteItemIdMap = new Map<string, string>(
          lineItems
            .filter((item) => Boolean(item.quote_item_id))
            .map((item) => [item.local_id, item.quote_item_id as string])
        );

        const persistItem = async (item: DraftQuoteItem) => {
          const sharedPayload = {
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            unit_of_measure: item.unit_of_measure ?? null,
            phase: item.phase ?? null,
            is_optional: item.is_optional,
            is_selected: item.is_selected,
            is_recurring: item.is_recurring,
            billing_frequency: item.billing_frequency ?? null,
            billing_method: item.billing_method ?? null,
            is_discount: item.is_discount ?? false,
            discount_type: item.discount_type ?? null,
            discount_percentage: item.discount_percentage ?? null,
            applies_to_item_id: item.applies_to_item_id ? (quoteItemIdMap.get(item.applies_to_item_id) ?? item.applies_to_item_id) : null,
            applies_to_service_id: item.applies_to_service_id ?? null,
            is_taxable: item.is_taxable ?? true,
            tax_region: item.tax_region ?? null,
            tax_rate: item.tax_rate ?? null,
            cost: item.cost ?? null,
            cost_currency: item.cost_currency ?? null,
          };

          if (item.quote_item_id) {
            const updatedItem = await updateQuoteItem(item.quote_item_id, sharedPayload);
            if ('permissionError' in updatedItem) {
              throw new Error(updatedItem.permissionError);
            }

            nextLineItems = nextLineItems.map((draftItem) => draftItem.local_id === item.local_id ? {
              ...draftItem,
              ...createDraftQuoteItemFromQuoteItem(updatedItem),
            } : draftItem);
            quoteItemIdMap.set(item.local_id, updatedItem.quote_item_id);
            return;
          }

          const createdItem = await addQuoteItem({
            quote_id: result.quote_id,
            service_id: item.service_id ?? null,
            ...sharedPayload,
          });

          if ('permissionError' in createdItem) {
            throw new Error(createdItem.permissionError);
          }

          nextLineItems = nextLineItems.map((draftItem) => {
            if (draftItem.local_id !== item.local_id) {
              return draftItem;
            }

            return {
              ...draftItem,
              local_id: createdItem.quote_item_id,
              quote_item_id: createdItem.quote_item_id,
            };
          });
          quoteItemIdMap.set(item.local_id, createdItem.quote_item_id);
        };

        const nonDiscountItems = lineItems.filter((item) => !item.is_discount);
        const discountItems = lineItems.filter((item) => item.is_discount);

        for (const item of nonDiscountItems) {
          await persistItem(item);
        }

        for (const item of discountItems) {
          await persistItem(item);
        }

        const currentQuoteItemIds = nextLineItems
          .map((item) => item.quote_item_id)
          .filter((value): value is string => Boolean(value));

        const removedQuoteItemIds = persistedQuoteItemIds.filter((itemId) => !currentQuoteItemIds.includes(itemId));
        for (const removedQuoteItemId of removedQuoteItemIds) {
          const removalResult = await removeQuoteItem(removedQuoteItemId);
          if (typeof removalResult !== 'boolean') {
            throw new Error(removalResult.permissionError);
          }
        }

        if (currentQuoteItemIds.length > 0) {
          const reorderedItems = await reorderQuoteItems(result.quote_id, currentQuoteItemIds);
          if ('permissionError' in reorderedItems) {
            throw new Error(reorderedItems.permissionError);
          }
          nextLineItems = reorderedItems.map(createDraftQuoteItemFromQuoteItem);
        }
      }

      setLineItems(nextLineItems);
      setPersistedQuoteItemIds(nextLineItems.map((item) => item.quote_item_id).filter((value): value is string => Boolean(value)));

      onSaved(result.quote_id);
    } catch (submitError) {
      console.error('Error saving quote:', submitError);
      setError(submitError instanceof Error ? submitError.message : 'Failed to save quote');
    } finally {
      setIsSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Workflow action helpers (ported from QuoteDetail)
  // ---------------------------------------------------------------------------

  const quoteStatus = (quote?.status ?? 'draft') as QuoteStatus;

  const runWorkflowAction = async (label: string, action: () => Promise<IQuote | { permissionError: string }>) => {
    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await action();
      if (result && typeof result === 'object' && 'permissionError' in result) {
        throw new Error((result as { permissionError: string }).permissionError);
      }
      setQuote(result as IQuote);
      return result;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `Failed to ${label}`);
      return null;
    } finally {
      setIsWorking(false);
    }
  };

  const handleSendQuote = async () => {
    if (!quote) return;
    const typedEmails = sendAdditionalEmails.split(',').map((e) => e.trim()).filter(Boolean);
    const pickedEmails = sendRecipients.map((r) => r.email);
    const seen = new Set<string>();
    const combined: string[] = [];
    for (const email of [...pickedEmails, ...typedEmails]) {
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(email);
    }
    const result = await runWorkflowAction('send quote', () =>
      sendQuote(quote.quote_id, {
        message: sendMessage.trim() || undefined,
        email_addresses: combined.length > 0 ? combined : undefined,
      })
    );
    if (result) {
      setIsSendDialogOpen(false);
      setSendMessage('');
      setSendRecipients([]);
      setSendAdditionalEmails('');
      setNotice('Quote sent to the client.');
    }
  };

  const handleResendQuote = async () => {
    if (!quote) return;
    const result = await runWorkflowAction('resend quote', () => resendQuote(quote.quote_id));
    if (result) setNotice('Quote resent.');
  };

  const handleSendReminder = async () => {
    if (!quote) return;
    const result = await runWorkflowAction('send reminder', () => sendQuoteReminder(quote.quote_id));
    if (result) setNotice('Quote reminder sent.');
  };

  const handleSubmitForApproval = async () => {
    if (!quote) return;
    const result = await runWorkflowAction('submit for approval', () => submitQuoteForApproval(quote.quote_id));
    if (result) setNotice('Quote submitted for internal approval.');
  };

  const handleApproveQuote = async () => {
    if (!quote) return;
    const result = await runWorkflowAction('approve quote', () => approveQuote(quote.quote_id, approvalComment));
    if (result) {
      setApprovalDialogMode(null);
      setApprovalComment('');
      setNotice('Quote approved and is ready to send.');
    }
  };

  const handleRequestChanges = async () => {
    if (!quote) return;
    const result = await runWorkflowAction('request changes', () => requestQuoteApprovalChanges(quote.quote_id, approvalComment));
    if (result) {
      setApprovalDialogMode(null);
      setApprovalComment('');
      setNotice('Quote returned to draft with requested changes.');
    }
  };

  const handleCancelQuote = async () => {
    if (!quote) return;
    const result = await runWorkflowAction('cancel quote', () => updateQuote(quote.quote_id, { status: 'cancelled' }));
    if (result) setNotice('Quote cancelled.');
  };

  const handleReviseQuote = async () => {
    if (!quote) return;
    try {
      setIsWorking(true);
      setError(null);
      const result = await createQuoteRevision(quote.quote_id);
      if ('permissionError' in result) throw new Error(result.permissionError);
      onSaved(result.quote_id);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to create revision');
    } finally {
      setIsWorking(false);
    }
  };

  const handleDuplicateQuote = async () => {
    if (!quote) return;
    try {
      setIsWorking(true);
      setError(null);
      const result = await duplicateQuote(quote.quote_id);
      if ('permissionError' in result) throw new Error(result.permissionError);
      onSaved(result.quote_id);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to duplicate quote');
    } finally {
      setIsWorking(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!quote) return;
    try {
      setIsWorking(true);
      setError(null);
      const result = await downloadQuotePdf(quote.quote_id);
      if (result && typeof result === 'object' && 'permissionError' in result) throw new Error(result.permissionError);
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
      setError(actionError instanceof Error ? actionError.message : 'Failed to download PDF');
    } finally {
      setIsWorking(false);
    }
  };

  const canConvertToContract = useMemo(() => {
    return Boolean((quote?.quote_items || []).some((item) => item.is_recurring && !item.is_discount && (!item.is_optional || item.is_selected !== false)));
  }, [quote]);
  const canConvertToInvoice = useMemo(() => {
    const oneTimeItems = (quote?.quote_items || []).filter((item) => !item.is_recurring && (!item.is_optional || item.is_selected !== false));
    return oneTimeItems.some((item) => !item.is_discount);
  }, [quote]);
  const canConvertToBoth = canConvertToContract && canConvertToInvoice;

  const handleOpenConversionDialog = async (mode: 'contract' | 'invoice' | 'both') => {
    if (!quote) return;
    try {
      setIsPreviewLoading(true);
      setError(null);
      setConversionMode(mode);
      const preview = await getQuoteConversionPreview(quote.quote_id);
      if ('permissionError' in preview) throw new Error(preview.permissionError);
      setConversionPreview(preview);
      setIsConversionDialogOpen(true);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Failed to load conversion preview');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleConfirmConversion = async () => {
    if (!quote || !conversionMode) return;
    try {
      setIsWorking(true);
      setError(null);
      if (conversionMode === 'contract') {
        const result = await convertQuoteToContract(quote.quote_id);
        if ('permissionError' in result) throw new Error(result.permissionError);
        setQuote(result.quote);
        setNotice(`Created draft contract ${result.contract.contract_name}.`);
      } else if (conversionMode === 'invoice') {
        const result = await convertQuoteToInvoice(quote.quote_id);
        if ('permissionError' in result) throw new Error(result.permissionError);
        setQuote(result.quote);
        setNotice(`Created draft invoice ${result.invoice.invoice_number}.`);
      } else {
        const result = await convertQuoteToBoth(quote.quote_id);
        if ('permissionError' in result) throw new Error(result.permissionError);
        setQuote(result.quote);
        setNotice(`Created draft contract ${result.contract.contract_name} and draft invoice ${result.invoice.invoice_number}.`);
      }
      setIsConversionDialogOpen(false);
      setConversionPreview(null);
      setConversionMode(null);
    } catch (conversionError) {
      setError(conversionError instanceof Error ? conversionError.message : 'Failed to convert quote');
    } finally {
      setIsWorking(false);
    }
  };

  const formatCurrency = (minorUnits: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: form.currency_code || 'USD' }).format((minorUnits || 0) / 100);

  const isReadOnly = isEditMode && !isTemplate && quoteStatus !== 'draft';

  if (isLoading) {
    return (
      <Card size="2">
        <Box p="4">
          <LoadingIndicator
            className="py-12 text-muted-foreground"
            layout="stacked"
            spinnerProps={{ size: 'md' }}
            text="Loading quote form..."
            textClassName="text-muted-foreground"
          />
        </Box>
      </Card>
    );
  }

  return (
    <Card size="2">
      <Box p="4" className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold">
              {isTemplate
                ? (isEditMode ? 'Edit Quote Template' : 'New Quote Template')
                : isReadOnly
                  ? (quote?.quote_number ? `Quote ${quote.quote_number}${quote.version > 1 ? ` v${quote.version}` : ''}` : 'Quote')
                  : (isEditMode ? 'Edit Quote' : 'New Quote')}
            </h2>
            {isEditMode && quote && !isTemplate && (
              <QuoteStatusBadge status={quoteStatus} />
            )}
          </div>
          <div className="flex items-center gap-2">
            {isEditMode && quote && !isTemplate && (
              <>
                <Button id="quote-form-download-pdf" variant="outline" onClick={() => void handleDownloadPdf()} disabled={isWorking}>Download PDF</Button>
                <Button id="quote-form-duplicate" variant="outline" onClick={() => void handleDuplicateQuote()} disabled={isWorking}>Duplicate</Button>
              </>
            )}
            <Button id="quote-form-cancel" variant="outline" onClick={onCancel}>Back</Button>
          </div>
        </div>

        {/* Status info banners */}
        {isEditMode && quote && !isTemplate && quoteStatus === 'accepted' && (
          <Alert>
            <AlertTitle>Quote Accepted</AlertTitle>
            <AlertDescription>
              {quote.accepted_by_name && <>Accepted by: {quote.accepted_by_name}<br /></>}
              {quote.accepted_at && <>Accepted on: {new Date(quote.accepted_at).toLocaleDateString()}</>}
            </AlertDescription>
          </Alert>
        )}
        {isEditMode && quote && !isTemplate && quoteStatus === 'rejected' && (
          <Alert variant="destructive">
            <AlertTitle>Quote Rejected</AlertTitle>
            <AlertDescription>
              {quote.rejected_at && <>Rejected on: {new Date(quote.rejected_at as string).toLocaleDateString()}<br /></>}
              {quote.rejection_reason && <>Reason: {quote.rejection_reason}</>}
            </AlertDescription>
          </Alert>
        )}
        {isEditMode && quote && !isTemplate && quoteStatus === 'converted' && (
          <Alert>
            <AlertTitle>Quote Converted</AlertTitle>
            <AlertDescription>This quote has been converted to a contract and/or invoice.</AlertDescription>
          </Alert>
        )}

        {/* Workflow action buttons */}
        {isEditMode && quote && !isTemplate && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3">
            {quoteStatus === 'draft' && (
              <>
                {approvalRequired ? (
                  <Button id="quote-form-submit-approval" onClick={() => void handleSubmitForApproval()} disabled={isWorking}>Submit for Approval</Button>
                ) : (
                  <Button id="quote-form-send" onClick={() => setIsSendDialogOpen(true)} disabled={isWorking}>Send to Client</Button>
                )}
              </>
            )}
            {quoteStatus === 'pending_approval' && (
              <>
                <Button id="quote-form-approve" onClick={() => setApprovalDialogMode('approve')} disabled={isWorking}>Approve</Button>
                <Button id="quote-form-request-changes" variant="outline" onClick={() => setApprovalDialogMode('changes')} disabled={isWorking}>Request Changes</Button>
              </>
            )}
            {quoteStatus === 'approved' && (
              <Button id="quote-form-send-approved" onClick={() => setIsSendDialogOpen(true)} disabled={isWorking}>Send to Client</Button>
            )}
            {quoteStatus === 'sent' && (
              <>
                <Button id="quote-form-revise" onClick={() => void handleReviseQuote()} disabled={isWorking}>Revise</Button>
                <Button id="quote-form-resend" variant="outline" onClick={() => void handleResendQuote()} disabled={isWorking}>Resend</Button>
                <Button id="quote-form-reminder" variant="outline" onClick={() => void handleSendReminder()} disabled={isWorking}>Send Reminder</Button>
                <Button id="quote-form-cancel-quote" variant="outline" onClick={() => void handleCancelQuote()} disabled={isWorking}>Cancel Quote</Button>
              </>
            )}
            {quoteStatus === 'accepted' && (
              <>
                <Button id="quote-form-convert-contract" onClick={() => void handleOpenConversionDialog('contract')} disabled={isWorking || isPreviewLoading}>Convert to Contract</Button>
                <Button id="quote-form-convert-invoice" onClick={() => void handleOpenConversionDialog('invoice')} disabled={isWorking || isPreviewLoading}>Convert to Invoice</Button>
                <Button id="quote-form-convert-both" variant="outline" onClick={() => void handleOpenConversionDialog('both')} disabled={isWorking || isPreviewLoading}>Convert to Both</Button>
              </>
            )}
            {(quoteStatus === 'rejected' || quoteStatus === 'expired') && (
              <Button id="quote-form-revise" onClick={() => void handleReviseQuote()} disabled={isWorking}>Create New Revision</Button>
            )}
            {isReadOnly && (
              <span className="ml-auto text-xs text-muted-foreground">
                This quote is read-only. To make changes, create a new revision.
              </span>
            )}
          </div>
        )}

        {notice && (
          <Alert>
            <AlertTitle>Quote</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Quote</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
            Title
            <Input value={form.title} onChange={(event) => handleChange('title', event.target.value)} disabled={isReadOnly} />
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
            Description / Scope
            <TextArea value={form.description} onChange={(event) => handleChange('description', event.target.value)} rows={4} disabled={isReadOnly} />
          </label>

          {!isTemplate && (
            <div className="flex flex-col gap-1 text-sm font-medium">
              <label htmlFor="quote-client">Client</label>
              <ClientPicker
                id="quote-client"
                clients={clients}
                selectedClientId={form.client_id || null}
                onSelect={(clientId) => {
                  if (isReadOnly) return;
                  handleChange('client_id', clientId || '');
                  if (clientId !== form.client_id) {
                    handleChange('contact_id', '');
                  }
                }}
                filterState={clientFilterState}
                onFilterStateChange={setClientFilterState}
                clientTypeFilter={clientTypeFilter}
                onClientTypeFilterChange={setClientTypeFilter}
                placeholder="Select client"
                disabled={isReadOnly}
              />
            </div>
          )}

          {!isTemplate && (
            <div className="flex flex-col gap-1 text-sm font-medium">
              <label htmlFor="quote-contact">Contact</label>
              <ContactPicker
                id="quote-contact"
                contacts={availableContacts}
                value={form.contact_id || ''}
                onValueChange={(value) => { if (!isReadOnly) handleChange('contact_id', value); }}
                clientId={form.client_id || undefined}
                placeholder="Select contact"
                buttonWidth="full"
                disabled={isReadOnly}
              />
            </div>
          )}

          <div className="flex flex-col gap-1 text-sm font-medium">
            <label htmlFor="quote-currency">Currency</label>
            <CustomSelect
              id="quote-currency"
              value={form.currency_code}
              onValueChange={(value) => handleChange('currency_code', value)}
              placeholder="Select currency"
              options={CURRENCY_OPTIONS.map((c) => ({ value: c.value, label: c.label }))}
              disabled={isReadOnly}
            />
          </div>

          {!isEditMode && (
            <div className="flex flex-col gap-1 text-sm font-medium">
              <label htmlFor="quote-template">Create From Template</label>
              <CustomSelect
                id="quote-template"
                value={form.template_id || undefined}
                onValueChange={(value) => void handleTemplateChange(value)}
                placeholder="Start from scratch"
                allowClear
                options={templates.map((template) => ({
                  value: template.quote_id,
                  label: template.title,
                }))}
              />
            </div>
          )}

          {!isTemplate && (
            <div className="flex flex-col gap-1 text-sm font-medium">
              <label htmlFor="quote-date">Quote Date</label>
              <DatePicker
                value={form.quote_date ? new Date(form.quote_date + 'T00:00:00') : undefined}
                onChange={(date) => { if (!isReadOnly) handleChange('quote_date', date ? date.toISOString().slice(0, 10) : ''); }}
                className="w-full"
                disabled={isReadOnly}
              />
            </div>
          )}

          {!isTemplate && (
            <div className="flex flex-col gap-1 text-sm font-medium">
              <label htmlFor="quote-valid-until">Valid Until</label>
              <DatePicker
                value={form.valid_until ? new Date(form.valid_until + 'T00:00:00') : undefined}
                onChange={(date) => { if (!isReadOnly) handleChange('valid_until', date ? date.toISOString().slice(0, 10) : ''); }}
                className="w-full"
                disabled={isReadOnly}
              />
            </div>
          )}

          {!isTemplate && (
            <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
              PO Number
              <Input value={form.po_number} onChange={(event) => handleChange('po_number', event.target.value)} disabled={isReadOnly} />
            </label>
          )}

          <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
            Notes to Client
            <TextArea value={form.client_notes} onChange={(event) => handleChange('client_notes', event.target.value)} rows={3} disabled={isReadOnly} />
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
            Terms & Conditions
            <TextArea value={form.terms_and_conditions} onChange={(event) => handleChange('terms_and_conditions', event.target.value)} rows={4} disabled={isReadOnly} />
          </label>

          <div className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
            <label htmlFor="quote-document-layout">Quote Layout</label>
            <p className="text-xs text-muted-foreground">Choose which layout to use for this quote&apos;s PDF. Leave empty to use the default.</p>
            <CustomSelect
              id="quote-document-layout"
              value={documentTemplateId || undefined}
              onValueChange={(value) => setDocumentTemplateId(value || '')}
              placeholder="Use default layout"
              allowClear
              options={documentTemplates.map((t) => ({
                value: t.template_id,
                label: `${t.name}${t.isStandard ? ' (Standard)' : ''}`,
              }))}
              disabled={isReadOnly}
            />
          </div>
        </div>

        <QuoteLineItemsEditor
          items={lineItems}
          currencyCode={form.currency_code}
          onChange={setLineItems}
          disabled={isSaving || isReadOnly}
        />

        <section className="grid gap-3 rounded-lg border border-border p-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Subtotal</div>
            <div className="mt-1 text-lg font-semibold">{formatDraftQuoteMoney(draftTotals.subtotal, form.currency_code)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Discounts</div>
            <div className="mt-1 text-lg font-semibold">{formatDraftQuoteMoney(draftTotals.discount_total, form.currency_code)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Tax</div>
            <div className="mt-1 text-lg font-semibold">{formatDraftQuoteMoney(draftTotals.tax, form.currency_code)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Total</div>
            <div className="mt-1 text-lg font-semibold">{formatDraftQuoteMoney(draftTotals.total_amount, form.currency_code)}</div>
          </div>
        </section>

        <div className="flex justify-end gap-2">
          <Button id="quote-form-cancel-bottom" variant="outline" onClick={onCancel}>Back</Button>
          {!isReadOnly && (
            <Button id="quote-form-save" onClick={() => void handleSubmit()} disabled={isSaving}>
              {isSaving ? 'Saving...' : isTemplate ? 'Save Template' : 'Save Quote'}
            </Button>
          )}
        </div>
      </Box>

      {/* Send dialog */}
      <Dialog
        id="quote-form-send-dialog"
        isOpen={isSendDialogOpen}
        onClose={() => setIsSendDialogOpen(false)}
        title="Send Quote to Client"
        footer={(
          <div className="flex justify-end space-x-2">
            <Button id="quote-form-send-cancel" variant="outline" onClick={() => setIsSendDialogOpen(false)} disabled={isWorking}>Cancel</Button>
            <Button id="quote-form-send-confirm" onClick={() => void handleSendQuote()} disabled={isWorking}>
              {isWorking ? 'Sending...' : 'Send Quote'}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <DialogDescription>
            This will email the quote to the client&apos;s billing contacts and change its status to &ldquo;Sent&rdquo;.
          </DialogDescription>
          <div className="space-y-3 py-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Recipients
              <QuoteSendRecipientsField
                id="quote-form-send-recipients"
                clientId={form.client_id}
                value={sendRecipients}
                onChange={setSendRecipients}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Additional email addresses (comma-separated)
              <Input
                id="quote-form-send-emails"
                value={sendAdditionalEmails}
                onChange={(event) => setSendAdditionalEmails(event.target.value)}
                placeholder="email@example.com, another@example.com"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Message (optional)
              <TextArea
                id="quote-form-send-message"
                value={sendMessage}
                onChange={(event) => setSendMessage(event.target.value)}
                rows={3}
                placeholder="Add a personal note for the client..."
              />
            </label>
          </div>
        </DialogContent>
      </Dialog>

      {/* Approval dialog */}
      <Dialog
        id="quote-form-approval-dialog"
        isOpen={approvalDialogMode !== null}
        onClose={() => { setApprovalDialogMode(null); setApprovalComment(''); }}
        title={approvalDialogMode === 'approve' ? 'Approve Quote' : 'Request Changes'}
        footer={(
          <div className="flex justify-end space-x-2">
            <Button id="quote-form-approval-cancel" variant="outline" onClick={() => { setApprovalDialogMode(null); setApprovalComment(''); }} disabled={isWorking}>Cancel</Button>
            <Button
              id="quote-form-approval-confirm"
              onClick={() => void (approvalDialogMode === 'approve' ? handleApproveQuote() : handleRequestChanges())}
              disabled={isWorking || (approvalDialogMode === 'changes' && !approvalComment.trim())}
            >
              {isWorking ? 'Processing...' : approvalDialogMode === 'approve' ? 'Approve' : 'Request Changes'}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <DialogDescription>
            {approvalDialogMode === 'approve'
              ? 'Approve this quote so it can be sent to the client.'
              : 'Return this quote to draft with requested changes.'}
          </DialogDescription>
          <div className="space-y-3 py-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {approvalDialogMode === 'approve' ? 'Comment (optional)' : 'Requested changes'}
              <TextArea
                id="quote-form-approval-comment"
                value={approvalComment}
                onChange={(event) => setApprovalComment(event.target.value)}
                rows={3}
                placeholder={approvalDialogMode === 'approve' ? 'Add an optional note...' : 'Describe the changes needed...'}
              />
            </label>
          </div>
        </DialogContent>
      </Dialog>

      {/* Conversion dialog */}
      <Dialog
        id="quote-form-conversion-dialog"
        isOpen={isConversionDialogOpen}
        onClose={() => setIsConversionDialogOpen(false)}
        footer={(
          <div className="flex justify-end space-x-2">
            <Button id="quote-form-conversion-cancel" variant="outline" onClick={() => setIsConversionDialogOpen(false)} disabled={isWorking}>Cancel</Button>
            <Button
              id="quote-form-conversion-confirm"
              onClick={() => void handleConfirmConversion()}
              disabled={isWorking || !conversionPreview}
            >
              {conversionMode === 'contract' ? 'Create Draft Contract' : conversionMode === 'invoice' ? 'Create Draft Invoice' : 'Create Both Records'}
            </Button>
          </div>
        )}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Conversion Preview</DialogTitle>
            <DialogDescription>Review what this quote conversion will create before confirming.</DialogDescription>
          </DialogHeader>
          {conversionPreview ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Contract Items</div>
                  <div className="mt-1 text-lg font-semibold">{conversionPreview.contract_items.length}</div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Invoice Items</div>
                  <div className="mt-1 text-lg font-semibold">{conversionPreview.invoice_items.length}</div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Excluded Items</div>
                  <div className="mt-1 text-lg font-semibold">{conversionPreview.excluded_items.length}</div>
                </div>
              </div>
              <section className="space-y-2 rounded-lg border border-border p-4">
                <h3 className="text-base font-semibold">Will Become Contract Lines</h3>
                {conversionPreview.contract_items.length ? (
                  <div className="space-y-2">
                    {conversionPreview.contract_items.map((item) => (
                      <div key={item.quote_item_id} className="rounded-md border border-border p-3">
                        <div className="font-medium text-foreground">{item.description}</div>
                        <div className="text-sm text-muted-foreground">
                          {item.billing_method || 'fixed'} &middot; Qty {item.quantity} &middot; {formatCurrency(item.total_price)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No recurring items will convert to a contract.</p>
                )}
              </section>
              <section className="space-y-2 rounded-lg border border-border p-4">
                <h3 className="text-base font-semibold">Will Become Invoice Charges</h3>
                {conversionPreview.invoice_items.length ? (
                  <div className="space-y-2">
                    {conversionPreview.invoice_items.map((item) => (
                      <div key={item.quote_item_id} className="rounded-md border border-border p-3">
                        <div className="font-medium text-foreground">{item.description}</div>
                        <div className="text-sm text-muted-foreground">
                          {item.is_discount ? 'Discount' : (item.billing_method || 'fixed')} &middot; Qty {item.quantity} &middot; {formatCurrency(item.total_price)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No one-time items will convert to an invoice.</p>
                )}
              </section>
              {conversionPreview.excluded_items.length > 0 && (
                <section className="space-y-2 rounded-lg border border-border p-4">
                  <h3 className="text-base font-semibold">Excluded from Conversion</h3>
                  <div className="space-y-2">
                    {conversionPreview.excluded_items.map((item) => (
                      <div key={item.quote_item_id} className="rounded-md border border-border p-3">
                        <div className="font-medium text-foreground">{item.description}</div>
                        <div className="text-sm text-muted-foreground">{item.reason || 'Not converted'}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center py-10">
              <LoadingIndicator text="Loading conversion preview..." spinnerProps={{ size: 'sm' }} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default QuoteForm;
