'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { CustomFieldInput } from './CustomFieldInput';
import {
  ICustomField,
  CustomFieldEntityType,
  CustomFieldValuesMap
} from 'server/src/interfaces/customField.interfaces';
import { getCustomFieldsByEntity } from 'server/src/lib/actions/customFieldActions';

interface CustomFieldsSectionProps {
  /** The entity type to show custom fields for */
  entityType: CustomFieldEntityType;
  /** Current values for the custom fields */
  values: CustomFieldValuesMap;
  /** Callback when a field value changes */
  onChange: (values: CustomFieldValuesMap) => void;
  /** Whether the form is disabled */
  disabled?: boolean;
  /** Validation errors by field_id */
  errors?: Record<string, string>;
  /** Optional title for the section */
  title?: string;
  /** Whether to show the section title */
  showTitle?: boolean;
  /** Additional CSS classes for the container */
  className?: string;
}

/**
 * Reusable section component that renders custom fields for an entity type.
 * Fetches field definitions and renders appropriate inputs.
 */
export function CustomFieldsSection({
  entityType,
  values,
  onChange,
  disabled = false,
  errors = {},
  title = 'Custom Fields',
  showTitle = true,
  className = ''
}: CustomFieldsSectionProps) {
  const [fields, setFields] = useState<ICustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Fetch custom field definitions
  useEffect(() => {
    const fetchFields = async () => {
      try {
        setLoading(true);
        setFetchError(null);
        const fieldDefinitions = await getCustomFieldsByEntity(entityType, false);
        setFields(fieldDefinitions);
      } catch (err) {
        console.error('Error fetching custom fields:', err);
        setFetchError('Failed to load custom fields');
      } finally {
        setLoading(false);
      }
    };

    fetchFields();
  }, [entityType]);

  // Handle individual field change
  const handleFieldChange = useCallback((fieldId: string, value: string | number | boolean | null) => {
    const newValues = {
      ...values,
      [fieldId]: value
    };
    onChange(newValues);
  }, [values, onChange]);

  // Don't render anything if there are no custom fields
  if (!loading && fields.length === 0) {
    return null;
  }

  // Loading state
  if (loading) {
    return (
      <div className={`custom-fields-section ${className}`}>
        {showTitle && (
          <h3 className="text-sm font-medium text-gray-700 mb-3">{title}</h3>
        )}
        <div className="animate-pulse space-y-3">
          <div className="h-10 bg-gray-200 rounded"></div>
          <div className="h-10 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  // Error state
  if (fetchError) {
    return (
      <div className={`custom-fields-section ${className}`}>
        {showTitle && (
          <h3 className="text-sm font-medium text-gray-700 mb-3">{title}</h3>
        )}
        <p className="text-sm text-red-600">{fetchError}</p>
      </div>
    );
  }

  return (
    <div className={`custom-fields-section ${className}`}>
      {showTitle && fields.length > 0 && (
        <h3 className="text-sm font-medium text-gray-700 mb-3">{title}</h3>
      )}
      <div className="space-y-4">
        {fields.map((field) => (
          <CustomFieldInput
            key={field.field_id}
            field={field}
            value={values[field.field_id]}
            onChange={handleFieldChange}
            disabled={disabled}
            error={errors[field.field_id]}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Helper hook to manage custom field values state
 */
export function useCustomFieldValues(initialValues: CustomFieldValuesMap = {}) {
  const [values, setValues] = useState<CustomFieldValuesMap>(initialValues);
  const [isDirty, setIsDirty] = useState(false);

  const updateValues = useCallback((newValues: CustomFieldValuesMap) => {
    setValues(newValues);
    setIsDirty(true);
  }, []);

  const resetValues = useCallback((newInitialValues: CustomFieldValuesMap = {}) => {
    setValues(newInitialValues);
    setIsDirty(false);
  }, []);

  return {
    values,
    setValues: updateValues,
    resetValues,
    isDirty
  };
}

export default CustomFieldsSection;
