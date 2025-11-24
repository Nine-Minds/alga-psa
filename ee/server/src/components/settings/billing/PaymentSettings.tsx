'use client';

/**
 * Payment Settings Component
 *
 * Allows tenants to configure payment providers (Stripe) for invoice payments.
 * Includes connection management, settings configuration, and webhook URL display.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Switch } from 'server/src/components/ui/Switch';
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
  getStripeWebhookUrlAction,
} from '@ee/lib/actions/payment-actions';
import type { PaymentSettings as PaymentSettingsType } from 'server/src/interfaces/payment.interfaces';

interface PaymentConfigDisplay {
  provider_type: string;
  is_enabled: boolean;
  is_default: boolean;
  settings: PaymentSettingsType;
  created_at: string;
  updated_at: string;
  publishable_key?: string;
  has_webhook_secret: boolean;
}

export const PaymentSettings: React.FC = () => {
  const [config, setConfig] = useState<PaymentConfigDisplay | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState<string>('');

  // Form state for connecting Stripe
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [secretKey, setSecretKey] = useState('');
  const [publishableKey, setPublishableKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');

  // Load current configuration
  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getPaymentConfigAction();
      if (result.success) {
        setConfig(result.data || null);
      } else {
        toast.error(result.error || 'Failed to load payment configuration');
      }

      // Get webhook URL
      const webhookResult = await getStripeWebhookUrlAction();
      if (webhookResult.success && webhookResult.data) {
        setWebhookUrl(webhookResult.data.webhookUrl);
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
        webhookSecret: webhookSecret || undefined,
      });

      if (result.success) {
        toast.success('Stripe connected successfully!');
        setShowConnectForm(false);
        setSecretKey('');
        setPublishableKey('');
        setWebhookSecret('');
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

  // Update settings
  const handleUpdateSettings = async (settings: Partial<PaymentSettingsType>) => {
    setSavingSettings(true);
    try {
      const result = await updatePaymentSettingsAction(settings);
      if (result.success && result.data) {
        setConfig((prev) => prev ? { ...prev, settings: result.data! } : null);
        toast.success('Settings updated');
      } else {
        toast.error(result.error || 'Failed to update settings');
      }
    } catch (error) {
      toast.error('Failed to update settings');
    } finally {
      setSavingSettings(false);
    }
  };

  // Copy webhook URL
  const handleCopyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('Webhook URL copied to clipboard');
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
                    variant="outline"
                    size="sm"
                    onClick={handleTestConnection}
                    disabled={testing}
                  >
                    {testing ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      'Test Connection'
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDisconnect}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Unplug className="h-4 w-4 mr-1" />
                    Disconnect
                  </Button>
                </div>
              </div>

              {/* Webhook URL */}
              <div className="space-y-2">
                <Label>Webhook URL</Label>
                <p className="text-sm text-gray-500">
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
                <div className="flex gap-2">
                  <Input
                    value={webhookUrl}
                    readOnly
                    className="font-mono text-sm bg-gray-50"
                  />
                  <Button variant="outline" size="sm" onClick={handleCopyWebhookUrl}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                {!config.has_webhook_secret && (
                  <div className="flex items-center gap-2 text-amber-600 text-sm">
                    <AlertCircle className="h-4 w-4" />
                    Webhook secret not configured. Reconnect Stripe to add it.
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

              <div className="space-y-2">
                <Label htmlFor="webhookSecret">Webhook Secret (Optional)</Label>
                <Input
                  id="webhookSecret"
                  type="password"
                  placeholder="whsec_..."
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                />
                <p className="text-sm text-gray-500">
                  Add the webhook URL below to Stripe first, then copy the signing secret here.
                </p>
              </div>

              <div className="p-3 bg-gray-50 rounded-lg space-y-1">
                <p className="text-sm font-medium">Webhook URL to add in Stripe:</p>
                <code className="text-sm text-gray-600 break-all">{webhookUrl}</code>
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={connecting}>
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
              <Button onClick={() => setShowConnectForm(true)}>
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
                checked={config.settings.paymentLinksInEmails}
                onCheckedChange={(checked) =>
                  handleUpdateSettings({ paymentLinksInEmails: checked })
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
                checked={config.settings.sendPaymentConfirmations}
                onCheckedChange={(checked) =>
                  handleUpdateSettings({ sendPaymentConfirmations: checked })
                }
                disabled={savingSettings}
              />
            </div>

            {/* Payment Link Expiration */}
            <div className="space-y-2">
              <Label>Payment Link Expiration</Label>
              <p className="text-sm text-gray-500">
                How long payment links remain valid (in hours)
              </p>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={720}
                  value={config.settings.paymentLinkExpirationHours}
                  onChange={(e) =>
                    handleUpdateSettings({
                      paymentLinkExpirationHours: parseInt(e.target.value, 10) || 168,
                    })
                  }
                  className="w-24"
                  disabled={savingSettings}
                />
                <span className="text-sm text-gray-500">
                  hours ({Math.round(config.settings.paymentLinkExpirationHours / 24)} days)
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default PaymentSettings;
