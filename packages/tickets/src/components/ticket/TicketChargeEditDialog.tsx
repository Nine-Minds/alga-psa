'use client';

import React, { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { getErrorMessage, handleError, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function TicketChargeEditDialog({
  id, quantity, description, onClose, onSave,
}: {
  id: string;
  quantity: number;
  description: string | null | undefined;
  onClose: () => void;
  onSave: (input: { quantity: number; description: string }) => Promise<unknown>;
}) {
  const { t } = useTranslation('features/tickets');
  const [value, setValue] = useState(String(quantity));
  const [text, setText] = useState(description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 2147483647;
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await onSave({ quantity: Number(value), description: text });
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      onClose();
    } catch (cause) {
      handleError(cause, t('chargeEdit.errors.save'));
      setError(t('chargeEdit.errors.save'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog id={id} isOpen onClose={() => { if (!saving) onClose(); }} title={t('chargeEdit.title')} className="max-w-md"
      footer={<div className="flex justify-end gap-2">
        <Button id={`${id}-cancel-button`} variant="outline" disabled={saving} onClick={onClose}>{t('actions.cancel')}</Button>
        <Button id={`${id}-save-button`} type="button" disabled={saving || !valid}
          onClick={() => {
            const form = document.getElementById(`${id}-form`);
            if (form instanceof HTMLFormElement) form.requestSubmit();
          }}>{t('chargeEdit.save')}</Button>
      </div>}>
      <DialogContent>
        <form id={`${id}-form`} onSubmit={(event) => void save(event)} className="mt-2 space-y-3">
          <Label htmlFor={`${id}-quantity-input`}>{t('fixedFeeServices.quantity')}</Label>
          <div className="flex items-center gap-2">
            <Button id={`${id}-decrease-button`} type="button" variant="outline" disabled={saving || !valid || Number(value) <= 1}
              aria-label={t('fixedFeeServices.decreaseQuantity')} onClick={() => setValue(String(Number(value) - 1))}><Minus className="h-4 w-4" /></Button>
            <Input id={`${id}-quantity-input`} type="number" min={1} max={2147483647} step={1} required value={value}
              disabled={saving} onChange={(event) => setValue(event.target.value)} />
            <Button id={`${id}-increase-button`} type="button" variant="outline" disabled={saving || !valid || Number(value) >= 2147483647}
              aria-label={t('fixedFeeServices.increaseQuantity')} onClick={() => setValue(String(Number(value) + 1))}><Plus className="h-4 w-4" /></Button>
          </div>
          <Label htmlFor={`${id}-description-input`}>{t('fixedFeeServices.description')}</Label>
          <Input id={`${id}-description-input`} value={text} maxLength={2000} disabled={saving} onChange={(event) => setText(event.target.value)} />
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </form>
      </DialogContent>
    </Dialog>
  );
}
