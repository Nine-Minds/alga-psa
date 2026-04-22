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
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { toast } from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface TicketNumberSettings {
  prefix: string;
  last_number: number;
  initial_value: number | null;
  padding_length: number;
}

const TicketNumberingSettings = () => {
  const { t } = useTranslation('msp/settings');
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
          setError(t('ticketing.numbering.messages.error.noSettings'));
          return;
        }

        setSettings(numberSettings);
        setFormState(numberSettings);
        setIsAdmin(user?.roles?.some(role => role.role_name.toLowerCase() === 'admin') ?? false);
      } catch (err) {
        setError(t('ticketing.numbering.messages.error.loadFailed'));
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
          throw new Error(result.error || t('ticketing.numbering.messages.error.updatePaddingFailed'));
        }
      }

      if (formState.last_number !== settings.last_number) {
        const result = await updateLastNumber(formState.last_number!);
        if (!result.success) {
          throw new Error(result.error || t('ticketing.numbering.messages.error.updateLastNumberFailed'));
        }
      }

      if (settings.initial_value === null && formState.initial_value !== null) {
        const result = await updateInitialValue(formState.initial_value!);
        if (!result.success) {
          throw new Error(result.error || t('ticketing.numbering.messages.error.updateInitialValueFailed'));
        }
      }

      // Reload settings
      const updatedSettings = await getTicketNumberSettings();
      setSettings(updatedSettings);
      setFormState(updatedSettings);
      toast.success(t('ticketing.numbering.messages.success.updated'));
      setIsEditing(false);
      setShowConfirmation(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ticketing.numbering.messages.error.updateFailed'));
      console.error(err);
    }
  };

  const handleCancel = () => {
    setError(null);
    setFormState(settings || {});
    setIsEditing(false);
  };

  if (!settings) {
    return <div>{t('ticketing.numbering.loading')}</div>;
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
        <h3 className="text-base font-semibold text-gray-900">{t('ticketing.numbering.title')}</h3>
        <p className="text-sm text-gray-500 mt-1">{t('ticketing.numbering.description')}</p>
      </div>

      <div className="space-y-6">
        {/* Prefix Field */}
        <div>
          <div className="flex items-center mb-2">
            <Label htmlFor="ticket-prefix-input" className="text-sm font-medium text-gray-700">
              {t('ticketing.numbering.fields.prefix.label')}
            </Label>
            <InfoTooltip text={t('ticketing.numbering.fields.prefix.help')} />
          </div>
          <div className="flex items-center space-x-2">
            <Input
              id="ticket-prefix-input"
              value={isEditing ? (formState.prefix ?? '') : (settings.prefix ?? '')}
              onChange={(e) => handleInputChange('prefix', e.target.value)}
              disabled={!isEditing}
              className="!w-48"
              placeholder={t('ticketing.numbering.fields.prefix.placeholder')}
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
              {t('ticketing.numbering.fields.minimumDigits.label')}
            </Label>
            <InfoTooltip text={t('ticketing.numbering.fields.minimumDigits.help')} />
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
                {t('ticketing.numbering.fields.initialValue.label')}
              </Label>
              <InfoTooltip text={t('ticketing.numbering.fields.initialValue.help')} />
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
                placeholder={t('ticketing.numbering.fields.initialValue.placeholder')}
              />
            </div>
          </div>
        )}

        {/* Last Used Number Field */}
        <div>
          <div className="flex items-center mb-2">
            <Label htmlFor="ticket-last-number-input" className="text-sm font-medium text-gray-700">
              {t('ticketing.numbering.fields.lastUsedNumber.label')}
            </Label>
            <InfoTooltip text={t('ticketing.numbering.fields.lastUsedNumber.help')} />
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
              {t('ticketing.numbering.fields.nextPreview.label')}
            </Label>
            <p className="text-xs text-gray-500 mt-1">{t('ticketing.numbering.fields.nextPreview.help')}</p>
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
              {t('ticketing.numbering.actions.saveChanges')}
            </Button>
            <Button
              id="cancel-ticket-settings-button"
              variant="outline"
              onClick={handleCancel}
            >
              {t('ticketing.numbering.actions.cancel')}
            </Button>
          </div>
        )}
      </div>

      <ConfirmationDialog
        id="ticket-settings-confirmation-dialog"
        isOpen={showConfirmation}
        onClose={() => setShowConfirmation(false)}
        onConfirm={handleSave}
        title={t('ticketing.numbering.dialog.title')}
        message={t('ticketing.numbering.dialog.message')}
        confirmLabel={t('ticketing.numbering.dialog.confirm')}
      />
    </div>
  );
};

export default TicketNumberingSettings;
