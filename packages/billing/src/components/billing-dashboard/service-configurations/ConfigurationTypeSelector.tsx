'use client'

import React, { useState } from 'react';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Card } from '@alga-psa/ui/components/Card';
import { CheckCircle, Coins, Clock, BarChart3, Package } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter
} from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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

const CONFIGURATION_TYPES: ConfigurationType[] = ['Fixed', 'Hourly', 'Usage', 'Bucket'];

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
  const { t } = useTranslation('msp/service-catalog');
  const [showWarningDialog, setShowWarningDialog] = useState(false);
  const [pendingType, setPendingType] = useState<ConfigurationType | null>(null);

  const configurationTypeOptions = [
    {
      value: 'Fixed' as const,
      label: t('configType.options.Fixed.label', { defaultValue: 'Fixed Price' }),
    },
    {
      value: 'Hourly' as const,
      label: t('configType.options.Hourly.label', { defaultValue: 'Hourly Rate' }),
    },
    {
      value: 'Usage' as const,
      label: t('configType.options.Usage.label', { defaultValue: 'Usage-Based' }),
    },
    {
      value: 'Bucket' as const,
      label: t('configType.options.Bucket.label', { defaultValue: 'Bucket Hours' }),
    },
  ];

  const configurationTypeDescriptions: Record<ConfigurationType, string> = {
    Fixed: t('configType.options.Fixed.description', {
      defaultValue:
        'A fixed-price service with consistent billing regardless of usage. Ideal for predictable services.',
    }),
    Hourly: t('configType.options.Hourly.description', {
      defaultValue:
        'Time-based billing with configurable rates. Best for variable workloads billed by time spent.',
    }),
    Usage: t('configType.options.Usage.description', {
      defaultValue:
        'Usage-based billing with tiered pricing options. Perfect for services measured by consumption.',
    }),
    Bucket: t('configType.options.Bucket.description', {
      defaultValue:
        'Pre-purchased hours that can be used over time. Good for clients who need flexibility with a budget cap.',
    }),
  };

  const isConfigurationType = (value: string): value is ConfigurationType => {
    return CONFIGURATION_TYPES.includes(value as ConfigurationType);
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
          {CONFIGURATION_TYPES.map((type) => (
            <Card
              key={type}
              className={`p-4 cursor-pointer transition-all hover:shadow-md ${
                value === type
                  ? 'border-2 border-blue-500 bg-blue-50'
                  : 'border border-[rgb(var(--color-border-200))]'
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
                      {configurationTypeOptions.find(opt => opt.value === type)?.label}
                    </h3>
                    {value === type && (
                      <CheckCircle className="h-5 w-5 text-blue-500" />
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {configurationTypeDescriptions[type]}
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
          title={t('configType.warningDialog.title', {
            defaultValue: 'Change Configuration Type?',
          })}
          >
          <DialogContent>
            <DialogDescription>
              {t('configType.warningDialog.description', {
                defaultValue:
                  'Changing the configuration type will reset any type-specific settings. This action cannot be undone.',
              })}
            </DialogDescription>
            <DialogFooter>
              <Button id="cancel-type-change" variant="outline" onClick={cancelTypeChange}>
                {t('configType.warningDialog.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button id="confirm-type-change" variant="default" onClick={confirmTypeChange}>
                {t('configType.warningDialog.confirm', { defaultValue: 'Change Type' })}
              </Button>
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
        options={configurationTypeOptions.map(option => ({
          ...option,
          description: showDescriptions ? configurationTypeDescriptions[option.value as ConfigurationType] : undefined,
          icon: CONFIGURATION_TYPE_ICONS[option.value as ConfigurationType]
        }))}
        onValueChange={handleTypeChange}
        value={value}
        placeholder={t('configType.placeholder', { defaultValue: 'Select configuration type' })}
        className="w-full"
        disabled={disabled}
      />
      {showDescriptions && value && (
        <p className="text-sm text-muted-foreground mt-2">
          {configurationTypeDescriptions[value]}
        </p>
      )}

      {/* Warning Dialog */}
      <Dialog 
        isOpen={showWarningDialog} 
        onClose={() => setShowWarningDialog(false)} 
        title={t('configType.warningDialog.title', {
          defaultValue: 'Change Configuration Type?',
        })}
      >
        <DialogContent>
          <DialogDescription>
            {t('configType.warningDialog.description', {
              defaultValue:
                'Changing the configuration type will reset any type-specific settings. This action cannot be undone.',
            })}
          </DialogDescription>
          <DialogFooter>
            <Button id="cancel-type-change-dropdown" variant="outline" onClick={cancelTypeChange}>
              {t('configType.warningDialog.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button id="confirm-type-change-dropdown" variant="default" onClick={confirmTypeChange}>
              {t('configType.warningDialog.confirm', { defaultValue: 'Change Type' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
