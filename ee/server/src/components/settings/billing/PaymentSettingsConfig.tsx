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
  // Predefined expiration options in hours
  const expirationOptions = useMemo(() => [
    { hours: 24, label: '1 day' },
    { hours: 48, label: '2 days' },
    { hours: 72, label: '3 days' },
    { hours: 168, label: '7 days' },
    { hours: 336, label: '14 days' },
    { hours: 720, label: '30 days' },
  ], []);

  // Check if current value matches a predefined option
  const currentOption = expirationOptions.find(opt => opt.hours === value);
  const isCustom = !currentOption;

  // Format hours to a readable string
  const formatHours = (hours: number): string => {
    if (hours < 24) {
      return `${hours} hour${hours !== 1 ? 's' : ''}`;
    }
    const days = hours / 24;
    if (days === Math.floor(days)) {
      return `${days} day${days !== 1 ? 's' : ''}`;
    }
    return `${days.toFixed(1)} days`;
  };

  // Create select options
  const selectOptions = useMemo(() => [
    ...expirationOptions.map(opt => ({
      value: opt.hours.toString(),
      label: opt.label,
    })),
    { value: 'custom', label: 'Custom...' },
  ], [expirationOptions]);

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
        placeholder="Select expiration time"
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
            hours ({formatHours(customHours)})
          </span>
        </div>
      )}

      {!showCustomInput && currentOption && (
        <p className="text-sm text-gray-500 pl-2">
          Payment links will expire after {formatHours(value)}
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
        toast.error(result.error || 'Failed to load payment configuration');
      }
    } catch (error) {
      toast.error('Failed to load payment configuration');
    } finally {
      setLoading(false);
    }
  }, []);

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
        toast.success('Settings saved successfully');
      } else {
        toast.error(result.error || 'Failed to save settings');
      }
    } catch (error) {
      toast.error('Failed to save settings');
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
          <div className="p-3 bg-amber-100 rounded-full">
            <AlertCircle className="h-8 w-8 text-amber-600" />
          </div>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">Stripe Not Connected</h3>
        <p className="text-gray-500 mb-4 max-w-md mx-auto">
          To configure payment settings, you need to connect your Stripe account first.
        </p>
        <Link href="/msp/settings?tab=Integrations&category=payments">
          <Button id="go-to-integrations">
            <CreditCard className="h-4 w-4 mr-2" />
            Connect Stripe
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
          <Label>Include Payment Links in Invoice Emails</Label>
          <p className="text-sm text-gray-500">
            Add a &quot;Pay Now&quot; button to invoice emails
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
          <Label>Send Payment Confirmation Emails</Label>
          <p className="text-sm text-gray-500">
            Email customers when their payment is received
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
        <Label>Payment Link Expiration</Label>
        <p className="text-sm text-gray-500">
          How long payment links remain valid before expiring
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
              Saving...
            </>
          ) : (
            'Save Settings'
          )}
        </Button>
      </div>
    </div>
  );
};

export default PaymentSettingsConfig;
