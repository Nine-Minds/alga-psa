'use client'

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';

interface ContractLineEditDialogProps {
  line: {
    contract_line_id: string;
    contract_line_name: string;
    custom_rate?: number;
    default_rate?: number;
    billing_timing?: 'arrears' | 'advance';
  };
  onClose: () => void;
  onSave: (contractLineId: string, customRate: number | undefined, billingTiming: 'arrears' | 'advance') => void;
}

export function ContractLineEditDialog({ line, onClose, onSave }: ContractLineEditDialogProps) {
  const [customRate, setCustomRate] = useState<number>(
    line.custom_rate !== undefined && line.custom_rate !== null ? line.custom_rate : (line.default_rate || 0)
  );
  const [useDefaultRate, setUseDefaultRate] = useState<boolean>(
    line.custom_rate === undefined || line.custom_rate === null
  );
  const [billingTiming, setBillingTiming] = useState<'arrears' | 'advance'>(
    line.billing_timing || 'arrears'
  );
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!useDefaultRate && (customRate < 0 || isNaN(customRate))) {
      setError('Please enter a valid rate (must be a non-negative number)');
      return;
    }

    // If using default rate, pass undefined to reset to default (will be saved as NULL)
    // Otherwise pass the custom rate
    onSave(line.contract_line_id, useDefaultRate ? undefined : customRate, billingTiming);
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

            <div className="flex items-center space-x-2 mb-4">
              <SwitchWithLabel
                label={`Use default rate${line.default_rate !== undefined ? ` ($${line.default_rate.toFixed(2)})` : ''}`}
                checked={useDefaultRate}
                onCheckedChange={(checked) => {
                  setUseDefaultRate(checked);
                  if (checked) {
                    setCustomRate(line.default_rate || 0);
                  }
                }}
              />
            </div>

            <div>
              <Label htmlFor="custom-rate" className={useDefaultRate ? 'text-gray-400' : ''}>
                Custom Rate
              </Label>
              <div className="relative">
                <span className={`absolute left-3 top-1/2 transform -translate-y-1/2 ${useDefaultRate ? 'text-gray-400' : 'text-gray-500'}`}>$</span>
                <Input
                  id="custom-rate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={customRate}
                  onChange={(e) => {
                    setCustomRate(parseFloat(e.target.value));
                    if (useDefaultRate) {
                      setUseDefaultRate(false);
                    }
                  }}
                  onFocus={() => {
                    if (useDefaultRate) {
                      setUseDefaultRate(false);
                    }
                  }}
                  disabled={useDefaultRate}
                  className={`pl-7 ${useDefaultRate ? 'bg-gray-100 text-gray-400 cursor-not-allowed opacity-60' : ''} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
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
            >
              Cancel
            </Button>
            <Button
              id="save-edit-line-btn"
              type="submit"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
