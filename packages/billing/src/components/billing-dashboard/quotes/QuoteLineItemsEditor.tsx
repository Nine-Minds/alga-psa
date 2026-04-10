'use client';

import React, { useEffect, useRef, useMemo, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Pencil } from 'lucide-react';
import type { CatalogPickerItem } from '../../../actions/serviceActions';
import ServiceCatalogPicker from '../contracts/ServiceCatalogPicker';
import {
  calculateDraftQuoteTotals,
  createCustomDraftQuoteItem,
  createDraftDiscountQuoteItem,
  createDraftQuoteItemFromService,
  formatDraftQuoteMoney,
  type DraftQuoteItem,
} from './quoteLineItemDraft';

interface InlineEditableValueProps {
  displayValue: string;
  editValue: string;
  onCommit: (value: string) => void;
  disabled?: boolean;
  type?: 'number' | 'text';
  min?: string;
  step?: string;
  highlight?: boolean;
}

const InlineEditableValue: React.FC<InlineEditableValueProps> = ({
  displayValue,
  editValue,
  onCommit,
  disabled = false,
  type = 'number',
  min,
  step,
  highlight = false,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(editValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      setDraft(editValue);
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [isEditing]);

  const commit = () => {
    onCommit(draft);
    setIsEditing(false);
  };

  if (disabled || !isEditing) {
    return (
      <button
        type="button"
        onClick={() => !disabled && setIsEditing(true)}
        disabled={disabled}
        className={`group flex w-full items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-sm font-medium transition-colors hover:border-border hover:bg-muted/40 disabled:pointer-events-none ${highlight ? 'border-amber-400 bg-amber-50/60 text-amber-700 dark:border-amber-600 dark:bg-amber-950/30 dark:text-amber-400' : 'border-transparent text-foreground'}`}
      >
        <span>{displayValue}</span>
        {!disabled && <Pencil className="h-3 w-3 shrink-0 text-muted-foreground" />}
      </button>
    );
  }

  return (
    <Input
      ref={inputRef}
      type="text"
      inputMode={type === 'number' ? 'decimal' : 'text'}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setIsEditing(false);
      }}
      className="w-full"
    />
  );
};

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

