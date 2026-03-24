'use client';

import { useState, useEffect } from "react";
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@alga-psa/ui/components/Card";
import { Switch } from "@alga-psa/ui/components/Switch";
import { Label } from "@alga-psa/ui/components/Label";
import { Button } from "@alga-psa/ui/components/Button";
import CustomSelect from "@alga-psa/ui/components/CustomSelect";
import { Alert, AlertDescription } from "@alga-psa/ui/components/Alert";
import type { TenantTelemetrySettings, AnonymizationLevel } from "@alga-psa/types";

interface TenantTelemetrySettingsProps {
  onSettingsUpdate?: (settings: TenantTelemetrySettings) => void;
}

export function TenantTelemetrySettings({ onSettingsUpdate }: TenantTelemetrySettingsProps) {
  const { t } = useTranslation('msp/admin');
  const { formatDate } = useFormatters();
  const [settings, setSettings] = useState<TenantTelemetrySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTenantSettings();
  }, []);

  const loadTenantSettings = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/telemetry-settings');
      if (!response.ok) {
        throw new Error(t('telemetry.errors.loadTenantTelemetrySettings', { defaultValue: 'Failed to load tenant telemetry settings' }));
      }
      
      const data = await response.json();
      setSettings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('telemetry.errors.loadSettings', { defaultValue: 'Failed to load settings' }));
    } finally {
      setLoading(false);
    }
  };

  const handleSettingChange = (key: keyof TenantTelemetrySettings, value: any) => {
    if (!settings) return;

    setSettings({
      ...settings,
      [key]: value,
      lastUpdated: new Date().toISOString()
    });
  };

  const handleSave = async () => {
    if (!settings) return;

    try {
      setSaving(true);
      setError(null);

      const response = await fetch('/api/admin/telemetry-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        throw new Error(t('telemetry.errors.saveTelemetrySettings', { defaultValue: 'Failed to save telemetry settings' }));
      }

      const updatedSettings = await response.json();
      setSettings(updatedSettings);
      onSettingsUpdate?.(updatedSettings);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('telemetry.errors.saveSettings', { defaultValue: 'Failed to save settings' }));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('telemetry.loading.title', { defaultValue: 'Organization Telemetry Settings' })}</CardTitle>
          <CardDescription>{t('telemetry.loading.description', { defaultValue: 'Loading...' })}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 rounded"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!settings) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('telemetry.empty.title', { defaultValue: 'Organization Telemetry Settings' })}</CardTitle>
          <CardDescription>{t('telemetry.empty.description', { defaultValue: 'Error loading settings' })}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-red-500">{t('telemetry.empty.body', { defaultValue: 'Failed to load telemetry settings' })}</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('telemetry.page.title', { defaultValue: 'Organization Telemetry & Analytics' })}</CardTitle>
        <CardDescription>
          {t('telemetry.page.description', {
            defaultValue: 'Configure telemetry settings for your entire organization. Telemetry is enabled by default to improve the platform, but users can opt-out individually unless you disable this option.'
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        
        {/* Master Enable Switch */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base font-medium">
                {t('telemetry.toggles.enableTelemetry.title', { defaultValue: 'Enable Telemetry' })}
              </Label>
              <p className="text-sm text-gray-600 mt-1">
                {t('telemetry.toggles.enableTelemetry.description', {
                  defaultValue: 'Allow collection of anonymous usage data to improve the platform (enabled by default)'
                })}
              </p>
            </div>
            <Switch
              checked={settings.enabled}
              onCheckedChange={(enabled) => handleSettingChange('enabled', enabled)}
            />
          </div>

          {settings.enabled && (
            <Alert variant="info" className="ml-6">
              <AlertDescription>
                {t('telemetry.alerts.enabled', {
                  defaultValue: '✓ Telemetry enabled. All categories are enabled by default for new users, but they can opt-out individually if desired.'
                })}
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* User Override Setting */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base font-medium">
                {t('telemetry.toggles.allowUserOptOut.title', { defaultValue: 'Allow User Opt-Out' })}
              </Label>
              <p className="text-sm text-gray-600 mt-1">
                {t('telemetry.toggles.allowUserOptOut.description', {
                  defaultValue: 'Allow individual users to opt-out of telemetry collection'
                })}
              </p>
            </div>
            <Switch
              checked={settings.allowUserOverride}
              disabled={!settings.enabled}
              onCheckedChange={(allow) => handleSettingChange('allowUserOverride', allow)}
            />
          </div>
          
          {!settings.allowUserOverride && settings.enabled && (
            <Alert variant="warning" className="ml-6">
              <AlertDescription>
                {t('telemetry.alerts.centralizedControl', {
                  defaultValue: 'Centralized control: Users cannot opt-out individually. Ensure compliance with local privacy regulations.'
                })}
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Anonymization Level */}
        <div className="space-y-3">
          <div>
            <Label className="text-base font-medium">
              {t('telemetry.anonymization.title', { defaultValue: 'Data Anonymization Level' })}
            </Label>
            <p className="text-sm text-gray-600 mt-1">
              {t('telemetry.anonymization.description', {
                defaultValue: 'Choose how much data to anonymize before collection'
              })}
            </p>
          </div>
          
          <CustomSelect
            id="anonymization-level"
            value={settings.anonymizationLevel} 
            onValueChange={(value: string) => handleSettingChange('anonymizationLevel', value as AnonymizationLevel)}
            disabled={!settings.enabled}
            className="w-full max-w-md"
            options={[
              {
                value: "none",
                label: (
                  <div>
                    <div className="font-medium">
                      {t('telemetry.anonymization.options.none.title', { defaultValue: 'No Anonymization' })}
                    </div>
                    <div className="text-sm text-gray-600">
                      {t('telemetry.anonymization.options.none.description', {
                        defaultValue: 'Collect data as-is (not recommended)'
                      })}
                    </div>
                  </div>
                )
              },
              {
                value: "partial",
                label: (
                  <div>
                    <div className="font-medium">
                      {t('telemetry.anonymization.options.partial.title', { defaultValue: 'Partial Anonymization' })}
                    </div>
                    <div className="text-sm text-gray-600">
                      {t('telemetry.anonymization.options.partial.description', {
                        defaultValue: 'Remove PII, keep correlation IDs'
                      })}
                    </div>
                  </div>
                )
              },
              {
                value: "full",
                label: (
                  <div>
                    <div className="font-medium">
                      {t('telemetry.anonymization.options.full.title', { defaultValue: 'Full Anonymization' })}
                    </div>
                    <div className="text-sm text-gray-600">
                      {t('telemetry.anonymization.options.full.description', {
                        defaultValue: 'Maximum privacy, minimal correlation'
                      })}
                    </div>
                  </div>
                )
              }
            ]}
          />
        </div>

        {/* Compliance Notes */}
        {settings.complianceNotes && (
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
            <h4 className="text-sm font-medium text-gray-900 mb-2">
              {t('telemetry.compliance.title', { defaultValue: 'Compliance Notes' })}
            </h4>
            <p className="text-sm text-gray-600">{settings.complianceNotes}</p>
          </div>
        )}

        {/* Privacy Information */}
        <Alert variant="success">
          <AlertDescription>
            <h4 className="text-sm font-medium mb-2">
              {t('telemetry.privacy.collectTitle', { defaultValue: 'What We Collect' })}
            </h4>
            <ul className="text-sm space-y-1">
              <li>{t('telemetry.privacy.collectItems.errors', { defaultValue: '• Error information (no sensitive data)' })}</li>
              <li>{t('telemetry.privacy.collectItems.performance', { defaultValue: '• Performance metrics (page load times, API response times)' })}</li>
              <li>{t('telemetry.privacy.collectItems.usage', { defaultValue: '• Feature usage patterns (which features are used)' })}</li>
              <li>{t('telemetry.privacy.collectItems.system', { defaultValue: '• System metrics (for infrastructure optimization)' })}</li>
            </ul>

            <h4 className="text-sm font-medium mt-4 mb-2">
              {t('telemetry.privacy.excludeTitle', { defaultValue: "What We DON'T Collect" })}
            </h4>
            <ul className="text-sm space-y-1">
              <li>{t('telemetry.privacy.excludeItems.personalInfo', { defaultValue: '• Personal information (names, emails, addresses)' })}</li>
              <li>{t('telemetry.privacy.excludeItems.clientData', { defaultValue: '• Client data or business information' })}</li>
              <li>{t('telemetry.privacy.excludeItems.passwords', { defaultValue: '• Passwords or authentication tokens' })}</li>
              <li>{t('telemetry.privacy.excludeItems.files', { defaultValue: '• File contents or documents' })}</li>
            </ul>
          </AlertDescription>
        </Alert>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex justify-between items-center pt-4 border-t">
          <div className="text-xs text-gray-500">
            {settings.lastUpdated && (
              <>
                {t('telemetry.footer.lastUpdated', {
                  defaultValue: 'Last updated: {{value}}',
                  value: formatDate(settings.lastUpdated, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }),
                })}
              </>
            )}
            {settings.updatedBy && t('telemetry.footer.updatedBy', { defaultValue: ' by {{user}}', user: settings.updatedBy })}
          </div>
          
          <div className="flex space-x-3">
            <Button
              id="reset-telemetry-settings"
              variant="outline"
              onClick={loadTenantSettings}
              disabled={saving}
            >
              {t('common.actions.reset', { defaultValue: 'Reset' })}
            </Button>
            <Button
              id="save-telemetry-settings"
              onClick={handleSave}
              disabled={saving}
            >
              {saving
                ? t('common.actions.saving', { defaultValue: 'Saving...' })
                : t('common.actions.save', { defaultValue: 'Save Settings' })}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
