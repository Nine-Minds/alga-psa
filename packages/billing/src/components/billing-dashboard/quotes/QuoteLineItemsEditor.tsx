'use client';

import React, { useEffect, useRef, useMemo, useState } from 'react';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useBillingFrequencyOptions, useFormatBillingFrequency } from '@alga-psa/billing/hooks/useBillingEnumOptions';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Pencil, Info } from 'lucide-react';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import type { CatalogPickerItem } from '../../../actions/serviceActions';
import ServiceCatalogPicker from '../contracts/ServiceCatalogPicker';
import LocationPicker from '../locations/LocationPicker';
import LocationAddress from '../locations/LocationAddress';
import {
  buildLocationGroups,
  getLocationKey,
  pickDefaultLocation,
  shouldShowLocationGroups,
  type LocationGroupEntry,
  type LocationSummary,
} from '../locations/locationGrouping';
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
  /**
   * Client locations available for assignment. When a second location is
   * chosen via "Add location", this dropdown feeds every group picker.
   */
  locations?: LocationSummary[];
  /**
   * When true, the editor shows per-location groups with per-group subtotals
   * and "+ Add item" actions. When false (default) it shows today's flat
   * layout. The caller decides based on `shouldShowLocationGroups(items)`
   * plus an explicit "+ Add location" click.
   */
  showLocationGroups?: boolean;
  /**
   * Extra location_ids that should render as empty groups even if no items
   * reference them yet. Populated by the "+ Add location" flow so the user
   * can pick a second location before adding any line items.
   */
  extraGroupLocationIds?: string[];
  /** Fires when the user asks to add a new empty location group. */
  onAddLocationGroup?: () => void;
  /** Fires when a location group is deleted (used to auto-revert to flat). */
  onRemoveLocationGroup?: (locationId: string | null) => void;
}

interface QuotePhaseSection {
  key: string;
  label: string;
  items: DraftQuoteItem[];
}

function computeEffectiveUnitPrice(item: DraftQuoteItem, items: DraftQuoteItem[]): number {
  if (item.is_discount || item.quantity === 0) return item.unit_price;

  const includedBaseItems = items.filter((i) => !i.is_discount && (!i.is_optional || i.is_selected !== false));
  const itemKey = item.quote_item_id ?? item.local_id;
  const isIncluded = includedBaseItems.some((i) => (i.quote_item_id ?? i.local_id) === itemKey);
  if (!isIncluded) return item.unit_price;

  const itemTotal = item.quantity * item.unit_price;
  if (itemTotal === 0) return item.unit_price;

  const quoteSubtotal = includedBaseItems.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);

  let totalReduction = 0;
  for (const d of items) {
    if (!d.is_discount) continue;

    let baseAmount: number;
    if (d.applies_to_item_id) {
      if (d.applies_to_item_id !== itemKey) continue;
      baseAmount = itemTotal;
    } else if (d.applies_to_service_id) {
      if (!item.service_id || d.applies_to_service_id !== item.service_id) continue;
      baseAmount = includedBaseItems
        .filter((i) => i.service_id === d.applies_to_service_id)
        .reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
    } else {
      baseAmount = quoteSubtotal;
    }

    if (baseAmount <= 0) continue;

    const discountAmount = d.discount_type === 'percentage'
      ? baseAmount * ((d.discount_percentage ?? 0) / 100)
      : d.quantity * d.unit_price;

    totalReduction += discountAmount * (itemTotal / baseAmount);
  }

  return (itemTotal - totalReduction) / item.quantity;
}

function computeMarkupPercent(
  effectiveUnitPrice: number,
  cost: number | null | undefined,
  costCurrency: string | null | undefined,
  quoteCurrency: string
): number | null {
  if (cost == null || cost === 0) return null;
  if (costCurrency && costCurrency !== quoteCurrency) return null;
  return ((effectiveUnitPrice - cost) / cost) * 100;
}

const UNGROUPED_PHASE_KEY = '__ungrouped__';

const getPhaseKey = (phase?: string | null): string => phase?.trim() || UNGROUPED_PHASE_KEY;
const getPhaseLabel = (phase?: string | null): string => phase?.trim() || 'Ungrouped Items';

