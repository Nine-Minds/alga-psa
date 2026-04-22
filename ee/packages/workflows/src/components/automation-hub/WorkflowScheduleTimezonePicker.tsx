'use client';

import React, { useMemo } from 'react';

import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import TimezonePicker from '@alga-psa/ui/components/TimezonePicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  BROWSE_ALL_VALUE,
  COMMON_IANA_TIMEZONES,
  CUSTOM_VALUE,
  getSupportedTimezones,
  inferWorkflowScheduleTimezoneMode,
} from './workflowScheduleTimezoneOptions';

type WorkflowScheduleTimezonePickerProps = {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
};

export default function WorkflowScheduleTimezonePicker({
  id,
  label,
  value,
  onValueChange,
}: WorkflowScheduleTimezonePickerProps) {
  const { t } = useTranslation('msp/workflows');
  const [mode, setMode] = React.useState<'common' | 'browse' | 'custom'>('common');
  const supportedTimezones = useMemo(() => getSupportedTimezones(), []);
  const commonTimezones = useMemo(() => [...COMMON_IANA_TIMEZONES], []);
  const inferredMode = React.useMemo(
    () => inferWorkflowScheduleTimezoneMode(value, commonTimezones, supportedTimezones),
    [commonTimezones, supportedTimezones, value]
  );

  React.useEffect(() => {
    setMode((current) => {
      if (inferredMode === 'custom') {
        return 'custom';
      }
      if (current === 'common' || current === 'browse') {
        return inferredMode;
      }
      return current;
    });
  }, [inferredMode]);

  const selectionValue = mode === 'common'
    ? value
    : mode === 'browse'
      ? BROWSE_ALL_VALUE
      : CUSTOM_VALUE;

  const options = useMemo<SelectOption[]>(() => [
    ...commonTimezones.map((timezone) => ({
      value: timezone,
      label: timezone,
    })),
    {
      value: BROWSE_ALL_VALUE,
      label: t('schedules.timezone.browseAll', { defaultValue: 'Browse all time zones...' }),
    },
    {
      value: CUSTOM_VALUE,
      label: t('schedules.timezone.custom', { defaultValue: 'Custom...' }),
    },
  ], [commonTimezones, t]);

  return (
    <div className="space-y-3">
      <CustomSelect
        id={id}
        label={label}
        value={selectionValue}
        onValueChange={(nextValue) => {
          if (nextValue === BROWSE_ALL_VALUE || nextValue === CUSTOM_VALUE) {
            setMode(nextValue === BROWSE_ALL_VALUE ? 'browse' : 'custom');
            return;
          }
          setMode('common');
          onValueChange(nextValue);
        }}
        options={options}
      />

      {mode === 'browse' && (
        <div className="space-y-1">
          <div className="text-xs text-[rgb(var(--color-text-500))]">
            {t('schedules.timezone.browseHelp', {
              defaultValue: 'Choose from the full supported IANA timezone list.',
            })}
          </div>
          <TimezonePicker
            value={value}
            onValueChange={(nextValue) => {
              setMode(commonTimezones.includes(nextValue) ? 'common' : 'browse');
              onValueChange(nextValue);
            }}
          />
        </div>
      )}

      {mode === 'custom' && (
        <Input
          id={`${id}-custom`}
          label={t('schedules.timezone.customLabel', { defaultValue: 'Custom timezone' })}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={t('schedules.timezone.customPlaceholder', { defaultValue: 'Etc/GMT+5' })}
        />
      )}
    </div>
  );
}
