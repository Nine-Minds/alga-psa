'use client';

import React, { useState, useEffect } from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Button } from 'server/src/components/ui/Button';
import { toast } from 'react-hot-toast';
import { Edit2 } from 'lucide-react';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import type { EntityType } from 'server/src/lib/services/numberingService';
import { getNumberSettings, updateNumberSettings, type NumberSettings } from '@product/actions/number-actions/numberingActions';

interface NumberingSettingsProps {
  entityType: EntityType;
}

const NumberingSettings: React.FC<NumberingSettingsProps> = ({ entityType }) => {
  // General state
  const [settings, setSettings] = useState<NumberSettings | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
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
            prefix: '',
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
      [field]: field === 'prefix' ? value : parseInt(value, 10) || 0
    }));
  };

  const handleSave = async () => {
    try {
      setError(null);

      // Only include fields that have actually changed
      const changes: Partial<NumberSettings> = {};
      if (settings) {
        // Handle prefix - explicitly include empty string to clear prefix
        if (formState.prefix !== settings.prefix) {
          changes.prefix = formState.prefix === '' ? '' : (formState.prefix || '');
        }
        if (formState.padding_length !== settings.padding_length) changes.padding_length = formState.padding_length;
        if (formState.last_number !== settings.last_number) changes.last_number = formState.last_number;
        // Only include initial_value if it's being explicitly changed
        if (settings.initial_value === null && formState.initial_value !== null) {
          changes.initial_value = formState.initial_value;
        }
      }

      const result = await updateNumberSettings(entityType, changes);
      
      if (result.success && result.settings) {
        setSettings(result.settings);
        setFormState(result.settings);
        toast.success('Settings updated successfully');
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
    ? (formState.prefix ?? '')
    : (settings?.prefix ?? '');

  const paddedNumber = paddingLength > 0 
    ? nextNumber.toString().padStart(paddingLength, '0')
    : nextNumber.toString();
  const previewNumber = `${prefix}${paddedNumber}`;

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm">
      <h3 className="text-lg font-semibold mb-4 text-gray-800">{entityLabel} Numbering</h3>
      
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
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
              value={isEditing ? (formState.prefix ?? '') : (settings?.prefix ?? '')}
              onChange={(e) => handleInputChange('prefix', e.target.value)}
              disabled={!isEditing}
              className="w-32"
              placeholder={entityType === 'TICKET' ? 'TK-' : 'INV-'}
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
          <p className="text-xs text-gray-500 mt-1">
            Optional. Leave empty for no prefix or enter a custom prefix (e.g., "{entityType === 'TICKET' ? 'TK-' : 'INV-'}", "{entityType === 'TICKET' ? 'TICKET-' : 'INVOICE-'}")
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Minimum Digits
          </label>
          <div className="flex space-x-2">
            <Input
              id={`${entityId}-padding-length-input`}
              type="number"
              value={isEditing ? formState.padding_length : settings?.padding_length ?? 6}
              onChange={(e) => handleInputChange('padding_length', e.target.value)}
              disabled={!isEditing}
              className="w-32"
              min={0}
              max={10}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Minimum total digits. E.g., 6 makes "1" become "000001"
          </p>
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
