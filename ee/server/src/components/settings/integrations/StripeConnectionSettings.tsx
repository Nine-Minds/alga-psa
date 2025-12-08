'use client';

/**
 * Stripe Connection Settings Component
 *
 * Manages Stripe integration connection for the Integrations settings page.
 * Includes connection management, webhook configuration, and status display.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import {
  AlertCircle,
  CheckCircle,
  CreditCard,
  RefreshCw,
  Unplug,
} from 'lucide-react';
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
        toast.error(result.error || 'Failed to load Stripe configuration');
      }
    } catch (error) {
      toast.error('Failed to load Stripe configuration');
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
    setDisconnecting(true);
    try {
      const result = await disconnectStripeAction();
      if (result.success) {
        toast.success('Stripe disconnected');
        setShowDisconnectDialog(false);
        await loadConfig();
      } else {
        toast.error(result.error || 'Failed to disconnect Stripe');
      }
    } catch (error) {
      toast.error('Failed to disconnect Stripe');
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

  // Retry webhook configuration
  const handleRetryWebhook = async () => {
    setRetryingWebhook(true);
    try {
      const result = await retryStripeWebhookConfigurationAction();
      if (result.success) {
        toast.success('Webhook configured successfully!');
        await loadConfig();
      } else {
        toast.error(result.error || 'Failed to configure webhook');
      }
    } catch (error) {
      toast.error('Failed to configure webhook');
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
                    onClick={() => setShowDisconnectDialog(true)}
                    id="disconnect-stripe"
                  >
                    <Unplug className="h-4 w-4 mr-1" />
                    Disconnect
                  </Button>
                </div>
              </div>

              {/* Webhook Status */}
              {config.webhook_status === 'enabled' ? (
                <div className="space-y-3">
                  <Label>Webhook Configuration</Label>
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
                </div>
              ) : (
                <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                  <div className="flex items-center gap-2 text-amber-700 mb-2">
                    <AlertCircle className="h-4 w-4" />
                    <span className="font-medium">Webhook configuration failed</span>
                  </div>
                  <p className="text-sm text-amber-600 mb-3">
                    Automatic webhook configuration failed. Click retry to attempt configuration again.
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
                        Configuring...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Retry Configuration
                      </>
                    )}
                  </Button>
                </div>
              )}
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

      {/* Disconnect Stripe Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showDisconnectDialog}
        onClose={() => setShowDisconnectDialog(false)}
        onConfirm={handleDisconnect}
        title="Disconnect Stripe"
        message="Are you sure you want to disconnect Stripe? Payment links will no longer work."
        confirmLabel="Disconnect"
        cancelLabel="Cancel"
        isConfirming={disconnecting}
        id="disconnect-stripe-dialog"
      />
    </>
  );
};

export default StripeConnectionSettings;
