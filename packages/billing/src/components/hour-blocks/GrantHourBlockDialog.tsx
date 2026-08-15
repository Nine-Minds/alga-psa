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
import type { IService } from '@alga-psa/types';
import { grantHourBlock } from '@alga-psa/billing/actions/hourBlockActions';
import { getServices } from '@alga-psa/billing/actions/serviceActions';

interface GrantHourBlockDialogProps {
  clientId: string;
  currencyCode: string;
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function GrantHourBlockDialog({ clientId, currencyCode, isOpen, onClose, onCreated }: GrantHourBlockDialogProps) {
  const { t } = useTranslation('msp/hour-blocks');

  const [services, setServices] = useState<IService[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [hours, setHours] = useState<string>('');
  const [rate, setRate] = useState<string>('');
  const [expirationDate, setExpirationDate] = useState<Date | undefined>(undefined);
  const [scopeServiceIds, setScopeServiceIds] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
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

  const serviceOptions = useMemo(
    () => services.map((service) => ({ value: service.service_id, label: service.service_name })),
    [services],
  );

  const selectedService = useMemo(
    () => services.find((service) => service.service_id === selectedServiceId),
    [services, selectedServiceId],
  );

  useEffect(() => {
    if (selectedService) {
      setRate(String((selectedService.default_rate ?? 0) / 100));
    }
  }, [selectedService?.service_id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setHours('');
    setRate('');
    setExpirationDate(undefined);
    setScopeServiceIds(new Set());
    setReason('');
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
    const hoursNumber = Number(hours);
    if (!Number.isFinite(hoursNumber) || hoursNumber <= 0) {
      setError(t('sell.hoursRequired', { defaultValue: 'Enter the number of hours.' }));
      return;
    }
    if (!reason.trim()) {
      setError(t('grant.reasonRequired', { defaultValue: 'A reason is required.' }));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await grantHourBlock({
        clientId,
        serviceId: selectedServiceId,
        hours: hoursNumber,
        hourlyRate: Number(rate) > 0 ? Math.round(Number(rate) * 100) : undefined,
        expirationDate: expirationDate ? expirationDate.toISOString() : null,
        scopeServiceIds: Array.from(scopeServiceIds),
        reason: reason.trim(),
      });

      if (isActionMessageError(result) || isActionPermissionError(result)) {
        setError(getErrorMessage(result));
        return;
      }

      toast.success(t('grant.granted', { defaultValue: 'Hour block granted.' }));
      reset();
      onCreated();
      onClose();
    } catch (err) {
      console.error('Failed to grant hour block:', err);
      setError(t('grant.error', { defaultValue: 'Could not grant the hour block.' }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog isOpen={isOpen} onClose={handleClose} title={t('grant.title', { defaultValue: 'Grant hour block' })} id="grant-hour-block-dialog" data-automation-id="grant-hour-block-dialog">
      <DialogContent>
        <div className="space-y-4">
          {servicesLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="hb-grant-service">{t('sell.serviceLabel', { defaultValue: 'Service' })}</Label>
              <CustomSelect
                id="hb-grant-service"
                options={serviceOptions}
                value={selectedServiceId || null}
                onValueChange={setSelectedServiceId}
                placeholder={t('sell.servicePlaceholder', { defaultValue: 'Select a service' })}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="hb-grant-hours">{t('sell.hoursLabel', { defaultValue: 'Hours' })}</Label>
              <Input
                id="hb-grant-hours"
                type="number"
                min="0.1"
                step="0.5"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder={t('sell.hoursPlaceholder', { defaultValue: 'e.g. 10' })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hb-grant-rate">{t('sell.rateLabel', { defaultValue: 'Rate per hour ({{currency}})', currency: currencyCode })}</Label>
              <Input
                id="hb-grant-rate"
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
            <Label htmlFor="hb-grant-expiration">{t('sell.expirationLabel', { defaultValue: 'Expiration (optional)' })}</Label>
            <DatePicker
              id="hb-grant-expiration"
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
            <Label htmlFor="hb-grant-reason">{t('grant.reasonLabel', { defaultValue: 'Reason' })}</Label>
            <TextArea id="hb-grant-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder={t('grant.reasonPlaceholder', { defaultValue: 'Why are these hours being granted?' })} />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" id="hb-cancel" onClick={handleClose}>{t('actions.cancel', { defaultValue: 'Cancel' })}</Button>
          <Button id="hb-grant-submit" onClick={handleSubmit} disabled={submitting}>
            {t('grant.submit', { defaultValue: 'Grant block' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
