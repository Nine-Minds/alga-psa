'use client';

import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';

interface EditPlanServiceQuantityDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  planId: string;
  serviceId: string;
  serviceName: string;
  currentQuantity: number;
  /** When provided, allows editing a per-unit rate override (in cents). */
  currencySymbol?: string;
  currentUnitRateCents?: number | null;
  onSave: (updates: { quantity: number; unitRateCents?: number | null }) => Promise<void> | void;
}

export const EditPlanServiceQuantityDialog: React.FC<EditPlanServiceQuantityDialogProps> = ({
  isOpen,
  onOpenChange,
  serviceName,
  currentQuantity,
  currencySymbol,
  currentUnitRateCents,
  onSave
}) => {
  const [quantity, setQuantity] = useState<number>(currentQuantity);
  const [rateInput, setRateInput] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuantity(currentQuantity);
      setRateInput(
        currentUnitRateCents !== undefined && currentUnitRateCents !== null
          ? (Number(currentUnitRateCents) / 100).toFixed(2)
          : ''
      );
      setError(null);
    }
  }, [isOpen, currentQuantity, currentUnitRateCents]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (Number.isNaN(quantity) || quantity <= 0) {
      setError('Quantity must be greater than zero');
      return;
    }

    try {
      setSaving(true);
      let unitRateCents: number | null | undefined = undefined;
      if (currentUnitRateCents !== undefined) {
        const trimmed = rateInput.trim();
        if (!trimmed || trimmed === '.') {
          unitRateCents = null;
        } else {
          const parsed = parseFloat(trimmed);
          unitRateCents = Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
        }
      }

      await onSave({ quantity, unitRateCents });
      onOpenChange(false);
    } catch (err: any) {
      console.error('Failed to update quantity', err);
      setError(err?.message ?? 'Failed to update quantity');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog isOpen={isOpen} onClose={() => onOpenChange(false)} title="Edit Service Quantity">
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle>Adjust Quantity</DialogTitle>
        </DialogHeader>
        <DialogContent className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground">{serviceName}</p>
            <label className="block text-sm font-medium mt-3" htmlFor="service-quantity-input">
              Quantity
            </label>
            <Input
              id="service-quantity-input"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 0)}
            />

            {currentUnitRateCents !== undefined && (
              <>
                <label className="block text-sm font-medium mt-4" htmlFor="service-rate-input">
                  Unit price override (optional)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                    {currencySymbol ?? '$'}
                  </span>
                  <Input
                    id="service-rate-input"
                    type="text"
                    inputMode="decimal"
                    value={rateInput}
                    onChange={(e) => {
                      const sanitized = e.target.value.replace(/[^0-9.]/g, '');
                      const decimalCount = (sanitized.match(/\./g) || []).length;
                      if (decimalCount <= 1) {
                        setRateInput(sanitized);
                      }
                    }}
                    placeholder=""
                    className="pl-10"
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Leave blank to use the product catalog price for this contract&apos;s currency.
                </p>
              </>
            )}

            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </div>
        </DialogContent>
        <DialogFooter>
          <Button
            id="edit-plan-service-quantity-cancel"
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            id="edit-plan-service-quantity-save"
            type="submit"
            disabled={saving}
          >
            Save
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
};

export default EditPlanServiceQuantityDialog;
