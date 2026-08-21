'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { toast } from 'react-hot-toast';
import { formatCurrencyFromMinorUnits, toCalendarDateString } from '@alga-psa/core';
import type { IService } from '@alga-psa/types';
import { createHourBlockPurchaseInvoice } from '@alga-psa/billing/actions/hourBlockActions';
import { getServices } from '@alga-psa/billing/actions/serviceActions';

interface SellHourBlockDialogProps {
  clientId: string;
  currencyCode: string;
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

interface ServiceOption {
  value: string;
  label: string;
}

export default function SellHourBlockDialog({ clientId, currencyCode, isOpen, onClose, onCreated }: SellHourBlockDialogProps) {
  const { t } = useTranslation('msp/hour-blocks');

  const [services, setServices] = useState<IService[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [rate, setRate] = useState<string>('');
  const [hours, setHours] = useState<string>('');
  const [expirationDate, setExpirationDate] = useState<Date | undefined>(undefined);
  const [scopeServiceIds, setScopeServiceIds] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setServicesLoading(true);
    setError(null);
    getServices(1, 999, { is_active: true, item_kind: 'service' })
      .then((result) => {
        if (cancelled) return;
        if (isActionMessageError(result) || isActionPermissionError(result) || 'error' in result) {
          setServices([]);
          return;
        }
        setServices(result.services);
      })
      .catch(() => {
        if (!cancelled) setServices([]);
      })
      .finally(() => {
        if (!cancelled) setServicesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const serviceOptions: ServiceOption[] = useMemo(
    () => services.map((service) => ({ value: service.service_id, label: service.service_name })),
    [services],
  );

  const selectedService = useMemo(
    () => services.find((service) => service.service_id === selectedServiceId),
    [services, selectedServiceId],
  );

  // When a service is picked, default the rate from its catalog default_rate.
  useEffect(() => {
    if (selectedService) {
      setRate(String((selectedService.default_rate ?? 0) / 100));
    }
  }, [selectedService?.service_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const hoursNumber = Number(hours);
  const rateNumber = Number(rate);
  const total = Number.isFinite(hoursNumber) && Number.isFinite(rateNumber) && hoursNumber > 0 && rateNumber >= 0
    ? Math.round(hoursNumber * rateNumber * 100)
    : 0;

  const toggleScope = (serviceId: string) => {
    setScopeServiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) {
        next.delete(serviceId);
      } else {
        next.add(serviceId);
      }
      return next;
    });
  };

  const reset = () => {
    setSelectedServiceId('');
    setRate('');
    setHours('');
    setExpirationDate(undefined);
    setScopeServiceIds(new Set());
    setNotes('');
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!selectedServiceId) {
      setError(t('sell.serviceRequired', { defaultValue: 'Select a service.' }));
      return;
    }
    if (!Number.isFinite(hoursNumber) || hoursNumber <= 0) {
      setError(t('sell.hoursRequired', { defaultValue: 'Enter the number of hours.' }));
      return;
    }
    if (!Number.isFinite(rateNumber) || rateNumber < 0) {
      setError(t('sell.rateRequired', { defaultValue: 'Enter a valid rate.' }));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await createHourBlockPurchaseInvoice({
        clientId,
        serviceId: selectedServiceId,
        hours: hoursNumber,
        hourlyRate: Math.round(rateNumber * 100),
        expirationDate: expirationDate ? toCalendarDateString(expirationDate) : null,
        scopeServiceIds: Array.from(scopeServiceIds),
        notes: notes.trim() || undefined,
      });

      if (isActionMessageError(result) || isActionPermissionError(result)) {
        setError(getErrorMessage(result));
        return;
      }

      toast.success(t('sell.submitted', {
        invoiceNumber: result.invoiceNumber,
        defaultValue: 'Draft invoice {{invoiceNumber}} created. Finalize it to activate the block.',
      }));
      reset();
      onCreated();
      onClose();
    } catch (err) {
      console.error('Failed to create hour block purchase:', err);
      setError(t('sell.invoiceError', { defaultValue: 'Could not create the block purchase invoice.' }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog isOpen={isOpen} onClose={handleClose} title={t('sell.title', { defaultValue: 'Sell hour block' })} id="sell-hour-block-dialog" data-automation-id="sell-hour-block-dialog">
      <DialogContent>
        <div className="space-y-4">
          {servicesLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="hb-service">{t('sell.serviceLabel', { defaultValue: 'Service' })}</Label>
              <CustomSelect
                id="hb-service"
                options={serviceOptions}
                value={selectedServiceId || null}
                onValueChange={setSelectedServiceId}
                placeholder={t('sell.servicePlaceholder', { defaultValue: 'Select a service' })}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="hb-hours">{t('sell.hoursLabel', { defaultValue: 'Hours' })}</Label>
              <Input
                id="hb-hours"
                type="number"
                min="0.1"
                step="0.5"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder={t('sell.hoursPlaceholder', { defaultValue: 'e.g. 10' })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hb-rate">{t('sell.rateLabel', { defaultValue: 'Rate per hour ({{currency}})', currency: currencyCode })}</Label>
              <Input
                id="hb-rate"
                type="number"
                min="0"
                step="0.01"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                disabled={!selectedServiceId}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hb-expiration">{t('sell.expirationLabel', { defaultValue: 'Expiration (optional)' })}</Label>
            <DatePicker
              id="hb-expiration"
              clearable
              value={expirationDate}
              onChange={setExpirationDate}
              minDate={new Date()}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t('sell.scopeLabel', { defaultValue: 'Scope — services this block covers (empty = all labor)' })}</Label>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-[rgb(var(--color-border-100))] p-2">
              {services.length === 0 ? (
                <p className="text-sm text-[rgb(var(--color-text-500))]">{t('sell.noServices', { defaultValue: 'No services available' })}</p>
              ) : (
                services.map((service) => (
                  <label key={service.service_id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-[rgb(var(--color-border-200))]"
                      checked={scopeServiceIds.has(service.service_id)}
                      onChange={() => toggleScope(service.service_id)}
                    />
                    <span className="text-[rgb(var(--color-text-900))]">{service.service_name}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hb-notes">{t('sell.notesLabel', { defaultValue: 'Notes (optional)' })}</Label>
            <TextArea id="hb-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          <div className="flex items-center justify-between rounded-md bg-[rgb(var(--color-border-100))] px-3 py-2">
            <span className="text-sm text-[rgb(var(--color-text-500))]">{t('sell.totalLabel', { defaultValue: 'Total' })}</span>
            <span className="text-base font-semibold tabular-nums text-[rgb(var(--color-text-900))]">
              {formatCurrencyFromMinorUnits(total, undefined, currencyCode)}
            </span>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" id="hb-cancel" onClick={handleClose}>{t('actions.cancel', { defaultValue: 'Cancel' })}</Button>
          <Button id="hb-sell-submit" onClick={handleSubmit} disabled={submitting}>
            {t('sell.submit', { defaultValue: 'Create draft invoice' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
