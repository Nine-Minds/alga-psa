'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Switch } from 'server/src/components/ui/Switch';
import { Button } from 'server/src/components/ui/Button';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { toast } from 'react-hot-toast';
import {
  ICustomField,
  ICompanyCustomFieldSetting,
  CustomFieldEntityType
} from 'server/src/interfaces/customField.interfaces';
import {
  getCustomFieldsByEntity,
  getCompanyCustomFieldSettings,
  upsertCompanyCustomFieldSetting
} from 'server/src/lib/actions/customFieldActions';

interface ClientCustomFieldSettingsProps {
  clientId: string;
  entityType: CustomFieldEntityType;
  title?: string;
}

/**
 * Component for managing which custom fields are enabled/disabled for a specific client.
 * This allows per-client field templates.
 */
export function ClientCustomFieldSettings({
  clientId,
  entityType,
  title = 'Custom Field Settings'
}: ClientCustomFieldSettingsProps) {
  const [fields, setFields] = useState<ICustomField[]>([]);
  const [settings, setSettings] = useState<Map<string, ICompanyCustomFieldSetting>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [fieldsData, settingsData] = await Promise.all([
        getCustomFieldsByEntity(entityType, false),
        getCompanyCustomFieldSettings(clientId)
      ]);
      setFields(fieldsData);

      // Convert settings array to map for easy lookup
      const settingsMap = new Map<string, ICompanyCustomFieldSetting>();
      settingsData.forEach(s => settingsMap.set(s.field_id, s));
      setSettings(settingsMap);
    } catch (error) {
      console.error('Error fetching custom field settings:', error);
      toast.error('Failed to load custom field settings');
    } finally {
      setLoading(false);
    }
  }, [clientId, entityType]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggleField = async (fieldId: string, isEnabled: boolean) => {
    setSaving(fieldId);
    try {
      const result = await upsertCompanyCustomFieldSetting({
        company_id: clientId,
        field_id: fieldId,
        is_enabled: isEnabled
      });

      // Update local state
      setSettings(prev => {
        const newMap = new Map(prev);
        newMap.set(fieldId, result);
        return newMap;
      });

      toast.success(isEnabled ? 'Field enabled' : 'Field disabled');
    } catch (error) {
      console.error('Error updating field setting:', error);
      toast.error('Failed to update field setting');
    } finally {
      setSaving(null);
    }
  };

  const isFieldEnabled = (fieldId: string): boolean => {
    const setting = settings.get(fieldId);
    // If no setting exists, field is enabled by default
    return setting ? setting.is_enabled : true;
  };

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <LoadingIndicator text="Loading field settings..." />
      </div>
    );
  }

  if (fields.length === 0) {
    return (
      <div className="text-center py-4 text-gray-500">
        <p>No custom fields have been defined yet.</p>
        <p className="text-sm mt-1">Go to Settings → Custom Fields to create fields.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <span className="text-xs text-gray-500">
          {fields.filter(f => isFieldEnabled(f.field_id)).length} of {fields.length} enabled
        </span>
      </div>

      <p className="text-xs text-gray-500">
        Enable or disable specific custom fields for this client. Disabled fields will not appear on forms for this client.
      </p>

      <div className="border border-gray-200 rounded-lg divide-y divide-gray-200">
        {fields.map(field => {
          const enabled = isFieldEnabled(field.field_id);
          const isSaving = saving === field.field_id;

          return (
            <div
              key={field.field_id}
              className={`flex items-center justify-between px-4 py-3 ${!enabled ? 'bg-gray-50' : ''}`}
            >
              <div className="flex-1 min-w-0 mr-4">
                <div className="flex items-center gap-2">
                  <span className={`font-medium ${!enabled ? 'text-gray-400' : 'text-gray-900'}`}>
                    {field.name}
                  </span>
                  {field.is_required && (
                    <span className="text-xs text-red-500">*Required</span>
                  )}
                  <span className="text-xs text-gray-400">
                    ({field.type === 'multi_picklist' ? 'Multi-Select' : field.type})
                  </span>
                </div>
                {field.description && (
                  <p className={`text-xs mt-0.5 ${!enabled ? 'text-gray-400' : 'text-gray-500'}`}>
                    {field.description}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                {isSaving && (
                  <span className="text-xs text-gray-400">Saving...</span>
                )}
                <Switch
                  id={`field-toggle-${field.field_id}`}
                  checked={enabled}
                  onCheckedChange={(checked) => handleToggleField(field.field_id, checked)}
                  disabled={isSaving}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <Button
          id="reset-field-settings"
          variant="outline"
          size="sm"
          onClick={() => {
            // Reset all settings - enable all fields
            const disabledFields = fields.filter(f => !isFieldEnabled(f.field_id));
            if (disabledFields.length === 0) {
              toast.success('All fields are already enabled');
              return;
            }

            Promise.all(
              disabledFields.map(f =>
                upsertCompanyCustomFieldSetting({
                  company_id: clientId,
                  field_id: f.field_id,
                  is_enabled: true
                })
              )
            ).then(() => {
              fetchData();
              toast.success('All fields have been enabled');
            }).catch(() => {
              toast.error('Failed to reset field settings');
            });
          }}
        >
          Enable All Fields
        </Button>
      </div>
    </div>
  );
}

export default ClientCustomFieldSettings;
