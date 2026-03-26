import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@alga-psa/ui/components/Card';
import type { AssetSummaryMetrics, Asset } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface SecurityPatchingPanelProps {
  metrics: AssetSummaryMetrics | undefined;
  asset: Asset;
  isLoading: boolean;
}

const SecurityRow = ({ label, value }: { label: string, value: React.ReactNode }) => (
  <div className="flex items-start gap-2 min-h-[24px]">
    <span className="text-sm font-bold text-gray-700 w-32 shrink-0">{label}:</span>
    <div className="flex-1">
      {typeof value === 'string' ? <span className="text-sm text-gray-900">{value}</span> : value}
    </div>
  </div>
);

export const SecurityPatchingPanel: React.FC<SecurityPatchingPanelProps> = ({
  metrics,
  asset,
  isLoading
}) => {
  const { t } = useTranslation('msp/assets');
  if (isLoading) {
    return <Card className="h-48 animate-pulse bg-gray-50" />;
  }

  const osVersion = asset.workstation?.os_version || asset.server?.os_version || t('securityPatchingPanel.values.unknown', {
    defaultValue: 'Unknown'
  });

  // Antivirus status
  const antivirusProduct = asset.workstation?.antivirus_product || asset.server?.antivirus_product || t('securityPatchingPanel.values.unknown', {
    defaultValue: 'Unknown'
  });
  const antivirusStatus = asset.workstation?.antivirus_status || asset.server?.antivirus_status;
  const isAvActive = antivirusStatus === 'running' || antivirusStatus === 'active';

  return (
    <Card className="bg-white">
      <CardHeader>
        <CardTitle>{t('securityPatchingPanel.title', { defaultValue: 'Security & Patching' })}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          <SecurityRow 
            label={t('securityPatchingPanel.fields.osVersion', { defaultValue: 'OS Version' })}
            value={osVersion} 
          />

          <SecurityRow 
            label={t('securityPatchingPanel.fields.antivirus', { defaultValue: 'Antivirus' })}
            value={
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-gray-900">{antivirusProduct}</span>
                <span className={`text-sm font-semibold ${isAvActive ? 'text-emerald-600' : 'text-red-600'}`}>
                  [{isAvActive
                    ? t('securityPatchingPanel.antivirus.running', { defaultValue: '✔ Installed & Running' })
                    : t('securityPatchingPanel.antivirus.inactive', { defaultValue: 'Inactive' })}]
                </span>
                <span className="text-sm text-gray-400">
                  {t('securityPatchingPanel.antivirus.lastScan', {
                    defaultValue: '| Last Scan: Today, 3:00 AM'
                  })}
                </span>
              </div>
            } 
          />

          <SecurityRow 
            label={t('securityPatchingPanel.fields.patchStatus', { defaultValue: 'Patch Status' })}
            value={
              metrics?.security_issues && metrics.security_issues.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                   <span className={`text-sm font-semibold ${metrics.security_status === 'critical' ? 'text-red-600' : 'text-amber-600'}`}>
                     [{metrics.security_status === 'critical'
                       ? t('securityPatchingPanel.patchStatus.critical', { defaultValue: 'Critical' })
                       : t('securityPatchingPanel.patchStatus.atRisk', { defaultValue: 'At Risk' })}]
                   </span>
                   <span className="text-sm text-gray-700">
                     {t('securityPatchingPanel.patchStatus.missingPatches', {
                       defaultValue: '- {{count}} Critical OS Patches missing.',
                       count: metrics.security_issues.length
                     })}
                   </span>
                </div>
              ) : (
                <span className="text-sm text-emerald-600 font-semibold">
                  [{t('securityPatchingPanel.patchStatus.upToDate', { defaultValue: '✔ Up to Date' })}]
                </span>
              )
            } 
          />

          <SecurityRow 
            label={t('securityPatchingPanel.fields.firewall', { defaultValue: 'Firewall' })}
            value={
              <span className="text-sm text-emerald-600 font-semibold">
                [{t('securityPatchingPanel.firewall.on', { defaultValue: '✔ On' })}]
              </span>
            } 
          />
        </div>
      </CardContent>
    </Card>
  );
};
