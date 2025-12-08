'use client';

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "server/src/components/ui/Card";
import { Switch } from "server/src/components/ui/Switch";
import { Label } from "server/src/components/ui/Label";
import { Button } from "server/src/components/ui/Button";
import CustomSelect from "server/src/components/ui/CustomSelect";
import { Alert, AlertDescription } from "server/src/components/ui/Alert";
import type { TenantTelemetrySettings, AnonymizationLevel } from "server/src/config/telemetry";

interface TenantTelemetrySettingsProps {
  onSettingsUpdate?: (settings: TenantTelemetrySettings) => void;
}

export function TenantTelemetrySettings({ onSettingsUpdate }: TenantTelemetrySettingsProps) {
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
      if (!response.ok) throw new Error('Failed to load tenant telemetry settings');
      
      const data = await response.json();
      setSettings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
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

      if (!response.ok) throw new Error('Failed to save telemetry settings');

      const updatedSettings = await response.json();
      setSettings(updatedSettings);
      onSettingsUpdate?.(updatedSettings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Organization Telemetry Settings</CardTitle>
          <CardDescription>Loading...</CardDescription>
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
          <CardTitle>Organization Telemetry Settings</CardTitle>
          <CardDescription>Error loading settings</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-red-500">Failed to load telemetry settings</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization Telemetry & Analytics</CardTitle>
        <CardDescription>
          Configure telemetry settings for your entire organization. Telemetry is enabled by default to improve the platform, but users can opt-out individually unless you disable this option.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        
        {/* Master Enable Switch */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base font-medium">Enable Telemetry</Label>
              <p className="text-sm text-gray-600 mt-1">
                Allow collection of anonymous usage data to improve the platform (enabled by default)
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
                ✓ Telemetry enabled. All categories are enabled by default for new users, but they can opt-out individually if desired.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* User Override Setting */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base font-medium">Allow User Opt-Out</Label>
              <p className="text-sm text-gray-600 mt-1">
                Allow individual users to opt-out of telemetry collection
              </p>
            </div>
            <Switch
              checked={settings.allowUserOverride}
              disabled={!settings.enabled}
              onCheckedChange={(allow) => handleSettingChange('allowUserOverride', allow)}
            />
          </div>
          
          {!settings.allowUserOverride && settings.enabled && (
            <div className="ml-6 p-4 bg-amber-50 border border-amber-200 rounded-md">
              <p className="text-sm text-amber-800">
                ⚠️ Centralized control: Users cannot opt-out individually. Ensure compliance with local privacy regulations.
              </p>
            </div>
          )}
        </div>

        {/* Anonymization Level */}
        <div className="space-y-3">
          <div>
            <Label className="text-base font-medium">Data Anonymization Level</Label>
            <p className="text-sm text-gray-600 mt-1">
              Choose how much data to anonymize before collection
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
                    <div className="font-medium">No Anonymization</div>
                    <div className="text-sm text-gray-600">Collect data as-is (not recommended)</div>
                  </div>
                )
              },
              {
                value: "partial",
                label: (
                  <div>
                    <div className="font-medium">Partial Anonymization</div>
                    <div className="text-sm text-gray-600">Remove PII, keep correlation IDs</div>
                  </div>
                )
              },
              {
                value: "full",
                label: (
                  <div>
                    <div className="font-medium">Full Anonymization</div>
                    <div className="text-sm text-gray-600">Maximum privacy, minimal correlation</div>
                  </div>
                )
              }
            ]}
          />
        </div>

        {/* Compliance Notes */}
        {settings.complianceNotes && (
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
            <h4 className="text-sm font-medium text-gray-900 mb-2">Compliance Notes</h4>
            <p className="text-sm text-gray-600">{settings.complianceNotes}</p>
          </div>
        )}

        {/* Privacy Information */}
        <div className="p-4 bg-green-50 border border-green-200 rounded-md">
          <h4 className="text-sm font-medium text-green-900 mb-2">What We Collect</h4>
          <ul className="text-sm text-green-800 space-y-1">
            <li>• Error information (no sensitive data)</li>
            <li>• Performance metrics (page load times, API response times)</li>
            <li>• Feature usage patterns (which features are used)</li>
            <li>• System metrics (for infrastructure optimization)</li>
          </ul>
          
          <h4 className="text-sm font-medium text-green-900 mt-4 mb-2">What We DON'T Collect</h4>
          <ul className="text-sm text-green-800 space-y-1">
            <li>• Personal information (names, emails, addresses)</li>
            <li>• Client data or business information</li>
            <li>• Passwords or authentication tokens</li>
            <li>• File contents or documents</li>
          </ul>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <div className="text-sm text-red-800">{error}</div>
          </div>
        )}

        <div className="flex justify-between items-center pt-4 border-t">
          <div className="text-xs text-gray-500">
            Last updated: {new Date(settings.lastUpdated).toLocaleString()}
            {settings.updatedBy && ` by ${settings.updatedBy}`}
          </div>
          
          <div className="flex space-x-3">
            <Button
              id="reset-telemetry-settings"
              variant="outline"
              onClick={loadTenantSettings}
              disabled={saving}
            >
              Reset
            </Button>
            <Button
              id="save-telemetry-settings"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}