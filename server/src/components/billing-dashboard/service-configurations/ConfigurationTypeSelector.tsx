'use client'

import React, { useState } from 'react';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Card } from 'server/src/components/ui/Card';
import { CheckCircle, Coins, Clock, BarChart3, Package } from 'lucide-react';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter
} from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';

export type ConfigurationType = 'Fixed' | 'Hourly' | 'Usage' | 'Bucket';

interface ConfigurationTypeSelectorProps {
  value: ConfigurationType;
  onChange: (value: ConfigurationType) => void;
  className?: string;
  disabled?: boolean;
  showDescriptions?: boolean;
  showCards?: boolean;
  showWarningOnChange?: boolean;
}

const CONFIGURATION_TYPE_OPTIONS = [
  { value: 'Fixed', label: 'Fixed Price' },
  { value: 'Hourly', label: 'Hourly Rate' },
  { value: 'Usage', label: 'Usage-Based' },
  { value: 'Bucket', label: 'Bucket Hours' }
];

const CONFIGURATION_TYPE_DESCRIPTIONS: Record<ConfigurationType, string> = {
  'Fixed': 'A fixed-price service with consistent billing regardless of usage. Ideal for predictable services.',
  'Hourly': 'Time-based billing with configurable rates. Best for variable workloads billed by time spent.',
  'Usage': 'Usage-based billing with tiered pricing options. Perfect for services measured by consumption.',
  'Bucket': 'Pre-purchased hours that can be used over time. Good for clients who need flexibility with a budget cap.'
};

const CONFIGURATION_TYPE_ICONS: Record<ConfigurationType, React.ReactNode> = {
  'Fixed': <Coins className="h-6 w-6 text-green-500" />,
  'Hourly': <Clock className="h-6 w-6 text-purple-500" />,
  'Usage': <BarChart3 className="h-6 w-6 text-orange-500" />,
  'Bucket': <Package className="h-6 w-6 text-blue-500" />
};

export function ConfigurationTypeSelector({
  value,
  onChange,
  className = '',
  disabled = false,
  showDescriptions = false,
  showCards = false,
  showWarningOnChange = false
}: ConfigurationTypeSelectorProps) {
  const [showWarningDialog, setShowWarningDialog] = useState(false);
  const [pendingType, setPendingType] = useState<ConfigurationType | null>(null);

  const isConfigurationType = (value: string): value is ConfigurationType => {
    return ['Fixed', 'Hourly', 'Usage', 'Bucket'].includes(value);
  };

  const handleTypeChange = (newValue: string) => {
    if (isConfigurationType(newValue)) {
      if (showWarningOnChange && newValue !== value) {
        setPendingType(newValue);
        setShowWarningDialog(true);
      } else {
        onChange(newValue);
      }
    }
  };

  const confirmTypeChange = () => {
    if (pendingType) {
      onChange(pendingType);
      setPendingType(null);
    }
    setShowWarningDialog(false);
  };

  const cancelTypeChange = () => {
    setPendingType(null);
    setShowWarningDialog(false);
  };

  // If using cards, render the card-based selector
  if (showCards) {
    return (
      <div className={className}>
        <div className="grid grid-cols-2 gap-3 mb-4">
          {(Object.keys(CONFIGURATION_TYPE_DESCRIPTIONS) as ConfigurationType[]).map((type) => (
            <Card
              key={type}
              className={`p-4 cursor-pointer transition-all hover:shadow-md ${
                value === type
                  ? 'border-2 border-blue-500 bg-blue-50'
                  : 'border border-gray-200'
              }`}
              onClick={() => !disabled && handleTypeChange(type)}
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  {CONFIGURATION_TYPE_ICONS[type]}
                </div>
                <div className="flex-grow">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">
                      {CONFIGURATION_TYPE_OPTIONS.find(opt => opt.value === type)?.label}
                    </h3>
                    {value === type && (
                      <CheckCircle className="h-5 w-5 text-blue-500" />
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    {CONFIGURATION_TYPE_DESCRIPTIONS[type]}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Warning Dialog */}
        <Dialog 
          isOpen={showWarningDialog} 
          onClose={() => setShowWarningDialog(false)} 
          title="Change Configuration Type?"
          >
          <DialogContent>
            <DialogDescription>
              Changing the configuration type will reset any type-specific settings. This action cannot be undone.
            </DialogDescription>
            <DialogFooter>
              <Button id="cancel-type-change" variant="outline" onClick={cancelTypeChange}>Cancel</Button>
              <Button id="confirm-type-change" variant="default" onClick={confirmTypeChange}>Change Type</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Otherwise, render the dropdown selector
  return (
    <div className={className}>
      <CustomSelect
        id="configuration-type-selector"
        options={CONFIGURATION_TYPE_OPTIONS.map(option => ({
          ...option,
          description: showDescriptions ? CONFIGURATION_TYPE_DESCRIPTIONS[option.value as ConfigurationType] : undefined,
          icon: CONFIGURATION_TYPE_ICONS[option.value as ConfigurationType]
        }))}
        onValueChange={handleTypeChange}
        value={value}
        placeholder="Select configuration type"
        className="w-full"
        disabled={disabled}
      />
      {showDescriptions && value && (
        <p className="text-sm text-gray-500 mt-2">
          {CONFIGURATION_TYPE_DESCRIPTIONS[value]}
        </p>
      )}

      {/* Warning Dialog */}
      <Dialog 
        isOpen={showWarningDialog} 
        onClose={() => setShowWarningDialog(false)} 
        title="Change Configuration Type?"
      >
        <DialogContent>
          <DialogDescription>
            Changing the configuration type will reset any type-specific settings. This action cannot be undone.
          </DialogDescription>
          <DialogFooter>
            <Button id="cancel-type-change-dropdown" variant="outline" onClick={cancelTypeChange}>Cancel</Button>
            <Button id="confirm-type-change-dropdown" variant="default" onClick={confirmTypeChange}>Change Type</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}