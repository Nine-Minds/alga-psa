'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { ChevronDown, ChevronRight, MoreVertical } from 'lucide-react';
import { CURRENCY_OPTIONS } from '@alga-psa/core';
import type { IClient, IContact, IQuote, IQuoteDocumentTemplate, IQuoteListItem, QuoteConversionPreview, QuoteStatus } from '@alga-psa/types';
import { isActionPermissionError, getErrorMessage } from '@alga-psa/ui/lib/errorHandling';
import { getDefaultBillingSettings } from '@alga-psa/billing/actions';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import { getAllClientsForBilling } from '../../../actions/billingClientsActions';
import { getActiveClientLocationsForBilling, type BillingLocationSummary } from '../../../actions/billingClientLocationActions';
import { addQuoteItem, approveQuote, convertQuoteToBoth, convertQuoteToContract, convertQuoteToInvoice, createQuote, createQuoteFromTemplate, createQuoteRevision, downloadQuotePdf, duplicateQuote, getQuote, getQuoteApprovalSettings, getQuoteConversionPreview, listQuotes, removeQuoteItem, reorderQuoteItems, requestQuoteApprovalChanges, resendQuote, sendQuote, sendQuoteReminder, submitQuoteForApproval, updateQuote, updateQuoteItem } from '../../../actions/quoteActions';
import { getQuoteDocumentTemplates } from '../../../actions/quoteDocumentTemplates';
import { getContactsForPicker } from '@alga-psa/user-composition/actions';
import QuoteLineItemsEditor from './QuoteLineItemsEditor';
import {
  pickDefaultLocation,
  collectDistinctLocationIds,
} from '../locations/locationGrouping';
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
  client_notes: '',
  terms_and_conditions: '',
  currency_code: 'USD',
};

const toDateInputValue = (value?: string | Date | null): string => {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === 'string' ? value.slice(0, 10) : String(value).slice(0, 10);
};

