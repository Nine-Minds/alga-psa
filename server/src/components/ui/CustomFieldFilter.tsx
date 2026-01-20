'use client';

import React, { useState, useEffect } from 'react';
import { ICustomField, CustomFieldEntityType } from 'server/src/interfaces/customField.interfaces';
import { getCustomFieldsByEntity } from 'server/src/lib/actions/customFieldActions';
import {
  CustomFieldFilterOperator,
  CustomFieldFilterDefinition,
  getAvailableOperatorsForFieldType,
  getOperatorLabel
} from 'server/src/lib/reports/helpers/customFieldReportHelpers';
import CustomSelect, { SelectOption } from './CustomSelect';
import { Input } from './Input';
import { Checkbox } from './Checkbox';
import { Label } from './Label';
import { Button } from './Button';
import { X, Plus } from 'lucide-react';
import LoadingIndicator from './LoadingIndicator';

export interface CustomFieldFilterValue {
  fieldId: string;
  operator: CustomFieldFilterOperator;
  value: any;
}

interface CustomFieldFilterProps {
  /** The entity type to filter custom fields for */
  entityType: CustomFieldEntityType;
  /** Current filter values */
  filters: CustomFieldFilterValue[];
  /** Callback when filters change */
  onChange: (filters: CustomFieldFilterValue[]) => void;
  /** Optional company ID for per-client field filtering */
  companyId?: string;
  /** Whether to allow multiple filters */
  multipleFilters?: boolean;
  /** Label for the section */
  label?: string;
  /** Optional className for the container */
  className?: string;
}

/**
 * A reusable component for filtering by custom field values.
 * Can be added to any filter dialog or panel.
 */
