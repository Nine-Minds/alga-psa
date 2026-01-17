'use client'

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Switch } from '@alga-psa/ui/components/Switch';
import { ICreditTracking } from 'server/src/interfaces/billing.interfaces';
import { formatCurrency } from 'server/src/lib/utils/formatters';
import { toPlainDate, toISODate, formatDateOnly } from 'server/src/lib/utils/dateTimeUtils';
import { Temporal } from '@js-temporal/polyfill';

interface CreditExpirationModificationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  credit: ICreditTracking | null;
  onSave: (creditId: string, newExpirationDate: string | null) => Promise<void>;
}

const CreditExpirationModificationDialog: React.FC<CreditExpirationModificationDialogProps> = ({
  isOpen,
  onClose,
  credit,
  onSave
}) => {
  const [expirationDate, setExpirationDate] = useState<string>('');
  const [removeExpiration, setRemoveExpiration] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize form when credit changes
  React.useEffect(() => {
    if (credit && credit.expiration_date) {
      // Format date for input field (YYYY-MM-DD)
      const date = new Date(credit.expiration_date);
      const formattedDate = date.toISOString().split('T')[0];
      setExpirationDate(formattedDate);
    } else {
      setExpirationDate('');
    }
    setRemoveExpiration(false);
    setError(null);
  }, [credit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!credit) return;
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      // If removeExpiration is true, set expiration date to null
      // Otherwise, use the selected date
      const newExpirationDate = removeExpiration ? null : expirationDate;
      
      // Validate date is in the future if setting an expiration
      if (newExpirationDate) {
        const selectedDate = toPlainDate(newExpirationDate);
        const today = Temporal.Now.plainDateISO();
        
        if (Temporal.PlainDate.compare(selectedDate, today) < 0) {
          setError('Expiration date cannot be in the past');
          setIsSubmitting(false);
          return;
        }
      }
      
      await onSave(credit.credit_id, newExpirationDate);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while updating the expiration date');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!credit) return null;

  return (
    <Dialog
      isOpen={isOpen} 
      onClose={onClose} 
      title="Modify Credit Expiration">
      <DialogContent className="sm:max-w-[425px]">
        <DialogDescription>
          Update the expiration date for this credit.
        </DialogDescription>
        
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="font-medium">Credit Amount:</span>
              <span>{formatCurrency(credit.amount)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="font-medium">Remaining Amount:</span>
              <span>{formatCurrency(credit.remaining_amount)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="font-medium">Created:</span>
              <span>{new Date(credit.created_at).toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="font-medium">Current Expiration:</span>
              <span>
                {credit.expiration_date 
                  ? new Date(credit.expiration_date).toLocaleDateString()
                  : 'No expiration'}
              </span>
            </div>
          </div>
          
          <div className="space-y-4 pt-4 border-t">
            <div className="flex items-center space-x-2">
              <Switch
                id="remove-expiration-switch"
                checked={removeExpiration}
                onCheckedChange={setRemoveExpiration}
              />
              <Label htmlFor="remove-expiration-switch" className="switch-label">
                Remove expiration date
              </Label>
            </div>
            
            {!removeExpiration && (
              <div className="space-y-1">
                <Label htmlFor="expiration-date">New Expiration Date</Label>
                <Input
                  id="expiration-date"
                  type="date"
                  value={expirationDate}
                  onChange={(e) => setExpirationDate(e.target.value)}
                  disabled={removeExpiration}
                  min={new Date().toISOString().split('T')[0]} // Prevent past dates
                  className="w-full"
                />
              </div>
            )}
          </div>
          
          {error && (
            <div className="text-sm text-red-500">{error}</div>
          )}
          
          <DialogFooter>
            <Button
              id="cancel-button"
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              id="save-button"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreditExpirationModificationDialog;