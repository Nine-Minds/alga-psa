'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import AsyncSearchableSelect, { type SelectOption } from '@alga-psa/ui/components/AsyncSearchableSelect';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { isStockConflictResult, type StockConflictResult } from '@alga-psa/inventory/lib/stockConflict';
import type { IServicePrice } from '@alga-psa/types';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { getServicePrices, searchServiceCatalogForPicker } from '../../actions/materialCatalogActions';
import {
  getProjectStagingAvailability,
  listProjectStagingUnits,
  reserveProjectStaging,
} from '../../actions/stagingActions';
import type { StagingTaskOption } from './stagingTypes';

const NO_TASK = '__none__';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onReserved: () => void;
  projectId: string;
  tasks: StagingTaskOption[];
  canReadInventory: boolean;
}

type Availability = {
  track_stock: boolean;
  is_serialized: boolean;
  default_location_id: string | null;
  locations: Array<{ location_id: string; name: string; on_hand: number; reserved: number; held: number; free: number }>;
};

const isError = (value: unknown) => isActionMessageError(value) || isActionPermissionError(value);

/**
 * Reserve stock for the project: all or nothing, at one location. Reserving claims stock (it stops being
 * free for sales orders and materials) but consumes nothing and bills nothing.
 */
export default function ReserveStagingDialog({ isOpen, onClose, onReserved, projectId, tasks, canReadInventory }: Props) {
  const { t } = useTranslation(['features/projects', 'common']);
  const st = useCallback((key: string, fallback: string, options?: Record<string, unknown>) =>
    t(`staging.reserve.${key}`, { defaultValue: fallback, ...(options ?? {}) }), [t]);

  const [productId, setProductId] = useState('');
  const [productLabel, setProductLabel] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [locationId, setLocationId] = useState('');
  const [units, setUnits] = useState<Array<{ unit_id: string; serial_number: string; location_name: string | null }>>([]);
  const [pickedUnits, setPickedUnits] = useState<Set<string>>(new Set());
  const [prices, setPrices] = useState<IServicePrice[]>([]);
  const [currency, setCurrency] = useState('');
  const [rate, setRate] = useState(0);
  const [taskId, setTaskId] = useState(NO_TASK);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<StockConflictResult['stockConflict'] | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setProductId('');
      setProductLabel('');
      setQuantity(1);
      setAvailability(null);
      setLocationId('');
      setUnits([]);
      setPickedUnits(new Set());
      setPrices([]);
      setCurrency('');
      setRate(0);
      setTaskId(NO_TASK);
      setError(null);
      setConflict(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    (async () => {
      const [avail, priceRows] = await Promise.all([
        getProjectStagingAvailability(projectId, productId),
        getServicePrices(productId),
      ]);
      if (cancelled) return;
      if (!isError(avail) && !isStockConflictResult(avail)) {
        const a = avail as Availability;
        setAvailability(a);
        setLocationId(a.default_location_id ?? '');
        if (a.is_serialized && canReadInventory) {
          const rows = await listProjectStagingUnits(projectId, productId);
          if (!cancelled && Array.isArray(rows)) setUnits(rows);
        } else {
          setUnits([]);
        }
      }
      setPrices(priceRows);
      if (priceRows.length > 0) {
        setCurrency(priceRows[0].currency_code);
        setRate(priceRows[0].rate);
      }
    })();
    return () => { cancelled = true; };
  }, [productId, projectId, canReadInventory]);

  const loadProductOptions = useCallback(async ({ search, page, limit }: { search: string; page: number; limit: number }) => {
    const result = await searchServiceCatalogForPicker({ search, page, limit, item_kinds: ['product'], is_active: true });
    const options: SelectOption[] = result.items.map((item) => ({
      value: item.service_id,
      label: item.sku ? `${item.service_name} (${item.sku})` : item.service_name,
      secondaryLabel: item.product_category || undefined,
    }));
    return { options, total: result.totalCount };
  }, []);

  const serialized = Boolean(availability?.is_serialized);
  const location = availability?.locations.find((l) => l.location_id === locationId) ?? null;
  const requested = serialized && pickedUnits.size > 0 ? pickedUnits.size : quantity;

  const locationOptions = useMemo(() => [
    ...(serialized ? [{ value: '__any__', label: st('anyLocation', 'Any location (oldest units first)') }] : []),
    ...(availability?.locations ?? []).map((l) => ({
      value: l.location_id,
      label: st('locationOption', '{{name}}: {{free}} free', { name: l.name, free: Math.max(0, l.free) }),
    })),
  ], [availability, serialized, st]);

  const handleReserve = async () => {
    setError(null);
    setConflict(null);
    if (!productId) {
      setError(st('selectProduct', 'Choose a product.'));
      return;
    }
    if (!Number.isFinite(requested) || requested < 1) {
      setError(st('quantityMin', 'Quantity must be at least 1.'));
      return;
    }
    setIsSaving(true);
    try {
      const result = await reserveProjectStaging({
        project_id: projectId,
        service_id: productId,
        quantity: requested,
        location_id: locationId && locationId !== '__any__' ? locationId : null,
        unit_ids: serialized && pickedUnits.size > 0 ? [...pickedUnits] : null,
        task_id: taskId === NO_TASK ? null : taskId,
        rate: prices.length > 0 ? rate : null,
        currency_code: currency || null,
      });
      if (isStockConflictResult(result)) {
        setConflict(result.stockConflict);
        return;
      }
      if (isError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      onReserved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : st('failed', 'Could not reserve the stock.'));
    } finally {
      setIsSaving(false);
    }
  };

  const conflictMessage = conflict
    ? conflict.reason === 'on_hand'
      ? st('conflictOnHand', 'Only {{onHand}} on hand, {{requested}} requested. Nothing was reserved.', conflict as never)
      : st(
        'conflictFree',
        'Only {{free}} free: {{reserved}} reserved and {{held}} on hard hold for sales orders or projects. You asked for {{requested}}. Nothing was reserved.',
        { ...conflict, free: Math.max(0, conflict.free) } as never,
      )
    : null;

  return (
    <Dialog id="staging-reserve-dialog" isOpen={isOpen} onClose={onClose} title={st('title', 'Reserve stock')}>
      <DialogContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {st('intro', 'Reserving holds stock for this project without using it up. Stock is used, and billed, only when you install it.')}
        </p>
        <div className="space-y-2">
          <Label htmlFor="staging-reserve-product">{st('product', 'Product')}</Label>
          <AsyncSearchableSelect
            id="staging-reserve-product"
            value={productId}
            selectedLabel={productLabel}
            onChange={(value, option) => {
              setProductId(value);
              setProductLabel(option?.label ?? '');
              setPickedUnits(new Set());
              setConflict(null);
              setError(null);
            }}
            loadOptions={loadProductOptions}
            limit={10}
            debounceMs={300}
            placeholder={st('productPlaceholder', 'Select a product...')}
            searchPlaceholder={st('productSearch', 'Search products...')}
            emptyMessage={st('noProducts', 'No products found')}
            dropdownMode="overlay"
            maxListHeight="200px"
          />
        </div>

        {productId && availability && !availability.track_stock && (
          <Alert variant="info">
            <AlertDescription>{st('untracked', 'This product is not stock-tracked. It is added as a planning line and claims no stock.')}</AlertDescription>
          </Alert>
        )}

        {productId && availability?.track_stock && (
          <div className="space-y-2">
            <Label htmlFor="staging-reserve-location">{st('location', 'Reserve from')}</Label>
            <CustomSelect
              id="staging-reserve-location"
              options={locationOptions}
              value={locationId || (serialized ? '__any__' : '')}
              onValueChange={setLocationId}
              placeholder={st('locationPlaceholder', 'Choose a location')}
            />
            {location && (
              <p className="text-xs text-muted-foreground">
                {st('locationDetail', '{{onHand}} on hand, {{reserved}} reserved, {{held}} on hard hold.', {
                  onHand: location.on_hand,
                  reserved: location.reserved,
                  held: location.held,
                })}
              </p>
            )}
          </div>
        )}

        {serialized && canReadInventory && units.length > 0 && (
          <div className="space-y-2">
            <Label>{st('units', 'Units (optional: leave empty to take the oldest)')}</Label>
            <div className="max-h-40 overflow-y-auto rounded border p-2 space-y-1">
              {units.map((unit) => (
                <Checkbox
                  key={unit.unit_id}
                  id={`staging-reserve-unit-${unit.unit_id}`}
                  checked={pickedUnits.has(unit.unit_id)}
                  onChange={(event) => {
                    const next = new Set(pickedUnits);
                    if ((event.target as HTMLInputElement).checked) next.add(unit.unit_id);
                    else next.delete(unit.unit_id);
                    setPickedUnits(next);
                  }}
                  label={unit.location_name ? `${unit.serial_number} (${unit.location_name})` : unit.serial_number}
                />
              ))}
            </div>
          </div>
        )}
        {serialized && !canReadInventory && (
          <p className="text-xs text-muted-foreground">{st('noUnitPicker', 'You cannot see stock units, so the oldest units are taken.')}</p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="staging-reserve-quantity">{st('quantity', 'Quantity')}</Label>
            <Input
              id="staging-reserve-quantity"
              type="number"
              min={1}
              value={serialized && pickedUnits.size > 0 ? pickedUnits.size : quantity}
              disabled={serialized && pickedUnits.size > 0}
              onChange={(event) => setQuantity(Math.floor(Number(event.target.value)))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="staging-reserve-task">{st('task', 'Task')}</Label>
            <CustomSelect
              id="staging-reserve-task"
              options={[
                { value: NO_TASK, label: st('noTask', 'No task') },
                ...tasks.map((task) => ({ value: task.task_id, label: `${task.phase_name}: ${task.task_name}` })),
              ]}
              value={taskId}
              onValueChange={setTaskId}
            />
          </div>
        </div>

        {productId && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="staging-reserve-currency">{st('currency', 'Currency')}</Label>
              <CustomSelect
                id="staging-reserve-currency"
                options={prices.map((price) => ({ value: price.currency_code, label: price.currency_code }))}
                value={currency}
                onValueChange={(value) => {
                  setCurrency(value);
                  const price = prices.find((p) => p.currency_code === value);
                  if (price) setRate(price.rate);
                }}
                placeholder={st('currencyPlaceholder', 'Tenant default')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staging-reserve-rate">{st('rate', 'Planned rate (per unit)')}</Label>
              <Input
                id="staging-reserve-rate"
                type="number"
                min={0}
                step="0.01"
                value={(rate / 100).toFixed(2)}
                onChange={(event) => setRate(Math.max(0, Math.round((Number(event.target.value) || 0) * 100)))}
              />
            </div>
          </div>
        )}

        {conflictMessage && (
          <Alert variant="destructive" id="staging-reserve-conflict">
            <AlertDescription>{conflictMessage}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive" id="staging-reserve-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </DialogContent>
      <DialogFooter>
        <Button id="staging-reserve-cancel" variant="outline" onClick={onClose}>
          {t('common:actions.cancel', 'Cancel')}
        </Button>
        <Button id="staging-reserve-submit" onClick={handleReserve} disabled={isSaving || !productId}>
          {isSaving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
          {st('submit', 'Reserve')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
