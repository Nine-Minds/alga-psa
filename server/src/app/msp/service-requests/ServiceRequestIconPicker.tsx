'use client';

import React from 'react';
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
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {SERVICE_REQUEST_ICON_OPTIONS.map((option) => {
          const selected = selectedIcon === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              className={`flex items-center gap-2 rounded border px-3 py-2 text-left text-sm transition-colors ${
                selected
                  ? 'border-[rgb(var(--color-primary-600))] bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-700))]'
                  : 'border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background-100))] hover:bg-[rgb(var(--color-background-200))]'
              }`}
              onClick={() => onChange(option.value)}
            >
              <ServiceRequestIcon iconName={option.value} className="h-4 w-4 shrink-0" />
              <span>{option.label}</span>
            </button>
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
        Clear icon
      </button>
    </div>
  );
}
