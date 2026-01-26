'use client';

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './Tabs';
import { CustomFieldInput } from './CustomFieldInput';
import { Button } from './Button';
import { ChevronDown, ChevronRight, Sliders } from 'lucide-react';
import {
  ICustomField,
  ICustomFieldGroup,
  CustomFieldEntityType,
  CustomFieldValuesMap,
  IConditionalLogic
} from 'server/src/interfaces/customField.interfaces';
import {
  getCustomFieldsByEntity,
  getCustomFieldGroups,
  getCustomFieldValues,
  saveCustomFieldValues,
  validateCustomFieldValues
} from 'server/src/lib/actions/customFieldActions';
import { toast } from 'react-hot-toast';

interface TabbedCustomFieldsCardProps {
  /** Unique identifier for UI reflection system */
  id: string;
  /** The entity type (ticket, company, contact) */
  entityType: CustomFieldEntityType;
  /** The ID of the entity */
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
  /** View mode: 'tabbed' for horizontal tabs, 'collapsible' for accordion */
  viewMode?: 'tabbed' | 'collapsible';
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
    return true;
  }

  const watchedValue = values[condition.field_id];

  switch (condition.operator) {
    case 'equals':
      return watchedValue === condition.value;
    case 'not_equals':
      return watchedValue !== condition.value;
    case 'contains':
      if (Array.isArray(watchedValue)) {
        return watchedValue.includes(condition.value as string);
      }
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
 * Enhanced custom fields card with tabbed/collapsible group support
 * Provides a Halo-style UI for viewing and editing custom fields
 */
export function TabbedCustomFieldsCard({
  id,
  entityType,
  entityId,
  disabled = false,
  title = 'Custom Fields',
  className = '',
  onSave,
  autoSaveDelay = 1500,
  viewMode = 'tabbed'
}: TabbedCustomFieldsCardProps) {
  const [fields, setFields] = useState<ICustomField[]>([]);
  const [groups, setGroups] = useState<ICustomFieldGroup[]>([]);
  const [values, setValues] = useState<CustomFieldValuesMap>({});
  const [initialValues, setInitialValues] = useState<CustomFieldValuesMap>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasChangesRef = useRef(false);

  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      if (!entityId) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const [fieldDefs, fieldGroups, fieldValues] = await Promise.all([
          getCustomFieldsByEntity(entityType, false),
          getCustomFieldGroups(entityType),
          getCustomFieldValues(entityType, entityId)
        ]);

        setFields(fieldDefs);
        setGroups(fieldGroups.sort((a, b) => a.group_order - b.group_order));
        setValues(fieldValues);
        setInitialValues(fieldValues);

        // Set initial active tab to first group with fields
        if (fieldGroups.length > 0) {
          setActiveTab(fieldGroups[0].group_id);
          // Set initial collapsed state
          const collapsed = new Set<string>();
          fieldGroups.forEach(g => {
            if (g.is_collapsed_by_default) {
              collapsed.add(g.group_id);
            }
          });
          setCollapsedGroups(collapsed);
        }
      } catch (error) {
        console.error('Error fetching custom fields:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [entityType, entityId]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Filter visible fields based on conditional logic
  const visibleFields = useMemo(() => {
    return fields.filter(field =>
      evaluateConditionalLogic(field.conditional_logic, values, fields)
    );
  }, [fields, values]);

  // Group fields
  const groupedFields = useMemo(() => {
    const map: Record<string, ICustomField[]> = { ungrouped: [] };
    groups.forEach(g => {
      map[g.group_id] = [];
    });

    visibleFields.forEach(field => {
      if (field.group_id && map[field.group_id]) {
        map[field.group_id].push(field);
      } else {
        map.ungrouped.push(field);
      }
    });

    // Sort fields within each group by field_order
    Object.keys(map).forEach(key => {
      map[key].sort((a, b) => a.field_order - b.field_order);
    });

    return map;
  }, [visibleFields, groups]);

  // Save values
  const saveValues = useCallback(async (valuesToSave: CustomFieldValuesMap) => {
    if (!entityId || disabled) return;

    const validationErrors = await validateCustomFieldValues(entityType, valuesToSave);
    if (validationErrors.length > 0) {
      const errorRecord: Record<string, string> = {};
      validationErrors.forEach(err => {
        const match = err.match(/^(.+?) (is|must)/);
        if (match) {
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

  // Handle value changes
  const handleFieldChange = useCallback((fieldId: string, value: string | number | boolean | string[] | null) => {
    const newValues = { ...values, [fieldId]: value };
    setValues(newValues);
    hasChangesRef.current = true;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    if (autoSaveDelay > 0 && !disabled) {
      saveTimeoutRef.current = setTimeout(() => {
        saveValues(newValues);
      }, autoSaveDelay);
    }
  }, [values, autoSaveDelay, disabled, saveValues]);

  const handleManualSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveValues(values);
  }, [saveValues, values]);

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  // Render field
  const renderField = (field: ICustomField) => (
    <CustomFieldInput
      key={field.field_id}
      field={field}
      value={values[field.field_id]}
      onChange={handleFieldChange}
      disabled={disabled || loading}
      error={errors[field.field_id]}
    />
  );

  if (!entityId) {
    return null;
  }

  if (loading) {
    return (
      <div id={id} className={`bg-white rounded-lg border border-gray-200 p-4 ${className}`}>
        <div className="flex items-center gap-2 mb-3">
          <Sliders className="w-4 h-4 text-gray-400" />
          <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-10 bg-gray-200 rounded"></div>
          <div className="h-10 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (fields.length === 0) {
    return null;
  }

  const hasGroups = groups.length > 0;
  const ungroupedFields = groupedFields.ungrouped || [];

  // Tabbed view
  if (viewMode === 'tabbed' && hasGroups) {
    return (
      <div id={id} className={`bg-white rounded-lg border border-gray-200 ${className}`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-gray-400" />
            <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
          </div>
          {saving && (
            <span className="text-xs text-gray-500">Saving...</span>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full justify-start border-b rounded-none bg-gray-50 px-2">
            {groups.map(group => {
              const groupFields = groupedFields[group.group_id] || [];
              if (groupFields.length === 0) return null;
              return (
                <TabsTrigger
                  key={group.group_id}
                  value={group.group_id}
                  className="data-[state=active]:bg-white"
                >
                  {group.name}
                  <span className="ml-1 text-xs text-gray-400">({groupFields.length})</span>
                </TabsTrigger>
              );
            })}
            {ungroupedFields.length > 0 && (
              <TabsTrigger value="ungrouped" className="data-[state=active]:bg-white">
                Other
                <span className="ml-1 text-xs text-gray-400">({ungroupedFields.length})</span>
              </TabsTrigger>
            )}
          </TabsList>

          {groups.map(group => {
            const groupFields = groupedFields[group.group_id] || [];
            if (groupFields.length === 0) return null;
            return (
              <TabsContent key={group.group_id} value={group.group_id} className="p-4 space-y-4">
                {group.description && (
                  <p className="text-sm text-gray-500 mb-2">{group.description}</p>
                )}
                {groupFields.map(renderField)}
              </TabsContent>
            );
          })}

          {ungroupedFields.length > 0 && (
            <TabsContent value="ungrouped" className="p-4 space-y-4">
              {ungroupedFields.map(renderField)}
            </TabsContent>
          )}
        </Tabs>

        {autoSaveDelay === 0 && hasChangesRef.current && !disabled && (
          <div className="px-4 py-3 border-t border-gray-200 flex justify-end">
            <Button
              id={`save-custom-fields-${entityType}-${entityId}`}
              onClick={handleManualSave}
              disabled={saving}
              size="sm"
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Collapsible view
  return (
    <div id={id} className={`bg-white rounded-lg border border-gray-200 p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-gray-400" />
          <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
        </div>
        {saving && (
          <span className="text-xs text-gray-500">Saving...</span>
        )}
      </div>

      {/* Grouped fields with collapsible sections */}
      {groups.map(group => {
        const groupFields = groupedFields[group.group_id] || [];
        if (groupFields.length === 0) return null;

        const isCollapsed = collapsedGroups.has(group.group_id);

        return (
          <div key={group.group_id} className="border border-gray-200 rounded-lg mb-3">
            <button
              type="button"
              onClick={() => toggleGroup(group.group_id)}
              className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded-t-lg transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                {isCollapsed ? (
                  <ChevronRight className="w-4 h-4 text-gray-500" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                )}
                <span className="font-medium text-sm text-gray-900">{group.name}</span>
                <span className="text-xs text-gray-400">({groupFields.length})</span>
              </div>
            </button>
            {!isCollapsed && (
              <div className="p-3 space-y-3">
                {group.description && (
                  <p className="text-sm text-gray-500">{group.description}</p>
                )}
                {groupFields.map(renderField)}
              </div>
            )}
          </div>
        );
      })}

      {/* Ungrouped fields */}
      {ungroupedFields.length > 0 && (
        <div className="space-y-3">
          {ungroupedFields.map(renderField)}
        </div>
      )}

      {autoSaveDelay === 0 && hasChangesRef.current && !disabled && (
        <div className="mt-4 flex justify-end">
          <Button
            id={`save-custom-fields-${entityType}-${entityId}`}
            onClick={handleManualSave}
            disabled={saving}
            size="sm"
          >
            {saving ? 'Saving...' : 'Save Custom Fields'}
          </Button>
        </div>
      )}
    </div>
  );
}

export default TabbedCustomFieldsCard;
