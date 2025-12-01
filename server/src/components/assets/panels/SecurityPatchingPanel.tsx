import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from 'server/src/components/ui/Card';
import { Stack, Group, Text } from '@mantine/core';
import { AssetSummaryMetrics, Asset } from '../../../interfaces/asset.interfaces';

interface SecurityPatchingPanelProps {
  metrics: AssetSummaryMetrics | undefined;
  asset: Asset;
  isLoading: boolean;
}

const SecurityRow = ({ label, value }: { label: string, value: React.ReactNode }) => (
  <Group gap="xs" align="flex-start" className="min-h-[24px]">
    <Text size="sm" fw={700} className="w-32 shrink-0">{label}:</Text>
    <div className="flex-1">
      {typeof value === 'string' ? <Text size="sm">{value}</Text> : value}
    </div>
  </Group>
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
        <Stack gap="xs">
          <SecurityRow 
            label="OS Version" 
            value={osVersion} 
          />

          <SecurityRow 
            label="Antivirus" 
            value={
              <Group gap="xs">
                <Text size="sm">{antivirusProduct}</Text>
                <Text size="sm" c={isAvActive ? 'green' : 'red'} fw={600}>
                  [{isAvActive ? '✔ Installed & Running' : 'Inactive'}]
                </Text>
                <Text size="sm" c="dimmed">| Last Scan: Today, 3:00 AM</Text>
              </Group>
            } 
          />

          <SecurityRow 
            label="Patch Status" 
            value={
              metrics?.security_issues && metrics.security_issues.length > 0 ? (
                <Group gap="xs">
                   <Text size="sm" c={metrics.security_status === 'critical' ? 'red' : 'yellow'} fw={600}>
                     [{metrics.security_status === 'critical' ? 'Critical' : 'At Risk'}]
                   </Text>
                   <Text size="sm">- {metrics.security_issues.length} Critical OS Patches missing.</Text>
                </Group>
              ) : (
                <Text size="sm" c="green" fw={600}>[✔ Up to Date]</Text>
              )
            } 
          />

          <SecurityRow 
            label="Firewall" 
            value={
              <Text size="sm" c="green" fw={600}>[✔ On]</Text>
            } 
          />
        </Stack>
      </CardContent>
    </Card>
  );
};