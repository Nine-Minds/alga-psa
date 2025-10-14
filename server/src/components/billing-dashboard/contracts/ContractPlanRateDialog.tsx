'use client'

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';

interface ContractLineRateDialogProps {
  contractLine: {
    contract_line_id: string;
    contract_line_name: string;
    custom_rate?: number;
    default_rate?: number;
  };
  onClose: () => void;
  onSave: (contractLineId: string, customRate: number | undefined) => void;
}

export function ContractLineRateDialog({ contractLine, onClose, onSave }: ContractLineRateDialogProps) {
  const [customRate, setCustomRate] = useState<number>(
    contractLine.custom_rate !== undefined && contractLine.custom_rate !== null ? contractLine.custom_rate : (contractLine.default_rate || 0)
  );
  const [useDefaultRate, setUseDefaultRate] = useState<boolean>(contractLine.custom_rate === undefined || contractLine.custom_rate === null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!useDefaultRate && (customRate < 0 || isNaN(customRate))) {
      setError('Please enter a valid rate (must be a non-negative number)');
      return;
    }

    // If using default rate, pass undefined to reset to default (will be saved as NULL)
    // Otherwise pass the custom rate
    onSave(contractLine.contract_line_id, useDefaultRate ? undefined : customRate);
  };

  return (
    <Dialog
      isOpen={true}
      onClose={onClose}
      title={`Set Custom Rate for ${contractLine.contract_line_name}`}
      className="max-w-md"
    >
      <DialogContent>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            
            <div className="flex items-center space-x-2 mb-4">
              <SwitchWithLabel
                label={`Use default rate${contractLine.default_rate !== undefined ? ` ($${contractLine.default_rate.toFixed(2)})` : ''}`}
                checked={useDefaultRate}
                onCheckedChange={(checked) => {
                  setUseDefaultRate(checked);
                  if (checked) {
                    setCustomRate(contractLine.default_rate || 0);
                  }
                }}
              />
            </div>
            
            <div>
              <Label htmlFor="custom-rate" className={useDefaultRate ? 'text-gray-400' : ''}>Custom Rate</Label>
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
            
            <DialogFooter>
              <Button
                id="cancel-rate-btn"
                type="button"
                variant="secondary"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                id="save-rate-btn"
                type="submit"
              >
                Save Rate
              </Button>
            </DialogFooter>
          </form>
      </DialogContent>
    </Dialog>
  );
}
