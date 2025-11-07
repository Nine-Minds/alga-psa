/**
 * Enterprise Email Settings with managed domain orchestration UI.
 */

'use client';

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Switch } from 'server/src/components/ui/Switch';
import { Badge } from 'server/src/components/ui/Badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'server/src/components/ui/Tabs';
import { Mail, Globe, Settings, CheckCircle, XCircle, Clock, Eye, EyeOff, Send, Inbox } from 'lucide-react';
import {
  TenantEmailSettings,
  EmailProviderConfig,
} from 'server/src/types/email.types';
import {
  getEmailSettings,
  updateEmailSettings,
} from 'server/src/lib/actions/email-actions/emailSettingsActions';
import {
  getManagedEmailDomains,
  requestManagedEmailDomain,
  refreshManagedEmailDomain,
  deleteManagedEmailDomain,
  ManagedDomainStatus,
} from '@ee/lib/actions/email-actions/managedDomainActions';
import { EmailProviderConfiguration } from 'server/src/components/EmailProviderConfiguration';
import ManagedDomainList from './ManagedDomainList';

const REGION_OPTIONS = [
  { value: 'us-east-1', label: 'US East (N. Virginia)' },
  { value: 'us-west-2', label: 'US West (Oregon)' },
  { value: 'eu-west-1', label: 'EU (Ireland)' },
];

interface EmailSettingsProps {}

