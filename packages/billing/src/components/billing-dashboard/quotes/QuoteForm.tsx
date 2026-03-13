'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import type { IClient, IContact, IQuote, IQuoteListItem } from '@alga-psa/types';
import { getAllClientsForBilling } from '../../../actions/billingClientsActions';
import { addQuoteItem, createQuote, createQuoteFromTemplate, getQuote, listQuotes, removeQuoteItem, reorderQuoteItems, updateQuote, updateQuoteItem } from '../../../actions/quoteActions';
import { getAllContacts } from '@alga-psa/clients/actions';
import QuoteLineItemsEditor from './QuoteLineItemsEditor';
import { createDraftQuoteItemFromQuoteItem, type DraftQuoteItem } from './quoteLineItemDraft';

interface QuoteFormProps {
  quoteId?: string | null;
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
};

const toDateInputValue = (value?: string | null): string => value ? value.slice(0, 10) : '';

const QuoteForm: React.FC<QuoteFormProps> = ({ quoteId, onCancel, onSaved }) => {
  const isEditMode = Boolean(quoteId && quoteId !== 'new');
  const [form, setForm] = useState<QuoteFormState>(EMPTY_FORM);
  const [clients, setClients] = useState<IClient[]>([]);
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [templates, setTemplates] = useState<IQuoteListItem[]>([]);
  const [lineItems, setLineItems] = useState<DraftQuoteItem[]>([]);
  const [persistedQuoteItemIds, setPersistedQuoteItemIds] = useState<string[]>([]);
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
        getAllContacts('active'),
        listQuotes({ is_template: true, pageSize: 200 }),
      ]);

      setClients(fetchedClients);
      setContacts(fetchedContacts);
      setTemplates('permissionError' in fetchedTemplates ? [] : fetchedTemplates.data);

      if (isEditMode && quoteId) {
        const quote = await getQuote(quoteId);
        if (!quote || 'permissionError' in quote) {
          throw new Error(!quote ? 'Quote not found' : quote.permissionError);
        }

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
        });
        setLineItems((quote.quote_items || []).map(createDraftQuoteItemFromQuoteItem));
        setPersistedQuoteItemIds((quote.quote_items || []).map((item) => item.quote_item_id));
      } else {
        const today = new Date();
        const validUntil = new Date(today);
        validUntil.setDate(validUntil.getDate() + 30);

        setForm({
          ...EMPTY_FORM,
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

  const handleChange = (field: keyof QuoteFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async () => {
    try {
      setIsSaving(true);
      setError(null);

      if (!form.client_id) {
        throw new Error('Client is required');
      }

      if (!form.title && !form.template_id) {
        throw new Error('Title is required unless creating from template');
      }

      const payload = {
        client_id: form.client_id,
        contact_id: form.contact_id || null,
        title: form.title,
        description: form.description || null,
        quote_date: form.quote_date,
        valid_until: form.valid_until,
        po_number: form.po_number || null,
        client_notes: form.client_notes || null,
        terms_and_conditions: form.terms_and_conditions || null,
        subtotal: 0,
        discount_total: 0,
        tax: 0,
        total_amount: 0,
        currency_code: 'USD',
        is_template: false,
      };

      let result: IQuote | { permissionError: string } | null;

      if (isEditMode && quoteId) {
        result = await updateQuote(quoteId, payload as Partial<IQuote>);
      } else if (form.template_id) {
        result = await createQuoteFromTemplate(form.template_id, payload as any);
      } else {
        result = await createQuote(payload as any);
      }

      if (!result || 'permissionError' in result) {
        throw new Error(result?.permissionError || 'Quote save failed');
      }

      let nextLineItems = lineItems;
      for (const item of lineItems) {
        if (item.quote_item_id) {
          const updatedItem = await updateQuoteItem(item.quote_item_id, {
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
          });

          if ('permissionError' in updatedItem) {
            throw new Error(updatedItem.permissionError);
          }

          nextLineItems = nextLineItems.map((draftItem) => draftItem.local_id === item.local_id ? {
            ...draftItem,
            ...createDraftQuoteItemFromQuoteItem(updatedItem),
          } : draftItem);
          continue;
        }

        const createdItem = await addQuoteItem({
          quote_id: result.quote_id,
          service_id: item.service_id ?? null,
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
            <h2 className="text-xl font-semibold">{isEditMode ? 'Edit Quote' : 'New Quote'}</h2>
            <p className="text-sm text-muted-foreground">
              Capture quote details, line items, and notes before saving the draft.
            </p>
          </div>
          <div className="flex gap-2">
            <Button id="quote-form-cancel" variant="outline" onClick={onCancel}>Cancel</Button>
            <Button id="quote-form-save" onClick={() => void handleSubmit()} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Draft'}
            </Button>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Quote Form</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Client
            <select
              value={form.client_id}
              onChange={(event) => handleChange('client_id', event.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Select client</option>
              {clients.map((client) => (
                <option key={client.client_id} value={client.client_id}>
                  {client.client_name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium">
            Contact
            <select
              value={form.contact_id}
              onChange={(event) => handleChange('contact_id', event.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Select contact</option>
              {availableContacts.map((contact) => (
                <option key={contact.contact_name_id} value={contact.contact_name_id}>
                  {contact.full_name}
                </option>
              ))}
            </select>
          </label>

          {!isEditMode && (
            <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
              Create From Template
              <select
                value={form.template_id}
                onChange={(event) => handleChange('template_id', event.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Start from scratch</option>
                {templates.map((template) => (
                  <option key={template.quote_id} value={template.quote_id}>
                    {template.title}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
            Title
            <Input value={form.title} onChange={(event) => handleChange('title', event.target.value)} />
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
            Description / Scope
            <TextArea value={form.description} onChange={(event) => handleChange('description', event.target.value)} rows={4} />
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium">
            Quote Date
            <Input type="date" value={form.quote_date} onChange={(event) => handleChange('quote_date', event.target.value)} />
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium">
            Valid Until
            <Input type="date" value={form.valid_until} onChange={(event) => handleChange('valid_until', event.target.value)} />
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium md:col-span-2">
            PO Number
            <Input value={form.po_number} onChange={(event) => handleChange('po_number', event.target.value)} />
          </label>

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
          currencyCode="USD"
          onChange={setLineItems}
          disabled={isSaving}
        />
      </Box>
    </Card>
  );
};

export default QuoteForm;
