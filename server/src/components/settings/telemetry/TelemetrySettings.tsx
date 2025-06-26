'use client';

import { useState, useEffect } from "react";
import { Card } from "server/src/components/ui/Card";
import { Switch } from "server/src/components/ui/Switch";
import { Label } from "server/src/components/ui/Label";
import { Button } from "server/src/components/ui/Button";
import { TELEMETRY_CONFIG } from "server/src/config/telemetry";
import { TelemetryConsentData } from "server/src/lib/models/telemetryPreferences";

interface TelemetrySettingsProps {
  userId: string;
  onSettingsUpdate?: (settings: TelemetryConsentData) => void;
}

export function TelemetrySettings({ userId, onSettingsUpdate }: TelemetrySettingsProps) {
  const [preferences, setPreferences] = useState<TelemetryConsentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTelemetryPreferences();
  }, [userId]);

  const loadTelemetryPreferences = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/user/telemetry-preferences');
      if (!response.ok) throw new Error('Failed to load telemetry preferences');
      
      const data = await response.json();
      setPreferences(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preferences');
      // Set safe defaults on error
      setPreferences({
        ...TELEMETRY_CONFIG.DEFAULT_PREFERENCES,
        last_updated: new Date().toISOString(),
        consent_version: TELEMETRY_CONFIG.PRIVACY.CONSENT_VERSION,
        user_id: userId,
        tenant_id: '',
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePreferenceChange = (category: string, enabled: boolean) => {
    if (!preferences) return;

    setPreferences({
      ...preferences,
      [category]: enabled,
      last_updated: new Date().toISOString()
    });
  };

  const handleSave = async () => {
    if (!preferences) return;

    try {
      setSaving(true);
      setError(null);

      const response = await fetch('/api/user/telemetry-preferences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(preferences),
      });

      if (!response.ok) throw new Error('Failed to save telemetry preferences');

      const updatedPreferences = await response.json();
      setPreferences(updatedPreferences);
      onSettingsUpdate?.(updatedPreferences);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  const handleDisableAll = () => {
    if (!preferences) return;

    const disabledPreferences = {
      ...preferences,
      ...Object.keys(TELEMETRY_CONFIG.DEFAULT_PREFERENCES).reduce(
        (acc, category) => ({ ...acc, [category]: false }),
        {}
      ),
      last_updated: new Date().toISOString()
    };

    setPreferences(disabledPreferences);
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded mb-4"></div>
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 rounded"></div>
            ))}
          </div>
        </div>
      </Card>
    );
  }

  if (!preferences) {
    return (
      <Card className="p-6">
        <div className="text-red-500">Failed to load telemetry settings</div>
      </Card>
    );
  }

  // Check if telemetry is disabled at environment level
  const environmentDisabled = !TELEMETRY_CONFIG.ENVIRONMENT_OVERRIDES.TELEMETRY_ENABLED ||
                              TELEMETRY_CONFIG.ENVIRONMENT_OVERRIDES.TELEMETRY_FORCE_DISABLE;

  return (
    <Card className="p-6">
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Telemetry & Analytics</h3>
          <p className="text-sm text-gray-600 mt-1">
            Help improve Alga PSA by sharing anonymous usage data. All data stays within your infrastructure.
          </p>
        </div>

        {environmentDisabled && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-yellow-800">
                  Telemetry is currently disabled by system administrators.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <TelemetryCategory
            id="error_tracking"
            title="Error Tracking"
            description="Share error information to help us fix bugs faster. No personal data is included."
            enabled={preferences.error_tracking && !environmentDisabled}
            disabled={environmentDisabled}
            onChange={(enabled) => handlePreferenceChange('error_tracking', enabled)}
          />
          
          <TelemetryCategory
            id="performance_metrics" 
            title="Performance Metrics"
            description="Share page load times and API response metrics to improve performance."
            enabled={preferences.performance_metrics && !environmentDisabled}
            disabled={environmentDisabled}
            onChange={(enabled) => handlePreferenceChange('performance_metrics', enabled)}
          />
          
          <TelemetryCategory
            id="usage_analytics"
            title="Usage Analytics" 
            description="Share which features are used to guide development priorities."
            enabled={preferences.usage_analytics && !environmentDisabled}
            disabled={environmentDisabled}
            onChange={(enabled) => handlePreferenceChange('usage_analytics', enabled)}
          />

          <TelemetryCategory
            id="system_metrics"
            title="System Metrics"
            description="Share system performance data to optimize infrastructure."
            enabled={preferences.system_metrics && !environmentDisabled}
            disabled={environmentDisabled}
            onChange={(enabled) => handlePreferenceChange('system_metrics', enabled)}
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <div className="text-sm text-red-800">{error}</div>
          </div>
        )}

        <div className="bg-gray-50 rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-900 mb-2">Privacy Commitment</h4>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• All telemetry data remains on your infrastructure</li>
            <li>• No personal information is ever collected</li>  
            <li>• You can disable telemetry at any time</li>
            <li>• Data helps improve the product for everyone</li>
            <li>• Identifiers are anonymized for correlation</li>
          </ul>
        </div>

        <div className="flex justify-between items-center pt-4 border-t">
          <Button
            variant="outline"
            onClick={handleDisableAll}
            disabled={saving || environmentDisabled}
          >
            Disable All
          </Button>
          
          <div className="flex space-x-3">
            <Button
              variant="outline"
              onClick={loadTelemetryPreferences}
              disabled={saving}
            >
              Reset
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || environmentDisabled}
            >
              {saving ? 'Saving...' : 'Save Preferences'}
            </Button>
          </div>
        </div>

        <div className="text-xs text-gray-500">
          Last updated: {new Date(preferences.last_updated).toLocaleString()}
          {preferences.consent_version && ` • Consent version: ${preferences.consent_version}`}
        </div>
      </div>
    </Card>
  );
}

interface TelemetryCategoryProps {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  disabled?: boolean;
  onChange: (enabled: boolean) => void;
}

function TelemetryCategory({ 
  id, 
  title, 
  description, 
  enabled, 
  disabled = false,
  onChange 
}: TelemetryCategoryProps) {
  return (
    <div className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-gray-50">
      <Switch
        id={id}
        checked={enabled}
        disabled={disabled}
        onCheckedChange={onChange}
        className="mt-1"
      />
      <div className="flex-1 min-w-0">
        <Label htmlFor={id} className="text-sm font-medium text-gray-900 cursor-pointer">
          {title}
        </Label>
        <p className="text-sm text-gray-600 mt-1">{description}</p>
      </div>
    </div>
  );
}