function computeMarkupPercent(
  unitPrice: number,
  cost: number | null | undefined,
  costCurrency: string | null | undefined,
  quoteCurrency: string
): number | null {
  if (cost == null || cost === 0) return null;
  if (costCurrency && costCurrency !== quoteCurrency) return null;
  return ((unitPrice - cost) / cost) * 100;
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
  const [isDiscountOpen, setIsDiscountOpen] = useState(false);
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
    onChange([...items, createDraftQuoteItemFromService(service, currencyCode)]);
    setServicePickerValue('');
  };

  const handleAddCustomItem = (description: string) => {
    onChange([
      ...items,
      createCustomDraftQuoteItem({
        description,
        quantity: 1,
        unit_price: 0,
      }),
    ]);
    setServicePickerValue('');
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

  const resolveDiscountAmount = (item: DraftQuoteItem): number => {
    if (!item.is_discount) return item.quantity * item.unit_price;

    if (item.discount_type === 'fixed') return item.quantity * item.unit_price;

    const includedBaseItems = items.filter((i) => !i.is_discount && (!i.is_optional || i.is_selected !== false));
    const baseSubtotal = includedBaseItems.reduce((sum, i) => sum + (i.quantity * i.unit_price), 0);

    let baseAmount = baseSubtotal;
    if (item.applies_to_item_id) {
      const target = includedBaseItems.find((i) => (i.quote_item_id ?? i.local_id) === item.applies_to_item_id);
      baseAmount = target ? target.quantity * target.unit_price : 0;
    } else if (item.applies_to_service_id) {
      baseAmount = includedBaseItems
        .filter((i) => i.service_id === item.applies_to_service_id)
        .reduce((sum, i) => sum + (i.quantity * i.unit_price), 0);
    }

    return Math.round(baseAmount * ((item.discount_percentage ?? 0) / 100));
  };

  const getDiscountTargetLabel = (item: DraftQuoteItem): string => {
    if (item.applies_to_item_id) {
      const target = items.find((i) => (i.quote_item_id ?? i.local_id) === item.applies_to_item_id);
      return target ? `on "${target.description}"` : 'on specific item';
    }
    if (item.applies_to_service_id) {
      const target = items.find((i) => i.service_id === item.applies_to_service_id);
      return target ? `on ${target.service_name || 'service'}` : 'on specific service';
    }
    return 'on full quote';
  };

  const renderItemRows = (sectionItems: DraftQuoteItem[]) => sectionItems.map((item) => {
    const isDiscount = item.is_discount === true;
    const resolvedTotal = resolveDiscountAmount(item);
    const dragClass = draggedItemId === item.local_id ? 'opacity-60' : '';
    const discountRowClass = isDiscount ? 'bg-amber-50/60 dark:bg-amber-950/20 border-l-2 border-l-amber-400' : '';

    return (
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
        className={`${dragClass} ${discountRowClass}`.trim() || undefined}
      >
        <td className="px-3 py-3 align-top text-lg text-muted-foreground">⋮⋮</td>
        <td className="px-3 py-3 align-top">
          <div className="space-y-2">
            {isDiscount && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                Discount
                {item.discount_type === 'percentage' ? ` (${item.discount_percentage}%)` : ''}
              </span>
            )}
            <Input
              value={item.description}
              onChange={(event) => updateItem(item.local_id, { description: event.target.value })}
              disabled={disabled}
            />
            <div className="text-xs text-muted-foreground">
              {isDiscount
                ? getDiscountTargetLabel(item)
                : (
                  <>
                    {item.service_name || 'Custom item'}
                    {item.service_sku ? ` • ${item.service_sku}` : ''}
                    {item.unit_of_measure ? ` • ${item.unit_of_measure}` : ''}
                  </>
                )
              }
            </div>
            {!isDiscount && (
              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Phase / Section</div>
                <Input
                  value={item.phase ?? ''}
                  onChange={(event) => updateItem(item.local_id, { phase: event.target.value.trim() || null })}
                  placeholder="e.g. Discovery, Rollout, Ongoing"
                  disabled={disabled}
                />
              </div>
            )}
          </div>
        </td>
        <td className="px-3 py-3 align-top text-muted-foreground">
          {isDiscount ? (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              {item.discount_type === 'percentage' ? 'Percentage' : 'Fixed'}
            </span>
          ) : (
            <>
              {item.billing_method ? item.billing_method.replace('_', ' ') : '—'}
              {item.is_recurring && item.billing_frequency ? (
                <div className="mt-2 text-xs text-muted-foreground">
                  {item.billing_frequency.replace('_', ' ')}
                </div>
              ) : null}
            </>
          )}
        </td>
        <td className="px-3 py-3 align-top">
          {isDiscount ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
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
          )}
        </td>
        <td className="px-3 py-3 align-top text-muted-foreground">
          {isDiscount && item.discount_type === 'percentage' ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            <InlineEditableValue
              displayValue={String(item.quantity)}
              editValue={String(item.quantity)}
              type="number"
              min="1"
              step="1"
              disabled={disabled}
              onCommit={(value) => {
                const quantity = Number.parseInt(value, 10);
                updateItem(item.local_id, { quantity: Number.isNaN(quantity) || quantity <= 0 ? 1 : quantity });
              }}
            />
          )}
        </td>
        <td className="px-3 py-3 align-top text-muted-foreground">
          {isDiscount && item.discount_type === 'percentage' ? (
            <span className="text-xs text-muted-foreground">{item.discount_percentage}%</span>
          ) : (
            <div className="space-y-1">
              <InlineEditableValue
                displayValue={item.needs_price ? 'Set price' : formatDraftQuoteMoney(item.unit_price, currencyCode)}
                editValue={(item.unit_price / 100).toFixed(2)}
                type="number"
                min="0"
                step="0.01"
                disabled={disabled}
                highlight={item.needs_price}
                onCommit={(value) => {
                  const nextValue = Math.round(Number.parseFloat(value || '0') * 100);
                  updateItem(item.local_id, { unit_price: Number.isNaN(nextValue) || nextValue < 0 ? 0 : nextValue, needs_price: false });
                }}
              />
              {item.needs_price && (
                <p className="text-xs text-amber-600 dark:text-amber-400">No price in {currencyCode}</p>
              )}
              {!isDiscount && item.service_item_kind === 'product' && (() => {
                const markup = computeMarkupPercent(item.unit_price, item.cost, item.cost_currency, currencyCode);
                if (markup === null) return null;
                const colorClass = markup < 0
                  ? 'text-red-600 dark:text-red-400'
                  : markup === 0
                    ? 'text-muted-foreground'
                    : 'text-emerald-600 dark:text-emerald-400';
                return (
                  <p className={`text-xs ${colorClass}`}>
                    {markup >= 0 ? '+' : ''}{markup.toFixed(1)}% markup
                  </p>
                );
              })()}
            </div>
          )}
        </td>
        <td className={`px-3 py-3 align-top font-medium ${isDiscount ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'}`}>
          {isDiscount ? `- ${formatDraftQuoteMoney(resolvedTotal, currencyCode)}` : formatDraftQuoteMoney(resolvedTotal, currencyCode)}
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
    );
  });

  return (
    <section className="space-y-4 rounded-lg border border-border bg-background/40 p-4">
      <div className="space-y-3">
        <h3 className="text-base font-semibold">Line Items</h3>
        <div className="w-full max-w-md">
          <ServiceCatalogPicker
            value={servicePickerValue}
            selectedLabel=""
            onSelect={handleAddService}
            onAddCustom={handleAddCustomItem}
            disabled={disabled}
            currencyCode={currencyCode}
            placeholder="Search or type custom item name..."
          />
        </div>
        <Button
          id="quote-line-toggle-discount"
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsDiscountOpen(!isDiscountOpen)}
          disabled={disabled}
        >
          {isDiscountOpen ? 'Hide Discount' : 'Add Discount'}
        </Button>
      </div>

      {isDiscountOpen && (
        <div className="grid gap-3 rounded-md border border-dashed border-amber-300 bg-amber-50/40 dark:border-amber-700 dark:bg-amber-950/20 p-3 lg:grid-cols-[1fr,1fr,1fr,1fr,auto]">
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
            <div className="rounded-md border border-dashed border-amber-300 dark:border-amber-700 px-3 py-2 text-sm text-muted-foreground">
              Applies to the full quote subtotal
            </div>
          )}
          <Button id="quote-line-add-discount" type="button" onClick={() => { handleAddDiscount(); setIsDiscountOpen(false); }} disabled={disabled}>
            Add Discount
          </Button>
        </div>
      )}

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
