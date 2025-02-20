'use client';

import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui/Input';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Edit2 } from 'lucide-react';
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import type { EntityType } from '@/lib/services/numberingService';
import { getNumberSettings, updateNumberSettings, type NumberSettings } from '@/lib/actions/number-actions/numberingActions';

interface NumberingSettingsProps {
  entityType: EntityType;
}

const NumberingSettings: React.FC<NumberingSettingsProps> = ({ entityType }) => {
  // General state
  const [settings, setSettings] = useState<NumberSettings | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  // Form state
  const [formState, setFormState] = useState<Partial<NumberSettings>>({});

  const entityLabel = entityType.charAt(0) + entityType.slice(1).toLowerCase();
  const entityId = entityType.toLowerCase();

  useEffect(() => {
    const init = async () => {
      try {
        const [numberSettings, user] = await Promise.all([
          getNumberSettings(entityType),
          getCurrentUser()
        ]);
        
        if (!numberSettings) {
          // Initialize with default values for new settings
          const defaultSettings = {
            prefix: entityType === 'TICKET' ? 'TK-' : 'INV-',
            padding_length: 6,
            last_number: 0,
            initial_value: 1
          };
          setSettings(defaultSettings);
          setFormState(defaultSettings);
          setIsEditing(true); // Automatically enter edit mode for new settings
        } else {
          setSettings(numberSettings);
          setFormState(numberSettings);
        }
        setIsAdmin(user?.roles?.some(role => role.role_name.toLowerCase() === 'admin') ?? false);
      } catch (err) {
        setError(`Failed to load ${entityType.toLowerCase()} numbering settings`);
        console.error('Error:', err);
      }
    };

    init();
  }, [entityType]);

  const handleInputChange = (field: keyof NumberSettings, value: string) => {
    setFormState(prev => ({
      ...prev,
      [field]: field === 'prefix' ? value : parseInt(value, 10)
    }));
  };

  const handleSave = async () => {
    try {
      setError(null);
      setSuccessMessage(null);

      const result = await updateNumberSettings(entityType, formState);
      
      if (result.success && result.settings) {
        setSettings(result.settings);
        setFormState(result.settings);
        setSuccessMessage('Settings updated successfully');
        setIsEditing(false);
        setShowConfirmation(false);
      } else {
        throw new Error(result.error || 'Failed to update settings');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update settings');
      console.error(err);
    }
  };

  const handleCancel = () => {
    setError(null);
    setFormState(settings || {});
    setIsEditing(false);
  };

  const nextNumber = isEditing
    ? parseInt((formState.last_number?.toString() ?? '0'), 10) + 1
    : settings
      ? parseInt(settings.last_number.toString(), 10) + 1
      : 0;

  const paddingLength = isEditing
    ? formState.padding_length ?? 6
    : settings?.padding_length ?? 6;

  const prefix = isEditing
    ? formState.prefix ?? (entityType === 'TICKET' ? 'TK-' : 'INV-')
    : settings?.prefix ?? '';

  const paddedNumber = nextNumber.toString().padStart(paddingLength, '0');
  const previewNumber = `${prefix}${paddedNumber}`;

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm">
      <h3 className="text-lg font-semibold mb-4 text-gray-800">{entityLabel} Numbering</h3>
      
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      {successMessage && (
        <Alert className="mb-4">
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {entityLabel} Number Prefix
          </label>
          <div className="flex space-x-2">
            <Input
              id={`${entityId}-prefix-input`}
              value={isEditing ? formState.prefix : settings?.prefix ?? ''}
              onChange={(e) => handleInputChange('prefix', e.target.value)}
              disabled={!isEditing}
              className="w-32"
            />
            {!isEditing && isAdmin && (
              <Button
                id={`edit-${entityId}-settings-button`}
                variant="ghost"
                size="sm"
                onClick={() => setIsEditing(true)}
              >
                <Edit2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Padding Length
          </label>
          <div className="flex space-x-2">
            <Input
              id={`${entityId}-padding-length-input`}
              type="number"
              value={isEditing ? formState.padding_length : settings?.padding_length ?? 6}
              onChange={(e) => handleInputChange('padding_length', e.target.value)}
              disabled={!isEditing}
              className="w-32"
              min={1}
              max={10}
            />
          </div>
        </div>

        {settings?.initial_value === null && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Initial Value
            </label>
            <div className="flex space-x-2">
              <Input
                id={`${entityId}-initial-value-input`}
                type="number"
                value={isEditing ? formState.initial_value : ''}
                onChange={(e) => handleInputChange('initial_value', e.target.value)}
                disabled={!isEditing}
                className="w-32"
                min={1}
                placeholder="Enter value"
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Last Used Number
          </label>
          <div className="flex space-x-2">
            <Input
              id={`${entityId}-last-number-input`}
              type="number"
              value={isEditing ? formState.last_number : settings?.last_number ?? 0}
              onChange={(e) => handleInputChange('last_number', e.target.value)}
              disabled={!isEditing}
              className="w-32"
              min={settings?.initial_value ?? 1}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Next {entityLabel} Number Preview
          </label>
          <div className="text-lg font-mono bg-gray-50 p-2 rounded border">
            {previewNumber}
          </div>
        </div>

        {isEditing && (
          <div className="flex space-x-2 mt-4">
            <Button
              id={`save-${entityId}-settings-button`}
              variant="default"
              onClick={() => setShowConfirmation(true)}
              disabled={!isAdmin}
            >
              Save Changes
            </Button>
            <Button
              id={`cancel-${entityId}-settings-button`}
              variant="outline"
              onClick={handleCancel}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>

      <ConfirmationDialog
        id={`${entityId}-settings-confirmation-dialog`}
        isOpen={showConfirmation}
        onClose={() => setShowConfirmation(false)}
        onConfirm={handleSave}
        title={`Update ${entityLabel} Number Settings`}
        message={`Changing these settings will affect how new ${entityType.toLowerCase()} numbers are generated. This change will not affect existing ${entityType.toLowerCase()}s. Are you sure you want to proceed?`}
        confirmLabel="Update Settings"
      />
    </div>
  );
};

export default NumberingSettings;