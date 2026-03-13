'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import type { IClient, IContact, IQuote } from '@alga-psa/types';
import { getAllClientsForBilling } from '../../../actions/billingClientsActions';
import { getQuote } from '../../../actions/quoteActions';
import { getAllContacts } from '@alga-psa/clients/actions';

interface QuoteDetailProps {
  quoteId: string;
  onBack: () => void;
  onEdit?: () => void;
}

function formatCurrency(minorUnits: number, currencyCode: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
  }).format((minorUnits || 0) / 100);
}

function formatDate(value?: string | null): string {
  if (!value) {
    return '—';
  }

  return new Date(value).toLocaleDateString();
}

const QuoteDetail: React.FC<QuoteDetailProps> = ({ quoteId, onBack, onEdit }) => {
  const [quote, setQuote] = useState<IQuote | null>(null);
  const [clients, setClients] = useState<IClient[]>([]);
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadQuote();
  }, [quoteId]);

  const loadQuote = async () => {
    try {
      setIsLoading(true);
      const [loadedQuote, loadedClients, loadedContacts] = await Promise.all([
        getQuote(quoteId),
        getAllClientsForBilling(false),
        getAllContacts('active'),
      ]);

      if (!loadedQuote || 'permissionError' in loadedQuote) {
        throw new Error(!loadedQuote ? 'Quote not found' : loadedQuote.permissionError);
      }

      setQuote(loadedQuote);
      setClients(loadedClients);
      setContacts(loadedContacts);
      setError(null);
    } catch (loadError) {
      console.error('Error loading quote detail:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load quote detail');
    } finally {
      setIsLoading(false);
    }
  };

  const client = useMemo(() => clients.find((entry) => entry.client_id === quote?.client_id) ?? null, [clients, quote?.client_id]);
  const contact = useMemo(() => contacts.find((entry) => entry.contact_name_id === quote?.contact_id) ?? null, [contacts, quote?.contact_id]);

  if (isLoading) {
    return (
      <Card size="2">
        <Box p="4">
          <LoadingIndicator
            className="py-12 text-muted-foreground"
            layout="stacked"
            spinnerProps={{ size: 'md' }}
            text="Loading quote details..."
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
          <Button id="quote-detail-back-error" variant="outline" onClick={onBack}>Back to Quotes</Button>
          <Alert variant="destructive">
            <AlertTitle>Quote Detail</AlertTitle>
            <AlertDescription>{error || 'Quote not found'}</AlertDescription>
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
            <div className="text-sm text-muted-foreground">{quote.quote_number || 'Template quote'}</div>
            <h2 className="text-2xl font-semibold text-foreground">{quote.title}</h2>
            <p className="text-sm text-muted-foreground">
              Status: {quote.status || 'draft'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button id="quote-detail-back" variant="outline" onClick={onBack}>Back</Button>
            {onEdit ? <Button id="quote-detail-edit" onClick={onEdit}>Edit</Button> : null}
          </div>
        </div>

        <section className="grid gap-4 rounded-lg border border-border p-4 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Client</div>
            <div className="mt-1 font-medium">{client?.client_name || quote.client_id || '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Contact</div>
            <div className="mt-1 font-medium">{contact?.full_name || quote.contact_id || '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Quote Date</div>
            <div className="mt-1 font-medium">{formatDate(quote.quote_date)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Valid Until</div>
            <div className="mt-1 font-medium">{formatDate(quote.valid_until)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">PO Number</div>
            <div className="mt-1 font-medium">{quote.po_number || '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Total</div>
            <div className="mt-1 font-medium">{formatCurrency(quote.total_amount, quote.currency_code || 'USD')}</div>
          </div>
        </section>

        <section className="space-y-2 rounded-lg border border-border p-4">
          <h3 className="text-base font-semibold">Scope of Work</h3>
          <p className="whitespace-pre-wrap text-sm text-foreground">{quote.description || '—'}</p>
        </section>

        <section className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-base font-semibold">Line Items</h3>
          {quote.quote_items?.length ? (
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
                  {quote.quote_items.map((item) => (
                    <tr key={item.quote_item_id}>
                      <td className="px-3 py-3 align-top">
                        <div className="font-medium text-foreground">{item.description}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.service_name || 'Custom item'}
                          {item.service_sku ? ` • ${item.service_sku}` : ''}
                          {item.phase ? ` • Phase: ${item.phase}` : ''}
                          {item.is_optional ? ' • Optional' : ''}
                          {item.is_recurring ? ` • Recurring${item.billing_frequency ? ` (${item.billing_frequency})` : ''}` : ''}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top text-muted-foreground">{item.billing_method || '—'}</td>
                      <td className="px-3 py-3 align-top text-muted-foreground">{item.quantity}</td>
                      <td className="px-3 py-3 align-top text-muted-foreground">
                        {formatCurrency(item.unit_price, quote.currency_code || 'USD')}
                      </td>
                      <td className="px-3 py-3 align-top font-medium text-foreground">
                        {formatCurrency(item.total_price, quote.currency_code || 'USD')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No line items on this quote yet.</p>
          )}
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2 rounded-lg border border-border p-4">
            <h3 className="text-base font-semibold">Client Notes</h3>
            <p className="whitespace-pre-wrap text-sm text-foreground">{quote.client_notes || '—'}</p>
          </div>
          <div className="space-y-2 rounded-lg border border-border p-4">
            <h3 className="text-base font-semibold">Internal Notes</h3>
            <p className="whitespace-pre-wrap text-sm text-foreground">{quote.internal_notes || '—'}</p>
          </div>
        </section>

        <section className="space-y-2 rounded-lg border border-border p-4">
          <h3 className="text-base font-semibold">Terms &amp; Conditions</h3>
          <p className="whitespace-pre-wrap text-sm text-foreground">{quote.terms_and_conditions || '—'}</p>
        </section>
      </Box>
    </Card>
  );
};

export default QuoteDetail;

