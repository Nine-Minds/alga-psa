'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { ServiceRequestIcon } from '../../client-portal/request-services/ServiceRequestIcon';
import { SERVICE_REQUEST_ICON_OPTIONS } from '../../../lib/service-requests/iconCatalog';

interface ServiceRequestIconPickerProps {
  selectedIcon: string;
  onChange: (value: string) => void;
}

export function ServiceRequestIconPicker({
  selectedIcon,
  onChange,
}: ServiceRequestIconPickerProps) {
  const { t } = useTranslation('msp/service-requests');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {SERVICE_REQUEST_ICON_OPTIONS.map((option) => {
          const selected = selectedIcon === option.value;
          const label = t(`icons.${option.value}`, { defaultValue: option.label });
          return (
            <Tooltip key={option.value} content={label}>
              <button
                type="button"
                aria-pressed={selected}
                aria-label={label}
                className={`flex h-9 w-9 items-center justify-center rounded border transition-colors ${
                  selected
                    ? 'border-[rgb(var(--color-primary-600))] bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-700))]'
                    : 'border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background-100))] text-[rgb(var(--color-text-700))] hover:bg-[rgb(var(--color-background-200))]'
                }`}
                onClick={() => onChange(option.value)}
              >
                <ServiceRequestIcon iconName={option.value} className="h-4 w-4" />
              </button>
            </Tooltip>
          );
        })}
      </div>
      <button
        type="button"
        className={`text-sm underline underline-offset-2 ${
          selectedIcon.length === 0
            ? 'text-[rgb(var(--color-primary-700))]'
            : 'text-[rgb(var(--color-text-700))]'
        }`}
        onClick={() => onChange('')}
      >
        {t('icons.clear')}
      </button>
    </div>
  );
}
