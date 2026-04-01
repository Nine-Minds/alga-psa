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
import type { IClient, IContact, IQuote, IQuoteListItem } from '@alga-psa/types';
import { isActionPermissionError, getErrorMessage } from '@alga-psa/ui/lib/errorHandling';
import { getDefaultBillingSettings } from '@alga-psa/billing/actions';
import { getAllClientsForBilling } from '../../../actions/billingClientsActions';
import { addQuoteItem, createQuote, createQuoteFromTemplate, getQuote, listQuotes, removeQuoteItem, reorderQuoteItems, updateQuote, updateQuoteItem } from '../../../actions/quoteActions';
import { getContactsForPicker } from '@alga-psa/user-composition/actions';
import QuoteLineItemsEditor from './QuoteLineItemsEditor';
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
  const [lineItems, setLineItems] = useState<DraftQuoteItem[]>([]);
  const [persistedQuoteItemIds, setPersistedQuoteItemIds] = useState<string[]>([]);
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadFormData();
  }, [quoteId]);

  const loadFormData = async () => {
    try {
      setIsLoading(true);

      const [fetchedClients, fetchedContacts, fetchedTemplates] = await Promise.all([
        getAllClientsForBilling(false),
        getContactsForPicker('active'),
        listQuotes({ is_template: true, pageSize: 200 }),
      ]);

      setClients(fetchedClients);
      setContacts(fetchedContacts);
      setTemplates(isActionPermissionError(fetchedTemplates) ? [] : fetchedTemplates.data);

      if (isEditMode && quoteId) {
        const quote = await getQuote(quoteId);
        if (!quote || isActionPermissionError(quote)) {
          throw new Error(!quote ? 'Quote not found' : getErrorMessage(quote));
        }

        setIsTemplate(quote.is_template === true);
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
          <div>
            <h2 className="text-xl font-semibold">
              {isTemplate ? (isEditMode ? 'Edit Quote Template' : 'New Quote Template') : (isEditMode ? 'Edit Quote' : 'New Quote')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isTemplate
                ? 'Define reusable line items, terms, and notes for this template.'
                : 'Capture quote details, line items, and notes before saving the draft.'}
            </p>
          </div>
          <Button id="quote-form-cancel" variant="outline" onClick={onCancel}>Cancel</Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Quote Form</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
            Title
            <Input value={form.title} onChange={(event) => handleChange('title', event.target.value)} />
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
            Description / Scope
            <TextArea value={form.description} onChange={(event) => handleChange('description', event.target.value)} rows={4} />
          </label>

          {!isTemplate && (
            <div className="flex flex-col gap-1 text-sm font-medium">
              <label htmlFor="quote-client">Client</label>
              <ClientPicker
                id="quote-client"
                clients={clients}
                selectedClientId={form.client_id || null}
                onSelect={(clientId) => {
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
                onValueChange={(value) => handleChange('contact_id', value)}
                clientId={form.client_id || undefined}
                placeholder="Select contact"
                buttonWidth="full"
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
                onChange={(date) => handleChange('quote_date', date ? date.toISOString().slice(0, 10) : '')}
                className="w-full"
              />
            </div>
          )}

          {!isTemplate && (
            <div className="flex flex-col gap-1 text-sm font-medium">
              <label htmlFor="quote-valid-until">Valid Until</label>
              <DatePicker
                value={form.valid_until ? new Date(form.valid_until + 'T00:00:00') : undefined}
                onChange={(date) => handleChange('valid_until', date ? date.toISOString().slice(0, 10) : '')}
                className="w-full"
              />
            </div>
          )}

          {!isTemplate && (
            <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
              PO Number
              <Input value={form.po_number} onChange={(event) => handleChange('po_number', event.target.value)} />
            </label>
          )}

          <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
            Client Notes
            <TextArea value={form.client_notes} onChange={(event) => handleChange('client_notes', event.target.value)} rows={3} />
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
            Terms & Conditions
            <TextArea value={form.terms_and_conditions} onChange={(event) => handleChange('terms_and_conditions', event.target.value)} rows={4} />
          </label>
        </div>

        <QuoteLineItemsEditor
          items={lineItems}
          currencyCode={form.currency_code}
          onChange={setLineItems}
          disabled={isSaving}
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
          <Button id="quote-form-cancel-bottom" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button id="quote-form-save" onClick={() => void handleSubmit()} disabled={isSaving}>
            {isSaving ? 'Saving...' : isTemplate ? 'Save Template' : 'Save Quote'}
          </Button>
        </div>
      </Box>
    </Card>
  );
};

export default QuoteForm;