const QuoteLineItemsEditor: React.FC<QuoteLineItemsEditorProps> = ({
  items,
  currencyCode,
  disabled = false,
  onChange,
  locations = [],
  showLocationGroups = false,
  extraGroupLocationIds = [],
  onAddLocationGroup,
  onRemoveLocationGroup,
}) => {
  const { t } = useTranslation('features/billing');
  const { formatCurrency } = useFormatters();
  const billingFrequencyOptions = useBillingFrequencyOptions();
  const formatBillingFrequency = useFormatBillingFrequency();
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

  const defaultLocation = useMemo(() => pickDefaultLocation(locations), [locations]);

  const locationGroups = useMemo<LocationGroupEntry<DraftQuoteItem>[]>(
    () => {
      const groups = buildLocationGroups(items, locations);
      // Surface empty groups the caller asked us to keep rendering so the
      // user can pick a location / add items into them.
      const existingKeys = new Set(groups.map((group) => group.key));
      for (const extraId of extraGroupLocationIds) {
        if (!extraId || existingKeys.has(extraId)) continue;
        const resolved = locations.find((loc) => loc.location_id === extraId) ?? null;
        groups.push({
          key: extraId,
          location_id: extraId,
          location: resolved,
          items: [],
        });
      }
      return groups;
    },
    [items, locations, extraGroupLocationIds]
  );

  const phaseSections = useMemo(
    (): QuotePhaseSection[] => buildPhaseSections(items),
    [items]
  );

  const formatBillingMethod = (billingMethod?: DraftQuoteItem['billing_method'] | null): string => {
    switch (billingMethod) {
      case 'fixed':
        return t('quoteLineItems.billingMethods.fixed', { defaultValue: 'Fixed' });
      case 'hourly':
        return t('quoteLineItems.billingMethods.hourly', { defaultValue: 'Hourly' });
      case 'usage':
        return t('quoteLineItems.billingMethods.usage', { defaultValue: 'Usage Based' });
      case 'per_unit':
        return t('quoteLineItems.billingMethods.perUnit', { defaultValue: 'Per Unit' });
      default:
        return billingMethod ?? '—';
    }
  };

  const formatMoney = (minorUnits: number): string => (
    formatCurrency((minorUnits || 0) / 100, currencyCode)
  );

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
      // When dropping across location groups, inherit the target's location.
      location_id: targetItem.location_id ?? draggedItem.location_id ?? null,
    });
    onChange(reorderedItems);
  };

  const removeItem = (localId: string) => {
    const next = items.filter((item) => item.local_id !== localId);
    const removed = items.find((item) => item.local_id === localId);
    onChange(next);

    // Empty-group auto-removal: if the removed item leaves its location group empty
    // (and the group wasn't the default), let the parent know so it can revert to
    // flat layout when only the default group remains.
    if (showLocationGroups && removed?.location_id) {
      const locationStillInUse = next.some((item) => item.location_id === removed.location_id);
      if (!locationStillInUse) {
        onRemoveLocationGroup?.(removed.location_id);
      }
    }
  };

  const toggleSection = (sectionKey: string) => {
    setCollapsedSections((current) => ({
      ...current,
      [sectionKey]: !current[sectionKey],
    }));
  };

  const handleAddServiceForLocation = (service: CatalogPickerItem, locationId: string | null) => {
    const nextItem = createDraftQuoteItemFromService(service, currencyCode);
    nextItem.location_id = locationId ?? defaultLocation?.location_id ?? null;
    onChange([...items, nextItem]);
    setServicePickerValue('');
  };

  const handleAddCustomItemForLocation = (description: string, locationId: string | null) => {
    const nextItem = createCustomDraftQuoteItem({
      description,
      quantity: 1,
      unit_price: 0,
    });
    nextItem.location_id = locationId ?? defaultLocation?.location_id ?? null;
    onChange([...items, nextItem]);
    setServicePickerValue('');
  };

  const handleAddDiscount = () => {
    const numericValue = Number.parseFloat(discountValue || '0');
    if (Number.isNaN(numericValue) || numericValue <= 0) {
      return;
    }

    const discountItem = createDraftDiscountQuoteItem({
      description: discountType === 'percentage' ? `Discount (${numericValue}%)` : 'Discount',
      discount_type: discountType,
      discount_percentage: discountType === 'percentage' ? Math.round(numericValue) : null,
      fixed_amount: discountType === 'fixed' ? Math.round(numericValue * 100) : 0,
      applies_to_item_id: discountTargetType === 'item' ? discountTargetValue || null : null,
      applies_to_service_id: discountTargetType === 'service' ? discountTargetValue || null : null,
    });

    onChange([...items, discountItem]);

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
      return target
        ? t('quoteLineItems.discounts.targets.namedItem', {
          defaultValue: 'on "{{name}}"',
          name: target.description,
        })
        : t('quoteLineItems.discounts.targets.specificItem', {
          defaultValue: 'on specific item',
        });
    }
    if (item.applies_to_service_id) {
      const target = items.find((i) => i.service_id === item.applies_to_service_id);
      return target
        ? t('quoteLineItems.discounts.targets.namedService', {
          defaultValue: 'on {{name}}',
          name: target.service_name || t('quoteLineItems.labels.service', { defaultValue: 'service' }),
        })
        : t('quoteLineItems.discounts.targets.specificService', {
          defaultValue: 'on specific service',
        });
    }
    return t('quoteLineItems.discounts.targets.fullQuote', {
      defaultValue: 'on full quote',
    });
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
                {t('quoteLineItems.discounts.badge', { defaultValue: 'Discount' })}
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
                    {item.service_name || t('quoteLineItems.labels.customItem', { defaultValue: 'Custom item' })}
                    {item.service_sku ? ` • ${item.service_sku}` : ''}
                    {item.unit_of_measure ? ` • ${item.unit_of_measure}` : ''}
                  </>
                )
              }
            </div>
            {!isDiscount && (
              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('quoteLineItems.labels.phaseSection', { defaultValue: 'Phase / Section' })}
                </div>
                <Input
                  value={item.phase ?? ''}
                  onChange={(event) => updateItem(item.local_id, { phase: event.target.value.trim() || null })}
                  placeholder={t('quoteLineItems.placeholders.phaseSection', {
                    defaultValue: 'e.g. Discovery, Rollout, Ongoing',
                  })}
                  disabled={disabled}
                />
              </div>
            )}
          </div>
        </td>
        <td className="px-3 py-3 align-top text-muted-foreground">
          {isDiscount ? (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              {item.discount_type === 'percentage'
                ? t('quoteLineItems.discounts.types.percentage', { defaultValue: 'Percentage' })
                : t('quoteLineItems.discounts.types.fixed', { defaultValue: 'Fixed' })}
            </span>
          ) : (
            <>
              {formatBillingMethod(item.billing_method)}
              {item.is_recurring && item.billing_frequency ? (
                <div className="mt-2 text-xs text-muted-foreground">
                  {formatBillingFrequency(item.billing_frequency)}
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
                label={t('quoteLineItems.labels.optional', { defaultValue: 'Optional' })}
                disabled={disabled}
                containerClassName="mb-0"
                onChange={(event) => updateItem(item.local_id, { is_optional: event.target.checked })}
              />
              <Checkbox
                id={`quote-line-recurring-${item.local_id}`}
                checked={item.is_recurring}
                label={t('quoteLineItems.labels.recurring', { defaultValue: 'Recurring' })}
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
                  options={billingFrequencyOptions}
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
                displayValue={item.needs_price
                  ? t('quoteLineItems.labels.setPrice', { defaultValue: 'Set price' })
                  : formatMoney(item.unit_price)}
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
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {t('quoteLineItems.labels.noPriceInCurrency', {
                    defaultValue: 'No price in {{currencyCode}}',
                    currencyCode,
                  })}
                </p>
              )}
              {!isDiscount && item.service_item_kind === 'product' && item.cost != null && item.cost !== 0 && (() => {
                if (item.cost_currency && item.cost_currency !== currencyCode) {
                  return (
                    <Tooltip
                      content={t('quoteLineItems.markup.unavailableTooltip', {
                        defaultValue: 'Markup can\'t be calculated because cost is tracked in {{costCurrency}} and this quote is in {{quoteCurrency}}.',
                        costCurrency: item.cost_currency,
                        quoteCurrency: currencyCode,
                      })}
                    >
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Info className="h-3 w-3" aria-hidden="true" />
                        {t('quoteLineItems.markup.unavailable', { defaultValue: 'Markup unavailable' })}
                      </span>
                    </Tooltip>
                  );
                }
                const effectiveUnitPrice = computeEffectiveUnitPrice(item, items);
                const markup = computeMarkupPercent(effectiveUnitPrice, item.cost, item.cost_currency, currencyCode);
                if (markup === null) return null;
                const colorClass = markup < 0
                  ? 'text-red-600 dark:text-red-400'
                  : markup === 0
                    ? 'text-muted-foreground'
                    : 'text-emerald-600 dark:text-emerald-400';
                return (
                  <p className={`text-xs ${colorClass}`}>
                    {t('quoteLineItems.markup.badge', {
                      defaultValue: '{{sign}}{{value}}% markup',
                      sign: markup >= 0 ? '+' : '',
                      value: markup.toFixed(1),
                    })}
                  </p>
                );
              })()}
            </div>
          )}
        </td>
        <td className={`px-3 py-3 align-top font-medium ${isDiscount ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'}`}>
          {isDiscount ? `- ${formatMoney(resolvedTotal)}` : formatMoney(resolvedTotal)}
        </td>
        <td className="px-3 py-3 align-top">
          <Button
            id={`quote-line-remove-${item.local_id}`}
            type="button"
            variant="outline"
            onClick={() => removeItem(item.local_id)}
            disabled={disabled}
          >
            {t('quoteLineItems.actions.remove', { defaultValue: 'Remove' })}
          </Button>
        </td>
      </tr>
    );
  });

  const renderPhaseSections = (sections: QuotePhaseSection[], sectionKeyPrefix: string) => (
    <div className="space-y-4">
      {sections.map((section) => {
        const sectionKey = `${sectionKeyPrefix}:${section.key}`;
        const isCollapsed = collapsedSections[sectionKey] === true;

        return (
          <div key={sectionKey} className="overflow-hidden rounded-md border border-border">
            <button
              type="button"
              className="flex w-full items-center justify-between bg-muted/40 px-4 py-3 text-left"
              onClick={() => toggleSection(sectionKey)}
            >
              <div>
                <div className="text-sm font-semibold text-foreground">{section.label}</div>
                <div className="text-xs text-muted-foreground">
                  {section.items.length} {section.items.length === 1 ? 'item' : 'items'}
                </div>
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
  );

  const renderServicePicker = (locationId: string | null, keySuffix: string) => (
    <div className="w-full max-w-md">
      <ServiceCatalogPicker
        value={servicePickerValue}
        selectedLabel=""
        onSelect={(service) => handleAddServiceForLocation(service, locationId)}
        onAddCustom={(description) => handleAddCustomItemForLocation(description, locationId)}
        disabled={disabled}
        currencyCode={currencyCode}
        placeholder={t('quotes.lineItems.searchPlaceholder', { defaultValue: 'Search or type custom item name...' })}
      />
    </div>
  );

  const excludedLocationIds = useMemo(() => {
    // Prevent the same location from being chosen twice across groups.
    const seen = new Set<string>();
    for (const item of items) {
      if (item.location_id) seen.add(item.location_id);
    }
    return Array.from(seen);
  }, [items]);

  const renderLocationGroupHeader = (group: LocationGroupEntry<DraftQuoteItem>, index: number) => {
    const pickerId = `quote-location-picker-${group.location_id ?? 'unassigned'}`;
    // Exclude locations that are already chosen by *other* groups.
    const exclude = excludedLocationIds.filter((id) => id !== (group.location_id ?? undefined));

    return (
      <div className="flex flex-col gap-3 rounded-t-md bg-muted/40 px-4 py-3 md:flex-row md:items-start md:justify-between">
        <div className="flex-1 space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('quotes.locations.groupHeading', {
              defaultValue: 'Location {{index}}',
              index: index + 1,
            })}
          </div>
          <div className="max-w-md">
            <LocationPicker
              id={pickerId}
              locations={locations}
              value={group.location_id}
              onChange={(nextLocationId) => {
                // Reassign every item in this group to the new location.
                const currentLocationId = group.location_id;
                onChange(items.map((item) =>
                  (item.location_id ?? null) === currentLocationId
                    ? { ...item, location_id: nextLocationId }
                    : item
                ));
              }}
              placeholder={t('quotes.locations.pickerPlaceholder', { defaultValue: 'Select a location' })}
              disabled={disabled}
              excludeLocationIds={exclude}
              allowClear={false}
            />
          </div>
          {group.location ? (
            <LocationAddress location={group.location} showName={false} />
          ) : (
            <p className="text-xs text-muted-foreground">
              {t('quotes.locations.unassigned', { defaultValue: 'Items without a location are listed here until one is chosen.' })}
            </p>
          )}
        </div>
        {onRemoveLocationGroup && group.location_id ? (
          <div>
            <Button
              id={`quote-location-remove-${group.location_id}`}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onRemoveLocationGroup(group.location_id)}
              disabled={disabled}
            >
              {t('quotes.locations.removeGroup', { defaultValue: 'Remove location' })}
            </Button>
          </div>
        ) : null}
      </div>
    );
  };

  const renderLocationGroupSubtotal = (group: LocationGroupEntry<DraftQuoteItem>) => {
    const totals = calculateDraftQuoteTotals(group.items);
    return (
      <div className="flex flex-wrap items-center justify-end gap-6 border-t border-border bg-background/70 px-4 py-2 text-sm">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {t('quotes.locations.subtotal', { defaultValue: 'Location subtotal' })}
        </span>
        <span className="font-semibold">{formatDraftQuoteMoney(totals.subtotal - totals.discount_total, currencyCode)}</span>
      </div>
    );
  };

  return (
    <section className="space-y-4 rounded-lg border border-border bg-background/40 p-4">
      <div className="space-y-3">
        <h3 className="text-base font-semibold">Line Items</h3>
        {!showLocationGroups && renderServicePicker(defaultLocation?.location_id ?? null, 'root')}
        <div className="flex flex-wrap items-center gap-2">
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
          {onAddLocationGroup ? (
            <Button
              id="quote-line-add-location"
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onAddLocationGroup()}
              disabled={disabled || locations.length < 2}
            >
              {t('quotes.locations.addLocationButton', { defaultValue: '+ Add location' })}
            </Button>
          ) : null}
        </div>
        {onAddLocationGroup && locations.length < 2 ? (
          <p className="text-xs text-muted-foreground">
            {t('quotes.locations.needMoreLocations', {
              defaultValue: 'This client only has one active location. Add a second location in Client settings to enable multi-site quoting.',
            })}
          </p>
        ) : null}
      </div>

      {isDiscountOpen && (
        <div className="grid gap-3 rounded-md border border-dashed border-amber-300 bg-amber-50/40 dark:border-amber-700 dark:bg-amber-950/20 p-3 lg:grid-cols-[1fr,1fr,1fr,1fr,auto]">
          <CustomSelect
            id="quote-discount-type"
            value={discountType}
            onValueChange={(value) => setDiscountType(value as 'percentage' | 'fixed')}
            disabled={disabled}
            options={[
              {
                value: 'percentage',
                label: t('quoteLineItems.discounts.percentage', { defaultValue: 'Percentage discount' }),
              },
              {
                value: 'fixed',
                label: t('quoteLineItems.discounts.fixed', { defaultValue: 'Fixed discount' }),
              },
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
              {
                value: 'quote',
                label: t('quoteLineItems.discounts.fullQuote', { defaultValue: 'Whole quote' }),
              },
              {
                value: 'item',
                label: t('quoteLineItems.discounts.item', { defaultValue: 'Specific item' }),
              },
              {
                value: 'service',
                label: t('quoteLineItems.discounts.service', { defaultValue: 'Specific service' }),
              },
            ]}
          />
          {discountTargetType === 'item' ? (
            <CustomSelect
              id="quote-discount-target-item"
              value={discountTargetValue || undefined}
              onValueChange={(value) => setDiscountTargetValue(value)}
              disabled={disabled}
              placeholder={t('quoteLineItems.placeholders.selectItem', { defaultValue: 'Select item' })}
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
              placeholder={t('quoteLineItems.placeholders.selectService', { defaultValue: 'Select service' })}
              options={serviceTargetOptions}
            />
          ) : (
            <div className="rounded-md border border-dashed border-amber-300 dark:border-amber-700 px-3 py-2 text-sm text-muted-foreground">
              {t('quoteLineItems.discounts.fullQuoteSubtotal', {
                defaultValue: 'Applies to the full quote subtotal',
              })}
            </div>
          )}
          <Button id="quote-line-add-discount" type="button" onClick={() => { handleAddDiscount(); setIsDiscountOpen(false); }} disabled={disabled}>
            {t('quoteLineItems.actions.addDiscount', { defaultValue: 'Add Discount' })}
          </Button>
        </div>
      )}

      {items.length === 0 && !showLocationGroups ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t('quoteLineItems.empty', {
            defaultValue: 'No line items yet. Use the catalog search above to add your first item.',
          })}
        </div>
      ) : showLocationGroups ? (
        <div className="space-y-4">
          {locationGroups.map((group, index) => (
            <div key={group.key} className="overflow-hidden rounded-md border border-border">
              {renderLocationGroupHeader(group, index)}
              <div className="border-t border-border p-4 space-y-3">
                {renderServicePicker(group.location_id ?? null, `loc-${group.key}`)}
                {group.items.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                    {t('quotes.locations.emptyGroup', { defaultValue: 'No items yet for this location.' })}
                  </div>
                ) : (
                  renderPhaseSections(buildPhaseSections(group.items), `loc-${group.key}`)
                )}
              </div>
              {group.items.length > 0 ? renderLocationGroupSubtotal(group) : null}
            </div>
          ))}
        </div>
      ) : (
        renderPhaseSections(phaseSections, 'root')
      )}
    </section>
  );
};

function buildPhaseSections(items: DraftQuoteItem[]): QuotePhaseSection[] {
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
}

export default QuoteLineItemsEditor;
