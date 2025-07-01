'use client';

import { useState, useEffect } from "react";
import { Card } from "server/src/components/ui/Card";
import { Switch } from "server/src/components/ui/Switch";
import { Label } from "server/src/components/ui/Label";
import { Button } from "server/src/components/ui/Button";
import { TELEMETRY_CONFIG } from "server/src/config/telemetry";
import { TelemetryConsentData } from "server/src/lib/models/telemetryPreferences";

interface TelemetrySettingsProps {
  onSettingsUpdate?: (settings: TelemetryConsentData) => void;
}

export function TelemetrySettings({ onSettingsUpdate }: TelemetrySettingsProps) {
  const [preferences, setPreferences] = useState<TelemetryConsentData | null>(null);
  const [tenantSettings, setTenantSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTelemetryPreferences();
  }, []);

  const loadTelemetryPreferences = async () => {
    try {
      setLoading(true);
      
      // Load both user preferences and tenant settings
      const [userResponse, tenantResponse] = await Promise.all([
        fetch('/api/user/telemetry-preferences'),
        fetch('/api/user/telemetry-decision')
      ]);
      
      if (!userResponse.ok) throw new Error('Failed to load telemetry preferences');
      if (!tenantResponse.ok) throw new Error('Failed to load tenant settings');
      
      const userData = await userResponse.json();
      const decisionData = await tenantResponse.json();
      
      setPreferences(userData);
      setTenantSettings(decisionData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preferences');
      // Set safe defaults on error
      setPreferences({
        ...TELEMETRY_CONFIG.DEFAULT_PREFERENCES,
        last_updated: new Date().toISOString(),
        consent_version: TELEMETRY_CONFIG.PRIVACY.CONSENT_VERSION,
        user_id: 'current',
        tenant_id: '',
      });
      setTenantSettings({
        tenantSettings: { enabled: false, allowUserOverride: false },
        userSettings: { optedOut: false, canOptOut: false },
        reason: 'Failed to load settings'
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
      <div className="space-y-4">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded mb-4"></div>
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!preferences || !tenantSettings) {
    return (
      <div className="text-red-500">Failed to load telemetry settings</div>
    );
  }

  // Check if telemetry is disabled at various levels
  const environmentDisabled = !TELEMETRY_CONFIG.ENVIRONMENT_OVERRIDES.TELEMETRY_ENABLED ||
                              TELEMETRY_CONFIG.ENVIRONMENT_OVERRIDES.TELEMETRY_FORCE_DISABLE;
  const tenantDisabled = !tenantSettings.tenantSettings.enabled;
  const userCannotOptOut = !tenantSettings.userSettings.canOptOut;
  const effectivelyDisabled = environmentDisabled || tenantDisabled;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-gray-600 mt-1">
          Telemetry is enabled by default to help improve Alga PSA through anonymous usage data. 
          You can opt-out of any categories you prefer. All data stays within your infrastructure.
        </p>
      </div>

      {/* Status Messages */}
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

      {!environmentDisabled && tenantDisabled && (
        <div className="bg-orange-50 border border-orange-200 rounded-md p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-orange-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-orange-800">
                Telemetry has been disabled by your organization administrator.
              </p>
            </div>
          </div>
        </div>
      )}

      {!environmentDisabled && !tenantDisabled && userCannotOptOut && (
        <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-blue-800">
                Telemetry is managed centrally by your organization. Individual opt-out is not available - contact your administrator if needed.
              </p>
            </div>
          </div>
        </div>
      )}

      {!environmentDisabled && !tenantDisabled && !userCannotOptOut && (
        <div className="bg-green-50 border border-green-200 rounded-md p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-green-800">
                ✓ Telemetry enabled to help improve the product. You can opt-out of any categories below.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <TelemetryCategory
          id="error_tracking"
          title="Error Tracking"
          description="Share error information to help us fix bugs faster. No personal data is included. (Enabled by default)"
          enabled={preferences.error_tracking && !effectivelyDisabled}
          disabled={effectivelyDisabled || userCannotOptOut}
          onChange={(enabled) => handlePreferenceChange('error_tracking', enabled)}
        />
        
        <TelemetryCategory
          id="performance_metrics" 
          title="Performance Metrics"
          description="Share page load times and API response metrics to improve performance. (Enabled by default)"
          enabled={preferences.performance_metrics && !effectivelyDisabled}
          disabled={effectivelyDisabled || userCannotOptOut}
          onChange={(enabled) => handlePreferenceChange('performance_metrics', enabled)}
        />
        
        <TelemetryCategory
          id="usage_analytics"
          title="Usage Analytics" 
          description="Share which features are used to guide development priorities. (Enabled by default)"
          enabled={preferences.usage_analytics && !effectivelyDisabled}
          disabled={effectivelyDisabled || userCannotOptOut}
          onChange={(enabled) => handlePreferenceChange('usage_analytics', enabled)}
        />

        <TelemetryCategory
          id="system_metrics"
          title="System Metrics"
          description="Share system performance data to optimize infrastructure. (Enabled by default)"
          enabled={preferences.system_metrics && !effectivelyDisabled}
          disabled={effectivelyDisabled || userCannotOptOut}
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
          id="opt-out-all"
          variant="outline"
          onClick={handleDisableAll}
          disabled={saving || effectivelyDisabled || userCannotOptOut}
        >
          Opt-Out of All
        </Button>
        
        <div className="flex space-x-3">
          <Button
            id="reset-preferences"
            variant="outline"
            onClick={loadTelemetryPreferences}
            disabled={saving}
          >
            Reset
          </Button>
          <Button
            id="save-preferences"
            onClick={handleSave}
            disabled={saving || effectivelyDisabled || userCannotOptOut}
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