export function CustomFieldFilter({
  entityType,
  filters,
  onChange,
  companyId,
  multipleFilters = true,
  label = 'Custom Field Filters',
  className = ''
}: CustomFieldFilterProps) {
  const [fields, setFields] = useState<ICustomField[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch custom fields
  useEffect(() => {
    const fetchFields = async () => {
      try {
        setLoading(true);
        const fetchedFields = await getCustomFieldsByEntity(entityType, true);
        setFields(fetchedFields);
      } catch (error) {
        console.error('Error fetching custom fields:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchFields();
  }, [entityType, companyId]);

  const handleAddFilter = () => {
    if (fields.length === 0) return;

    const firstField = fields[0];
    const operators = getAvailableOperatorsForFieldType(firstField.type);
    const newFilter: CustomFieldFilterValue = {
      fieldId: firstField.field_id,
      operator: operators[0],
      value: ''
    };

    onChange([...filters, newFilter]);
  };

  const handleRemoveFilter = (index: number) => {
    const newFilters = [...filters];
    newFilters.splice(index, 1);
    onChange(newFilters);
  };

  const handleFilterChange = (index: number, updates: Partial<CustomFieldFilterValue>) => {
    const newFilters = [...filters];
    newFilters[index] = { ...newFilters[index], ...updates };

    // If field changed, reset operator and value
    if (updates.fieldId && updates.fieldId !== filters[index].fieldId) {
      const field = fields.find(f => f.field_id === updates.fieldId);
      if (field) {
        const operators = getAvailableOperatorsForFieldType(field.type);
        newFilters[index].operator = operators[0];
        newFilters[index].value = field.type === 'boolean' ? false : '';
      }
    }

    onChange(newFilters);
  };

  const getFieldById = (fieldId: string) => {
    return fields.find(f => f.field_id === fieldId);
  };

  if (loading) {
    return (
      <div className={`space-y-2 ${className}`}>
        <Label className="text-base font-semibold">{label}</Label>
        <div className="py-2">
          <LoadingIndicator text="Loading custom fields..." />
        </div>
      </div>
    );
  }

  if (fields.length === 0) {
    return (
      <div className={`space-y-2 ${className}`}>
        <Label className="text-base font-semibold">{label}</Label>
        <p className="text-sm text-gray-500">No custom fields available for filtering.</p>
      </div>
    );
  }

  const fieldOptions: SelectOption[] = fields.map(f => ({
    value: f.field_id,
    label: f.name
  }));

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center justify-between">
        <Label className="text-base font-semibold">{label}</Label>
        {(multipleFilters || filters.length === 0) && (
          <Button
            id="add-custom-field-filter"
            variant="ghost"
            size="sm"
            onClick={handleAddFilter}
            className="text-primary-600 hover:text-primary-700"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Filter
          </Button>
        )}
      </div>

      {filters.length === 0 ? (
        <p className="text-sm text-gray-500">No custom field filters applied.</p>
      ) : (
        <div className="space-y-3">
          {filters.map((filter, index) => {
            const field = getFieldById(filter.fieldId);
            const operators = field ? getAvailableOperatorsForFieldType(field.type) : [];
            const operatorOptions: SelectOption[] = operators.map(op => ({
              value: op,
              label: getOperatorLabel(op)
            }));

            return (
              <FilterRow
                key={index}
                filter={filter}
                field={field}
                fieldOptions={fieldOptions}
                operatorOptions={operatorOptions}
                onChange={(updates) => handleFilterChange(index, updates)}
                onRemove={() => handleRemoveFilter(index)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

interface FilterRowProps {
  filter: CustomFieldFilterValue;
  field: ICustomField | undefined;
  fieldOptions: SelectOption[];
  operatorOptions: SelectOption[];
  onChange: (updates: Partial<CustomFieldFilterValue>) => void;
  onRemove: () => void;
}

function FilterRow({
  filter,
  field,
  fieldOptions,
  operatorOptions,
  onChange,
  onRemove
}: FilterRowProps) {
  const needsValueInput = !['is_empty', 'is_not_empty'].includes(filter.operator);

  return (
    <div className="flex items-start gap-2 p-3 bg-gray-50 rounded-md">
      <div className="flex-1 grid grid-cols-3 gap-2">
        {/* Field selector */}
        <CustomSelect
          id={`cf-filter-field-${filter.fieldId}`}
          value={filter.fieldId}
          onValueChange={(value) => onChange({ fieldId: value })}
          options={fieldOptions}
          placeholder="Select field..."
        />

        {/* Operator selector */}
        <CustomSelect
          id={`cf-filter-operator-${filter.fieldId}`}
          value={filter.operator}
          onValueChange={(value) => onChange({ operator: value as CustomFieldFilterOperator })}
          options={operatorOptions}
          placeholder="Select operator..."
        />

        {/* Value input */}
        {needsValueInput && (
          <ValueInput
            field={field}
            value={filter.value}
            operator={filter.operator}
            onChange={(value) => onChange({ value })}
          />
        )}
      </div>

      <Button
        id={`cf-filter-remove-${filter.fieldId}`}
        variant="ghost"
        size="sm"
        onClick={onRemove}
        className="text-gray-400 hover:text-red-500 mt-1"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

interface ValueInputProps {
  field: ICustomField | undefined;
  value: any;
  operator: CustomFieldFilterOperator;
  onChange: (value: any) => void;
}

function ValueInput({ field, value, operator, onChange }: ValueInputProps) {
  if (!field) {
    return <Input id="cf-filter-value" value={String(value || '')} onChange={(e) => onChange(e.target.value)} />;
  }

  // Handle between operator (needs two values)
  if (operator === 'between') {
    const rangeValue = Array.isArray(value) ? value : ['', ''];
    return (
      <div className="flex items-center gap-1">
        <Input
          id="cf-filter-value-from"
          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
          value={rangeValue[0] || ''}
          onChange={(e) => onChange([e.target.value, rangeValue[1]])}
          placeholder="From"
          className="flex-1"
        />
        <span className="text-gray-500 text-sm">to</span>
        <Input
          id="cf-filter-value-to"
          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
          value={rangeValue[1] || ''}
          onChange={(e) => onChange([rangeValue[0], e.target.value])}
          placeholder="To"
          className="flex-1"
        />
      </div>
    );
  }

  // Handle in/not_in operators (multi-value)
  if (operator === 'in' || operator === 'not_in') {
    if (field.type === 'picklist' && field.options) {
      // Show checkboxes for picklist values
      const selectedValues = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap gap-2 border border-gray-200 rounded p-2 max-h-32 overflow-y-auto">
          {field.options
            .sort((a, b) => a.order - b.order)
            .map(opt => (
              <label key={opt.value} className="flex items-center gap-1 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedValues.includes(opt.value)}
                  onChange={(e) => {
                    const newValues = e.target.checked
                      ? [...selectedValues, opt.value]
                      : selectedValues.filter(v => v !== opt.value);
                    onChange(newValues);
                  }}
                  className="rounded border-gray-300"
                />
                <span>{opt.label}</span>
              </label>
            ))}
        </div>
      );
    }

    // For other types, use comma-separated input
    return (
      <Input
        id="cf-filter-value-multi"
        value={Array.isArray(value) ? value.join(', ') : value || ''}
        onChange={(e) => {
          const values = e.target.value.split(',').map(v => v.trim()).filter(Boolean);
          onChange(values);
        }}
        placeholder="Enter values separated by commas"
      />
    );
  }

  // Handle different field types
  switch (field.type) {
    case 'boolean':
      return (
        <CustomSelect
          id="cf-filter-value-bool"
          value={value === true || value === 'true' ? 'true' : 'false'}
          onValueChange={(v) => onChange(v === 'true')}
          options={[
            { value: 'true', label: 'Yes' },
            { value: 'false', label: 'No' }
          ]}
        />
      );

    case 'picklist':
      if (field.options) {
        return (
          <CustomSelect
            id="cf-filter-value-picklist"
            value={String(value || '')}
            onValueChange={onChange}
            options={field.options
              .sort((a, b) => a.order - b.order)
              .map(opt => ({
                value: opt.value,
                label: opt.label
              }))}
            placeholder="Select value..."
          />
        );
      }
      return <Input id="cf-filter-value" value={String(value || '')} onChange={(e) => onChange(e.target.value)} />;

    case 'multi_picklist':
      if (field.options) {
        const selectedValues = Array.isArray(value) ? value : [];
        return (
          <div className="flex flex-wrap gap-2 border border-gray-200 rounded p-2 max-h-32 overflow-y-auto">
            {field.options
              .sort((a, b) => a.order - b.order)
              .map(opt => (
                <label key={opt.value} className="flex items-center gap-1 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedValues.includes(opt.value)}
                    onChange={(e) => {
                      const newValues = e.target.checked
                        ? [...selectedValues, opt.value]
                        : selectedValues.filter(v => v !== opt.value);
                      onChange(newValues);
                    }}
                    className="rounded border-gray-300"
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
          </div>
        );
      }
      return <Input id="cf-filter-value" value={String(value || '')} onChange={(e) => onChange(e.target.value)} />;

    case 'number':
      return (
        <Input
          id="cf-filter-value-number"
          type="number"
          value={value || ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}
          placeholder="Enter number..."
        />
      );

    case 'date':
      return (
        <Input
          id="cf-filter-value-date"
          type="date"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'text':
    default:
      return (
        <Input
          id="cf-filter-value-text"
          type="text"
          value={String(value || '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter value..."
        />
      );
  }
}

/**
 * Convert CustomFieldFilterValue array to CustomFieldFilterDefinition array
 * for use with the report helpers
 */
export function toFilterDefinitions(
  filters: CustomFieldFilterValue[],
  fields: ICustomField[]
): CustomFieldFilterDefinition[] {
  return filters
    .filter(f => {
      // Skip empty filters
      if (!f.fieldId) return false;
      if (['is_empty', 'is_not_empty'].includes(f.operator)) return true;
      if (f.value === undefined || f.value === null || f.value === '') return false;
      if (Array.isArray(f.value) && f.value.length === 0) return false;
      return true;
    })
    .map(f => {
      const field = fields.find(fd => fd.field_id === f.fieldId);
      return {
        fieldId: f.fieldId,
        fieldName: field?.name || '',
        fieldType: field?.type || 'text',
        operator: f.operator,
        value: f.value
      };
    });
}

export default CustomFieldFilter;
