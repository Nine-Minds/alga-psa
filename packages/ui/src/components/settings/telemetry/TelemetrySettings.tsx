'use client';

import { useState, useEffect } from "react";
import { Switch } from "@alga-psa/ui/components/Switch";
import { Label } from "@alga-psa/ui/components/Label";
import { Alert, AlertDescription } from "@alga-psa/ui/components/Alert";
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export function TelemetrySettings() {
  const { t } = useTranslation('msp/settings');
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
              {t('telemetry.fields.usageStats.label')}
            </Label>
            <p className="text-sm text-gray-600 mt-1">
              {usageStatsEnabled
                ? t('telemetry.fields.usageStats.enabledDescription')
                : t('telemetry.fields.usageStats.disabledDescription')}
            </p>
          </div>
        </div>
      </div>

      <Alert variant="info">
        <AlertDescription>
          {t('telemetry.environmentHelp', { variable: 'ALGA_USAGE_STATS' })}
        </AlertDescription>
      </Alert>

      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-900 mb-2">{t('telemetry.sections.collectedData.title')}</h4>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• {t('telemetry.sections.collectedData.featureUsage')}</li>
          <li>• {t('telemetry.sections.collectedData.errorReports')}</li>
          <li>• {t('telemetry.sections.collectedData.performance')}</li>
          <li>• {t('telemetry.sections.collectedData.configuration')}</li>
        </ul>
      </div>
    </div>
  );
}
