'use client';

/**
 * Payment Settings Component
 *
 * Allows tenants to configure payment providers (Stripe) for invoice payments.
 * Includes connection management, settings configuration, and webhook URL display.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Switch } from 'server/src/components/ui/Switch';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import {
  AlertCircle,
  CheckCircle,
  CreditCard,
  ExternalLink,
  Copy,
  RefreshCw,
  Unplug,
  Settings,
} from 'lucide-react';
import {
  getPaymentConfigAction,
  connectStripeAction,
  disconnectStripeAction,
  updatePaymentSettingsAction,
  testStripeConnectionAction,
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
  publishable_key?: string;
  has_webhook_secret: boolean;
  webhook_url?: string;
  webhook_events?: string[];
  webhook_status?: 'enabled' | 'disabled' | 'not_configured';
}

export const PaymentSettings: React.FC = () => {
  const [config, setConfig] = useState<PaymentConfigDisplay | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Local state for payment settings (to track changes)
  const [localSettings, setLocalSettings] = useState<PaymentSettingsType | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Form state for connecting Stripe
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [secretKey, setSecretKey] = useState('');
  const [publishableKey, setPublishableKey] = useState('');

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

  // Connect Stripe
  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!secretKey || !publishableKey) {
      toast.error('Please enter both secret key and publishable key');
      return;
    }

    if (!secretKey.startsWith('sk_')) {
      toast.error('Secret key should start with sk_');
      return;
    }

    if (!publishableKey.startsWith('pk_')) {
      toast.error('Publishable key should start with pk_');
      return;
    }

    setConnecting(true);
    try {
      const result = await connectStripeAction({
        secretKey,
        publishableKey,
      });

      if (result.success && result.data) {
        if (result.data.webhookConfigured) {
          toast.success('Stripe connected and webhooks configured automatically!');
        } else {
          toast.success('Stripe connected! Note: Webhook auto-configuration failed - you may need to configure webhooks manually in Stripe Dashboard.');
        }
        setShowConnectForm(false);
        setSecretKey('');
        setPublishableKey('');
        await loadConfig();
      } else {
        toast.error(result.error || 'Failed to connect Stripe');
      }
    } catch (error) {
      toast.error('Failed to connect Stripe');
    } finally {
      setConnecting(false);
    }
  };

  // Disconnect Stripe
  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect Stripe? Payment links will no longer work.')) {
      return;
    }

    try {
      const result = await disconnectStripeAction();
      if (result.success) {
        toast.success('Stripe disconnected');
        await loadConfig();
      } else {
        toast.error(result.error || 'Failed to disconnect Stripe');
      }
    } catch (error) {
      toast.error('Failed to disconnect Stripe');
    }
  };

  // Test connection
  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const result = await testStripeConnectionAction();
      if (result.success) {
        toast.success(result.data?.status || 'Connection successful!');
      } else {
        toast.error(result.error || 'Connection test failed');
      }
    } catch (error) {
      toast.error('Connection test failed');
    } finally {
      setTesting(false);
    }
  };

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

  // Copy webhook URL
  const handleCopyWebhookUrl = () => {
    if (config?.webhook_url) {
      navigator.clipboard.writeText(config.webhook_url);
      toast.success('Webhook URL copied to clipboard');
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stripe Connection Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <CreditCard className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <CardTitle>Stripe Payments</CardTitle>
              <CardDescription>
                Accept credit card payments for your invoices
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {config?.is_enabled ? (
            <div className="space-y-4">
              {/* Connected Status */}
              <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg border border-green-200">
                <div className="flex items-center gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="font-medium text-green-800">Stripe Connected</p>
                    <p className="text-sm text-green-600">
                      Publishable key: {config.publishable_key?.slice(0, 12)}...
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleTestConnection}
                    disabled={testing}
                    id="test-stripe-connection"
                  >
                    {testing ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      'Test Connection'
                    )}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleDisconnect}
                    id="disconnect-stripe"
                  >
                    <Unplug className="h-4 w-4 mr-1" />
                    Disconnect
                  </Button>
                </div>
              </div>

              {/* Webhook Status */}
              <div className="space-y-3">
                <Label>Webhook Configuration</Label>
                {config.webhook_status === 'enabled' ? (
                  <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                    <div className="flex items-center gap-2 text-green-700 mb-2">
                      <CheckCircle className="h-4 w-4" />
                      <span className="font-medium">Webhooks configured automatically</span>
                    </div>
                    <p className="text-sm text-green-600 mb-2">
                      Alga PSA will receive payment notifications for:
                    </p>
                    <ul className="text-sm text-green-600 list-disc list-inside space-y-1">
                      {config.webhook_events?.map((event) => (
                        <li key={event}>{event}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                    <div className="flex items-center gap-2 text-amber-700 mb-2">
                      <AlertCircle className="h-4 w-4" />
                      <span className="font-medium">Manual webhook configuration required</span>
                    </div>
                    <p className="text-sm text-amber-600 mb-2">
                      Add this URL to your{' '}
                      <a
                        href="https://dashboard.stripe.com/webhooks"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-600 hover:underline inline-flex items-center gap-1"
                      >
                        Stripe Dashboard
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </p>
                    <div className="flex gap-2 mt-2">
                      <Input
                        value={config.webhook_url || ''}
                        readOnly
                        className="font-mono text-xs bg-white"
                      />
                      <Button id="copy-webhook-url" variant="outline" size="sm" onClick={handleCopyWebhookUrl}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-amber-500 mt-2">
                      Subscribe to: {config.webhook_events?.join(', ')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : showConnectForm ? (
            <form onSubmit={handleConnect} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="secretKey">Secret Key</Label>
                <Input
                  id="secretKey"
                  type="password"
                  placeholder="sk_live_... or sk_test_..."
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  required
                />
                <p className="text-sm text-gray-500">
                  Find this in your{' '}
                  <a
                    href="https://dashboard.stripe.com/apikeys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 hover:underline"
                  >
                    Stripe Dashboard → API Keys
                  </a>
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="publishableKey">Publishable Key</Label>
                <Input
                  id="publishableKey"
                  type="text"
                  placeholder="pk_live_... or pk_test_..."
                  value={publishableKey}
                  onChange={(e) => setPublishableKey(e.target.value)}
                  required
                />
              </div>

              <div className="flex gap-2">
                <Button id="connect-stripe-submit" type="submit" disabled={connecting}>
                  {connecting ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    'Connect Stripe'
                  )}
                </Button>
                <Button
                  id="connect-stripe-cancel"
                  type="button"
                  variant="outline"
                  onClick={() => setShowConnectForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="text-center py-8">
              <CreditCard className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 mb-4">
                Connect your Stripe account to accept online payments for invoices
              </p>
              <Button id="connect-stripe-button" onClick={() => setShowConnectForm(true)}>
                <CreditCard className="h-4 w-4 mr-2" />
                Connect Stripe
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment Settings Card */}
      {config?.is_enabled && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-100 rounded-lg">
                <Settings className="h-5 w-5 text-gray-600" />
              </div>
              <div>
                <CardTitle>Payment Settings</CardTitle>
                <CardDescription>
                  Configure how payment links work with your invoices
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
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
            <div className="flex justify-end pt-4 border-t">
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
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default PaymentSettings;