export const ManagedEmailSettings: React.FC<EmailSettingsProps> = () => {
  const [settings, setSettings] = useState<TenantEmailSettings | null>(null);
  const [domains, setDomains] = useState<ManagedDomainStatus[]>([]);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [loadingDomains, setLoadingDomains] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<'smtp' | 'resend'>('smtp');
  const [showPassword, setShowPassword] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'inbound' | 'outbound'>('outbound');
  const [newDomain, setNewDomain] = useState('');
  const [region, setRegion] = useState(REGION_OPTIONS[0].value);
  const [busyDomain, setBusyDomain] = useState<string | null>(null);

  useEffect(() => {
    loadEmailSettings();
    loadDomains();
  }, []);

  useEffect(() => {
    if (settings?.emailProvider) {
      setSelectedProvider(settings.emailProvider);
    }
  }, [settings]);

  const loadEmailSettings = async () => {
    setLoadingSettings(true);
    try {
      const data = await getEmailSettings();
      setSettings(data);
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError('Failed to load email settings');
      toast.error('Failed to load email settings');
    } finally {
      setLoadingSettings(false);
    }
  };

  const loadDomains = async () => {
    setLoadingDomains(true);
    try {
      const data = await getManagedEmailDomains();
      setDomains(data);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to load managed domains');
    } finally {
      setLoadingDomains(false);
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await updateEmailSettings(settings);
      toast.success('Email settings saved');
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to save settings');
      toast.error(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleProviderChange = (provider: 'smtp' | 'resend') => {
    if (!settings) return;

    setSelectedProvider(provider);
    const updatedSettings = {
      ...settings,
      emailProvider: provider,
      providerConfigs: settings.providerConfigs.map((config) => ({
        ...config,
        isEnabled: config.providerType === provider,
      })),
    };

    const hasProvider = updatedSettings.providerConfigs.some((config) => config.providerType === provider);
    if (!hasProvider) {
      const newConfig: EmailProviderConfig = {
        providerId: `${provider}-provider`,
        providerType: provider,
        isEnabled: true,
        config:
          provider === 'smtp'
            ? { host: '', port: 587, username: '', password: '', from: '' }
            : { apiKey: '', from: '' },
      };
      updatedSettings.providerConfigs.push(newConfig);
    }

    setSettings(updatedSettings);
  };

  const getCurrentProviderConfig = () => {
    return settings?.providerConfigs.find(
      (config) => config.providerType === selectedProvider && config.isEnabled
    );
  };

  const renderSMTPConfig = () => {
    const config = getCurrentProviderConfig();
    if (!config) return null;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="smtp-host">SMTP Host</Label>
            <Input
              id="smtp-host"
              value={config.config.host || ''}
              onChange={(e) =>
                updateProviderConfig(config.providerId, { host: e.target.value })
              }
            />
          </div>
          <div>
            <Label htmlFor="smtp-port">Port</Label>
            <Input
              id="smtp-port"
              type="number"
              value={config.config.port || 587}
              onChange={(e) =>
                updateProviderConfig(config.providerId, {
                  port: parseInt(e.target.value, 10),
                })
              }
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="smtp-username">Username</Label>
            <Input
              id="smtp-username"
              value={config.config.username || ''}
              onChange={(e) =>
                updateProviderConfig(config.providerId, { username: e.target.value })
              }
            />
          </div>
          <div>
            <Label htmlFor="smtp-password">Password</Label>
            <div className="flex items-center space-x-2">
              <Input
                id="smtp-password"
                type={showPassword ? 'text' : 'password'}
                value={config.config.password || ''}
                onChange={(e) =>
                  updateProviderConfig(config.providerId, { password: e.target.value })
                }
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
        <div>
          <Label htmlFor="smtp-from">Default From Address</Label>
          <Input
            id="smtp-from"
            value={config.config.from || ''}
            onChange={(e) => updateProviderConfig(config.providerId, { from: e.target.value })}
          />
        </div>
      </div>
    );
  };

  const renderResendConfig = () => {
    const config = getCurrentProviderConfig();
    if (!config) return null;

    return (
      <div className="space-y-4">
        <div>
          <Label htmlFor="resend-api-key">Resend API Key</Label>
          <div className="flex items-center space-x-2">
            <Input
              id="resend-api-key"
              type={showApiKey ? 'text' : 'password'}
              value={config.config.apiKey || ''}
              onChange={(e) =>
                updateProviderConfig(config.providerId, { apiKey: e.target.value })
              }
            />
            <Button
              variant='outline'
              size='icon'
              onClick={() => setShowApiKey(!showApiKey)}
              aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
            >
              {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <div>
          <Label htmlFor="resend-from">Default From Address</Label>
          <Input
            id="resend-from"
            value={config.config.from || ''}
            onChange={(e) => updateProviderConfig(config.providerId, { from: e.target.value })}
          />
        </div>
      </div>
    );
  };

  const updateProviderConfig = (providerId: string, configUpdates: Record<string, unknown>) => {
    if (!settings) return;
    const updatedConfigs = settings.providerConfigs.map((config) =>
      config.providerId === providerId
        ? { ...config, config: { ...config.config, ...configUpdates } }
        : config
    );
    setSettings({ ...settings, providerConfigs: updatedConfigs });
  };

  const handleAddDomain = async () => {
    if (!newDomain.trim()) {
      toast.error('Enter a domain name');
      return;
    }

    setBusyDomain(newDomain.trim());
    try {
      await requestManagedEmailDomain(newDomain.trim(), region);
      toast.success('Domain request submitted');
      setNewDomain('');
      await loadDomains();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to request domain');
    } finally {
      setBusyDomain(null);
    }
  };

  const handleRefreshDomain = async (domain: string) => {
    setBusyDomain(domain);
    try {
      await refreshManagedEmailDomain(domain);
      toast.success('Verification re-check scheduled');
      await loadDomains();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to refresh domain status');
    } finally {
      setBusyDomain(null);
    }
  };

  const handleDeleteDomain = async (domain: string) => {
    setBusyDomain(domain);
    try {
      await deleteManagedEmailDomain(domain);
      toast.success('Domain removal scheduled');
      await loadDomains();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to remove domain');
    } finally {
      setBusyDomain(null);
    }
  };

  if (loadingSettings) {
    return <div>Loading email settings…</div>;
  }

  if (error) {
    return <div className="text-red-600">{error}</div>;
  }

  return (
    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'inbound' | 'outbound')} className="w-full">
      <TabsList className="grid w-full grid-cols-2 mb-6">
        <TabsTrigger value="inbound" className="flex items-center gap-2">
          <Inbox className="h-4 w-4" />
          Inbound Email
        </TabsTrigger>
        <TabsTrigger value="outbound" className="flex items-center gap-2">
          <Send className="h-4 w-4" />
          Outbound Email
        </TabsTrigger>
      </TabsList>

      <TabsContent value="outbound" className="space-y-6">
        <div className="text-sm text-muted-foreground mb-4">
          Configure managed sending domains and outbound providers.
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Email Provider Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <Label htmlFor="provider-select">Email Provider</Label>
              <CustomSelect
                id="provider-select"
                value={selectedProvider}
                onValueChange={(value: string) => handleProviderChange(value as 'smtp' | 'resend')}
                options={[
                  { value: 'smtp', label: 'SMTP (Traditional Email Server)' },
                  { value: 'resend', label: 'Resend (Managed Provider)' },
                ]}
                placeholder="Select email provider"
              />
              <p className="text-sm text-gray-500 mt-1">
                {selectedProvider === 'smtp'
                  ? 'Configure SMTP credentials for outbound email.'
                  : 'Use the managed Resend adapter for branded sending.'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant={getCurrentProviderConfig()?.isEnabled ? 'default' : 'secondary'}>
                {getCurrentProviderConfig()?.isEnabled ? 'Active' : 'Inactive'}
              </Badge>
              <span className="text-sm text-gray-600">
                {selectedProvider.toUpperCase()} Provider
              </span>
            </div>

            {selectedProvider === 'smtp' && renderSMTPConfig()}
            {selectedProvider === 'resend' && renderResendConfig()}

            <div className="border-t pt-6">
              <h3 className="text-lg font-medium mb-4">General Settings</h3>
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="tracking-enabled"
                    checked={settings?.trackingEnabled || false}
                    onCheckedChange={(checked) =>
                      settings && setSettings({ ...settings, trackingEnabled: checked })
                    }
                  />
                  <Label htmlFor="tracking-enabled">Enable Email Tracking</Label>
                </div>
                <div>
                  <Label htmlFor="daily-limit">Daily Email Limit</Label>
                  <Input
                    id="daily-limit"
                    type="number"
                    value={settings?.maxDailyEmails || 1000}
                    onChange={(e) =>
                      settings &&
                      setSettings({
                        ...settings,
                        maxDailyEmails: parseInt(e.target.value, 10) || undefined,
                      })
                    }
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Managed Domains
            </CardTitle>
            <CardDescription>
              Add a custom domain and follow the DNS instructions to verify ownership.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="managed-domain-input">Domain</Label>
                <Input
                  id="managed-domain-input"
                  placeholder="example.com"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="managed-domain-region">Region</Label>
                <CustomSelect
                  id="managed-domain-region"
                  value={region}
                  onValueChange={(value) => setRegion(value)}
                  options={REGION_OPTIONS}
                  placeholder="Select region"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                id="add-managed-domain-button"
                onClick={handleAddDomain}
                disabled={!newDomain.trim() || busyDomain !== null}
              >
                Add Domain
              </Button>
            </div>

            <ManagedDomainList
              domains={domains}
              loading={loadingDomains}
              busyDomain={busyDomain}
              onRefresh={handleRefreshDomain}
              onDelete={handleDeleteDomain}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button id="save-email-settings" onClick={saveSettings} disabled={saving}>
            {saving ? 'Saving…' : 'Save Settings'}
          </Button>
        </div>
      </TabsContent>

      <TabsContent value="inbound" className="space-y-6">
        <div className="text-sm text-muted-foreground mb-4">
          Configure inbound email routing and provider-specific automation.
        </div>
        <EmailProviderConfiguration />
      </TabsContent>
    </Tabs>
  );
};

export default ManagedEmailSettings;
