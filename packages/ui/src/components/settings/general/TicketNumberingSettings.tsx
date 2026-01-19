'use client';

import React, { useState, useEffect } from 'react';
import {
  getTicketNumberSettings,
  updateTicketPrefix,
  updateInitialValue,
  updateLastNumber,
  updatePaddingLength
} from '@alga-psa/tickets/actions';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Edit2, Info } from 'lucide-react';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { getCurrentUser } from '@alga-psa/users/actions';
import { toast } from 'react-hot-toast';

interface TicketNumberSettings {
  prefix: string;
  last_number: number;
  initial_value: number | null;
  padding_length: number;
}

const TicketNumberingSettings = () => {
  // General state
  const [settings, setSettings] = useState<TicketNumberSettings | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  // Form state
  const [formState, setFormState] = useState<Partial<TicketNumberSettings>>({});

  useEffect(() => {
    const init = async () => {
      try {
        const [numberSettings, user] = await Promise.all([
          getTicketNumberSettings(),
          getCurrentUser()
        ]);

        if (!numberSettings) {
          setError('No ticket numbering settings found. Please contact your administrator.');
          return;
        }

        setSettings(numberSettings);
        setFormState(numberSettings);
        setIsAdmin(user?.roles?.some(role => role.role_name.toLowerCase() === 'admin') ?? false);
      } catch (err) {
        setError('Failed to load ticket numbering settings');
        console.error('Error:', err);
      }
    };

    init();
  }, []);

  const handleInputChange = (field: keyof TicketNumberSettings, value: string) => {
    setFormState(prev => ({
      ...prev,
      [field]: field === 'prefix' ? value : parseInt(value, 10) || 0
    }));
  };

  const handleSave = async () => {
    try {
      setError(null);

      if (!settings) return;

      // Update each field that changed
      if (formState.prefix !== settings.prefix) {
        await updateTicketPrefix(formState.prefix || '');
      }

      if (formState.padding_length !== settings.padding_length) {
        const result = await updatePaddingLength(formState.padding_length!);
        if (!result.success) {
          throw new Error(result.error || 'Failed to update padding length');
        }
      }

      if (formState.last_number !== settings.last_number) {
        const result = await updateLastNumber(formState.last_number!);
        if (!result.success) {
          throw new Error(result.error || 'Failed to update last number');
        }
      }

      if (settings.initial_value === null && formState.initial_value !== null) {
        const result = await updateInitialValue(formState.initial_value!);
        if (!result.success) {
          throw new Error(result.error || 'Failed to update initial value');
        }
      }

      // Reload settings
      const updatedSettings = await getTicketNumberSettings();
      setSettings(updatedSettings);
      setFormState(updatedSettings);
      toast.success('Settings updated successfully');
      setIsEditing(false);
      setShowConfirmation(false);
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

  if (!settings) {
    return <div>Loading...</div>;
  }

  const nextNumber = isEditing
    ? parseInt((formState.last_number?.toString() ?? '0'), 10) + 1
    : parseInt(settings.last_number.toString(), 10) + 1;

  const paddingLength = isEditing
    ? formState.padding_length ?? 6
    : settings.padding_length ?? 6;

  const prefix = isEditing
    ? (formState.prefix ?? '')
    : (settings.prefix ?? '');

  const paddedNumber = paddingLength > 0
    ? nextNumber.toString().padStart(paddingLength, '0')
    : nextNumber.toString();
  const previewNumber = `${prefix}${paddedNumber}`;

  const InfoTooltip: React.FC<{ text: string }> = ({ text }) => (
    <div className="group relative inline-block ml-1">
      <Info className="h-4 w-4 text-gray-400 cursor-help" />
      <div className="hidden group-hover:block absolute z-10 w-64 p-2 mt-1 text-sm text-white bg-gray-900 rounded-lg shadow-lg -left-28">
        {text}
      </div>
    </div>
  );

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm">
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Section Header */}
      <div className="mb-6">
        <h3 className="text-base font-semibold text-gray-900">Number Format</h3>
        <p className="text-sm text-gray-500 mt-1">Define the prefix, digit padding, and current sequence</p>
      </div>

      <div className="space-y-6">
        {/* Prefix Field */}
        <div>
          <div className="flex items-center mb-2">
            <Label htmlFor="ticket-prefix-input" className="text-sm font-medium text-gray-700">
              Ticket Number Prefix
            </Label>
            <InfoTooltip text="Optional prefix for ticket numbers. Leave empty for no prefix or enter a custom prefix (e.g., 'TK-')" />
          </div>
          <div className="flex items-center space-x-2">
            <Input
              id="ticket-prefix-input"
              value={isEditing ? (formState.prefix ?? '') : (settings.prefix ?? '')}
              onChange={(e) => handleInputChange('prefix', e.target.value)}
              disabled={!isEditing}
              className="!w-48"
              placeholder="TK-"
            />
            {!isEditing && isAdmin && (
              <Button
                id="edit-ticket-settings-button"
                variant="ghost"
                size="sm"
                onClick={() => setIsEditing(true)}
              >
                <Edit2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Minimum Digits Field */}
        <div>
          <div className="flex items-center mb-2">
            <Label htmlFor="ticket-padding-length-input" className="text-sm font-medium text-gray-700">
              Minimum Digits
            </Label>
            <InfoTooltip text="Minimum number of digits for the sequential number. For example, 6 makes '1' become '000001'" />
          </div>
          <div className="flex items-center space-x-2">
            <Input
              id="ticket-padding-length-input"
              type="number"
              value={isEditing ? formState.padding_length : settings.padding_length ?? 6}
              onChange={(e) => handleInputChange('padding_length', e.target.value)}
              disabled={!isEditing}
              className="!w-48"
              min={0}
              max={10}
            />
          </div>
        </div>

        {/* Initial Value Field (only if not yet set) */}
        {settings.initial_value === null && (
          <div>
            <div className="flex items-center mb-2">
              <Label htmlFor="ticket-initial-value-input" className="text-sm font-medium text-gray-700">
                Initial Value
              </Label>
              <InfoTooltip text="Set the starting number for the sequence. This can only be set once." />
            </div>
            <div className="flex items-center space-x-2">
              <Input
                id="ticket-initial-value-input"
                type="number"
                value={isEditing ? (formState.initial_value ?? '') : ''}
                onChange={(e) => handleInputChange('initial_value', e.target.value)}
                disabled={!isEditing}
                className="!w-48"
                min={1}
                placeholder="Enter value"
              />
            </div>
          </div>
        )}

        {/* Last Used Number Field */}
        <div>
          <div className="flex items-center mb-2">
            <Label htmlFor="ticket-last-number-input" className="text-sm font-medium text-gray-700">
              Last Used Number
            </Label>
            <InfoTooltip text="The last number that was assigned. The next number will be one higher than this value." />
          </div>
          <div className="flex items-center space-x-2">
            <Input
              id="ticket-last-number-input"
              type="number"
              value={isEditing ? formState.last_number : settings.last_number}
              onChange={(e) => handleInputChange('last_number', e.target.value)}
              disabled={!isEditing}
              className="!w-48"
              min={settings.initial_value ?? 1}
            />
          </div>
        </div>

        {/* Preview Section */}
        <div className="pt-4 border-t">
          <div className="mb-2">
            <Label className="text-sm font-medium text-gray-700">
              Next Ticket Number Preview
            </Label>
            <p className="text-xs text-gray-500 mt-1">This is the number that will be assigned to the next ticket</p>
          </div>
          <div className="inline-block px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg">
            <span className="text-2xl font-mono font-semibold text-gray-900">{previewNumber}</span>
          </div>
        </div>

        {/* Action Buttons */}
        {isEditing && (
          <div className="flex space-x-3 pt-4">
            <Button
              id="save-ticket-settings-button"
              variant="default"
              onClick={() => setShowConfirmation(true)}
              disabled={!isAdmin}
            >
              Save Changes
            </Button>
            <Button
              id="cancel-ticket-settings-button"
              variant="outline"
              onClick={handleCancel}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>

      <ConfirmationDialog
        id="ticket-settings-confirmation-dialog"
        isOpen={showConfirmation}
        onClose={() => setShowConfirmation(false)}
        onConfirm={handleSave}
        title="Update Ticket Number Settings"
        message="Changing these settings will affect how new ticket numbers are generated. This change will not affect existing tickets. Are you sure you want to proceed?"
        confirmLabel="Update Settings"
      />
    </div>
  );
};

export default TicketNumberingSettings;
