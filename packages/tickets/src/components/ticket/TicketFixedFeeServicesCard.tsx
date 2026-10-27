'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Minus, Plus, Receipt, Trash2, Pencil } from 'lucide-react';
import type { IServicePrice, ITicketFixedFeeService } from '@alga-psa/types';
import { ContentCard } from '@alga-psa/ui/components';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import AsyncSearchableSelect from '@alga-psa/ui/components/AsyncSearchableSelect';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage, handleError, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTicketDataSource, useTicketScreenReadOnly } from './TicketDataSourceContext';
import TicketChargeEditDialog from './TicketChargeEditDialog';

const isActionError = (value: unknown) => isActionMessageError(value) || isActionPermissionError(value);

export default function TicketFixedFeeServicesCard({
  id = 'ticket-fixed-fee-services',
  ticketId,
}: { id?: string; ticketId: string }) {
  const { t } = useTranslation('features/tickets');
  const { money, currencyCode } = useCurrencyFormat();
  const readOnly = useTicketScreenReadOnly();
  const { fixedFees, materials } = useTicketDataSource();
  const [entries, setEntries] = useState<ITicketFixedFeeService[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serviceId, setServiceId] = useState('');
  const [serviceLabel, setServiceLabel] = useState('');
  const [prices, setPrices] = useState<IServicePrice[]>([]);
  const [currency, setCurrency] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<ITicketFixedFeeService | null>(null);
  const [editingEntry, setEditingEntry] = useState<ITicketFixedFeeService | null>(null);
  const priceRequest = useRef(0);
  const activeTicket = useRef(ticketId);
  activeTicket.current = ticketId;
  const price = prices.find((row) => row.currency_code === currency);
  const validQuantity = Number.isInteger(Number(quantity)) && Number(quantity) >= 1 && Number(quantity) <= 2147483647;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fixedFees.listTicketFixedFeeServices(ticketId);
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        throw result;
      }
      if (activeTicket.current === ticketId) setEntries(result);
    } catch (cause) {
      handleError(cause, t('fixedFeeServices.errors.load'));
      if (activeTicket.current === ticketId) setError(t('fixedFeeServices.errors.load'));
    } finally {
      if (activeTicket.current === ticketId) setLoading(false);
    }
  }, [fixedFees, ticketId, t]);

  useEffect(() => {
    setEntries([]);
    setShowForm(false);
    setEditingEntry(null);
    setDeleteEntry(null);
    setServiceId('');
    setServiceLabel('');
    setPrices([]);
    setCurrency('');
    setQuantity('1');
    setDescription('');
    setSaving(false);
    setError(null);
    priceRequest.current += 1;
    void reload();
    return () => { priceRequest.current += 1; };
  }, [reload]);

  const loadOptions = useCallback(async ({ search, page, limit }: { search: string; page: number; limit: number }) => {
    const result = await materials.searchServiceCatalogForPicker({
      search, page, limit, item_kinds: ['service'], billing_methods: ['fixed'], is_active: true,
    });
    return {
      options: result.items.map((service) => ({ value: service.service_id, label: service.service_name })),
      total: result.totalCount,
    };
  }, [materials]);

  const selectService = async (value: string, label?: string) => {
    const request = ++priceRequest.current;
    setServiceId(value);
    setServiceLabel(label ?? '');
    setPrices([]);
    setCurrency('');
    setError(null);
    if (!value) return;
    try {
      const result = await materials.getServicePrices(value);
      if (request !== priceRequest.current) return;
      setPrices(result);
      setCurrency(result.find((row) => row.currency_code === currencyCode)?.currency_code ?? result[0]?.currency_code ?? '');
      if (result.length === 0) setError(t('fixedFeeServices.errors.priceInvalid'));
    } catch (cause) {
      if (request !== priceRequest.current) return;
      handleError(cause, t('fixedFeeServices.errors.prices'));
      setError(t('fixedFeeServices.errors.prices'));
    }
  };

  const reset = () => {
    priceRequest.current += 1;
    setShowForm(false);
    setServiceId('');
    setServiceLabel('');
    setPrices([]);
    setCurrency('');
    setQuantity('1');
    setDescription('');
    setError(null);
  };

  const save = async () => {
    if (readOnly || saving || !price || !validQuantity) return;
    setSaving(true);
    setError(null);
    try {
      const result = await fixedFees.addTicketFixedFeeService({
        ticket_id: ticketId, service_id: serviceId, quantity: Number(quantity),
        currency_code: currency, description,
      });
      if (activeTicket.current !== ticketId) return;
      if (isActionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      reset();
      await reload();
    } catch (cause) {
      handleError(cause, t('fixedFeeServices.errors.add'));
      if (activeTicket.current === ticketId) setError(t('fixedFeeServices.errors.add'));
    } finally {
      if (activeTicket.current === ticketId) setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteEntry || readOnly || saving) return;
    setSaving(true);
    try {
      const result = await fixedFees.deleteTicketFixedFeeService(deleteEntry.entry_id);
      if (activeTicket.current !== ticketId) return;
      if (isActionError(result)) {
        handleError(result, t('fixedFeeServices.errors.remove'));
        return;
      }
      setDeleteEntry(null);
      await reload();
    } catch (cause) {
      handleError(cause, t('fixedFeeServices.errors.remove'));
    } finally {
      if (activeTicket.current === ticketId) setSaving(false);
    }
  };

  return (
    <ContentCard id={id} collapsible title={t('fixedFeeServices.title')} headerIcon={<Receipt className="h-4 w-4" />}
      count={entries.length} defaultExpanded={entries.length > 0}
      addButton={readOnly ? undefined : { id: `${id}-add-button`, label: t('fixedFeeServices.add'), onClick: () => setShowForm(true) }}>
      {showForm && !readOnly && (
        <div className="space-y-3">
          <Label htmlFor={`${id}-service-select-trigger`}>{t('fixedFeeServices.service')}</Label>
          <AsyncSearchableSelect id={`${id}-service-select`} value={serviceId} selectedLabel={serviceLabel || undefined}
            triggerId={`${id}-service-select-trigger`}
            onChange={(value, option) => void selectService(value, option?.label)}
            loadOptions={loadOptions} placeholder={t('fixedFeeServices.selectService')} dropdownMode="overlay" disabled={saving} />
          <Label htmlFor={`${id}-currency-select`}>{t('fixedFeeServices.currency')}</Label>
          <CustomSelect id={`${id}-currency-select`} value={currency} onValueChange={setCurrency}
            options={prices.map((row) => ({ value: row.currency_code, label: row.currency_code }))}
            disabled={saving || prices.length === 0} />
          <Label htmlFor={`${id}-quantity-input`}>{t('fixedFeeServices.quantity')}</Label>
          <div className="flex items-center gap-2">
            <Button id={`${id}-decrease-button`} variant="outline" aria-label={t('fixedFeeServices.decreaseQuantity')}
              disabled={saving || !validQuantity || Number(quantity) <= 1} onClick={() => setQuantity(String(Number(quantity) - 1))}><Minus className="h-4 w-4" /></Button>
            <Input id={`${id}-quantity-input`} type="number" min={1} max={2147483647} step={1} value={quantity}
              disabled={saving} onChange={(event) => setQuantity(event.target.value)} />
            <Button id={`${id}-increase-button`} variant="outline" aria-label={t('fixedFeeServices.increaseQuantity')}
              disabled={saving || !validQuantity || Number(quantity) >= 2147483647} onClick={() => setQuantity(String(Number(quantity) + 1))}><Plus className="h-4 w-4" /></Button>
          </div>
          <p className="text-sm text-[rgb(var(--color-text-600))]">
            {t('fixedFeeServices.rate')}: {price ? money(Number(price.rate), currency) : '-'}
            {' · '}{t('fixedFeeServices.total')}: {price && validQuantity ? money(Number(price.rate) * Number(quantity), currency) : '-'}
          </p>
          <Label htmlFor={`${id}-description-input`}>{t('fixedFeeServices.description')}</Label>
          <Input id={`${id}-description-input`} value={description} maxLength={2000}
            disabled={saving} onChange={(event) => setDescription(event.target.value)} />
          <div className="flex justify-end gap-2">
            <Button id={`${id}-cancel-button`} variant="outline" disabled={saving} onClick={reset}>{t('actions.cancel')}</Button>
            <Button id={`${id}-save-button`} disabled={saving || !serviceId || !price || !validQuantity} onClick={() => void save()}>{t('fixedFeeServices.add')}</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">{error}</p>}
      {loading ? <p role="status" className="animate-pulse rounded bg-[rgb(var(--color-border-100))] p-2 text-sm">{t('fixedFeeServices.loading')}</p> : entries.length === 0 ? (
        <p className="text-sm text-[rgb(var(--color-text-500))]">{t('fixedFeeServices.empty')}</p>
      ) : (
        <ul className="min-w-0 divide-y divide-[rgb(var(--color-border-100))]">
          {entries.map((entry, index) => (
            <li key={entry.entry_id} className="min-w-0 py-2 first:pt-0 last:pb-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[rgb(var(--color-text-800))]" title={entry.service_name}>{entry.service_name}</span>
                <span className="shrink-0 text-xs text-[rgb(var(--color-text-500))]">{t(entry.is_billed ? 'fixedFeeServices.billed' : 'fixedFeeServices.unbilled')}</span>
                {!readOnly && !entry.is_billed && <Button id={`${id}-edit-${index}-button`} variant="ghost" size="sm" disabled={saving}
                  aria-label={t('chargeEdit.edit')} data-entry-id={entry.entry_id}
                  onClick={() => setEditingEntry(entry)}><Pencil className="h-4 w-4" /></Button>}
                {!readOnly && !entry.is_billed && <Button id={`${id}-remove-${index}-button`} variant="ghost" size="sm"
                  disabled={saving} data-entry-id={entry.entry_id} aria-label={t('fixedFeeServices.remove')}
                  onClick={() => setDeleteEntry(entry)}><Trash2 className="h-4 w-4" /></Button>}
              </div>
              {entry.description && <p className="truncate text-xs text-[rgb(var(--color-text-500))]" title={entry.description}>{entry.description}</p>}
              <div className="flex flex-wrap justify-between gap-x-2 text-xs text-[rgb(var(--color-text-500))]">
                <span>{entry.quantity} &times; {money(Number(entry.rate), entry.currency_code)}</span>
                <span>{t('fixedFeeServices.total')}: {money(Number(entry.rate) * entry.quantity, entry.currency_code)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editingEntry && !readOnly && (
        <TicketChargeEditDialog key={editingEntry.entry_id} id={`${id}-edit-dialog`}
          quantity={editingEntry.quantity} description={editingEntry.description} onClose={() => setEditingEntry(null)}
          onSave={async (input) => {
            const result = await fixedFees.updateTicketFixedFeeService(editingEntry.entry_id, input);
            if (!isActionError(result)) await reload();
            return result;
          }} />
      )}
      <ConfirmationDialog id={`${id}-remove-dialog`} isOpen={Boolean(deleteEntry)} onClose={() => setDeleteEntry(null)}
        onConfirm={remove} title={t('fixedFeeServices.remove')} message={t('fixedFeeServices.confirmRemove')}
        confirmLabel={t('fixedFeeServices.remove')} isConfirming={saving} />
    </ContentCard>
  );
}
