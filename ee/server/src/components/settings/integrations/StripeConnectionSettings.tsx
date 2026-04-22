'use client';

/**
 * Stripe Connection Settings Component
 *
 * Manages Stripe integration connection for the Integrations settings page.
 * Includes connection management, webhook configuration, and status display.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import {
  CheckCircle,
  CreditCard,
  RefreshCw,
  Unplug,
} from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import {
  getPaymentConfigAction,
  connectStripeAction,
  disconnectStripeAction,
  testStripeConnectionAction,
  retryStripeWebhookConfigurationAction,
} from '@ee/lib/actions/payment-actions';

interface PaymentConfigDisplay {
  provider_type: string;
  is_enabled: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  publishable_key?: string;
  has_webhook_secret: boolean;
  webhook_url?: string;
  webhook_events?: string[];
  webhook_status?: 'enabled' | 'disabled' | 'not_configured';
}

export const StripeConnectionSettings: React.FC = () => {
  const { t } = useTranslation('msp/integrations');
  const [config, setConfig] = useState<PaymentConfigDisplay | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);

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
      } else {
        console.error('Stripe load config failed:', result.error);
        toast.error(t('integrations.stripe.errors.loadConfig', { defaultValue: 'Failed to load Stripe configuration' }));
      }
    } catch (error) {
      console.error('Stripe load config error:', error);
      toast.error(t('integrations.stripe.errors.loadConfig', { defaultValue: 'Failed to load Stripe configuration' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Connect Stripe
  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!secretKey || !publishableKey) {
      toast.error(t('integrations.stripe.errors.bothKeysRequired', { defaultValue: 'Please enter both secret key and publishable key' }));
      return;
    }

    if (!secretKey.startsWith('sk_')) {
      toast.error(t('integrations.stripe.errors.secretKeyFormat', { defaultValue: 'Secret key should start with sk_' }));
      return;
    }

    if (!publishableKey.startsWith('pk_')) {
      toast.error(t('integrations.stripe.errors.publishableKeyFormat', { defaultValue: 'Publishable key should start with pk_' }));
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
          toast.success(t('integrations.stripe.toasts.connectedWithWebhook', { defaultValue: 'Stripe connected and webhooks configured automatically!' }));
        } else {
          toast.success(t('integrations.stripe.toasts.connectedWebhookFailed', { defaultValue: 'Stripe connected! Note: Webhook auto-configuration failed - you may need to configure webhooks manually in Stripe Dashboard.' }));
        }
        setShowConnectForm(false);
        setSecretKey('');
        setPublishableKey('');
        await loadConfig();
      } else {
        console.error('Stripe connect failed:', result.error);
        toast.error(t('integrations.stripe.errors.connect', { defaultValue: 'Failed to connect Stripe' }));
      }
    } catch (error) {
      console.error('Stripe connect error:', error);
      toast.error(t('integrations.stripe.errors.connect', { defaultValue: 'Failed to connect Stripe' }));
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
        toast.success(t('integrations.stripe.toasts.disconnected', { defaultValue: 'Stripe disconnected' }));
        setShowDisconnectDialog(false);
        await loadConfig();
      } else {
        console.error('Stripe disconnect failed:', result.error);
        toast.error(t('integrations.stripe.errors.disconnect', { defaultValue: 'Failed to disconnect Stripe' }));
      }
    } catch (error) {
      console.error('Stripe disconnect error:', error);
      toast.error(t('integrations.stripe.errors.disconnect', { defaultValue: 'Failed to disconnect Stripe' }));
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
        toast.success(result.data?.status || t('integrations.stripe.toasts.connectionSuccess', { defaultValue: 'Connection successful!' }));
      } else {
        console.error('Stripe test failed:', result.error);
        toast.error(t('integrations.stripe.errors.testConnection', { defaultValue: 'Connection test failed' }));
      }
    } catch (error) {
      console.error('Stripe test error:', error);
      toast.error(t('integrations.stripe.errors.testConnection', { defaultValue: 'Connection test failed' }));
    } finally {
      setTesting(false);
    }
  };

  // Retry webhook configuration
  const handleRetryWebhook = async () => {
    setRetryingWebhook(true);
    try {
      const result = await retryStripeWebhookConfigurationAction();
      if (result.success) {
        toast.success(t('integrations.stripe.toasts.webhookConfigured', { defaultValue: 'Webhook configured successfully!' }));
        await loadConfig();
      } else {
        console.error('Stripe webhook retry failed:', result.error);
        toast.error(t('integrations.stripe.errors.configureWebhook', { defaultValue: 'Failed to configure webhook' }));
      }
    } catch (error) {
      console.error('Stripe webhook retry error:', error);
      toast.error(t('integrations.stripe.errors.configureWebhook', { defaultValue: 'Failed to configure webhook' }));
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
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <CreditCard className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <CardTitle>{t('integrations.stripe.title', { defaultValue: 'Stripe Payments' })}</CardTitle>
              <CardDescription>
                {t('integrations.stripe.description', { defaultValue: 'Accept credit card payments for your invoices' })}
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
                        <p className="font-medium">{t('integrations.stripe.connected.title', { defaultValue: 'Stripe Connected' })}</p>
                        <p className="text-sm">
                          {t('integrations.stripe.connected.publishableKey', { defaultValue: 'Publishable key: {{key}}...', key: config.publishable_key?.slice(0, 12) })}
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
                          t('integrations.stripe.actions.testConnection', { defaultValue: 'Test Connection' })
                        )}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setShowDisconnectDialog(true)}
                        id="disconnect-stripe"
                      >
                        <Unplug className="h-4 w-4 mr-1" />
                        {t('integrations.stripe.actions.disconnect', { defaultValue: 'Disconnect' })}
                      </Button>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>

              {/* Webhook Status */}
              {config.webhook_status === 'enabled' ? (
                <div className="space-y-3">
                  <Label>{t('integrations.stripe.webhook.heading', { defaultValue: 'Webhook Configuration' })}</Label>
                  <Alert variant="success" showIcon={false}>
                    <AlertDescription>
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle className="h-4 w-4 text-success" />
                        <span className="font-medium">{t('integrations.stripe.webhook.configuredAutomatically', { defaultValue: 'Webhooks configured automatically' })}</span>
                      </div>
                      <p className="text-sm mb-2">
                        {t('integrations.stripe.webhook.receiveNotifications', { defaultValue: 'Alga PSA will receive payment notifications for:' })}
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
                    <p className="font-medium mb-2">{t('integrations.stripe.webhook.failedTitle', { defaultValue: 'Webhook configuration failed' })}</p>
                    <p className="text-sm mb-3">
                      {t('integrations.stripe.webhook.failedBody', { defaultValue: 'Automatic webhook configuration failed. Click retry to attempt configuration again.' })}
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
                          {t('integrations.stripe.webhook.configuring', { defaultValue: 'Configuring...' })}
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          {t('integrations.stripe.webhook.retry', { defaultValue: 'Retry Configuration' })}
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
                <Label htmlFor="secretKey">{t('integrations.stripe.form.secretKeyLabel', { defaultValue: 'Secret Key' })}</Label>
                <Input
                  id="secretKey"
                  type="password"
                  placeholder={t('integrations.stripe.form.secretKeyPlaceholder', { defaultValue: 'sk_live_... or sk_test_...' })}
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  required
                />
                <p className="text-sm text-gray-500">
                  {t('integrations.stripe.form.findKeyPrefix', { defaultValue: 'Find this in your' })}{' '}
                  <a
                    href="https://dashboard.stripe.com/apikeys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 hover:underline"
                  >
                    {t('integrations.stripe.form.dashboardLink', { defaultValue: 'Stripe Dashboard → API Keys' })}
                  </a>
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="publishableKey">{t('integrations.stripe.form.publishableKeyLabel', { defaultValue: 'Publishable Key' })}</Label>
                <Input
                  id="publishableKey"
                  type="text"
                  placeholder={t('integrations.stripe.form.publishableKeyPlaceholder', { defaultValue: 'pk_live_... or pk_test_...' })}
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
                      {t('integrations.stripe.actions.connecting', { defaultValue: 'Connecting...' })}
                    </>
                  ) : (
                    t('integrations.stripe.actions.connect', { defaultValue: 'Connect Stripe' })
                  )}
                </Button>
                <Button
                  id="connect-stripe-cancel"
                  type="button"
                  variant="outline"
                  onClick={() => setShowConnectForm(false)}
                >
                  {t('integrations.stripe.actions.cancel', { defaultValue: 'Cancel' })}
                </Button>
              </div>
            </form>
          ) : (
            <div className="text-center py-8">
              <CreditCard className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 mb-4">
                {t('integrations.stripe.empty.description', { defaultValue: 'Connect your Stripe account to accept online payments for invoices' })}
              </p>
              <Button id="connect-stripe-button" onClick={() => setShowConnectForm(true)}>
                <CreditCard className="h-4 w-4 mr-2" />
                {t('integrations.stripe.actions.connect', { defaultValue: 'Connect Stripe' })}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Disconnect Stripe Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showDisconnectDialog}
        onClose={() => setShowDisconnectDialog(false)}
        onConfirm={handleDisconnect}
        title={t('integrations.stripe.disconnectDialog.title', { defaultValue: 'Disconnect Stripe' })}
        message={t('integrations.stripe.disconnectDialog.message', { defaultValue: 'Are you sure you want to disconnect Stripe? Payment links will no longer work.' })}
        confirmLabel={t('integrations.stripe.disconnectDialog.confirm', { defaultValue: 'Disconnect' })}
        cancelLabel={t('integrations.stripe.disconnectDialog.cancel', { defaultValue: 'Cancel' })}
        isConfirming={disconnecting}
        id="disconnect-stripe-dialog"
      />
    </>
  );
};

export default StripeConnectionSettings;
