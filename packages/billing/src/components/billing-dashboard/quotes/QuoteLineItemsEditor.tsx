'use client';

import React, { useState } from 'react';
import type { CatalogPickerItem } from '../../../actions/serviceActions';
import ServiceCatalogPicker from '../contracts/ServiceCatalogPicker';
import { createDraftQuoteItemFromService, formatDraftQuoteMoney, type DraftQuoteItem } from './quoteLineItemDraft';

interface QuoteLineItemsEditorProps {
  items: DraftQuoteItem[];
  currencyCode: string;
  disabled?: boolean;
  onChange: (items: DraftQuoteItem[]) => void;
}

const QuoteLineItemsEditor: React.FC<QuoteLineItemsEditorProps> = ({
  items,
  currencyCode,
  disabled = false,
  onChange,
}) => {
  const [servicePickerValue, setServicePickerValue] = useState('');

  const handleAddService = (service: CatalogPickerItem) => {
    onChange([...items, createDraftQuoteItemFromService(service)]);
    setServicePickerValue('');
  };

  return (
    <section className="space-y-4 rounded-lg border border-border bg-background/40 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-base font-semibold">Line Items</h3>
          <p className="text-sm text-muted-foreground">
            Add services or products from the catalog to build the quote scope.
          </p>
        </div>
        <div className="w-full max-w-xl">
          <ServiceCatalogPicker
            value={servicePickerValue}
            selectedLabel=""
            onSelect={handleAddService}
            itemKinds={['service', 'product']}
            placeholder="Search the catalog"
            disabled={disabled}
          />
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          No line items yet. Use the catalog search above to add your first item.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium">Billing</th>
                <th className="px-3 py-2 font-medium">Qty</th>
                <th className="px-3 py-2 font-medium">Unit Price</th>
                <th className="px-3 py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-background">
              {items.map((item) => (
                <tr key={item.local_id}>
                  <td className="px-3 py-3 align-top">
                    <div className="font-medium text-foreground">{item.description}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.service_name || 'Custom item'}
                      {item.service_sku ? ` • ${item.service_sku}` : ''}
                      {item.unit_of_measure ? ` • ${item.unit_of_measure}` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top text-muted-foreground">
                    {item.billing_method ? item.billing_method.replace('_', ' ') : '—'}
                  </td>
                  <td className="px-3 py-3 align-top text-muted-foreground">{item.quantity}</td>
                  <td className="px-3 py-3 align-top text-muted-foreground">
                    {formatDraftQuoteMoney(item.unit_price, currencyCode)}
                  </td>
                  <td className="px-3 py-3 align-top font-medium text-foreground">
                    {formatDraftQuoteMoney(item.quantity * item.unit_price, currencyCode)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default QuoteLineItemsEditor;
