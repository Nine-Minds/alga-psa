'use client';

import { useEffect, useState } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { toast } from 'react-hot-toast';
import { Edit2, Info } from 'lucide-react';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useSession } from 'next-auth/react';
import type { EntityType } from '@alga-psa/shared/services/numberingService';
import { getNumberSettings, updateNumberSettings, type NumberSettings } from '@alga-psa/reference-data/actions';

interface NumberingSettingsProps {
  entityType: EntityType;
}

const NumberingSettings = ({ entityType }: NumberingSettingsProps): React.JSX.Element => {
  const { data: session } = useSession();
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
        const numberSettings = await getNumberSettings(entityType);

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

        const roles = (session?.user as any)?.roles as Array<{ role_name?: string }> | undefined;
        setIsAdmin(roles?.some((role) => role.role_name?.toLowerCase() === 'admin') ?? false);
      } catch (err) {
        setError(`Failed to load ${entityType.toLowerCase()} numbering settings`);
        console.error('Error:', err);
      }
    };

    init();
  }, [entityType, session]);

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
            <Label htmlFor={`${entityId}-prefix-input`} className="text-sm font-medium text-gray-700">
              {entityLabel} Number Prefix
            </Label>
            <InfoTooltip text={`Optional prefix for ${entityType.toLowerCase()} numbers. Leave empty for no prefix or enter a custom prefix (e.g., "${entityType === 'TICKET' ? 'TK-' : entityType === 'INVOICE' ? 'INV-' : entityType === 'PROJECT' ? 'PROJECT-' : ''}")`} />
          </div>
          <div className="flex items-center space-x-2">
            <Input
              id={`${entityId}-prefix-input`}
              value={isEditing ? (formState.prefix ?? '') : (settings?.prefix ?? '')}
              onChange={(e) => handleInputChange('prefix', e.target.value)}
              disabled={!isEditing}
              className="!w-48"
              placeholder={entityType === 'TICKET' ? 'TK-' : entityType === 'INVOICE' ? 'INV-' : 'PRJ-'}
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

        {/* Minimum Digits Field */}
        <div>
          <div className="flex items-center mb-2">
            <Label htmlFor={`${entityId}-padding-length-input`} className="text-sm font-medium text-gray-700">
              Minimum Digits
            </Label>
            <InfoTooltip text="Minimum number of digits for the sequential number. For example, 6 makes '1' become '000001'" />
          </div>
          <div className="flex items-center space-x-2">
            <Input
              id={`${entityId}-padding-length-input`}
              type="number"
              value={isEditing ? formState.padding_length : settings?.padding_length ?? 6}
              onChange={(e) => handleInputChange('padding_length', e.target.value)}
              disabled={!isEditing}
              className="!w-48"
              min={0}
              max={10}
            />
          </div>
        </div>

        {/* Initial Value Field (only if not yet set) */}
        {settings?.initial_value === null && (
          <div>
            <div className="flex items-center mb-2">
              <Label htmlFor={`${entityId}-initial-value-input`} className="text-sm font-medium text-gray-700">
                Initial Value
              </Label>
              <InfoTooltip text="Set the starting number for the sequence. This can only be set once." />
            </div>
            <div className="flex items-center space-x-2">
              <Input
                id={`${entityId}-initial-value-input`}
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
            <Label htmlFor={`${entityId}-last-number-input`} className="text-sm font-medium text-gray-700">
              Last Used Number
            </Label>
            <InfoTooltip text="The last number that was assigned. The next number will be one higher than this value." />
          </div>
          <div className="flex items-center space-x-2">
            <Input
              id={`${entityId}-last-number-input`}
              type="number"
              value={isEditing ? formState.last_number : settings?.last_number ?? 0}
              onChange={(e) => handleInputChange('last_number', e.target.value)}
              disabled={!isEditing}
              className="!w-48"
              min={settings?.initial_value ?? 1}
            />
          </div>
        </div>

        {/* Preview Section */}
        <div className="pt-4 border-t">
          <div className="mb-2">
            <Label className="text-sm font-medium text-gray-700">
              Next {entityLabel} Number Preview
            </Label>
            <p className="text-xs text-gray-500 mt-1">This is the number that will be assigned to the next {entityType.toLowerCase()}</p>
          </div>
          <div className="inline-block px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg">
            <span className="text-lg font-mono">{previewNumber}</span>
          </div>
        </div>

        {/* Action Buttons */}
        {isEditing && (
          <div className="flex space-x-3 pt-4">
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
