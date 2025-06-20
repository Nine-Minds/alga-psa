'use client'

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';

interface BundlePlanRateDialogProps {
  plan: {
    plan_id: string;
    plan_name: string;
    custom_rate?: number;
    default_rate?: number;
  };
  onClose: () => void;
  onSave: (customRate: number | undefined) => void; // Allow undefined
}

export function BundlePlanRateDialog({ plan, onClose, onSave }: BundlePlanRateDialogProps) {
  const [customRate, setCustomRate] = useState<number>(
    plan.custom_rate !== undefined && plan.custom_rate !== null ? plan.custom_rate : (plan.default_rate || 0) // Use default if null or undefined
  );
  // Check for both null and undefined to determine if default rate is being used
  const [useDefaultRate, setUseDefaultRate] = useState<boolean>(plan.custom_rate === undefined || plan.custom_rate === null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!useDefaultRate && (customRate < 0 || isNaN(customRate))) {
      setError('Please enter a valid rate (must be a non-negative number)');
      return;
    }
    
    // If using default rate, pass undefined to reset to default (will be saved as NULL)
    // Otherwise pass the custom rate
    onSave(useDefaultRate ? undefined : customRate);
  };

  return (
    <Dialog
      isOpen={true}
      onClose={onClose}
      title={`Set Custom Rate for ${plan.plan_name}`}
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
                label={`Use default rate${plan.default_rate !== undefined ? ` ($${plan.default_rate.toFixed(2)})` : ''}`}
                checked={useDefaultRate}
                onCheckedChange={(checked) => {
                  setUseDefaultRate(checked);
                  if (checked) {
                    setCustomRate(plan.default_rate || 0);
                  }
                }}
              />
            </div>
            
            <div>
              <Label htmlFor="custom-rate">Custom Rate</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2">$</span>
                <Input
                  id="custom-rate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={customRate}
                  onChange={(e) => setCustomRate(parseFloat(e.target.value))}
                  disabled={useDefaultRate}
                  className="pl-7"
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