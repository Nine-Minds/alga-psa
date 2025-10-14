'use client';

import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';

interface EditPlanServiceQuantityDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  planId: string;
  serviceId: string;
  serviceName: string;
  currentQuantity: number;
  onSave: (quantity: number) => Promise<void> | void;
}

export const EditPlanServiceQuantityDialog: React.FC<EditPlanServiceQuantityDialogProps> = ({
  isOpen,
  onOpenChange,
  serviceName,
  currentQuantity,
  onSave
}) => {
  const [quantity, setQuantity] = useState<number>(currentQuantity);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuantity(currentQuantity);
      setError(null);
    }
  }, [isOpen, currentQuantity]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (Number.isNaN(quantity) || quantity <= 0) {
      setError('Quantity must be greater than zero');
      return;
    }

    try {
      setSaving(true);
      await onSave(quantity);
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
