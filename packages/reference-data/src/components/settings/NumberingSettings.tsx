'use client';

import { useEffect, useState } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { toast } from 'react-hot-toast';
import { Edit2, Info } from 'lucide-react';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { EntityType } from '@alga-psa/shared/services/numberingService';
import { getNumberSettings, updateNumberSettings, canEditNumberingSettings, type NumberSettings } from '@alga-psa/reference-data/actions';

interface NumberingSettingsProps {
  entityType: EntityType;
}

const NumberingSettings = ({ entityType }: NumberingSettingsProps): React.JSX.Element => {
  const { t } = useTranslation('msp/billing-settings');
  // General state
  const [settings, setSettings] = useState<NumberSettings | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  // Form state
  const [formState, setFormState] = useState<Partial<NumberSettings>>({});

  const entityId = entityType.toLowerCase();

  useEffect(() => {
    const init = async () => {
      try {
        const [numberSettings, hasEditPermission] = await Promise.all([
          getNumberSettings(entityType),
          canEditNumberingSettings()
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

        setCanEdit(hasEditPermission);
      } catch (err) {
        setError(t('numbering.errors.load'));
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
        toast.success(t('numbering.toast.updated'));
        setIsEditing(false);
        setShowConfirmation(false);
      } else {
        throw new Error(result.error || t('numbering.errors.save'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('numbering.errors.save'));
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
        <h3 className="text-base font-semibold text-gray-900">{t('numbering.section.title')}</h3>
        <p className="text-sm text-gray-500 mt-1">{t('numbering.section.description')}</p>
      </div>

      <div className="space-y-6">
        {/* Prefix Field */}
        <div>
          <div className="flex items-center mb-2">
            <Label htmlFor={`${entityId}-prefix-input`} className="text-sm font-medium text-gray-700">
              {t('numbering.fields.prefix.label')}
            </Label>
            <InfoTooltip text={t('numbering.fields.prefix.help')} />
          </div>
          <div className="flex items-center space-x-2">
            <Input
              id={`${entityId}-prefix-input`}
              value={isEditing ? (formState.prefix ?? '') : (settings?.prefix ?? '')}
              onChange={(e) => handleInputChange('prefix', e.target.value)}
              disabled={!isEditing}
              className="!w-48"
              placeholder={
                entityType === 'TICKET'
                  ? 'TK-'
                  : entityType === 'INVOICE'
                  ? 'INV-'
                  : entityType === 'QUOTE'
                  ? 'QT-'
                  : 'PRJ-'
              }
            />
            {!isEditing && canEdit && (
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
              {t('numbering.fields.minimumDigits.label')}
            </Label>
            <InfoTooltip text={t('numbering.fields.minimumDigits.help')} />
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
                {t('numbering.fields.initialValue.label')}
              </Label>
              <InfoTooltip text={t('numbering.fields.initialValue.help')} />
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
                placeholder={t('numbering.fields.initialValue.placeholder')}
              />
            </div>
          </div>
        )}

        {/* Last Used Number Field */}
        <div>
          <div className="flex items-center mb-2">
            <Label htmlFor={`${entityId}-last-number-input`} className="text-sm font-medium text-gray-700">
              {t('numbering.fields.lastUsedNumber.label')}
            </Label>
            <InfoTooltip text={t('numbering.fields.lastUsedNumber.help')} />
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
              {t('numbering.fields.nextPreview.label')}
            </Label>
            <p className="text-xs text-gray-500 mt-1">{t('numbering.fields.nextPreview.help')}</p>
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
              disabled={!canEdit}
            >
              {t('numbering.actions.save')}
            </Button>
            <Button
              id={`cancel-${entityId}-settings-button`}
              variant="outline"
              onClick={handleCancel}
            >
              {t('numbering.actions.cancel')}
            </Button>
          </div>
        )}
      </div>

      <ConfirmationDialog
        id={`${entityId}-settings-confirmation-dialog`}
        isOpen={showConfirmation}
        onClose={() => setShowConfirmation(false)}
        onConfirm={handleSave}
        title={t('numbering.dialog.title')}
        message={t('numbering.dialog.message')}
        confirmLabel={t('numbering.dialog.confirm')}
      />
    </div>
  );
};

export default NumberingSettings;
