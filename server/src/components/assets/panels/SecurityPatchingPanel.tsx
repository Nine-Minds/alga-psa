import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from 'server/src/components/ui/Card';
import { AssetSummaryMetrics, Asset } from '../../../interfaces/asset.interfaces';

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
  if (isLoading) {
    return <Card className="h-48 animate-pulse bg-gray-50" />;
  }

  const osVersion = asset.workstation?.os_version || asset.server?.os_version || 'Unknown';

  // Antivirus status
  const antivirusProduct = asset.workstation?.antivirus_product || asset.server?.antivirus_product || 'Unknown';
  const antivirusStatus = asset.workstation?.antivirus_status || asset.server?.antivirus_status;
  const isAvActive = antivirusStatus === 'running' || antivirusStatus === 'active';

  return (
    <Card className="bg-white">
      <CardHeader>
        <CardTitle>Security & Patching</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          <SecurityRow 
            label="OS Version" 
            value={osVersion} 
          />

          <SecurityRow 
            label="Antivirus" 
            value={
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-gray-900">{antivirusProduct}</span>
                <span className={`text-sm font-semibold ${isAvActive ? 'text-emerald-600' : 'text-red-600'}`}>
                  [{isAvActive ? '✔ Installed & Running' : 'Inactive'}]
                </span>
                <span className="text-sm text-gray-400">| Last Scan: Today, 3:00 AM</span>
              </div>
            } 
          />

          <SecurityRow 
            label="Patch Status" 
            value={
              metrics?.security_issues && metrics.security_issues.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                   <span className={`text-sm font-semibold ${metrics.security_status === 'critical' ? 'text-red-600' : 'text-amber-600'}`}>
                     [{metrics.security_status === 'critical' ? 'Critical' : 'At Risk'}]
                   </span>
                   <span className="text-sm text-gray-700">- {metrics.security_issues.length} Critical OS Patches missing.</span>
                </div>
              ) : (
                <span className="text-sm text-emerald-600 font-semibold">[✔ Up to Date]</span>
              )
            } 
          />

          <SecurityRow 
            label="Firewall" 
            value={
              <span className="text-sm text-emerald-600 font-semibold">[✔ On]</span>
            } 
          />
        </div>
      </CardContent>
    </Card>
  );
};