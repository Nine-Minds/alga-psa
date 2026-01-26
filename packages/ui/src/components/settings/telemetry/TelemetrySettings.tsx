'use client';

import { useState, useEffect } from "react";
import { Switch } from "../../Switch";
import { Label } from "../../Label";
import { Alert, AlertDescription } from "../../Alert";

export function TelemetrySettings() {
  const [usageStatsEnabled, setUsageStatsEnabled] = useState(false);

  useEffect(() => {
    // Check ALGA_USAGE_STATS environment variable status
    const checkUsageStats = async () => {
      try {
        const response = await fetch('/api/system/env-status');
        if (response.ok) {
          const data = await response.json();
          setUsageStatsEnabled(data.ALGA_USAGE_STATS === 'true');
        }
      } catch (error) {
        // Default to false if unable to fetch
        setUsageStatsEnabled(false);
      }
    };

    checkUsageStats();
  }, []);

  return (
    <div className="space-y-4">
      <div className="p-4 border rounded-lg">
        <div className="flex items-center space-x-3">
          <Switch
            id="usage-stats"
            checked={usageStatsEnabled}
            disabled={true}
            className="mt-1"
          />
          <div className="flex-1">
            <Label htmlFor="usage-stats" className="text-sm font-medium text-gray-900">
              Usage Statistics
            </Label>
            <p className="text-sm text-gray-600 mt-1">
              {usageStatsEnabled ? 'Enabled' : 'Disabled'} - Sends anonymous usage data to help improve the product
            </p>
          </div>
        </div>
      </div>

      <Alert variant="info">
        <AlertDescription>
          Usage statistics are controlled via the ALGA_USAGE_STATS environment variable.
          Contact your system administrator to modify this setting.
        </AlertDescription>
      </Alert>

      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-900 mb-2">What data is collected</h4>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• Feature usage patterns (no personal data)</li>
          <li>• Error reports for debugging</li>
          <li>• Performance metrics</li>
          <li>• System configuration (anonymized)</li>
        </ul>
      </div>
    </div>
  );
}