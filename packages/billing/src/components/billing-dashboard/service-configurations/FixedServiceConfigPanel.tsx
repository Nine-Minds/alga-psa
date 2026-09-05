'use client'

import React, { useState, useEffect } from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { Switch } from '@alga-psa/ui/components/Switch';
import { RadioGroup } from '@alga-psa/ui/components/RadioGroup';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { IContractLineServiceFixedConfig } from '@alga-psa/types';
import { IContractLineFixedConfig } from '@alga-psa/types';
import type { FixedPricingBasis } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useCurrencyFormat } from '@alga-psa/ui/lib';

interface FixedServiceConfigPanelProps {
  configuration: Partial<IContractLineServiceFixedConfig>;
  planFixedConfig: Partial<IContractLineFixedConfig>;
  /** Configured allocation/seat count from the base service configuration. */
  quantity?: number | null;
  onConfigurationChange: (updates: Partial<IContractLineServiceFixedConfig>) => void;
  onPlanFixedConfigChange: (updates: Partial<IContractLineFixedConfig>) => void;
  currencyCode?: string;
  idPrefix?: string;
  className?: string;
  disabled?: boolean;
}

export function FixedServiceConfigPanel(props: FixedServiceConfigPanelProps) {
  const {
    configuration,
    planFixedConfig,
    quantity,
    onConfigurationChange,
    onPlanFixedConfigChange,
    currencyCode,
    idPrefix = '',
    className = '',
    disabled = false,
  } = props;
  const { t } = useTranslation('msp/service-catalog');
  const { money } = useCurrencyFormat();
  const [enableProration, setEnableProration] = useState(planFixedConfig.enable_proration || false);
  const [billingCycleAlignment, setBillingCycleAlignment] = useState<string>(
    planFixedConfig.billing_cycle_alignment || 'start'
  );
  // A NULL pricing basis is the legacy bundle contract: the line total is
  // authoritative and member quantities are FMV allocations. Only an explicit
  // author choice opts a member into recurring seat pricing.
  const [pricingBasis, setPricingBasis] = useState<FixedPricingBasis>(
    configuration.pricing_basis === 'unit' ? 'unit' : 'bundle'
  );
  const [unitRateInput, setUnitRateInput] = useState<string>(
    configuration.base_rate == null ? '' : (Number(configuration.base_rate) / 100).toFixed(2)
  );

  // Update local state when props change
  useEffect(() => {
    setEnableProration(planFixedConfig.enable_proration || false);
    setBillingCycleAlignment(planFixedConfig.billing_cycle_alignment || 'start');
  }, [planFixedConfig]);

  useEffect(() => {
    setPricingBasis(configuration.pricing_basis === 'unit' ? 'unit' : 'bundle');
    setUnitRateInput(current => {
      const cents = configuration.base_rate == null ? null : Number(configuration.base_rate);
      if (cents === null) return current === '.' ? current : '';
      // Keep the text being typed when it already represents the saved cents.
      // Formatting every keystroke would turn "1" into "1.00" mid-entry.
      return Math.round(Number.parseFloat(current) * 100) === cents
        ? current : (cents / 100).toFixed(2);
    });
  }, [configuration.pricing_basis, configuration.base_rate]);

  const handleEnableProrateChange = (checked: boolean) => {
    setEnableProration(checked);
    onPlanFixedConfigChange({ enable_proration: checked });
  };

  const handleBillingCycleAlignmentChange = (value: string) => {
    setBillingCycleAlignment(value);
    onPlanFixedConfigChange({ billing_cycle_alignment: value as 'start' | 'end' | 'prorated' });
  };

  const handlePricingBasisChange = (value: string) => {
    const basis: FixedPricingBasis = value === 'unit' ? 'unit' : 'bundle';
    setPricingBasis(basis);
    onConfigurationChange({ pricing_basis: basis });
  };

  const handleUnitRateChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = event.target.value.replace(/[^0-9.]/g, '');
    if ((sanitized.match(/\./g) || []).length > 1) {
      return;
    }
    setUnitRateInput(sanitized);
    const trimmed = sanitized.trim();
    if (!trimmed || trimmed === '.') {
      onConfigurationChange({ base_rate: null });
      return;
    }
    const parsed = parseFloat(trimmed);
    onConfigurationChange({ base_rate: Number.isFinite(parsed) ? Math.round(parsed * 100) : null });
  };

  const alignmentOptions = [
    {
      value: 'start',
      label: t('fixedConfig.options.start', { defaultValue: 'Start of Billing Cycle' }),
    },
    {
      value: 'end',
      label: t('fixedConfig.options.end', { defaultValue: 'End of Billing Cycle' }),
    },
    {
      value: 'prorated',
      label: t('fixedConfig.options.prorated', { defaultValue: 'Proportional Coverage' }),
    }
  ];

  const seatQuantity = quantity == null ? 0 : Number(quantity);
  const unitRateCents = configuration.base_rate == null ? null : Number(configuration.base_rate);

  return (
    <Card className={`p-4 ${className}`}>
      <div className="space-y-4">
        <h3 className="text-md font-medium">
          {t('fixedConfig.title', { defaultValue: 'Fixed Price Configuration' })}
        </h3>

        {/* Pricing basis is the operator's billing intent: one bundle total
            split across allocations, or a standing quantity billed at a unit
            rate every period. The copy names the quantity source explicitly so
            an allocation is never read as a billable seat count. */}
        <div data-testid="fixed-pricing-basis">
          <Label>
            {t('fixedConfig.pricingBasis.label', { defaultValue: 'How does this service price?' })}
          </Label>
          <RadioGroup
            id={`${idPrefix}fixed-pricing-basis`}
            name={`${idPrefix}fixed-pricing-basis`}
            value={pricingBasis}
            onChange={handlePricingBasisChange}
            disabled={disabled}
            options={[
              {
                value: 'bundle',
                label: t('fixedConfig.pricingBasis.bundle.label', { defaultValue: 'Bundle price' }),
                description: t('fixedConfig.pricingBasis.bundle.description', {
                  defaultValue:
                    "The contract line's fixed total is what bills. Quantities on this service only allocate a share of that total for reporting — they are not billable seats, and changing one does not change the amount billed.",
                }),
              },
              {
                value: 'unit',
                label: t('fixedConfig.pricingBasis.unit.label', {
                  defaultValue: 'Recurring seats/units',
                }),
                description: t('fixedConfig.pricingBasis.unit.description', {
                  defaultValue:
                    'Bills quantity × unit rate every period, with no line total taking precedence. The same quantity and rate bill again next period until you schedule a change. A quantity of zero bills zero.',
                }),
              },
            ]}
          />
        </div>

        {pricingBasis === 'unit' && (
          <div className="pl-6 border-l-2 border-[rgb(var(--color-border-200))] space-y-2">
            <Label htmlFor={`${idPrefix}fixed-service-unit-rate`}>
              {t('fixedConfig.fields.unitRate.label', { defaultValue: 'Unit rate' })}
            </Label>
            <Input
              id={`${idPrefix}fixed-service-unit-rate`}
              type="text"
              inputMode="decimal"
              value={unitRateInput}
              onChange={handleUnitRateChange}
              placeholder={t('fixedConfig.fields.unitRate.placeholder', { defaultValue: '0.00' })}
              disabled={disabled}
            />
            <p className="text-sm text-muted-foreground" data-testid="fixed-unit-pricing-summary">
              {unitRateCents == null
                ? t('fixedConfig.fields.unitRate.help', {
                    defaultValue: 'Rate billed for each seat/unit in every service period.',
                  })
                : t('fixedConfig.pricingBasis.unit.summary', {
                    defaultValue: '{{quantity}} × {{rate}} (recurring seats) = {{total}} per period',
                    quantity: seatQuantity,
                    rate: money(unitRateCents, currencyCode),
                    total: money(Math.ceil(seatQuantity * Math.ceil(unitRateCents)), currencyCode),
                  })}
            </p>
          </div>
        )}

        {pricingBasis === 'bundle' && (
          <p className="text-sm text-muted-foreground" data-testid="fixed-bundle-allocation-note">
            {t('fixedConfig.pricingBasis.bundle.allocationNote', {
              defaultValue:
                'Allocation quantity: {{quantity}} — used to split the bundle total for reporting, not billed as seats.',
              quantity: seatQuantity,
            })}
          </p>
        )}

        <div className="flex items-center space-x-2 pt-2">
          <Switch
            id={`${idPrefix}fixed-service-enable-proration`}
            checked={enableProration}
            onCheckedChange={handleEnableProrateChange}
            disabled={disabled}
          />
          <Label htmlFor={`${idPrefix}fixed-service-enable-proration`} className="cursor-pointer">
            {t('fixedConfig.fields.adjustForPartialPeriods', {
              defaultValue: 'Adjust for Partial Periods',
            })}
          </Label>
        </div>

        {enableProration && (
          <div className="pl-6 border-l-2 border-[rgb(var(--color-border-200))]">
            <Label htmlFor={`${idPrefix}fixed-service-billing-cycle-alignment`}>
              {t('fixedConfig.fields.billingCycleAlignment.label', {
                defaultValue: 'Billing Cycle Alignment',
              })}
            </Label>
            <CustomSelect
              id={`${idPrefix}fixed-service-billing-cycle-alignment`}
              options={alignmentOptions}
              onValueChange={handleBillingCycleAlignmentChange}
              value={billingCycleAlignment}
              placeholder={t('fixedConfig.fields.billingCycleAlignment.placeholder', {
                defaultValue: 'Select alignment',
              })}
              className="w-full"
              disabled={disabled}
            />
            <p className="text-sm text-muted-foreground mt-1">
              {t('fixedConfig.fields.billingCycleAlignment.help', {
                defaultValue:
                  'Controls how partial-period coverage is calculated when the recurring fee needs to scale to less than a full service period.',
              })}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
