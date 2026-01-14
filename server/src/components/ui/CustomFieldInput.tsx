'use client';

import React from 'react';
import { Input } from './Input';
import CustomSelect from './CustomSelect';
import { Switch } from './Switch';
import { DatePicker } from './DatePicker';
import { ICustomField, CustomFieldType } from 'server/src/interfaces/customField.interfaces';

interface CustomFieldInputProps {
  field: ICustomField;
  value: string | number | boolean | null | undefined;
  onChange: (fieldId: string, value: string | number | boolean | null) => void;
  disabled?: boolean;
  error?: string;
}

/**
 * Renders the appropriate input component based on custom field type
 */
export function CustomFieldInput({
  field,
  value,
  onChange,
  disabled = false,
  error
}: CustomFieldInputProps) {
  const handleChange = (newValue: string | number | boolean | null) => {
    onChange(field.field_id, newValue);
  };

  const renderInput = () => {
    switch (field.type) {
      case 'text':
        return (
          <Input
            id={`custom-field-${field.field_id}`}
            label={field.name}
            value={value as string || ''}
            onChange={(e) => handleChange(e.target.value)}
            disabled={disabled}
            required={field.is_required}
            placeholder={field.description || `Enter ${field.name.toLowerCase()}`}
            error={error}
          />
        );

      case 'number':
        return (
          <Input
            id={`custom-field-${field.field_id}`}
            label={field.name}
            type="number"
            value={value !== null && value !== undefined ? String(value) : ''}
            onChange={(e) => {
              const numValue = e.target.value === '' ? null : Number(e.target.value);
              handleChange(numValue);
            }}
            disabled={disabled}
            required={field.is_required}
            placeholder={field.description || `Enter ${field.name.toLowerCase()}`}
            error={error}
          />
        );

      case 'date':
        return (
          <div className="mb-0">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.name}
              {field.is_required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <DatePicker
              id={`custom-field-${field.field_id}`}
              value={value ? new Date(value as string) : undefined}
              onChange={(date) => handleChange(date ? date.toISOString() : null)}
              disabled={disabled}
              required={field.is_required}
              placeholder={field.description || `Select ${field.name.toLowerCase()}`}
              clearable={!field.is_required}
            />
            {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
          </div>
        );

      case 'boolean':
        return (
          <div className="mb-0">
            <div className="flex items-center gap-3">
              <Switch
                id={`custom-field-${field.field_id}`}
                checked={Boolean(value)}
                onCheckedChange={(checked) => handleChange(checked)}
                disabled={disabled}
              />
              <label className="text-sm font-medium text-gray-700">
                {field.name}
                {field.is_required && <span className="text-red-500 ml-1">*</span>}
              </label>
            </div>
            {field.description && (
              <p className="mt-1 text-xs text-gray-500">{field.description}</p>
            )}
            {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
          </div>
        );

      case 'picklist':
        const options = (field.options || []).map((opt) => ({
          value: opt.value,
          label: opt.label
        }));

        return (
          <CustomSelect
            id={`custom-field-${field.field_id}`}
            label={field.name}
            options={options}
            value={value as string || ''}
            onValueChange={(newValue) => handleChange(newValue || null)}
            disabled={disabled}
            required={field.is_required}
            placeholder={field.description || `Select ${field.name.toLowerCase()}`}
            allowClear={!field.is_required}
          />
        );

      default:
        // Fallback to text input for unknown types
        return (
          <Input
            id={`custom-field-${field.field_id}`}
            label={field.name}
            value={value as string || ''}
            onChange={(e) => handleChange(e.target.value)}
            disabled={disabled}
            required={field.is_required}
            error={error}
          />
        );
    }
  };

  return (
    <div className="custom-field-input">
      {renderInput()}
    </div>
  );
}

export default CustomFieldInput;
