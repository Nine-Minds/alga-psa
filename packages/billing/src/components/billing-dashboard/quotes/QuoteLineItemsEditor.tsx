'use client';

import React, { useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Input } from '@alga-psa/ui/components/Input';
import type { CatalogPickerItem } from '../../../actions/serviceActions';
import ServiceCatalogPicker from '../contracts/ServiceCatalogPicker';
import {
  createCustomDraftQuoteItem,
  createDraftQuoteItemFromService,
  formatDraftQuoteMoney,
  type DraftQuoteItem,
} from './quoteLineItemDraft';

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
  const [manualDescription, setManualDescription] = useState('');
  const [manualQuantity, setManualQuantity] = useState('1');
  const [manualUnitPrice, setManualUnitPrice] = useState('0.00');

  const updateItem = (localId: string, patch: Partial<DraftQuoteItem>) => {
    onChange(items.map((item) => item.local_id === localId ? { ...item, ...patch } : item));
  };

  const handleAddService = (service: CatalogPickerItem) => {
    onChange([...items, createDraftQuoteItemFromService(service)]);
    setServicePickerValue('');
  };

  const handleAddCustomItem = () => {
    const trimmedDescription = manualDescription.trim();
    const quantity = Number.parseInt(manualQuantity, 10);
    const unitPrice = Math.round(Number.parseFloat(manualUnitPrice || '0') * 100);

    if (!trimmedDescription || Number.isNaN(quantity) || quantity <= 0 || Number.isNaN(unitPrice) || unitPrice < 0) {
      return;
    }

    onChange([
      ...items,
      createCustomDraftQuoteItem({
        description: trimmedDescription,
        quantity,
        unit_price: unitPrice,
      }),
    ]);

    setManualDescription('');
    setManualQuantity('1');
    setManualUnitPrice('0.00');
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

      <div className="grid gap-3 rounded-md border border-dashed border-border p-3 md:grid-cols-[minmax(0,2fr)_120px_140px_auto]">
        <Input
          value={manualDescription}
          onChange={(event) => setManualDescription(event.target.value)}
          placeholder="Custom item description"
          disabled={disabled}
        />
        <Input
          type="number"
          min="1"
          step="1"
          value={manualQuantity}
          onChange={(event) => setManualQuantity(event.target.value)}
          placeholder="Qty"
          disabled={disabled}
        />
        <Input
          type="number"
          min="0"
          step="0.01"
          value={manualUnitPrice}
          onChange={(event) => setManualUnitPrice(event.target.value)}
          placeholder="Unit price"
          disabled={disabled}
        />
        <Button
          id="quote-line-items-add-custom"
          type="button"
          variant="outline"
          onClick={handleAddCustomItem}
          disabled={disabled || !manualDescription.trim()}
        >
          Add Custom Item
        </Button>
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
                <th className="px-3 py-2 font-medium">Flags</th>
                <th className="px-3 py-2 font-medium">Qty</th>
                <th className="px-3 py-2 font-medium">Unit Price</th>
                <th className="px-3 py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-background">
              {items.map((item) => (
                <tr key={item.local_id}>
                  <td className="px-3 py-3 align-top">
                    <Input
                      value={item.description}
                      onChange={(event) => updateItem(item.local_id, { description: event.target.value })}
                      disabled={disabled}
                    />
                    <div className="text-xs text-muted-foreground">
                      {item.service_name || 'Custom item'}
                      {item.service_sku ? ` • ${item.service_sku}` : ''}
                      {item.unit_of_measure ? ` • ${item.unit_of_measure}` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top text-muted-foreground">
                    {item.billing_method ? item.billing_method.replace('_', ' ') : '—'}
                    {item.is_recurring && item.billing_frequency ? (
                      <div className="mt-2 text-xs text-muted-foreground">
                        {item.billing_frequency.replace('_', ' ')}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 align-top">
                    <div className="space-y-2">
                      <Checkbox
                        id={`quote-line-optional-${item.local_id}`}
                        checked={item.is_optional}
                        label="Optional"
                        disabled={disabled}
                        containerClassName="mb-0"
                        onChange={(event) => updateItem(item.local_id, { is_optional: event.target.checked })}
                      />
                      <Checkbox
                        id={`quote-line-recurring-${item.local_id}`}
                        checked={item.is_recurring}
                        label="Recurring"
                        disabled={disabled}
                        containerClassName="mb-0"
                        onChange={(event) => updateItem(item.local_id, {
                          is_recurring: event.target.checked,
                          billing_frequency: event.target.checked ? (item.billing_frequency ?? 'monthly') : null,
                        })}
                      />
                      {item.is_recurring ? (
                        <select
                          value={item.billing_frequency ?? 'monthly'}
                          onChange={(event) => updateItem(item.local_id, { billing_frequency: event.target.value })}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          disabled={disabled}
                        >
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                          <option value="quarterly">Quarterly</option>
                          <option value="annually">Annually</option>
                        </select>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top text-muted-foreground">
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={String(item.quantity)}
                      onChange={(event) => {
                        const quantity = Number.parseInt(event.target.value, 10);
                        updateItem(item.local_id, { quantity: Number.isNaN(quantity) || quantity <= 0 ? 1 : quantity });
                      }}
                      disabled={disabled}
                    />
                  </td>
                  <td className="px-3 py-3 align-top text-muted-foreground">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={(item.unit_price / 100).toFixed(2)}
                      onChange={(event) => {
                        const nextValue = Math.round(Number.parseFloat(event.target.value || '0') * 100);
                        updateItem(item.local_id, { unit_price: Number.isNaN(nextValue) || nextValue < 0 ? 0 : nextValue });
                      }}
                      disabled={disabled}
                    />
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
