'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { CustomFieldInput } from './CustomFieldInput';
import {
  ICustomField,
  ICustomFieldGroup,
  IConditionalLogic,
  CustomFieldEntityType,
  CustomFieldValuesMap
} from 'server/src/interfaces/customField.interfaces';
import { getCustomFieldsByEntity, getCustomFieldGroups } from 'server/src/lib/actions/customFieldActions';

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
  /** Whether to show field groups (if any exist) */
  showGroups?: boolean;
}

/**
 * Evaluates conditional logic to determine if a field should be visible
 */
function evaluateConditionalLogic(
  condition: IConditionalLogic | null | undefined,
  values: CustomFieldValuesMap,
  fields: ICustomField[]
): boolean {
  if (!condition) {
    return true; // No condition means always visible
  }

  const watchedValue = values[condition.field_id];
  const watchedField = fields.find(f => f.field_id === condition.field_id);

  switch (condition.operator) {
    case 'equals':
      if (Array.isArray(watchedValue) && Array.isArray(condition.value)) {
        // Both are arrays - compare as sets
        return watchedValue.length === condition.value.length &&
          watchedValue.every(v => (condition.value as string[]).includes(v));
      }
      return watchedValue === condition.value;

    case 'not_equals':
      if (Array.isArray(watchedValue) && Array.isArray(condition.value)) {
        return !(watchedValue.length === condition.value.length &&
          watchedValue.every(v => (condition.value as string[]).includes(v)));
      }
      return watchedValue !== condition.value;

    case 'contains':
      if (Array.isArray(watchedValue)) {
        // For multi_picklist, check if array contains the value
        return watchedValue.includes(condition.value as string);
      }
      // For text fields, check if string contains the value
      return typeof watchedValue === 'string' &&
        watchedValue.toLowerCase().includes(String(condition.value).toLowerCase());

    case 'is_empty':
      return watchedValue === null ||
        watchedValue === undefined ||
        watchedValue === '' ||
        (Array.isArray(watchedValue) && watchedValue.length === 0);

    case 'is_not_empty':
      return watchedValue !== null &&
        watchedValue !== undefined &&
        watchedValue !== '' &&
        !(Array.isArray(watchedValue) && watchedValue.length === 0);

    default:
      return true;
  }
}

/**
 * Collapsible group wrapper component
 */
function FieldGroup({
  group,
  children,
  defaultCollapsed = false
}: {
  group: ICustomFieldGroup;
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  return (
    <div className="field-group border border-gray-200 rounded-lg mb-4">
      <button
        type="button"
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-t-lg transition-colors"
      >
        <span className="font-medium text-gray-900">{group.name}</span>
        {isCollapsed ? (
          <ChevronRightIcon className="w-5 h-5 text-gray-500" />
        ) : (
          <ChevronDownIcon className="w-5 h-5 text-gray-500" />
        )}
      </button>
      {!isCollapsed && (
        <div className="p-4 space-y-4">
          {group.description && (
            <p className="text-sm text-gray-500 mb-3">{group.description}</p>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Reusable section component that renders custom fields for an entity type.
 * Fetches field definitions and renders appropriate inputs.
 * Supports conditional logic and field grouping.
 */
export function CustomFieldsSection({
  entityType,
  values,
  onChange,
  disabled = false,
  errors = {},
  title = 'Custom Fields',
  showTitle = true,
  className = '',
  showGroups = true
}: CustomFieldsSectionProps) {
  const [fields, setFields] = useState<ICustomField[]>([]);
  const [groups, setGroups] = useState<ICustomFieldGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Fetch custom field definitions and groups
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setFetchError(null);
        const [fieldDefinitions, fieldGroups] = await Promise.all([
          getCustomFieldsByEntity(entityType, false),
          showGroups ? getCustomFieldGroups(entityType) : Promise.resolve([])
        ]);
        setFields(fieldDefinitions);
        setGroups(fieldGroups);
      } catch (err) {
        console.error('Error fetching custom fields:', err);
        setFetchError('Failed to load custom fields');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [entityType, showGroups]);

  // Handle individual field change (supports arrays for multi_picklist)
  const handleFieldChange = useCallback((fieldId: string, value: string | number | boolean | string[] | null) => {
    const newValues = {
      ...values,
      [fieldId]: value
    };
    onChange(newValues);
  }, [values, onChange]);

  // Filter visible fields based on conditional logic
  const visibleFields = useMemo(() => {
    return fields.filter(field =>
      evaluateConditionalLogic(field.conditional_logic, values, fields)
    );
  }, [fields, values]);

  // Group fields by group_id (null group_id = ungrouped)
  const groupedFields = useMemo(() => {
    const grouped = new Map<string | null, ICustomField[]>();

    // Initialize groups
    grouped.set(null, []); // Ungrouped fields
    groups.forEach(g => grouped.set(g.group_id, []));

    // Distribute visible fields into groups
    visibleFields.forEach(field => {
      const groupId = field.group_id || null;
      const existing = grouped.get(groupId) || [];
      existing.push(field);
      grouped.set(groupId, existing);
    });

    return grouped;
  }, [visibleFields, groups]);

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

  // Render a single field
  const renderField = (field: ICustomField) => (
    <CustomFieldInput
      key={field.field_id}
      field={field}
      value={values[field.field_id]}
      onChange={handleFieldChange}
      disabled={disabled}
      error={errors[field.field_id]}
    />
  );

  // Get ungrouped fields
  const ungroupedFields = groupedFields.get(null) || [];
  const hasGroups = groups.length > 0;

  return (
    <div className={`custom-fields-section ${className}`}>
      {showTitle && visibleFields.length > 0 && (
        <h3 className="text-sm font-medium text-gray-700 mb-3">{title}</h3>
      )}

      {/* Render grouped fields */}
      {hasGroups && groups.map(group => {
        const groupFields = groupedFields.get(group.group_id) || [];
        if (groupFields.length === 0) return null;

        return (
          <FieldGroup
            key={group.group_id}
            group={group}
            defaultCollapsed={group.is_collapsed_by_default}
          >
            {groupFields.map(renderField)}
          </FieldGroup>
        );
      })}

      {/* Render ungrouped fields */}
      {ungroupedFields.length > 0 && (
        <div className={`space-y-4 ${hasGroups ? 'mt-4' : ''}`}>
          {ungroupedFields.map(renderField)}
        </div>
      )}
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
