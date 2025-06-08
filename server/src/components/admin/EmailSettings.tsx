/**
 * Email Settings Configuration Screen
 * Provides admin interface for managing email providers and domain settings
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Label } from '../ui/Label';
import CustomSelect from '../ui/CustomSelect';
import { Switch } from '../ui/Switch';
import { Badge } from '../ui/Badge';
import { Mail, Globe, Settings, CheckCircle, XCircle, Clock } from 'lucide-react';
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

interface EmailSettingsProps {
  // Remove tenantId prop since server actions handle tenant context automatically
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
  const [settings, setSettings] = useState<TenantEmailSettings | null>(null);
  const [domains, setDomains] = useState<DomainStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newDomain, setNewDomain] = useState('');
  const [activeTab, setActiveTab] = useState('providers');

  useEffect(() => {
    loadEmailSettings();
    loadDomains();
  }, []);

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
      loadDomains();
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to add domain');
    }
  };

  const verifyDomain = async (domain: string) => {
    try {
      await verifyEmailDomain(domain);
      loadDomains();
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to verify domain');
    }
  };

  const renderProviderConfig = (provider: EmailProviderConfig) => {
    return (
      <Card key={provider.providerId} className="mb-4">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Mail className="h-4 w-4" />
            {provider.providerType.toUpperCase()} Provider
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={provider.isEnabled ? "default" : "secondary"}>
              {provider.isEnabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              id={`${provider.providerId}-enabled`}
              checked={provider.isEnabled}
              onCheckedChange={(checked: boolean) => {
                if (settings) {
                  const updatedConfigs = settings.providerConfigs.map(p =>
                    p.providerId === provider.providerId ? { ...p, isEnabled: checked } : p
                  );
                  setSettings({ ...settings, providerConfigs: updatedConfigs });
                }
              }}
            />
            <Label htmlFor={`${provider.providerId}-enabled`}>Enabled</Label>
          </div>
          </div>
          
          {provider.providerType === 'smtp' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>SMTP Host</Label>
                <Input 
                  value={provider.config.host || ''} 
                  placeholder="smtp.example.com"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    if (settings) {
                      const updatedConfigs = settings.providerConfigs.map(p =>
                        p.providerId === provider.providerId 
                          ? { ...p, config: { ...p.config, host: e.target.value } }
                          : p
                      );
                      setSettings({ ...settings, providerConfigs: updatedConfigs });
                    }
                  }}
                />
              </div>
              <div>
                <Label>Port</Label>
                <Input 
                  type="number"
                  value={provider.config.port || 587} 
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    if (settings) {
                      const updatedConfigs = settings.providerConfigs.map(p =>
                        p.providerId === provider.providerId 
                          ? { ...p, config: { ...p.config, port: parseInt(e.target.value) || 587 } }
                          : p
                      );
                      setSettings({ ...settings, providerConfigs: updatedConfigs });
                    }
                  }}
                />
              </div>
              <div>
                <Label>Username</Label>
                <Input 
                  value={provider.config.username || ''} 
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    if (settings) {
                      const updatedConfigs = settings.providerConfigs.map(p =>
                        p.providerId === provider.providerId 
                          ? { ...p, config: { ...p.config, username: e.target.value } }
                          : p
                      );
                      setSettings({ ...settings, providerConfigs: updatedConfigs });
                    }
                  }}
                />
              </div>
              <div>
                <Label>Password</Label>
                <Input 
                  type="password"
                  value={provider.config.password || ''} 
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    if (settings) {
                      const updatedConfigs = settings.providerConfigs.map(p =>
                        p.providerId === provider.providerId 
                          ? { ...p, config: { ...p.config, password: e.target.value } }
                          : p
                      );
                      setSettings({ ...settings, providerConfigs: updatedConfigs });
                    }
                  }}
                />
              </div>
            </div>
          )}
          
          {provider.providerType === 'resend' && (
            <div>
              <Label>API Key</Label>
              <Input 
                type="password"
                value={provider.config.apiKey || ''} 
                placeholder="re_..."
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  if (settings) {
                    const updatedConfigs = settings.providerConfigs.map(p =>
                      p.providerId === provider.providerId 
                        ? { ...p, config: { ...p.config, apiKey: e.target.value } }
                        : p
                    );
                    setSettings({ ...settings, providerConfigs: updatedConfigs });
                  }
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderDomainStatus = (domain: DomainStatus) => {
    const getStatusIcon = () => {
      switch (domain.status) {
        case 'verified':
          return <CheckCircle className="h-4 w-4 text-green-500" />;
        case 'failed':
          return <XCircle className="h-4 w-4 text-red-500" />;
        default:
          return <Clock className="h-4 w-4 text-yellow-500" />;
      }
    };

    const getBadgeVariant = (status: string) => {
      switch (status) {
        case 'verified':
          return 'success';
        case 'failed':
          return 'error';
        default:
          return 'warning';
      }
    };

    return (
      <Card key={domain.domain} className="mb-4">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Globe className="h-4 w-4" />
            {domain.domain}
          </CardTitle>
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <Badge variant={getBadgeVariant(domain.status)}>
              {domain.status}
            </Badge>
            {domain.status === 'pending' && (
              <Button 
                id={`verify-domain-${domain.domain}-button`}
                size="sm" 
                onClick={() => verifyDomain(domain.domain)}
              >
                Verify
              </Button>
            )}
          </div>
        </CardHeader>
        {domain.dnsRecords && (
          <CardContent>
            <div className="text-sm text-muted-foreground mb-2">
              Required DNS Records:
            </div>
            <div className="space-y-2">
              {domain.dnsRecords.map((record, index) => (
                <div key={index} className="bg-muted p-2 rounded text-xs font-mono">
                  <div><strong>Type:</strong> {record.type}</div>
                  <div><strong>Name:</strong> {record.name}</div>
                  <div><strong>Value:</strong> {record.value}</div>
                </div>
              ))}
            </div>
          </CardContent>
        )}
      </Card>
    );
  };

  if (loading) return <div>Loading email settings...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Email Settings</h1>
        <Button 
          id="save-email-settings-button"
          onClick={saveSettings} 
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-600">{error}</p>
        </div>
      )}

      {/* Simple tab navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('providers')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'providers'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Mail className="h-4 w-4 inline mr-2" />
            Providers
          </button>
          <button
            onClick={() => setActiveTab('domains')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'domains'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Globe className="h-4 w-4 inline mr-2" />
            Domains
          </button>
          <button
            onClick={() => setActiveTab('general')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'general'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Settings className="h-4 w-4 inline mr-2" />
            General
          </button>
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'providers' && (
        <Card>
          <CardHeader>
            <CardTitle>Email Providers Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {settings?.providerConfigs.map(renderProviderConfig)}
          </CardContent>
        </Card>
      )}

      {activeTab === 'domains' && (
        <Card>
          <CardHeader>
            <CardTitle>Custom Domains</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="example.com"
                value={newDomain}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewDomain(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === 'Enter') {
                    addDomain();
                  }
                }}
              />
              <Button 
                id="add-domain-button"
                onClick={addDomain} 
                disabled={!newDomain.trim()}
              >
                Add Domain
              </Button>
            </div>
            
            {domains.map(renderDomainStatus)}
          </CardContent>
        </Card>
      )}

      {activeTab === 'general' && (
        <Card>
          <CardHeader>
            <CardTitle>General Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="default-provider">Email Provider</Label>
              <CustomSelect
                id="default-provider"
                value={settings?.emailProvider || ''}
                onValueChange={(value: string) => {
                  if (settings) {
                    setSettings({ ...settings, emailProvider: value as 'smtp' | 'resend' });
                  }
                }}
                options={[
                  { value: 'smtp', label: 'SMTP' },
                  { value: 'resend', label: 'Resend' }
                ]}
                placeholder="Select provider"
              />
            </div>

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
          </CardContent>
        </Card>
      )}
    </div>
  );
};