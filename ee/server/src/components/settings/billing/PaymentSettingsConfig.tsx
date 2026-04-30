'use client';

/**
 * Payment Settings Configuration Component
 *
 * Manages payment-related settings for the Billing settings page.
 * Includes settings for payment links, confirmations, and expiration.
 * Requires Stripe to be connected (configured in Integrations).
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import {
  AlertCircle,
  RefreshCw,
  CreditCard,
} from 'lucide-react';
import {
  getPaymentConfigAction,
  updatePaymentSettingsAction,
} from '@ee/lib/actions/payment-actions';
import type { PaymentSettings as PaymentSettingsType } from 'server/src/interfaces/payment.interfaces';

// Payment Link Expiration Selector Component
interface PaymentLinkExpirationSelectorProps {
  value: number; // hours
  onChange: (hours: number) => void;
  disabled?: boolean;
}

const PaymentLinkExpirationSelector: React.FC<PaymentLinkExpirationSelectorProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  const { t } = useTranslation('msp/billing-settings');

  // Predefined expiration options in hours
  const expirationOptions = useMemo(() => [
    { hours: 24, label: t('payment.expiration.daysSingular', { count: 1 }) },
    { hours: 48, label: t('payment.expiration.daysPlural', { count: 2 }) },
    { hours: 72, label: t('payment.expiration.daysPlural', { count: 3 }) },
    { hours: 168, label: t('payment.expiration.daysPlural', { count: 7 }) },
    { hours: 336, label: t('payment.expiration.daysPlural', { count: 14 }) },
    { hours: 720, label: t('payment.expiration.daysPlural', { count: 30 }) },
  ], [t]);

  // Check if current value matches a predefined option
  const currentOption = expirationOptions.find(opt => opt.hours === value);
  const isCustom = !currentOption;

  // Format hours to a readable string
  const formatHours = (hours: number): string => {
    if (hours < 24) {
      return hours === 1
        ? t('payment.expiration.hoursSingular', { count: hours })
        : t('payment.expiration.hoursPlural', { count: hours });
    }
    const days = hours / 24;
    if (days === Math.floor(days)) {
      return days === 1
        ? t('payment.expiration.daysSingular', { count: days })
        : t('payment.expiration.daysPlural', { count: days });
    }
    return t('payment.expiration.daysDecimal', { count: Number(days.toFixed(1)) });
  };

  // Create select options
  const selectOptions = useMemo(() => [
    ...expirationOptions.map(opt => ({
      value: opt.hours.toString(),
      label: opt.label,
    })),
    { value: 'custom', label: t('payment.expiration.custom') },
  ], [expirationOptions, t]);

  const [showCustomInput, setShowCustomInput] = useState(isCustom);
  const [customHours, setCustomHours] = useState(isCustom ? value : 168);

  const handleSelectChange = (selectedValue: string) => {
    if (selectedValue === 'custom') {
      setShowCustomInput(true);
      setCustomHours(value);
    } else {
      setShowCustomInput(false);
      const hours = parseInt(selectedValue, 10);
      onChange(hours);
    }
  };

  const handleCustomHoursChange = (hours: number) => {
    setCustomHours(hours);
    onChange(hours);
  };

  return (
    <div className="space-y-3">
      <CustomSelect
        options={selectOptions}
        value={isCustom ? 'custom' : value.toString()}
        onValueChange={handleSelectChange}
        placeholder={t('payment.expiration.selectPlaceholder')}
        disabled={disabled}
        className="w-full max-w-xs"
      />

      {showCustomInput && (
        <div className="flex items-center gap-2 pl-2">
          <Input
            type="number"
            min={1}
            max={720}
            value={customHours}
            onChange={(e) => {
              const hours = parseInt(e.target.value, 10) || 168;
              handleCustomHoursChange(hours);
            }}
            className="w-24"
            disabled={disabled}
          />
          <span className="text-sm text-gray-500">
            {t('payment.expiration.hoursUnit', { formatted: formatHours(customHours) })}
          </span>
        </div>
      )}

      {!showCustomInput && currentOption && (
        <p className="text-sm text-gray-500 pl-2">
          {t('payment.expiration.willExpireAfter', { duration: formatHours(value) })}
        </p>
      )}
    </div>
  );
};

interface PaymentConfigDisplay {
  provider_type: string;
  is_enabled: boolean;
  is_default: boolean;
  settings: PaymentSettingsType;
  created_at: string;
  updated_at: string;
}

export const PaymentSettingsConfig: React.FC = () => {
  const { t } = useTranslation('msp/billing-settings');
  const [config, setConfig] = useState<PaymentConfigDisplay | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  // Local state for payment settings (to track changes)
  const [localSettings, setLocalSettings] = useState<PaymentSettingsType | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Load current configuration
  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getPaymentConfigAction();
      if (result.success) {
        setConfig(result.data || null);
        // Initialize local settings with loaded config
        if (result.data?.settings) {
          setLocalSettings(result.data.settings);
          setHasChanges(false);
        }
      } else {
        toast.error(result.error || t('payment.messages.loadConfigFailed'));
      }
    } catch (error) {
      toast.error(t('payment.messages.loadConfigFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Update local settings (for tracking changes)
  const handleLocalSettingsChange = (updates: Partial<PaymentSettingsType>) => {
    if (!localSettings) return;
    const newSettings = { ...localSettings, ...updates };
    setLocalSettings(newSettings);

    // Check if settings have changed from original config
    if (config?.settings) {
      const hasChanged = JSON.stringify(newSettings) !== JSON.stringify(config.settings);
      setHasChanges(hasChanged);
    }
  };

  // Save settings
  const handleSaveSettings = async () => {
    if (!localSettings || !hasChanges) return;

    setSavingSettings(true);
    try {
      const result = await updatePaymentSettingsAction(localSettings);
      if (result.success && result.data) {
        setConfig((prev) => prev ? { ...prev, settings: result.data! } : null);
        setLocalSettings(result.data);
        setHasChanges(false);
        toast.success(t('payment.messages.settingsSaved'));
      } else {
        toast.error(result.error || t('payment.messages.saveSettingsFailed'));
      }
    } catch (error) {
      toast.error(t('payment.messages.saveSettingsFailed'));
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  // If Stripe is not connected, show a message
  if (!config?.is_enabled) {
    return (
      <div className="text-center py-8">
        <div className="flex justify-center mb-4">
          <div className="p-3 bg-warning/15 rounded-full">
            <AlertCircle className="h-8 w-8 text-amber-600" />
          </div>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">{t('payment.notConnected.title')}</h3>
        <p className="text-gray-500 mb-4 max-w-md mx-auto">
          {t('payment.notConnected.description')}
        </p>
        <Link href="/msp/settings?tab=Integrations&category=payments">
          <Button id="go-to-integrations">
            <CreditCard className="h-4 w-4 mr-2" />
            {t('payment.notConnected.connectButton')}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Payment Links in Emails */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label>{t('payment.settings.paymentLinksInEmails.label')}</Label>
          <p className="text-sm text-gray-500">
            {t('payment.settings.paymentLinksInEmails.description')}
          </p>
        </div>
        <Switch
          checked={localSettings?.paymentLinksInEmails ?? false}
          onCheckedChange={(checked) =>
            handleLocalSettingsChange({ paymentLinksInEmails: checked })
          }
          disabled={savingSettings}
        />
      </div>

      {/* Payment Confirmations */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label>{t('payment.settings.paymentConfirmations.label')}</Label>
          <p className="text-sm text-gray-500">
            {t('payment.settings.paymentConfirmations.description')}
          </p>
        </div>
        <Switch
          checked={localSettings?.sendPaymentConfirmations ?? false}
          onCheckedChange={(checked) =>
            handleLocalSettingsChange({ sendPaymentConfirmations: checked })
          }
          disabled={savingSettings}
        />
      </div>

      {/* Payment Link Expiration */}
      <div className="space-y-2">
        <Label>{t('payment.settings.paymentLinkExpiration.label')}</Label>
        <p className="text-sm text-gray-500">
          {t('payment.settings.paymentLinkExpiration.description')}
        </p>
        <PaymentLinkExpirationSelector
          value={localSettings?.paymentLinkExpirationHours ?? 168}
          onChange={(hours) =>
            handleLocalSettingsChange({
              paymentLinkExpirationHours: hours,
            })
          }
          disabled={savingSettings}
        />
      </div>

      {/* Save Button */}
      <div className="flex justify-end pt-4">
        <Button
          id="save-payment-settings"
          onClick={handleSaveSettings}
          disabled={!hasChanges || savingSettings}
        >
          {savingSettings ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              {t('payment.settings.actions.saving')}
            </>
          ) : (
            t('payment.settings.actions.save')
          )}
        </Button>
      </div>
    </div>
  );
};

export default PaymentSettingsConfig;
