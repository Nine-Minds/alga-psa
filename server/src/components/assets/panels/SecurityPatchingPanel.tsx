import React from 'react';
import { Card } from '../../ui/Card';
import { Stack, Group, Text, ThemeIcon } from '@mantine/core';
import { 
  ShieldCheck, 
  ShieldAlert, 
  Shield,
  Bandage,
  Monitor,
  Command // Using Command for Mac/Apple
} from 'lucide-react';
import { AssetSummaryMetrics, Asset } from '../../../interfaces/asset.interfaces';

interface SecurityPatchingPanelProps {
  metrics: AssetSummaryMetrics | undefined;
  asset: Asset;
  isLoading: boolean;
}

export const SecurityPatchingPanel: React.FC<SecurityPatchingPanelProps> = ({
  metrics,
  asset,
  isLoading
}) => {
  if (isLoading) {
    return <Card className="h-48 animate-pulse bg-gray-50" />;
  }

  // Helper to determine OS icon
  const getOsIcon = () => {
    const os = asset.workstation?.os_type || asset.server?.os_type || '';
    if (os.toLowerCase().includes('win')) return Monitor;
    if (os.toLowerCase().includes('mac') || os.toLowerCase().includes('darwin')) return Command;
    return ShieldCheck; // Generic
  };
  const OsIcon = getOsIcon();
  const osVersion = asset.workstation?.os_version || asset.server?.os_version || 'Unknown';

  // Antivirus status (from extension data)
  const antivirusProduct = asset.workstation?.antivirus_product || asset.server?.antivirus_product || 'Unknown';
  const antivirusStatus = asset.workstation?.antivirus_status || asset.server?.antivirus_status;
  const isAvActive = antivirusStatus === 'running' || antivirusStatus === 'active';

  return (
    <Card title="Security & Patching">
      <Stack gap="md">
        {/* OS Version */}
        <Group>
          <ThemeIcon variant="light" color="gray" size="md">
            <OsIcon size={16} />
          </ThemeIcon>
          <div>
            <Text size="sm" fw={500}>OS Version</Text>
            <Text size="xs" c="dimmed">{osVersion}</Text>
          </div>
        </Group>

        {/* Antivirus */}
        <Group>
          <ThemeIcon variant="light" color={isAvActive ? 'green' : 'red'} size="md">
            {isAvActive ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
          </ThemeIcon>
          <div>
            <Text size="sm" fw={500}>Antivirus</Text>
            <Group gap="xs">
              <Text size="xs">{antivirusProduct}</Text>
              <Text size="xs" c={isAvActive ? 'green' : 'red'}>
                [{isAvActive ? 'Running' : 'Inactive'}]
              </Text>
            </Group>
          </div>
        </Group>

        {/* Patch Status */}
        <Group align="flex-start">
          <ThemeIcon variant="light" color={metrics?.security_status === 'secure' ? 'green' : 'yellow'} size="md">
            <Bandage size={16} />
          </ThemeIcon>
          <div>
            <Text size="sm" fw={500}>Patch Status</Text>
            {metrics?.security_issues && metrics.security_issues.length > 0 ? (
              <Stack gap={2} mt={2}>
                 {metrics.security_issues.map((issue, i) => (
                   <Text key={i} size="xs" c="red">{issue}</Text>
                 ))}
              </Stack>
            ) : (
              <Text size="xs" c="green">All systems up to date</Text>
            )}
          </div>
        </Group>
      </Stack>
    </Card>
  );
};