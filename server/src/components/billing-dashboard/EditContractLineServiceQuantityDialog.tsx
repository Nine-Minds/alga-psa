import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter
} from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Label } from '../ui/Label';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';

export interface EditContractLineServiceQuantityDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  contractLineId: string;
  serviceId: string;
  serviceName: string;
  currentQuantity: number;
  onSave: (contractLineId: string, serviceId: string, newQuantity: number) => Promise<void>;
}

export function EditContractLineServiceQuantityDialog({
  isOpen,
  onOpenChange,
  contractLineId,
  serviceId,
  serviceName,
  currentQuantity,
  onSave,
}: EditContractLineServiceQuantityDialogProps) {
  const [quantity, setQuantity] = useState<string>(String(currentQuantity));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Reset state when the dialog opens or the current quantity changes
  useEffect(() => {
    if (isOpen) {
      setQuantity(String(currentQuantity));
      setError(null);
      setValidationError(null);
      setIsSaving(false);
    }
  }, [isOpen, currentQuantity]);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setQuantity(value);
    // Basic validation on change
    if (value === '') {
        setValidationError('Quantity cannot be empty.');
    } else if (!/^\d+$/.test(value) || parseInt(value, 10) <= 0) {
        setValidationError('Quantity must be a positive whole number.');
    } else {
        setValidationError(null);
    }
  };

  const validateQuantity = (value: string): number | null => {
    if (value === '') {
      setValidationError('Quantity cannot be empty.');
      return null;
    }
    const num = parseInt(value, 10);
    if (isNaN(num) || !Number.isInteger(num) || num <= 0) {
      setValidationError('Quantity must be a positive whole number.');
      return null;
    }
    setValidationError(null);
    return num;
  };

  const handleSave = async () => {
    setError(null); // Clear previous save errors
    const validatedQuantity = validateQuantity(quantity);

    if (validatedQuantity === null) {
      return; // Validation failed
    }

    // Prevent saving if the quantity hasn't changed
    if (validatedQuantity === currentQuantity) {
        onOpenChange(false); // Just close the dialog
        return;
    }

    setIsSaving(true);
    try {
      await onSave(contractLineId, serviceId, validatedQuantity);
      onOpenChange(false); // Close dialog on successful save
    } catch (err: any) {
      console.error('Error saving quantity:', err);
      setError(err.message || 'Failed to update quantity. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  // Wrapper function to match the Dialog's onClose signature
  const handleDialogClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog
      isOpen={isOpen} 
      onClose={handleDialogClose} 
      id="edit-contract-line-service-quantity-dialog" 
      className="sm:max-w-[425px]" 
      title={`Edit Quantity for ${serviceName}`}
    >
      <DialogContent>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="quantity-input" className="text-right">
              Quantity
            </Label>
            <Input
              id="quantity-input"
              type="number"
              value={quantity}
              onChange={handleInputChange}
              className={`col-span-3 ${validationError ? 'border-red-500' : ''}`}
              min="1"
              step="1"
              disabled={isSaving}
            />
          </div>
          {validationError && (
            <div className="col-span-4 text-red-600 text-sm text-right -mt-2">
              {validationError}
            </div>
          )}
          {error && (
            <div className="col-span-4 text-red-600 text-sm text-center p-2 bg-red-100 rounded">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          {/* DialogClose removed, Button onClick handles closing via onOpenChange -> onClose */}
          <Button
            id="cancel-quantity-button"
            type="button"
            variant="outline"
            onClick={handleCancel} // This calls onOpenChange(false) which is passed as onClose
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            id="save-quantity-button"
            type="button"
            onClick={handleSave}
            disabled={isSaving || !!validationError || quantity === String(currentQuantity)}
          >
            {isSaving ? (
              <>
                <LoadingIndicator spinnerProps={{ size: "sm" }} text="Saving..." className="mr-2" />
              </>
            ) : (
              'Save Quantity'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
