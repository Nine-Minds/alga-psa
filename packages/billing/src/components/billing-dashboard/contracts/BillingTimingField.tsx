'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { isAdvanceTimingAllowedForLineType } from '@shared/billingClients/contractLineTimingRule';

export type BillingTimingValue = 'arrears' | 'advance';

interface BillingTimingFieldProps {
  /** Contract line type (Fixed, Hourly, Usage, ...). Unknown or missing is treated as Fixed. */
  lineType: string | null | undefined;
  value: BillingTimingValue | null | undefined;
  onChange: (value: BillingTimingValue) => void;
  id?: string;
  className?: string;
  /** Hide the explanatory help line (used where the caller renders its own). */
  hideHelp?: boolean;
}

/**
 * Billing timing control. Fixed lines choose between arrears and advance.
 * Hourly and usage lines always bill in arrears, so they get read-only text and
 * can never emit an advance value.
 */
export function BillingTimingField({
  lineType,
  value,
  onChange,
  id = 'billing-timing',
  className,
  hideHelp = false,
}: BillingTimingFieldProps) {
  const { t } = useTranslation('msp/contracts');

  if (!isAdvanceTimingAllowedForLineType(lineType)) {
    return (
      <div className={className}>
        <p id={`${id}-readonly-arrears`} className="mt-1 text-sm text-[rgb(var(--color-text-800))]">
          {t('billingTimingField.arrears', { defaultValue: 'In Arrears' })}
        </p>
        {!hideHelp && (
          <p className="text-xs text-muted-foreground mt-1">
            {t('billingTimingField.nonFixedHelp', {
              defaultValue: 'Hourly and usage lines always bill in arrears, after the work happens.',
            })}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <CustomSelect
        id={id}
        value={value === 'advance' ? 'advance' : 'arrears'}
        onValueChange={(next) => onChange(next === 'advance' ? 'advance' : 'arrears')}
        options={[
          {
            value: 'arrears',
            label: t('billingTimingField.options.arrears', {
              defaultValue: 'In Arrears (bill at end of period)',
            }),
          },
          {
            value: 'advance',
            label: t('billingTimingField.options.advance', {
              defaultValue: 'In Advance (bill at start of period)',
            }),
          },
        ]}
      />
      {!hideHelp && (
        <p className="text-xs text-muted-foreground mt-1">
          {t('billingTimingField.fixedHelp', {
            defaultValue: 'Fixed lines can bill in advance or in arrears.',
          })}
        </p>
      )}
    </div>
  );
}

export default BillingTimingField;
