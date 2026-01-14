'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { CustomFieldsSection } from './CustomFieldsSection';
import {
  CustomFieldEntityType,
  CustomFieldValuesMap
} from 'server/src/interfaces/customField.interfaces';
import {
  getCustomFieldValues,
  saveCustomFieldValues,
  validateCustomFieldValues
} from 'server/src/lib/actions/customFieldActions';
import { toast } from 'react-hot-toast';

interface CustomFieldsCardProps {
  /** The entity type (ticket, company, contact) */
  entityType: CustomFieldEntityType;
  /** The ID of the entity (ticket_id, company_id, contact_name_id) */
  entityId: string;
  /** Whether the form is disabled/read-only */
  disabled?: boolean;
  /** Title for the card */
  title?: string;
  /** Additional CSS classes */
  className?: string;
  /** Callback when values are saved */
  onSave?: (values: CustomFieldValuesMap) => void;
  /** Auto-save delay in ms (0 to disable auto-save) */
  autoSaveDelay?: number;
}

/**
 * Self-contained card component for displaying and editing custom fields.
 * Handles fetching, displaying, validating, and saving custom field values.
 */
export function CustomFieldsCard({
  entityType,
  entityId,
  disabled = false,
  title = 'Custom Fields',
  className = '',
  onSave,
  autoSaveDelay = 1500
}: CustomFieldsCardProps) {
  const [values, setValues] = useState<CustomFieldValuesMap>({});
  const [initialValues, setInitialValues] = useState<CustomFieldValuesMap>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasChangesRef = useRef(false);

  // Fetch initial values
  useEffect(() => {
    const fetchValues = async () => {
      if (!entityId) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const fetchedValues = await getCustomFieldValues(entityType, entityId);
        setValues(fetchedValues);
        setInitialValues(fetchedValues);
      } catch (error) {
        console.error('Error fetching custom field values:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchValues();
  }, [entityType, entityId]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Save values
  const saveValues = useCallback(async (valuesToSave: CustomFieldValuesMap) => {
    if (!entityId || disabled) return;

    // Validate
    const validationErrors = await validateCustomFieldValues(entityType, valuesToSave);
    if (validationErrors.length > 0) {
      // Convert array to record
      const errorRecord: Record<string, string> = {};
      validationErrors.forEach(err => {
        // Extract field name from error message (assumes format "FieldName is required" etc.)
        const match = err.match(/^(.+?) (is|must)/);
        if (match) {
          // This is a simplification - in production, validation should return field IDs
          errorRecord[match[1]] = err;
        }
      });
      setErrors(errorRecord);
      return;
    }

    setErrors({});
    setSaving(true);

    try {
      await saveCustomFieldValues(entityType, entityId, valuesToSave);
      setInitialValues(valuesToSave);
      hasChangesRef.current = false;
      onSave?.(valuesToSave);
    } catch (error) {
      console.error('Error saving custom field values:', error);
      toast.error('Failed to save custom fields');
    } finally {
      setSaving(false);
    }
  }, [entityType, entityId, disabled, onSave]);

  // Handle value changes with optional auto-save
  const handleChange = useCallback((newValues: CustomFieldValuesMap) => {
    setValues(newValues);
    hasChangesRef.current = true;

    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Schedule auto-save if enabled
    if (autoSaveDelay > 0 && !disabled) {
      saveTimeoutRef.current = setTimeout(() => {
        saveValues(newValues);
      }, autoSaveDelay);
    }
  }, [autoSaveDelay, disabled, saveValues]);

  // Manual save (can be called by parent if needed)
  const handleManualSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveValues(values);
  }, [saveValues, values]);

  // Don't render if still loading or if we don't have an entity ID
  if (!entityId) {
    return null;
  }

  return (
    <div className={`custom-fields-card bg-white rounded-lg border border-gray-200 p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
        {saving && (
          <span className="text-xs text-gray-500">Saving...</span>
        )}
      </div>

      <CustomFieldsSection
        entityType={entityType}
        values={values}
        onChange={handleChange}
        disabled={disabled || loading}
        errors={errors}
        showTitle={false}
      />

      {/* Show manual save button if auto-save is disabled */}
      {autoSaveDelay === 0 && hasChangesRef.current && !disabled && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleManualSave}
            disabled={saving}
            className="px-3 py-1.5 text-sm bg-primary-500 text-white rounded hover:bg-primary-600 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Custom Fields'}
          </button>
        </div>
      )}
    </div>
  );
}

export default CustomFieldsCard;
