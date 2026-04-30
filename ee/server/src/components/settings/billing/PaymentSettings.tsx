'use client';

/**
 * Payment Settings Component
 *
 * Allows tenants to configure payment providers (Stripe) for invoice payments.
 * Includes connection management, settings configuration, and webhook URL display.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import {
  CheckCircle,
  CreditCard,
  RefreshCw,
  Unplug,
  Settings,
} from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import {
  getPaymentConfigAction,
  connectStripeAction,
  disconnectStripeAction,
  updatePaymentSettingsAction,
  testStripeConnectionAction,
  retryStripeWebhookConfigurationAction,
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
  publishable_key?: string;
  has_webhook_secret: boolean;
  webhook_url?: string;
  webhook_events?: string[];
  webhook_status?: 'enabled' | 'disabled' | 'not_configured';
}

export const PaymentSettings: React.FC = () => {
  const { t } = useTranslation('msp/billing-settings');
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

  // Retry webhook configuration state
  const [retryingWebhook, setRetryingWebhook] = useState(false);

  // Disconnect confirmation dialog state
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

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
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Connect Stripe
  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!secretKey || !publishableKey) {
      toast.error(t('payment.messages.keysRequired'));
      return;
    }

    if (!secretKey.startsWith('sk_')) {
      toast.error(t('payment.messages.invalidSecretKey'));
      return;
    }

    if (!publishableKey.startsWith('pk_')) {
      toast.error(t('payment.messages.invalidPublishableKey'));
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
          toast.success(t('payment.messages.connectSuccess'));
        } else {
          toast.success(t('payment.messages.connectPartialSuccess'));
        }
        setShowConnectForm(false);
        setSecretKey('');
        setPublishableKey('');
        await loadConfig();
      } else {
        toast.error(result.error || t('payment.messages.connectFailed'));
      }
    } catch (error) {
      toast.error(t('payment.messages.connectFailed'));
    } finally {
      setConnecting(false);
    }
  };

  // Disconnect Stripe
  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const result = await disconnectStripeAction();
      if (result.success) {
        toast.success(t('payment.messages.disconnected'));
        setShowDisconnectDialog(false);
        await loadConfig();
      } else {
        toast.error(result.error || t('payment.messages.disconnectFailed'));
      }
    } catch (error) {
      toast.error(t('payment.messages.disconnectFailed'));
    } finally {
      setDisconnecting(false);
    }
  };

  // Test connection
  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const result = await testStripeConnectionAction();
      if (result.success) {
        toast.success(result.data?.status || t('payment.messages.connectionSuccess'));
      } else {
        toast.error(result.error || t('payment.messages.connectionTestFailed'));
      }
    } catch (error) {
      toast.error(t('payment.messages.connectionTestFailed'));
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

  // Retry webhook configuration
  const handleRetryWebhook = async () => {
    setRetryingWebhook(true);
    try {
      const result = await retryStripeWebhookConfigurationAction();
      if (result.success) {
        toast.success(t('payment.messages.webhookConfigured'));
        await loadConfig();
      } else {
        toast.error(result.error || t('payment.messages.webhookConfigureFailed'));
      }
    } catch (error) {
      toast.error(t('payment.messages.webhookConfigureFailed'));
    } finally {
      setRetryingWebhook(false);
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
              <CardTitle>{t('payment.stripe.cardTitle')}</CardTitle>
              <CardDescription>
                {t('payment.stripe.cardDescription')}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {config?.is_enabled ? (
            <div className="space-y-4">
              {/* Connected Status */}
              <Alert variant="success" showIcon={false}>
                <AlertDescription>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="h-5 w-5 text-success" />
                      <div>
                        <p className="font-medium">{t('payment.stripe.connectedTitle')}</p>
                        <p className="text-sm">
                          {t('payment.stripe.publishableKey', { key: config.publishable_key?.slice(0, 12) })}
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
                          t('payment.stripe.testConnection')
                        )}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setShowDisconnectDialog(true)}
                        id="disconnect-stripe"
                      >
                        <Unplug className="h-4 w-4 mr-1" />
                        {t('payment.stripe.disconnect')}
                      </Button>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>

              {/* Webhook Status */}
              {config.webhook_status === 'enabled' ? (
                <div className="space-y-3">
                  <Label>{t('payment.stripe.webhook.label')}</Label>
                  <Alert variant="success" showIcon={false}>
                    <AlertDescription>
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle className="h-4 w-4 text-success" />
                        <span className="font-medium">{t('payment.stripe.webhook.configuredTitle')}</span>
                      </div>
                      <p className="text-sm mb-2">
                        {t('payment.stripe.webhook.configuredDescription')}
                      </p>
                      <ul className="text-sm list-disc list-inside space-y-1">
                        {config.webhook_events?.map((event) => (
                          <li key={event}>{event}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                </div>
              ) : (
                <Alert variant="warning" showIcon={false}>
                  <AlertDescription>
                    <p className="font-medium mb-2">{t('payment.stripe.webhook.failedTitle')}</p>
                    <p className="text-sm mb-3">
                      {t('payment.stripe.webhook.failedDescription')}
                    </p>
                    <Button
                      id="retry-webhook-config"
                      variant="default"
                      size="sm"
                      onClick={handleRetryWebhook}
                      disabled={retryingWebhook}
                    >
                      {retryingWebhook ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          {t('payment.stripe.webhook.configuring')}
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          {t('payment.stripe.webhook.retry')}
                        </>
                      )}
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          ) : showConnectForm ? (
            <form onSubmit={handleConnect} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="secretKey">{t('payment.stripe.connectForm.secretKeyLabel')}</Label>
                <Input
                  id="secretKey"
                  type="password"
                  placeholder={t('payment.stripe.connectForm.secretKeyPlaceholder')}
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  required
                />
                <p className="text-sm text-gray-500">
                  {t('payment.stripe.connectForm.secretKeyHelpPrefix')}{' '}
                  <a
                    href="https://dashboard.stripe.com/apikeys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 hover:underline"
                  >
                    {t('payment.stripe.connectForm.secretKeyHelpLink')}
                  </a>
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="publishableKey">{t('payment.stripe.connectForm.publishableKeyLabel')}</Label>
                <Input
                  id="publishableKey"
                  type="text"
                  placeholder={t('payment.stripe.connectForm.publishableKeyPlaceholder')}
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
                      {t('payment.stripe.connectForm.connecting')}
                    </>
                  ) : (
                    t('payment.stripe.connectForm.connect')
                  )}
                </Button>
                <Button
                  id="connect-stripe-cancel"
                  type="button"
                  variant="outline"
                  onClick={() => setShowConnectForm(false)}
                >
                  {t('payment.stripe.connectForm.cancel')}
                </Button>
              </div>
            </form>
          ) : (
            <div className="text-center py-8">
              <CreditCard className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 mb-4">
                {t('payment.stripe.empty.description')}
              </p>
              <Button id="connect-stripe-button" onClick={() => setShowConnectForm(true)}>
                <CreditCard className="h-4 w-4 mr-2" />
                {t('payment.stripe.empty.connectButton')}
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
                <CardTitle>{t('payment.stripe.settingsCard.title')}</CardTitle>
                <CardDescription>
                  {t('payment.stripe.settingsCard.description')}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
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
            <div className="flex justify-end pt-4 border-t">
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
          </CardContent>
        </Card>
      )}

      {/* Disconnect Stripe Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showDisconnectDialog}
        onClose={() => setShowDisconnectDialog(false)}
        onConfirm={handleDisconnect}
        title={t('payment.stripe.disconnectDialog.title')}
        message={t('payment.stripe.disconnectDialog.message')}
        confirmLabel={t('payment.stripe.disconnectDialog.confirm')}
        cancelLabel={t('payment.stripe.disconnectDialog.cancel')}
        isConfirming={disconnecting}
        id="disconnect-stripe-dialog"
      />
    </div>
  );
};

export default PaymentSettings;