const formatRelativeMinutes = (iso?: string | null): string | null => {
  if (!iso) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  const mins = Math.max(0, Math.floor((Date.now() - when.getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs === 1) return '1 hr ago';
  if (hrs < 24) return `${hrs} hr ago`;
  return when.toLocaleString();
};

const QuoteForm: React.FC<QuoteFormProps> = ({ quoteId, initialIsTemplate = false, onCancel, onSaved }) => {
  const { t } = useTranslation('msp/quotes');
  const { formatCurrency: formatLocalizedCurrency, formatDate } = useFormatters();
  const isEditMode = Boolean(quoteId && quoteId !== 'new');
  const [defaultCurrency, setDefaultCurrency] = useState('USD');
  const [form, setForm] = useState<QuoteFormState>(EMPTY_FORM);
  const [clientLocations, setClientLocations] = useState<BillingLocationSummary[]>([]);
  /**
   * True once the user has explicitly clicked "+ Add location" OR loaded a quote
   * that already spans multiple locations. False ⇒ render the editor flat with
   * a single header-level location. This state is the sole toggle the editor
   * uses — it falls back to flat automatically once only one distinct location
   * remains.
   */
  const [multiLocationMode, setMultiLocationMode] = useState(false);
  /**
   * Locations that should appear as empty groups even though no items have
   * been added to them yet. Populated by "+ Add location" so the user can
   * choose the second location before adding items.
   */
  const [extraGroupLocationIds, setExtraGroupLocationIds] = useState<string[]>([]);

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
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [isMoreDetailsOpen, setIsMoreDetailsOpen] = useState(false);

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

  // Load locations whenever the selected client changes so the picker is fresh.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!form.client_id) {
        setClientLocations([]);
        return;
      }
      try {
        const locations = await getActiveClientLocationsForBilling(form.client_id);
        if (cancelled) return;
        setClientLocations(locations);
      } catch (locationError) {
        console.error('Failed to load client locations:', locationError);
        if (!cancelled) setClientLocations([]);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [form.client_id]);

  // Derived: whether the quote currently spans ≥2 locations. Combined with
  // `multiLocationMode` this drives the editor's flat-vs-grouped layout.
  const distinctLocationIds = useMemo(() => collectDistinctLocationIds(lineItems), [lineItems]);
  // Editor renders groups when the user explicitly entered multi-location
  // mode (via "+ Add location"), regardless of whether the seeded empty
  // second group has items yet.
  const showLocationGroups = multiLocationMode;

  // Auto-flip back to flat if everything collapses to one location and no
  // user-seeded empty location group is still visible.
  useEffect(() => {
    if (!multiLocationMode) return;
    if (distinctLocationIds.length <= 1 && extraGroupLocationIds.length === 0) {
      setMultiLocationMode(false);
    }
  }, [multiLocationMode, distinctLocationIds.length, extraGroupLocationIds.length]);

  // An extra group is "realized" once items land on it — drop it from the
  // placeholder list so `buildLocationGroups` doesn't double-count it.
  useEffect(() => {
    if (extraGroupLocationIds.length === 0) return;
    const stillEmpty = extraGroupLocationIds.filter((id) => !distinctLocationIds.includes(id));
    if (stillEmpty.length !== extraGroupLocationIds.length) {
      setExtraGroupLocationIds(stillEmpty);
    }
  }, [distinctLocationIds, extraGroupLocationIds]);

  // On first render (or client change), make sure every line item carries a
  // location_id. Default to the client's primary location.
  useEffect(() => {
    if (clientLocations.length === 0) return;
    const primary = pickDefaultLocation(clientLocations);
    if (!primary) return;

    const hasUnassigned = lineItems.some((item) => !item.location_id);
    if (hasUnassigned) {
      setLineItems((current) => current.map((item) =>
        item.location_id ? item : { ...item, location_id: primary.location_id }
      ));
    }
  }, [clientLocations, lineItems.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enter multi-location mode automatically when loading a quote that already
  // spans ≥2 locations (e.g. editing an existing multi-site quote).
  useEffect(() => {
    if (distinctLocationIds.length >= 2 && !multiLocationMode) {
      setMultiLocationMode(true);
    }
  }, [distinctLocationIds.length, multiLocationMode]);

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
          throw new Error(
            !quote
              ? t('quoteForm.errors.notFound', { defaultValue: 'Quote not found' })
              : getErrorMessage(quote),
          );
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
          client_notes: quote.client_notes || '',
          terms_and_conditions: quote.terms_and_conditions || '',
          currency_code: quote.currency_code || defaultCurrency,
        });
        setLineItems((quote.quote_items || []).map(createDraftQuoteItemFromQuoteItem));
        setPersistedQuoteItemIds((quote.quote_items || []).map((item) => item.quote_item_id));
        setLastSavedAt(quote.updated_at || quote.created_at || null);
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
        setLastSavedAt(null);
      }

      setError(null);
    } catch (loadError) {
      console.error('Error loading quote form:', loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : t('quoteForm.errors.load', { defaultValue: 'Failed to load quote form' }),
      );
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

  // Derived: recurring per-month subtotal across draft items (expressed in
  // the quote's minor currency units). Used for the sidebar "$X recurring /
  // month" hint. Only monthly-recurring items count; mixed frequencies don't
  // reduce cleanly to a single per-month number without more math.
  const recurringMonthlySubtotal = useMemo(() => {
    return lineItems.reduce((sum, item) => {
      if (!item.is_recurring || item.is_discount) return sum;
      if (item.is_optional && item.is_selected === false) return sum;
      const freq = (item.billing_frequency || '').toLowerCase();
      if (freq && freq !== 'monthly') return sum;
      return sum + Math.round(item.quantity * item.unit_price);
    }, 0);
  }, [lineItems]);

  const selectedClient = useMemo(
    () => clients.find((c) => c.client_id === form.client_id) ?? null,
    [clients, form.client_id],
  );

  const selectedDocTemplate = useMemo(
    () => documentTemplates.find((dt) => dt.template_id === documentTemplateId) ?? null,
    [documentTemplates, documentTemplateId],
  );

  const lineItemCount = lineItems.filter((i) => !i.is_discount).length;
  const hasRecurring = lineItems.some((i) => i.is_recurring && !i.is_discount);
  const hasOneTime = lineItems.some((i) => !i.is_recurring && !i.is_discount);

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
          // Templates may originate from a different client — drop the
          // template's location_id so the primary-location auto-assign
          // effect can pick the correct one for the new client.
          location_id: null,
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
        throw new Error(
          t('quoteForm.validation.clientRequired', { defaultValue: 'Client is required' }),
        );
      }

      if (!form.title && !form.template_id) {
        throw new Error(
          t('quoteForm.validation.titleRequired', {
            defaultValue: 'Title is required unless creating from template',
          }),
        );
      }

      const payload = {
        client_id: form.client_id || null,
        contact_id: form.contact_id || null,
        title: form.title,
        description: form.description || null,
        quote_date: form.quote_date || null,
        valid_until: form.valid_until || null,
        po_number: form.po_number || null,
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
        throw new Error(
          result
            ? getErrorMessage(result)
            : t('quoteForm.errors.saveFailed', { defaultValue: 'Quote save failed' }),
        );
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
            location_id: item.location_id ?? null,
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
      setLastSavedAt(new Date().toISOString());

      onSaved(result.quote_id);
    } catch (submitError) {
      console.error('Error saving quote:', submitError);
      setError(
        submitError instanceof Error
          ? submitError.message
          : t('quoteForm.errors.save', { defaultValue: 'Failed to save quote' }),
      );
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
      setError(
        actionError instanceof Error
          ? actionError.message
          : t('quoteForm.errors.workflowAction', {
            defaultValue: 'Failed to {{action}}',
            action: label,
          }),
      );
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
    const result = await runWorkflowAction(
      t('quoteForm.errorActions.sendQuote', { defaultValue: 'send quote' }),
      () => sendQuote(quote.quote_id, {
        message: sendMessage.trim() || undefined,
        email_addresses: combined.length > 0 ? combined : undefined,
      }),
    );
    if (result) {
      setIsSendDialogOpen(false);
      setSendMessage('');
      setSendRecipients([]);
      setSendAdditionalEmails('');
      setNotice(
        t('quoteForm.notices.sent', { defaultValue: 'Quote sent to the client.' }),
      );
    }
  };

  const handleResendQuote = async () => {
    if (!quote) return;
    const result = await runWorkflowAction(
      t('quoteForm.errorActions.resendQuote', { defaultValue: 'resend quote' }),
      () => resendQuote(quote.quote_id),
    );
    if (result) {
      setNotice(t('quoteForm.notices.resent', { defaultValue: 'Quote resent.' }));
    }
  };

  const handleSendReminder = async () => {
    if (!quote) return;
    const result = await runWorkflowAction(
      t('quoteForm.errorActions.sendReminder', { defaultValue: 'send reminder' }),
      () => sendQuoteReminder(quote.quote_id),
    );
    if (result) {
      setNotice(
        t('quoteForm.notices.reminderSent', { defaultValue: 'Quote reminder sent.' }),
      );
    }
  };

  const handleSubmitForApproval = async () => {
    if (!quote) return;
    const result = await runWorkflowAction(
      t('quoteForm.errorActions.submitForApproval', {
        defaultValue: 'submit for approval',
      }),
      () => submitQuoteForApproval(quote.quote_id),
    );
    if (result) {
      setNotice(
        t('quoteForm.notices.submittedForApproval', {
          defaultValue: 'Quote submitted for internal approval.',
        }),
      );
    }
  };

  const handleApproveQuote = async () => {
    if (!quote) return;
    const result = await runWorkflowAction(
      t('quoteForm.errorActions.approveQuote', { defaultValue: 'approve quote' }),
      () => approveQuote(quote.quote_id, approvalComment),
    );
    if (result) {
      setApprovalDialogMode(null);
      setApprovalComment('');
      setNotice(
        t('quoteForm.notices.approved', {
          defaultValue: 'Quote approved and is ready to send.',
        }),
      );
    }
  };

  const handleRequestChanges = async () => {
    if (!quote) return;
    const result = await runWorkflowAction(
      t('quoteForm.errorActions.requestChanges', { defaultValue: 'request changes' }),
      () => requestQuoteApprovalChanges(quote.quote_id, approvalComment),
    );
    if (result) {
      setApprovalDialogMode(null);
      setApprovalComment('');
      setNotice(
        t('quoteForm.notices.requestedChanges', {
          defaultValue: 'Quote returned to draft with requested changes.',
        }),
      );
    }
  };

  const handleCancelQuote = async () => {
    if (!quote) return;
    const result = await runWorkflowAction(
      t('quoteForm.errorActions.cancelQuote', { defaultValue: 'cancel quote' }),
      () => updateQuote(quote.quote_id, { status: 'cancelled' }),
    );
    if (result) {
      setNotice(t('quoteForm.notices.cancelled', { defaultValue: 'Quote cancelled.' }));
    }
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
      setError(
        actionError instanceof Error
          ? actionError.message
          : t('quoteForm.errors.createRevision', {
            defaultValue: 'Failed to create revision',
          }),
      );
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
      setError(
        actionError instanceof Error
          ? actionError.message
          : t('quoteForm.errors.duplicate', { defaultValue: 'Failed to duplicate quote' }),
      );
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
      setError(
        actionError instanceof Error
          ? actionError.message
          : t('quoteForm.errors.downloadPdf', {
            defaultValue: 'Failed to download PDF',
          }),
      );
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
      setError(
        previewError instanceof Error
          ? previewError.message
          : t('quoteForm.errors.loadConversionPreview', {
            defaultValue: 'Failed to load conversion preview',
          }),
      );
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
        setNotice(
          t('quoteForm.notices.createdDraftContract', {
            defaultValue: 'Created draft contract {{name}}.',
            name: result.contract.contract_name,
          }),
        );
      } else if (conversionMode === 'invoice') {
        const result = await convertQuoteToInvoice(quote.quote_id);
        if ('permissionError' in result) throw new Error(result.permissionError);
        setQuote(result.quote);
        setNotice(
          t('quoteForm.notices.createdDraftInvoice', {
            defaultValue: 'Created draft invoice {{name}}.',
            name: result.invoice.invoice_number,
          }),
        );
      } else {
        const result = await convertQuoteToBoth(quote.quote_id);
        if ('permissionError' in result) throw new Error(result.permissionError);
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
          : t('quoteForm.errors.convert', { defaultValue: 'Failed to convert quote' }),
      );
    } finally {
      setIsWorking(false);
    }
  };

  const formatCurrency = (minorUnits: number) =>
    formatLocalizedCurrency((minorUnits || 0) / 100, form.currency_code || 'USD');

  const isReadOnly = isEditMode && !isTemplate && quoteStatus !== 'draft';

  // +Add-location handler moved into the line-items toolbar. Seed an empty
  // second group so the user can pick a location before adding any items.
  const handleAddLocationGroup = () => {
    const primary = pickDefaultLocation(clientLocations)?.location_id ?? null;
    setLineItems((current) => current.map((item) =>
      item.is_discount || item.location_id ? item : { ...item, location_id: primary }
    ));
    setMultiLocationMode(true);
    const used = new Set<string>(lineItems.map((item) => item.location_id).filter((id): id is string => Boolean(id)));
    if (primary) used.add(primary);
    const candidate = clientLocations.find((loc) => !used.has(loc.location_id));
    if (candidate) {
      setExtraGroupLocationIds((current) => current.includes(candidate.location_id) ? current : [...current, candidate.location_id]);
    }
  };

  const handleRemoveLocationGroup = (removedLocationId: string | null) => {
    if (removedLocationId) {
      setLineItems((current) => current.filter((item) => item.location_id !== removedLocationId));
      setExtraGroupLocationIds((current) => current.filter((id) => id !== removedLocationId));
    }
  };

  // Scroll into view + expand helper wired to the sidebar "Change" link.
  const openMoreDetails = () => {
    setIsMoreDetailsOpen(true);
    // Defer scroll until after expansion so the target is measured.
    requestAnimationFrame(() => {
      const el = document.getElementById('quote-form-more-details');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  // ---------------------------------------------------------------------------
  // Primary action: a single state-driven descriptor used in both the top
  // header bar and the footer row. Keeps label/handler/id consistent and
  // avoids two code paths drifting.
  // ---------------------------------------------------------------------------
  type PrimaryAction = { id: string; label: string; onClick: () => void; disabled?: boolean } | null;

  const resolvePrimaryAction = (): PrimaryAction => {
    if (isTemplate) {
      return {
        id: 'quote-form-save',
        label: isSaving
          ? t('quoteForm.actions.saving', { defaultValue: 'Saving…' })
          : t('quoteForm.actions.saveTemplate', { defaultValue: 'Save template' }),
        onClick: () => void handleSubmit(),
        disabled: isSaving,
      };
    }

    if (!isEditMode || !quote) {
      return {
        id: 'quote-form-save',
        label: isSaving
          ? t('quoteForm.actions.saving', { defaultValue: 'Saving…' })
          : t('quoteForm.actions.saveQuote', { defaultValue: 'Save quote' }),
        onClick: () => void handleSubmit(),
        disabled: isSaving,
      };
    }

    switch (quoteStatus) {
      case 'draft':
        return approvalRequired
          ? {
              id: 'quote-form-submit-approval',
              label: t('common.actions.submitForApproval', { defaultValue: 'Request approval' }),
              onClick: () => void handleSubmitForApproval(),
              disabled: isWorking,
            }
          : {
              id: 'quote-form-send',
              label: t('quoteForm.actions.sendToClient', { defaultValue: 'Send to client' }),
              onClick: () => setIsSendDialogOpen(true),
              disabled: isWorking,
            };
      case 'pending_approval':
        return {
          id: 'quote-form-approve',
          label: t('quoteForm.actions.approve', { defaultValue: 'Approve' }),
          onClick: () => setApprovalDialogMode('approve'),
          disabled: isWorking,
        };
      case 'approved':
        return {
          id: 'quote-form-send-approved',
          label: t('quoteForm.actions.sendToClient', { defaultValue: 'Send to client' }),
          onClick: () => setIsSendDialogOpen(true),
          disabled: isWorking,
        };
      case 'sent':
        return {
          id: 'quote-form-revise',
          label: t('quoteForm.actions.revise', { defaultValue: 'Revise' }),
          onClick: () => void handleReviseQuote(),
          disabled: isWorking,
        };
      case 'accepted':
        if (canConvertToBoth) {
          return {
            id: 'quote-form-convert-both',
            label: t('quoteForm.actions.convertToBoth', { defaultValue: 'Convert to both' }),
            onClick: () => void handleOpenConversionDialog('both'),
            disabled: isWorking || isPreviewLoading,
          };
        }
        if (canConvertToContract) {
          return {
            id: 'quote-form-convert-contract',
            label: t('quoteForm.actions.convertToContract', { defaultValue: 'Convert to contract' }),
            onClick: () => void handleOpenConversionDialog('contract'),
            disabled: isWorking || isPreviewLoading,
          };
        }
        if (canConvertToInvoice) {
          return {
            id: 'quote-form-convert-invoice',
            label: t('quoteForm.actions.convertToInvoice', { defaultValue: 'Convert to invoice' }),
            onClick: () => void handleOpenConversionDialog('invoice'),
            disabled: isWorking || isPreviewLoading,
          };
        }
        return null;
      case 'rejected':
      case 'expired':
        return {
          id: 'quote-form-revise',
          label: t('quoteForm.actions.createNewRevision', { defaultValue: 'Create new revision' }),
          onClick: () => void handleReviseQuote(),
          disabled: isWorking,
        };
      default:
        return null;
    }
  };

  const primaryAction = resolvePrimaryAction();

  // Secondary inline button (e.g. "Request changes" pairs with "Approve",
  // "Save quote" pairs with "Send to client" on drafts).
  const resolveSecondaryAction = (): PrimaryAction => {
    if (!isEditMode || isTemplate || !quote) return null;
    if (quoteStatus === 'draft') {
      return {
        id: 'quote-form-save',
        label: isSaving
          ? t('quoteForm.actions.saving', { defaultValue: 'Saving…' })
          : t('quoteForm.actions.saveQuote', { defaultValue: 'Save quote' }),
        onClick: () => void handleSubmit(),
        disabled: isSaving,
      };
    }
    if (quoteStatus === 'pending_approval') {
      return {
        id: 'quote-form-request-changes',
        label: t('quoteForm.actions.requestChanges', { defaultValue: 'Request changes' }),
        onClick: () => setApprovalDialogMode('changes'),
        disabled: isWorking,
      };
    }
    return null;
  };

  const secondaryAction = resolveSecondaryAction();

  // Overflow items for workflow statuses with secondary actions.
  type OverflowItem = { id: string; label: string; onClick: () => void; disabled?: boolean };
  const resolveOverflowItems = (): OverflowItem[] => {
    if (!isEditMode || isTemplate || !quote) return [];
    if (quoteStatus === 'sent') {
      return [
        { id: 'quote-form-resend', label: t('quoteForm.actions.resend', { defaultValue: 'Resend' }), onClick: () => void handleResendQuote(), disabled: isWorking },
        { id: 'quote-form-reminder', label: t('quoteForm.actions.sendReminder', { defaultValue: 'Send reminder' }), onClick: () => void handleSendReminder(), disabled: isWorking },
        { id: 'quote-form-cancel-quote', label: t('quoteForm.actions.cancelQuote', { defaultValue: 'Cancel quote' }), onClick: () => void handleCancelQuote(), disabled: isWorking },
      ];
    }
    if (quoteStatus === 'accepted') {
      const items: OverflowItem[] = [];
      if (canConvertToContract) items.push({ id: 'quote-form-convert-contract', label: t('quoteForm.actions.convertToContract', { defaultValue: 'Convert to contract' }), onClick: () => void handleOpenConversionDialog('contract'), disabled: isWorking || isPreviewLoading });
      if (canConvertToInvoice) items.push({ id: 'quote-form-convert-invoice', label: t('quoteForm.actions.convertToInvoice', { defaultValue: 'Convert to invoice' }), onClick: () => void handleOpenConversionDialog('invoice'), disabled: isWorking || isPreviewLoading });
      if (canConvertToBoth) items.push({ id: 'quote-form-convert-both', label: t('quoteForm.actions.convertToBoth', { defaultValue: 'Convert to both' }), onClick: () => void handleOpenConversionDialog('both'), disabled: isWorking || isPreviewLoading });
      // Remove the item whose id matches the primary so we don't duplicate.
      return items.filter((i) => i.id !== primaryAction?.id);
    }
    return [];
  };

  const overflowItems = resolveOverflowItems();

  if (isLoading) {
    return (
      <Card size="2">
        <Box p="4">
          <LoadingIndicator
            className="py-12 text-muted-foreground"
            layout="stacked"
            spinnerProps={{ size: 'md' }}
            text={t('quoteForm.loading', { defaultValue: 'Loading quote form...' })}
            textClassName="text-muted-foreground"
          />
        </Box>
      </Card>
    );
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const formattedTotal = formatDraftQuoteMoney(draftTotals.total_amount, form.currency_code);
  const formattedSubtotal = formatDraftQuoteMoney(draftTotals.subtotal, form.currency_code);
  const formattedDiscount = formatDraftQuoteMoney(draftTotals.discount_total, form.currency_code);
  const formattedTax = formatDraftQuoteMoney(draftTotals.tax, form.currency_code);
  const formattedRecurringMonthly = recurringMonthlySubtotal > 0
    ? formatDraftQuoteMoney(recurringMonthlySubtotal, form.currency_code)
    : null;

  const headerTitle = isTemplate
    ? (isEditMode
        ? t('quoteForm.headings.editTemplate', { defaultValue: 'Edit Quote Template' })
        : t('quoteForm.headings.newTemplate', { defaultValue: 'New Quote Template' }))
    : (form.title || (isEditMode
        ? t('quoteForm.headings.editQuote', { defaultValue: 'Edit Quote' })
        : t('quoteForm.headings.newQuote', { defaultValue: 'New Quote' })));

  const breadcrumbParts = isTemplate
    ? [
        t('quoteForm.breadcrumb.billing', { defaultValue: 'Billing' }),
        t('quoteForm.breadcrumb.quoteTemplates', { defaultValue: 'Quote Templates' }),
        headerTitle,
      ]
    : [
        t('quoteForm.breadcrumb.billing', { defaultValue: 'Billing' }),
        t('quoteForm.breadcrumb.quotes', { defaultValue: 'Quotes' }),
        quote?.quote_number ?? t('quoteForm.breadcrumb.newQuote', { defaultValue: 'New quote' }),
      ];

  const subtitleLine = isTemplate
    ? t('quoteForm.subtitle.template', { defaultValue: 'Template · {{description}}', description: form.description || '' })
    : (() => {
        const parts: string[] = [];
        if (quote?.quote_number) parts.push(quote.quote_number);
        if (selectedClient?.client_name) parts.push(t('quoteForm.subtitle.forClient', { defaultValue: 'For {{clientName}}', clientName: selectedClient.client_name }));
        if (form.valid_until) {
          parts.push(t('quoteForm.subtitle.expires', { defaultValue: 'Expires {{date}}', date: formatDate(form.valid_until + 'T00:00:00') }));
        }
        return parts.join(' · ');
      })();

  return (
    <Card size="2">
      <Box p="4" className="space-y-6">
        {/* ============ TOP HEADER BAR ============ */}
        <header className="flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <nav className="text-xs text-muted-foreground">
              {breadcrumbParts.map((part, idx) => (
                <span key={`${part}-${idx}`}>
                  {idx > 0 && <span className="mx-1">›</span>}
                  <span>{part}</span>
                </span>
              ))}
            </nav>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold text-foreground">{headerTitle}</h2>
              {isEditMode && quote && !isTemplate && (
                <>
                  <QuoteStatusBadge status={quoteStatus} />
                  {quote.version > 1 && (
                    <span className="text-xs text-muted-foreground">
                      {t('quoteForm.header.version', { defaultValue: 'v{{version}}', version: quote.version })}
                    </span>
                  )}
                </>
              )}
            </div>
            {subtitleLine && (
              <p className="text-sm text-muted-foreground">{subtitleLine}</p>
            )}
            {isReadOnly && (
              <p className="text-xs text-muted-foreground">
                {t('quoteForm.readOnlyNotice', { defaultValue: 'This quote is read-only. To make changes, create a new revision.' })}
              </p>
            )}
          </div>

          <div className="flex flex-col items-stretch gap-2 md:items-end">
            {!isTemplate && (
              <div className="text-right">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('quoteForm.header.quoteTotalLabel', { defaultValue: 'Quote total' })}
                </div>
                <div className="text-2xl font-semibold text-foreground">{formattedTotal}</div>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {isEditMode && quote && !isTemplate && (
                <>
                  <Button id="quote-form-download-pdf" variant="outline" onClick={() => void handleDownloadPdf()} disabled={isWorking}>
                    {t('quoteForm.actions.pdf', { defaultValue: 'PDF' })}
                  </Button>
                  <Button id="quote-form-duplicate" variant="outline" onClick={() => void handleDuplicateQuote()} disabled={isWorking}>
                    {t('quoteForm.actions.duplicate', { defaultValue: 'Duplicate' })}
                  </Button>
                </>
              )}
              <Button id="quote-form-cancel" variant="outline" onClick={onCancel}>
                {t('quoteForm.actions.back', { defaultValue: 'Back' })}
              </Button>
              {secondaryAction && (
                <Button id={secondaryAction.id} variant="outline" onClick={secondaryAction.onClick} disabled={secondaryAction.disabled}>
                  {secondaryAction.label}
                </Button>
              )}
              {primaryAction && !isReadOnly && (
                <Button id={primaryAction.id} onClick={primaryAction.onClick} disabled={primaryAction.disabled}>
                  {primaryAction.label}
                </Button>
              )}
              {overflowItems.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      id="quote-form-overflow"
                      variant="outline"
                      className="h-9 w-9 p-0"
                      aria-label={t('quoteForm.actions.moreActions', { defaultValue: 'More actions' })}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {overflowItems.map((item) => (
                      <DropdownMenuItem key={item.id} id={`${item.id}-menu-item`} onClick={item.onClick} disabled={item.disabled}>
                        {item.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </header>

        {/* ============ STATUS BANNERS ============ */}
        {isEditMode && quote && !isTemplate && quoteStatus === 'accepted' && (
          <Alert>
            <AlertTitle>{t('quoteForm.banners.acceptedTitle', { defaultValue: 'Quote Accepted' })}</AlertTitle>
            <AlertDescription>
              {quote.accepted_by_name && <>{t('quoteForm.banners.acceptedBy', { defaultValue: 'Accepted by: {{name}}', name: quote.accepted_by_name })}<br /></>}
              {quote.accepted_at && <>{t('quoteForm.banners.acceptedOn', { defaultValue: 'Accepted on: {{date}}', date: formatDate(quote.accepted_at) })}</>}
            </AlertDescription>
          </Alert>
        )}
        {isEditMode && quote && !isTemplate && quoteStatus === 'rejected' && (
          <Alert variant="destructive">
            <AlertTitle>{t('quoteForm.banners.rejectedTitle', { defaultValue: 'Quote Rejected' })}</AlertTitle>
            <AlertDescription>
              {quote.rejected_at && <>{t('quoteForm.banners.rejectedOn', { defaultValue: 'Rejected on: {{date}}', date: formatDate(quote.rejected_at as string) })}<br /></>}
              {quote.rejection_reason && <>{t('quoteForm.banners.rejectedReason', { defaultValue: 'Reason: {{reason}}', reason: quote.rejection_reason })}</>}
            </AlertDescription>
          </Alert>
        )}
        {isEditMode && quote && !isTemplate && quoteStatus === 'converted' && (
          <Alert>
            <AlertTitle>{t('quoteForm.banners.convertedTitle', { defaultValue: 'Quote Converted' })}</AlertTitle>
            <AlertDescription>{t('quoteForm.banners.convertedDescription', { defaultValue: 'This quote has been converted to a contract and/or invoice.' })}</AlertDescription>
          </Alert>
        )}

        {/* Notice / error alerts */}
        {notice && (
          <Alert>
            <AlertTitle>{t('quoteForm.noticeTitle', { defaultValue: 'Quote' })}</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertTitle>{t('quoteForm.noticeTitle', { defaultValue: 'Quote' })}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* ============ TWO-COLUMN LAYOUT ============ */}
        <div className={isTemplate ? '' : 'grid gap-6 lg:grid-cols-3'}>
          {/* MAIN COLUMN */}
          <div className={isTemplate ? 'space-y-6' : 'space-y-6 lg:col-span-2'}>
            {/* --- Essentials card --- */}
            <section className="rounded-lg border border-border bg-background p-5 shadow-sm">
              <header className="mb-4 space-y-1">
                <h3 className="text-base font-semibold">{t('quoteForm.essentials.title', { defaultValue: 'Essentials' })}</h3>
                <p className="text-xs text-muted-foreground">
                  {t('quoteForm.essentials.subtitle', { defaultValue: 'Shown to the client on the quote document.' })}
                </p>
              </header>

              <div className="grid gap-4 md:grid-cols-3">
                <label className="flex flex-col gap-1 text-sm font-medium md:col-span-3">
                  {t('quoteForm.essentials.titleField', { defaultValue: 'Title' })}
                  <Input value={form.title} onChange={(event) => handleChange('title', event.target.value)} disabled={isReadOnly} />
                </label>

                <label className="flex flex-col gap-1 text-sm font-medium md:col-span-3">
                  {t('quoteForm.essentials.descriptionField', { defaultValue: 'Description / Scope' })}
                  <TextArea value={form.description} onChange={(event) => handleChange('description', event.target.value)} rows={4} disabled={isReadOnly} />
                  <span className="text-xs font-normal text-muted-foreground">
                    {t('quoteForm.essentials.descriptionHelp', { defaultValue: 'A short paragraph that appears just under the title on the PDF.' })}
                  </span>
                </label>

                {!isTemplate && (
                  <div className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
                    <label htmlFor="quote-client">{t('quoteForm.essentials.client', { defaultValue: 'Client' })}</label>
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
                      placeholder={t('quoteForm.essentials.clientPlaceholder', { defaultValue: 'Select client' })}
                      disabled={isReadOnly}
                    />
                  </div>
                )}

                {!isTemplate && (
                  <div className="flex flex-col gap-1 text-sm font-medium">
                    <label htmlFor="quote-contact">{t('quoteForm.essentials.contact', { defaultValue: 'Contact' })}</label>
                    <ContactPicker
                      id="quote-contact"
                      contacts={availableContacts}
                      value={form.contact_id || ''}
                      onValueChange={(value) => { if (!isReadOnly) handleChange('contact_id', value); }}
                      clientId={form.client_id || undefined}
                      placeholder={t('quoteForm.essentials.contactPlaceholder', { defaultValue: 'Select contact' })}
                      buttonWidth="full"
                      disabled={isReadOnly}
                    />
                  </div>
                )}

                <div className="flex flex-col gap-1 text-sm font-medium">
                  <label htmlFor="quote-currency">{t('quoteForm.essentials.currency', { defaultValue: 'Currency' })}</label>
                  <CustomSelect
                    id="quote-currency"
                    value={form.currency_code}
                    onValueChange={(value) => handleChange('currency_code', value)}
                    placeholder={t('quoteForm.essentials.currencyPlaceholder', { defaultValue: 'Select currency' })}
                    options={CURRENCY_OPTIONS.map((c) => ({ value: c.value, label: c.label }))}
                    disabled={isReadOnly}
                  />
                </div>

                {!isTemplate && (
                  <div className="flex flex-col gap-1 text-sm font-medium">
                    <label htmlFor="quote-date">{t('quoteForm.essentials.quoteDate', { defaultValue: 'Quote date' })}</label>
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
                    <label htmlFor="quote-valid-until">{t('quoteForm.essentials.validUntil', { defaultValue: 'Valid until' })}</label>
                    <DatePicker
                      value={form.valid_until ? new Date(form.valid_until + 'T00:00:00') : undefined}
                      onChange={(date) => { if (!isReadOnly) handleChange('valid_until', date ? date.toISOString().slice(0, 10) : ''); }}
                      className="w-full"
                      disabled={isReadOnly}
                    />
                    <span className="text-xs font-normal text-muted-foreground">
                      {t('quoteForm.essentials.validUntilHelp', { defaultValue: 'Quote auto-expires on this date.' })}
                    </span>
                  </div>
                )}
              </div>
            </section>

            {/* --- Line items card --- */}
            <section className="rounded-lg border border-border bg-background p-5 shadow-sm">
              <header className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-1">
                  <h3 className="text-base font-semibold">{t('quoteForm.lineItems.title', { defaultValue: 'Line items' })}</h3>
                  <p className="text-xs text-muted-foreground">
                    {lineItemCount === 0
                      ? t('quoteForm.lineItems.subtitleEmpty', { defaultValue: 'No items yet.' })
                      : t('quoteForm.lineItems.subtitleCount', {
                          defaultValue: '{{count}} items · {{mix}}',
                          count: lineItemCount,
                          mix: hasRecurring && hasOneTime
                            ? t('quoteForm.lineItems.mixBoth', { defaultValue: 'recurring and one-time' })
                            : hasRecurring
                              ? t('quoteForm.lineItems.mixRecurring', { defaultValue: 'recurring' })
                              : t('quoteForm.lineItems.mixOneTime', { defaultValue: 'one-time' }),
                        })}
                  </p>
                </div>
                {!isReadOnly && (
                  <div className="flex flex-wrap items-center gap-2">
                    {!isTemplate && clientLocations.length >= 2 && !showLocationGroups && (
                      <Button
                        id="quote-form-add-location"
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleAddLocationGroup}
                        disabled={isSaving}
                      >
                        {t('quoteForm.lineItems.addLocation', { defaultValue: '+ Add location' })}
                      </Button>
                    )}
                    {!isEditMode && templates.length > 0 && (
                      <CustomSelect
                        id="quote-form-template-picker"
                        value={form.template_id || undefined}
                        onValueChange={(value) => void handleTemplateChange(value)}
                        placeholder={t('quoteForm.fields.createFromTemplate', { defaultValue: '+ From template' })}
                        allowClear
                        options={templates.map((template) => ({
                          value: template.quote_id,
                          label: template.title,
                        }))}
                      />
                    )}
                  </div>
                )}
              </header>

              <QuoteLineItemsEditor
                items={lineItems}
                currencyCode={form.currency_code}
                onChange={setLineItems}
                disabled={isSaving || isReadOnly}
                locations={clientLocations}
                showLocationGroups={showLocationGroups}
                extraGroupLocationIds={extraGroupLocationIds}
                onAddLocationGroup={
                  !isTemplate && !isReadOnly ? handleAddLocationGroup : undefined
                }
                onRemoveLocationGroup={handleRemoveLocationGroup}
              />
            </section>

            {/* --- Client-facing text card --- */}
            <section className="rounded-lg border border-border bg-background p-5 shadow-sm">
              <header className="mb-4 space-y-1">
                <h3 className="text-base font-semibold">{t('quoteForm.clientFacing.title', { defaultValue: 'Client-facing text' })}</h3>
                <p className="text-xs text-muted-foreground">
                  {t('quoteForm.clientFacing.subtitle', { defaultValue: 'Appears on the PDF, below the totals.' })}
                </p>
              </header>

              <div className="grid gap-4">
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {t('quoteForm.clientFacing.notes', { defaultValue: 'Notes to client (Optional)' })}
                  <TextArea value={form.client_notes} onChange={(event) => handleChange('client_notes', event.target.value)} rows={3} disabled={isReadOnly} />
                </label>

                <label className="flex flex-col gap-1 text-sm font-medium">
                  {t('quoteForm.clientFacing.terms', { defaultValue: 'Terms & conditions (Optional)' })}
                  <TextArea value={form.terms_and_conditions} onChange={(event) => handleChange('terms_and_conditions', event.target.value)} rows={4} disabled={isReadOnly} />
                </label>
              </div>
            </section>

            {/* --- More details (collapsible) --- */}
            {!isTemplate && (
              <section id="quote-form-more-details" className="rounded-lg border border-border bg-background shadow-sm">
                <button
                  id="quote-form-more-details-toggle"
                  type="button"
                  onClick={() => setIsMoreDetailsOpen((open) => !open)}
                  className="flex w-full items-center justify-between gap-3 p-5 text-left"
                  aria-expanded={isMoreDetailsOpen}
                >
                  <div className="space-y-1">
                    <h3 className="text-base font-semibold">{t('quoteForm.moreDetails.title', { defaultValue: 'More details' })}</h3>
                    <p className="text-xs text-muted-foreground">
                      {t('quoteForm.moreDetails.subtitle', { defaultValue: 'PO number, PDF layout' })}
                    </p>
                  </div>
                  {isMoreDetailsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {isMoreDetailsOpen && (
                  <div className="grid gap-4 border-t border-border p-5 md:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm font-medium">
                      {t('quoteForm.moreDetails.poNumber', { defaultValue: 'PO number' })}
                      <Input value={form.po_number} onChange={(event) => handleChange('po_number', event.target.value)} disabled={isReadOnly} />
                    </label>

                    <div className="flex flex-col gap-1 text-sm font-medium">
                      <label htmlFor="quote-document-layout">{t('quoteForm.moreDetails.pdfLayout', { defaultValue: 'PDF layout' })}</label>
                      <CustomSelect
                        id="quote-document-layout"
                        value={documentTemplateId || undefined}
                        onValueChange={(value) => setDocumentTemplateId(value || '')}
                        placeholder={t('quoteForm.moreDetails.pdfLayoutPlaceholder', { defaultValue: 'Use default layout' })}
                        allowClear
                        options={documentTemplates.map((dt) => ({
                          value: dt.template_id,
                          label: `${dt.name}${dt.isStandard ? ' (Standard)' : ''}`,
                        }))}
                        disabled={isReadOnly}
                      />
                      <span className="text-xs font-normal text-muted-foreground">
                        {t('quoteForm.moreDetails.pdfLayoutHelp', { defaultValue: 'Choose which layout the client will see. Leave default to use tenant default.' })}
                      </span>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* --- Footer row --- */}
            <div className="flex flex-col gap-3 border-t border-border pt-4 md:flex-row md:items-center md:justify-between">
              <div className="text-xs text-muted-foreground" id="quote-form-autosave-indicator">
                {lastSavedAt
                  ? t('quoteForm.footer.savedAgo', { defaultValue: 'Changes saved · {{ago}}', ago: formatRelativeMinutes(lastSavedAt) ?? '' })
                  : isSaving
                    ? t('quoteForm.footer.saving', { defaultValue: 'Saving…' })
                    : t('quoteForm.footer.unsaved', { defaultValue: 'Unsaved changes' })}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button id="quote-form-cancel-bottom" variant="outline" onClick={onCancel}>
                  {t('quoteForm.actions.cancel', { defaultValue: 'Cancel' })}
                </Button>
                {isEditMode && quote && !isTemplate && (
                  <Button id="quote-form-preview-pdf" variant="outline" onClick={() => void handleDownloadPdf()} disabled={isWorking}>
                    {t('quoteForm.actions.previewPdf', { defaultValue: 'Preview PDF' })}
                  </Button>
                )}
                {primaryAction && !isReadOnly && (
                  <Button id={`${primaryAction.id}-footer`} onClick={primaryAction.onClick} disabled={primaryAction.disabled}>
                    {primaryAction.label}
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT SIDEBAR */}
          {!isTemplate && (
            <aside className="space-y-4 lg:sticky lg:top-4 lg:h-fit lg:self-start">
              {/* Quote Total card */}
              <section className="rounded-lg border border-border bg-background p-5 shadow-sm">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('quoteForm.sidebar.quoteTotal', { defaultValue: 'Quote total' })}
                </div>
                <div className="mt-1 text-2xl font-semibold">{formattedTotal}</div>
                {formattedRecurringMonthly && (
                  <div className="mt-1 text-sm text-muted-foreground">
                    {t('quoteForm.sidebar.recurringPerMonth', { defaultValue: '{{amount}} recurring / month', amount: formattedRecurringMonthly })}
                  </div>
                )}
                <dl className="mt-4 space-y-1.5 text-sm">
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">{t('quoteForm.sidebar.subtotal', { defaultValue: 'Subtotal' })}</dt>
                    <dd>{formattedSubtotal}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">{t('quoteForm.sidebar.discounts', { defaultValue: 'Discounts' })}</dt>
                    <dd>{draftTotals.discount_total > 0 ? `−${formattedDiscount}` : formattedDiscount}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">{t('quoteForm.sidebar.tax', { defaultValue: 'Tax' })}</dt>
                    <dd>{formattedTax}</dd>
                  </div>
                </dl>
              </section>

              {/* Status card */}
              {isEditMode && quote && (
                <section className="rounded-lg border border-border bg-background p-5 shadow-sm">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('quoteForm.sidebar.statusLabel', { defaultValue: 'Status' })}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <QuoteStatusBadge status={quoteStatus} />
                    {quote.version > 1 && (
                      <span className="text-xs text-muted-foreground">
                        {t('quoteForm.header.version', { defaultValue: 'v{{version}}', version: quote.version })}
                      </span>
                    )}
                  </div>
                </section>
              )}

              {/* Approval card */}
              {isEditMode && quote && approvalRequired && (quoteStatus === 'draft' || quoteStatus === 'pending_approval') && (
                <section className="rounded-lg border border-border bg-background p-5 shadow-sm">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('quoteForm.sidebar.approvalLabel', { defaultValue: 'Approval' })}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t('quoteForm.sidebar.approvalMessage', { defaultValue: 'Quotes need sales lead approval before sending.' })}
                  </p>
                  {quoteStatus === 'draft' && (
                    <Button
                      id="quote-form-sidebar-submit-approval"
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full"
                      onClick={() => void handleSubmitForApproval()}
                      disabled={isWorking}
                    >
                      {t('common.actions.submitForApproval', { defaultValue: 'Request approval' })}
                    </Button>
                  )}
                </section>
              )}

              {/* Document Layout card */}
              <section className="rounded-lg border border-border bg-background p-5 shadow-sm">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('common.labels.quoteLayout', { defaultValue: 'Document layout' })}
                </div>
                <div className="mt-2">
                  <div className="text-sm font-medium text-foreground">
                    {selectedDocTemplate?.name ?? t('quoteForm.sidebar.defaultLayout', { defaultValue: 'Tenant default' })}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {selectedDocTemplate
                      ? (selectedDocTemplate.isStandard
                          ? t('quoteForm.sidebar.standardLayout', { defaultValue: 'Standard' })
                          : t('quoteForm.sidebar.customLayout', { defaultValue: 'Custom' }))
                      : t('quoteForm.sidebar.tenantDefault', { defaultValue: 'Tenant default' })}
                  </div>
                  <Button
                    id="quote-form-sidebar-change-layout"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={openMoreDetails}
                    disabled={isReadOnly}
                  >
                    {t('quoteForm.sidebar.changeLayout', { defaultValue: 'Change' })}
                  </Button>
                </div>
              </section>
            </aside>
          )}
        </div>
      </Box>

      {/* Send dialog */}
      <Dialog
        id="quote-form-send-dialog"
        isOpen={isSendDialogOpen}
        onClose={() => setIsSendDialogOpen(false)}
        title={t('quoteForm.dialogs.send.title', { defaultValue: 'Send Quote to Client' })}
        footer={(
          <div className="flex justify-end space-x-2">
            <Button id="quote-form-send-cancel" variant="outline" onClick={() => setIsSendDialogOpen(false)} disabled={isWorking}>
              {t('common.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button id="quote-form-send-confirm" onClick={() => void handleSendQuote()} disabled={isWorking}>
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
              defaultValue:
                'This will email the quote to the client\'s billing contacts and change its status to "Sent".',
            })}
          </DialogDescription>
          <div className="space-y-3 py-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('quoteForm.fields.recipients', { defaultValue: 'Recipients' })}
              <QuoteSendRecipientsField
                id="quote-form-send-recipients"
                clientId={form.client_id}
                value={sendRecipients}
                onChange={setSendRecipients}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('quoteForm.fields.additionalEmails', {
                defaultValue: 'Additional email addresses (comma-separated)',
              })}
              <Input
                id="quote-form-send-emails"
                value={sendAdditionalEmails}
                onChange={(event) => setSendAdditionalEmails(event.target.value)}
                placeholder={t('quoteForm.placeholders.additionalEmails', {
                  defaultValue: 'email@example.com, another@example.com',
                })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('quoteForm.fields.messageOptional', { defaultValue: 'Message (optional)' })}
              <TextArea
                id="quote-form-send-message"
                value={sendMessage}
                onChange={(event) => setSendMessage(event.target.value)}
                rows={3}
                placeholder={t('quoteForm.placeholders.message', {
                  defaultValue: 'Add a personal note for the client...',
                })}
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
        title={approvalDialogMode === 'approve'
          ? t('quoteForm.dialogs.approval.approveTitle', { defaultValue: 'Approve Quote' })
          : t('quoteForm.dialogs.approval.changesTitle', { defaultValue: 'Request Changes' })}
        footer={(
          <div className="flex justify-end space-x-2">
            <Button id="quote-form-approval-cancel" variant="outline" onClick={() => { setApprovalDialogMode(null); setApprovalComment(''); }} disabled={isWorking}>
              {t('common.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id="quote-form-approval-confirm"
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
              ? t('quoteForm.dialogs.approval.approveDescription', {
                defaultValue: 'Approve this quote so it can be sent to the client.',
              })
              : t('quoteForm.dialogs.approval.changesDescription', {
                defaultValue: 'Return this quote to draft with requested changes.',
              })}
          </DialogDescription>
          <div className="space-y-3 py-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {approvalDialogMode === 'approve'
                ? t('quoteForm.dialogs.approval.approveComment', {
                  defaultValue: 'Comment (optional)',
                })
                : t('quoteForm.dialogs.approval.changesComment', {
                  defaultValue: 'Requested changes',
                })}
              <TextArea
                id="quote-form-approval-comment"
                value={approvalComment}
                onChange={(event) => setApprovalComment(event.target.value)}
                rows={3}
                placeholder={approvalDialogMode === 'approve'
                  ? t('quoteForm.dialogs.approval.approveCommentPlaceholder', {
                    defaultValue: 'Add an optional note...',
                  })
                  : t('quoteForm.dialogs.approval.changesCommentPlaceholder', {
                    defaultValue: 'Describe the changes needed...',
                  })}
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
            <Button id="quote-form-conversion-cancel" variant="outline" onClick={() => setIsConversionDialogOpen(false)} disabled={isWorking}>
              {t('common.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id="quote-form-conversion-confirm"
              onClick={() => void handleConfirmConversion()}
              disabled={isWorking || !conversionPreview}
            >
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
                          {item.billing_method || t('quoteConversion.summary.fixed', { defaultValue: 'fixed' })} &middot; {t('quoteLineItems.columns.quantity', { defaultValue: 'Qty' })} {item.quantity} &middot; {formatCurrency(item.total_price)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t('quoteConversion.empty.contractItems', {
                      defaultValue: 'No recurring items will convert to a contract.',
                    })}
                  </p>
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
                            : (item.billing_method || t('quoteConversion.summary.fixed', { defaultValue: 'fixed' }))} &middot; {t('quoteLineItems.columns.quantity', { defaultValue: 'Qty' })} {item.quantity} &middot; {formatCurrency(item.total_price)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t('quoteConversion.empty.invoiceItems', {
                      defaultValue: 'No one-time items will convert to an invoice.',
                    })}
                  </p>
                )}
              </section>
              {conversionPreview.excluded_items.length > 0 && (
                <section className="space-y-2 rounded-lg border border-border p-4">
                  <h3 className="text-base font-semibold">{t('quoteConversion.sections.excludedFromConversion', { defaultValue: 'Excluded from Conversion' })}</h3>
                  <div className="space-y-2">
                    {conversionPreview.excluded_items.map((item) => (
                      <div key={item.quote_item_id} className="rounded-md border border-border p-3">
                        <div className="font-medium text-foreground">{item.description}</div>
                        <div className="text-sm text-muted-foreground">
                          {item.reason || t('quoteConversion.summary.notConverted', { defaultValue: 'Not converted' })}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center py-10">
              <LoadingIndicator
                text={t('quoteConversion.loading', { defaultValue: 'Loading conversion preview...' })}
                spinnerProps={{ size: 'sm' }}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default QuoteForm;
