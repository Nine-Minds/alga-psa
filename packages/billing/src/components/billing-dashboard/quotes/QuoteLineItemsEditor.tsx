'use client';

import React, { useMemo, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import type { CatalogPickerItem } from '../../../actions/serviceActions';
import ServiceCatalogPicker from '../contracts/ServiceCatalogPicker';
import {
  createCustomDraftQuoteItem,
  createDraftDiscountQuoteItem,
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

interface QuotePhaseSection {
  key: string;
  label: string;
  items: DraftQuoteItem[];
}

const UNGROUPED_PHASE_KEY = '__ungrouped__';

const getPhaseKey = (phase?: string | null): string => phase?.trim() || UNGROUPED_PHASE_KEY;
const getPhaseLabel = (phase?: string | null): string => phase?.trim() || 'Ungrouped Items';

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
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [discountValue, setDiscountValue] = useState('10');
  const [discountTargetType, setDiscountTargetType] = useState<'quote' | 'item' | 'service'>('quote');
  const [discountTargetValue, setDiscountTargetValue] = useState('');
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const itemTargetOptions = items.filter((item) => !item.is_discount);
  const serviceTargetOptions = Array.from(new Map(
    items
      .filter((item) => !item.is_discount && item.service_id)
      .map((item) => [item.service_id!, { value: item.service_id!, label: item.service_name || item.description }])
  ).values());

  const sections = useMemo<QuotePhaseSection[]>(() => {
    const grouped = new Map<string, QuotePhaseSection>();

    for (const item of items) {
      const key = getPhaseKey(item.phase);
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          label: getPhaseLabel(item.phase),
          items: [],
        });
      }

      grouped.get(key)!.items.push(item);
    }

    return Array.from(grouped.values());
  }, [items]);

  const updateItem = (localId: string, patch: Partial<DraftQuoteItem>) => {
    onChange(items.map((item) => item.local_id === localId ? { ...item, ...patch } : item));
  };

  const moveItem = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) {
      return;
    }

    const draggedIndex = items.findIndex((item) => item.local_id === draggedId);
    const targetIndex = items.findIndex((item) => item.local_id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) {
      return;
    }

    const reorderedItems = [...items];
    const [draggedItem] = reorderedItems.splice(draggedIndex, 1);
    const targetItem = items[targetIndex];
    const adjustedTargetIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;

    reorderedItems.splice(adjustedTargetIndex, 0, {
      ...draggedItem,
      phase: targetItem.phase ?? null,
    });
    onChange(reorderedItems);
  };

  const removeItem = (localId: string) => {
    onChange(items.filter((item) => item.local_id !== localId));
  };

  const toggleSection = (sectionKey: string) => {
    setCollapsedSections((current) => ({
      ...current,
      [sectionKey]: !current[sectionKey],
    }));
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

  const handleAddDiscount = () => {
    const numericValue = Number.parseFloat(discountValue || '0');
    if (Number.isNaN(numericValue) || numericValue <= 0) {
      return;
    }

    onChange([
      ...items,
      createDraftDiscountQuoteItem({
        description: discountType === 'percentage' ? `Discount (${numericValue}%)` : 'Discount',
        discount_type: discountType,
        discount_percentage: discountType === 'percentage' ? Math.round(numericValue) : null,
        fixed_amount: discountType === 'fixed' ? Math.round(numericValue * 100) : 0,
        applies_to_item_id: discountTargetType === 'item' ? discountTargetValue || null : null,
        applies_to_service_id: discountTargetType === 'service' ? discountTargetValue || null : null,
      }),
    ]);

    setDiscountValue(discountType === 'percentage' ? '10' : '0.00');
    setDiscountTargetType('quote');
    setDiscountTargetValue('');
  };

  const renderItemRows = (sectionItems: DraftQuoteItem[]) => sectionItems.map((item) => (
    <tr
      key={item.local_id}
      draggable={!disabled}
      onDragStart={() => setDraggedItemId(item.local_id)}
      onDragEnd={() => setDraggedItemId(null)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (draggedItemId) {
          moveItem(draggedItemId, item.local_id);
        }
        setDraggedItemId(null);
      }}
      className={draggedItemId === item.local_id ? 'opacity-60' : undefined}
    >
      <td className="px-3 py-3 align-top text-lg text-muted-foreground">⋮⋮</td>
      <td className="px-3 py-3 align-top">
        <div className="space-y-2">
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
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Phase / Section</div>
            <Input
              value={item.phase ?? ''}
              onChange={(event) => updateItem(item.local_id, { phase: event.target.value.trim() || null })}
              placeholder="e.g. Discovery, Rollout, Ongoing"
              disabled={disabled}
            />
          </div>
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
            <CustomSelect
              id={`quote-line-frequency-${item.local_id}`}
              value={item.billing_frequency ?? 'monthly'}
              onValueChange={(value) => updateItem(item.local_id, { billing_frequency: value })}
              disabled={disabled}
              options={[
                { value: 'weekly', label: 'Weekly' },
                { value: 'monthly', label: 'Monthly' },
                { value: 'quarterly', label: 'Quarterly' },
                { value: 'annually', label: 'Annually' },
              ]}
            />
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
      <td className="px-3 py-3 align-top">
        <Button
          id={`quote-line-remove-${item.local_id}`}
          type="button"
          variant="outline"
          onClick={() => removeItem(item.local_id)}
          disabled={disabled}
        >
          Remove
        </Button>
      </td>
    </tr>
  ));

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
            disabled={disabled}
            currencyCode={currencyCode}
            placeholder="Search services or products"
          />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[2fr,auto,auto]">
        <Input
          value={manualDescription}
          onChange={(event) => setManualDescription(event.target.value)}
          placeholder="Add custom line item description"
          disabled={disabled}
        />
        <Input
          type="number"
          min="1"
          step="1"
          value={manualQuantity}
          onChange={(event) => setManualQuantity(event.target.value)}
          disabled={disabled}
        />
        <div className="flex gap-2">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={manualUnitPrice}
            onChange={(event) => setManualUnitPrice(event.target.value)}
            disabled={disabled}
          />
          <Button id="quote-line-add-custom" type="button" onClick={handleAddCustomItem} disabled={disabled}>
            Add Custom
          </Button>
        </div>
      </div>

      <div className="grid gap-3 rounded-md border border-dashed border-border p-3 lg:grid-cols-[1fr,1fr,1fr,1fr,auto]">
        <CustomSelect
          id="quote-discount-type"
          value={discountType}
          onValueChange={(value) => setDiscountType(value as 'percentage' | 'fixed')}
          disabled={disabled}
          options={[
            { value: 'percentage', label: 'Percentage discount' },
            { value: 'fixed', label: 'Fixed discount' },
          ]}
        />
        <Input
          type="number"
          min="0"
          step={discountType === 'percentage' ? '1' : '0.01'}
          value={discountValue}
          onChange={(event) => setDiscountValue(event.target.value)}
          disabled={disabled}
          placeholder={discountType === 'percentage' ? '10' : '0.00'}
        />
        <CustomSelect
          id="quote-discount-target-type"
          value={discountTargetType}
          onValueChange={(value) => {
            const nextTargetType = value as 'quote' | 'item' | 'service';
            setDiscountTargetType(nextTargetType);
            setDiscountTargetValue('');
          }}
          disabled={disabled}
          options={[
            { value: 'quote', label: 'Whole quote' },
            { value: 'item', label: 'Specific item' },
            { value: 'service', label: 'Specific service' },
          ]}
        />
        {discountTargetType === 'item' ? (
          <CustomSelect
            id="quote-discount-target-item"
            value={discountTargetValue || undefined}
            onValueChange={(value) => setDiscountTargetValue(value)}
            disabled={disabled}
            placeholder="Select item"
            options={itemTargetOptions.map((item) => ({
              value: item.local_id,
              label: item.description,
            }))}
          />
        ) : discountTargetType === 'service' ? (
          <CustomSelect
            id="quote-discount-target-service"
            value={discountTargetValue || undefined}
            onValueChange={(value) => setDiscountTargetValue(value)}
            disabled={disabled}
            placeholder="Select service"
            options={serviceTargetOptions}
          />
        ) : (
          <div className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            Applies to the full quote subtotal
          </div>
        )}
        <Button id="quote-line-add-discount" type="button" onClick={handleAddDiscount} disabled={disabled}>
          Add Discount
        </Button>
      </div>

      <div className="rounded-md border border-dashed border-border bg-background/70 p-3 text-sm text-muted-foreground">
        Use the Phase / Section field on each line to group related work, collapse sections while editing, and drag a line onto another section’s row to move it between phases.
      </div>

      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No line items yet. Use the catalog search above to add your first item.
        </div>
      ) : (
        <div className="space-y-4">
          {sections.map((section) => {
            const isCollapsed = collapsedSections[section.key] === true;

            return (
              <div key={section.key} className="overflow-hidden rounded-md border border-border">
                <button
                  type="button"
                  className="flex w-full items-center justify-between bg-muted/40 px-4 py-3 text-left"
                  onClick={() => toggleSection(section.key)}
                >
                  <div>
                    <div className="text-sm font-semibold text-foreground">{section.label}</div>
                    <div className="text-xs text-muted-foreground">{section.items.length} item{section.items.length === 1 ? '' : 's'}</div>
                  </div>
                  <span className="text-sm text-muted-foreground">{isCollapsed ? 'Expand' : 'Collapse'}</span>
                </button>

                {!isCollapsed ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-border text-sm">
                      <thead className="bg-background text-left">
                        <tr>
                          <th className="px-3 py-2 font-medium">Move</th>
                          <th className="px-3 py-2 font-medium">Item</th>
                          <th className="px-3 py-2 font-medium">Billing</th>
                          <th className="px-3 py-2 font-medium">Flags</th>
                          <th className="px-3 py-2 font-medium">Qty</th>
                          <th className="px-3 py-2 font-medium">Unit Price</th>
                          <th className="px-3 py-2 font-medium">Total</th>
                          <th className="px-3 py-2 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border bg-background">
                        {renderItemRows(section.items)}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default QuoteLineItemsEditor;
