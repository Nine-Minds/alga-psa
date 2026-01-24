'use client'

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle } from 'lucide-react';

interface ContractLineEditDialogProps {
  line: {
    contract_line_id: string;
    contract_line_name?: string;
    rate?: number | null;
    custom_rate?: number | null;
    billing_timing?: 'arrears' | 'advance';
  };
  onClose: () => void;
  onSave: (contractLineId: string, rate: number, billingTiming: 'arrears' | 'advance') => Promise<void>;
}

export function ContractLineEditDialog({ line, onClose, onSave }: ContractLineEditDialogProps) {
  const [rate, setRate] = useState<number>(
    line.rate !== undefined && line.rate !== null
      ? line.rate
      : line.custom_rate !== undefined && line.custom_rate !== null
        ? line.custom_rate
        : 0
  );
  const [billingTiming, setBillingTiming] = useState<'arrears' | 'advance'>(
    line.billing_timing || 'arrears'
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isNaN(rate) || rate < 0) {
      setError('Please enter a valid rate (must be a non-negative number)');
      return;
    }

    setIsSaving(true);
    try {
      await onSave(line.contract_line_id, rate, billingTiming);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      isOpen={true}
      onClose={onClose}
      title={`Edit Contract Line: ${line.contract_line_name}`}
      className="max-w-md"
    >
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Custom Rate Section */}
          <div className="space-y-4">
            <h4 className="font-medium text-sm">Pricing</h4>

            <div>
              <Label htmlFor="contract-line-rate">Rate</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                <Input
                  id="contract-line-rate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={rate}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value);
                    setRate(Number.isNaN(value) ? 0 : value);
                  }}
                  className="pl-10 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>
          </div>

          {/* Billing Timing Section */}
          <div className="space-y-4 border-t pt-4">
            <h4 className="font-medium text-sm">Billing Timing</h4>

            <div>
              <Label htmlFor="billing-timing">When should this line be billed?</Label>
              <CustomSelect
                value={billingTiming}
                onValueChange={(value) => setBillingTiming(value as 'arrears' | 'advance')}
                options={[
                  {
                    label: 'In Arrears (at end of billing period)',
                    value: 'arrears'
                  },
                  {
                    label: 'In Advance (at start of billing period)',
                    value: 'advance'
                  }
                ]}
              />
              <p className="text-xs text-gray-500 mt-2">
                {billingTiming === 'arrears'
                  ? 'Charges will be billed after the service is provided'
                  : 'Charges will be billed before the service is provided'}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              id="cancel-edit-line-btn"
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              id="save-edit-line-btn"
              type="submit"
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
