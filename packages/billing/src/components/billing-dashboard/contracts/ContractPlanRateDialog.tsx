'use client'

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle } from 'lucide-react';

interface ContractLineRateDialogProps {
  contractLine: {
    contract_line_id: string;
    contract_line_name: string;
    rate?: number | null;
    custom_rate?: number | null;
  };
  onClose: () => void;
  onSave: (contractLineId: string, rate: number) => void;
}

export function ContractLineRateDialog({ contractLine, onClose, onSave }: ContractLineRateDialogProps) {
  const [rate, setRate] = useState<number>(
    contractLine.rate !== undefined && contractLine.rate !== null ? contractLine.rate : 0
  );
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (isNaN(rate) || rate < 0) {
      setError('Please enter a valid rate (must be a non-negative number)');
      return;
    }

    onSave(contractLine.contract_line_id, rate);
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
            
            <div>
              <Label htmlFor="custom-rate">Rate</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                <Input
                  id="custom-rate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={rate}
                  onChange={(e) => {
                    const parsed = parseFloat(e.target.value);
                    setRate(Number.isNaN(parsed) ? 0 : parsed);
                  }}
                  className="pl-10 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
