/**
 * Email Settings Configuration Screen
 * Provides admin interface for managing email providers and domain settings
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { Mail, Globe, Settings, CheckCircle, XCircle, Clock, Eye, EyeOff, Send, Inbox } from 'lucide-react';
import {
  TenantEmailSettings,
  EmailProviderConfig
} from '../../types/email.types';
import {
  getEmailSettings,
  updateEmailSettings
} from '../../lib/actions/email-actions/emailSettingsActions';
import {
  getEmailDomains,
  addEmailDomain,
  verifyEmailDomain
} from '../../lib/actions/email-actions/emailDomainActions';
import { EmailProviderConfiguration } from '../EmailProviderConfiguration';
import { useTenant } from '@alga-psa/ui/components/providers/TenantProvider';

interface EmailSettingsProps {
  // Remove tenantId prop since we'll use the tenant context
}

interface DomainStatus {
  domain: string;
  status: 'pending' | 'verified' | 'failed';
  dnsRecords?: Array<{
    type: string;
    name: string;
    value: string;
  }>;
  verifiedAt?: string;
  createdAt?: string;
  providerId?: string;
  providerDomainId?: string;
}

export const EmailSettings: React.FC<EmailSettingsProps> = () => {
  const tenantId = useTenant();
  const [settings, setSettings] = useState<TenantEmailSettings | null>(null);
  const [domains, setDomains] = useState<DomainStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newDomain, setNewDomain] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<'smtp' | 'resend'>('smtp');
  const [showPassword, setShowPassword] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [activeTab, setActiveTab] = useState('inbound');

  useEffect(() => {
    loadEmailSettings();
    loadDomains();
  }, []);

  useEffect(() => {
    // Update selected provider when settings load
    if (settings?.emailProvider) {
      setSelectedProvider(settings.emailProvider);
    }
  }, [settings]);

  const loadEmailSettings = async () => {
    try {
      const data = await getEmailSettings();
      setSettings(data);
    } catch (err: any) {
      setError('Failed to load email settings');
    } finally {
      setLoading(false);
    }
  };

  const loadDomains = async () => {
    try {
      const data = await getEmailDomains();
      setDomains(data);
    } catch (err: any) {
      console.error('Failed to load domains:', err);
    }
  };

  const saveSettings = async () => {
    if (!settings) return;

    setSaving(true);
    try {
      await updateEmailSettings(settings);
      setError(null);
      // Show success message
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const addDomain = async () => {
    if (!newDomain.trim()) return;

    try {
      await addEmailDomain(newDomain.trim());
      setNewDomain('');
      await loadDomains();
    } catch (err: any) {
      setError(err.message || 'Failed to add domain');
    }
  };

  const verifyDomain = async (domain: string) => {
    try {
      await verifyEmailDomain(domain);
      await loadDomains();
    } catch (err: any) {
      setError(err.message || 'Failed to verify domain');
    }
  };

  const handleProviderChange = (providerType: 'smtp' | 'resend') => {
    if (!settings) return;

    setSelectedProvider(providerType);

    // Update the settings to use the selected provider
    const updatedSettings = {
      ...settings,
      emailProvider: providerType,
      providerConfigs: settings.providerConfigs.map(config => ({
        ...config,
        isEnabled: config.providerType === providerType
      }))
    };

    // Ensure we have a config for the selected provider
    const hasProvider = updatedSettings.providerConfigs.some(config => config.providerType === providerType);
    if (!hasProvider) {
      const newConfig: EmailProviderConfig = {
        providerId: `${providerType}-provider`,
        providerType: providerType,
        isEnabled: true,
        config: providerType === 'smtp' ? {
          host: '',
          port: 587,
          username: '',
          password: '',
          from: ''
        } : {
          apiKey: '',
          from: ''
        }
      };
      updatedSettings.providerConfigs.push(newConfig);
    }

    setSettings(updatedSettings);
  };

  const updateProviderConfig = (providerId: string, configUpdates: any) => {
    if (!settings) return;

    const updatedConfigs = settings.providerConfigs.map(config =>
      config.providerId === providerId
        ? { ...config, config: { ...config.config, ...configUpdates } }
        : config
    );

    setSettings({ ...settings, providerConfigs: updatedConfigs });
  };

  const getCurrentProviderConfig = () => {
    return settings?.providerConfigs.find(config =>
      config.providerType === selectedProvider && config.isEnabled
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
              placeholder="smtp.example.com"
              onChange={(e) => updateProviderConfig(config.providerId, { host: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="smtp-port">Port</Label>
            <Input
              id="smtp-port"
              type="number"
              value={config.config.port || 587}
              placeholder="587"
              onChange={(e) => updateProviderConfig(config.providerId, { port: parseInt(e.target.value) })}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="smtp-username">Username</Label>
            <Input
              id="smtp-username"
              value={config.config.username || ''}
              placeholder="your-email@example.com"
              onChange={(e) => updateProviderConfig(config.providerId, { username: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="smtp-password">Password</Label>
            <div className="relative">
              <Input
                id="smtp-password"
                type={showPassword ? "text" : "password"}
                value={config.config.password === '***' ? '' : config.config.password || ''}
                placeholder="Enter password"
                onChange={(e) => updateProviderConfig(config.providerId, { password: e.target.value })}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        <div>
          <Label htmlFor="smtp-from">From Address</Label>
          <Input
            id="smtp-from"
            value={config.config.from || ''}
            placeholder="noreply@example.com"
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
          <div className="relative">
            <Input
              id="resend-api-key"
              type={showApiKey ? "text" : "password"}
              value={config.config.apiKey === '***' ? '' : config.config.apiKey || ''}
              placeholder="re_xxxxxxxxxxxxxxxxxx"
              onChange={(e) => updateProviderConfig(config.providerId, { apiKey: e.target.value })}
            />
            <button
              type="button"
              className="absolute inset-y-0 right-0 pr-3 flex items-center"
              onClick={() => setShowApiKey(!showApiKey)}
            >
              {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Get your API key from <a href="https://resend.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">resend.com/api-keys</a>
          </p>
        </div>

        <div>
          <Label htmlFor="resend-from">From Address</Label>
          <Input
            id="resend-from"
            value={config.config.from || ''}
            placeholder="noreply@yourdomain.com"
            onChange={(e) => updateProviderConfig(config.providerId, { from: e.target.value })}
          />
          <p className="text-sm text-gray-500 mt-1">
            Must be from a verified domain. Use the Domains tab to add custom domains.
          </p>
        </div>
      </div>
    );
  };

  const renderDomainStatus = (domain: DomainStatus) => {
    const getStatusIcon = () => {
      switch (domain.status) {
        case 'verified': return <CheckCircle className="h-4 w-4 text-green-500" />;
        case 'failed': return <XCircle className="h-4 w-4 text-red-500" />;
        default: return <Clock className="h-4 w-4 text-yellow-500" />;
      }
    };

    const getStatusBadge = () => {
      switch (domain.status) {
        case 'verified': return <Badge variant="default" className="bg-green-100 text-green-800">Verified</Badge>;
        case 'failed': return <Badge variant="error">Failed</Badge>;
        default: return <Badge variant="secondary">Pending</Badge>;
      }
    };

    return (
      <div key={domain.domain} className="border rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <span className="font-medium">{domain.domain}</span>
          </div>
          <div className="flex items-center gap-2">
            {getStatusBadge()}
            {domain.status === 'pending' && (
              <Button
                id={`verify-domain-${domain.domain}`}
                size="sm"
                variant="outline"
                onClick={() => verifyDomain(domain.domain)}
              >
                Verify
              </Button>
            )}
          </div>
        </div>

        {domain.dnsRecords && domain.status !== 'verified' && (
          <div className="mt-3">
            <p className="text-sm text-gray-600 mb-2">Required DNS Records:</p>
            <div className="space-y-2 text-sm">
              {domain.dnsRecords.map((record, idx) => (
                <div key={idx} className="bg-gray-50 p-2 rounded font-mono text-xs">
                  <strong>{record.type}</strong> {record.name} → {record.value}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return <div>Loading email settings...</div>;
  }

  if (error) {
    return <div className="text-red-600">Error: {error}</div>;
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
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
        <>
            <div className="text-sm text-muted-foreground mb-4">
              Configure SMTP or API settings for sending emails from your application
            </div>

            {/* Provider Configuration Section */}
            <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Email Provider Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Provider Selection */}
              <div>
                <Label htmlFor="provider-select">Email Provider</Label>
                <CustomSelect
                  id="provider-select"
                  value={selectedProvider}
                  onValueChange={(value: string) => handleProviderChange(value as 'smtp' | 'resend')}
                  options={[
                    { value: 'smtp', label: 'SMTP (Traditional Email Server)' },
                    { value: 'resend', label: 'Resend (Modern API Service)' }
                  ]}
                  placeholder="Select email provider"
                />
                <p className="text-sm text-gray-500 mt-1">
                  {selectedProvider === 'smtp'
                    ? 'Configure traditional SMTP email server settings'
                    : 'Configure Resend API for modern email delivery'
                  }
                </p>
              </div>

              {/* Provider Status */}
              <div className="flex items-center gap-2">
                <Badge variant={getCurrentProviderConfig()?.isEnabled ? "default" : "secondary"}>
                  {getCurrentProviderConfig()?.isEnabled ? "Active" : "Inactive"}
                </Badge>
                <span className="text-sm text-gray-600">
                  {selectedProvider.toUpperCase()} Provider
                </span>
              </div>

              {/* Provider-specific Configuration */}
              {selectedProvider === 'smtp' && renderSMTPConfig()}
              {selectedProvider === 'resend' && renderResendConfig()}

              {/* General Settings */}
              <div className="border-t pt-6">
                <h3 className="text-lg font-medium mb-4">General Settings</h3>
                <div className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="tracking-enabled"
                      checked={settings?.trackingEnabled || false}
                      onCheckedChange={(checked: boolean) => {
                        if (settings) {
                          setSettings({ ...settings, trackingEnabled: checked });
                        }
                      }}
                    />
                    <Label htmlFor="tracking-enabled">Enable Email Tracking</Label>
                  </div>

                  <div>
                    <Label htmlFor="daily-limit">Daily Email Limit</Label>
                    <Input
                      id="daily-limit"
                      type="number"
                      value={settings?.maxDailyEmails || 1000}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        if (settings) {
                          setSettings({
                            ...settings,
                            maxDailyEmails: parseInt(e.target.value) || undefined
                          });
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>



            {/* Save Button */}
            <div className="flex justify-end">
              <Button id="save-email-settings" onClick={saveSettings} disabled={saving}>
                {saving ? 'Saving...' : 'Save Settings'}
              </Button>
            </div>
          </>
      </TabsContent>

      <TabsContent value="inbound" className="space-y-6">
        <div className="text-sm text-muted-foreground mb-4">
          Configure email providers to receive and process emails as tickets
        </div>
        <EmailProviderConfiguration
          onProviderAdded={(provider) => {
            // Optional: Handle provider added event
            console.log('Provider added:', provider);
          }}
          onProviderUpdated={(provider) => {
            // Optional: Handle provider updated event
            console.log('Provider updated:', provider);
          }}
          onProviderDeleted={(providerId) => {
            // Optional: Handle provider deleted event
            console.log('Provider deleted:', providerId);
          }}
        />
      </TabsContent>
    </Tabs>
  );
};
