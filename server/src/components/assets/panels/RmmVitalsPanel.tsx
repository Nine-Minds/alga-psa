import React from 'react';
import { Card } from 'server/src/components/ui/Card';
import { Group, Text, Stack, Button, Loader } from '@mantine/core';
import { RefreshCw, WifiOff } from 'lucide-react';
import { RmmCachedData } from '../../../interfaces/asset.interfaces';
import { CopyableField } from '../shared/CopyableField';
import { StatusBadge } from '../shared/StatusBadge';
import { formatDateTime } from '../../../lib/utils/dateTimeUtils';

interface RmmVitalsPanelProps {
  data: RmmCachedData | null | undefined;
  isLoading: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const RmmVitalsPanel: React.FC<RmmVitalsPanelProps> = ({
  data,
  isLoading,
  onRefresh,
  isRefreshing
}) => {
  const formatUptime = (seconds: number | null) => {
    if (!seconds) return 'N/A';
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
  };

  if (isLoading) {
    return <Card className="h-64 animate-pulse bg-gray-50" />;
  }

  if (!data) {
    return (
      <Card title="RMM Vitals">
        <div className="flex flex-col items-center justify-center h-48 text-gray-400">
          <WifiOff size={48} className="mb-2" />
          <Text>Not connected to RMM</Text>
        </div>
      </Card>
    );
  }

  return (
    <Card 
      title="RMM Vitals & Connectivity" 
      action={
        <Button 
          variant="subtle" 
          size="xs" 
          leftSection={isRefreshing ? <Loader size={12} /> : <RefreshCw size={12} />}
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          Refresh
        </Button>
      }
    >
      <Stack gap="md">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">Agent Status:</Text>
          <Group gap="xs">
            <StatusBadge status={data.agent_status} size="sm" />
            {data.last_check_in && (
              <Text size="xs" c="dimmed">
                (Last check-in: {formatDateTime(new Date(data.last_check_in), Intl.DateTimeFormat().resolvedOptions().timeZone)})
              </Text>
            )}
          </Group>
        </Group>

        <Group justify="space-between">
          <Text size="sm" c="dimmed">Current User:</Text>
          <Text size="sm" fw={500}>{data.current_user || 'None'}</Text>
        </Group>

        <Group justify="space-between">
          <Text size="sm" c="dimmed">Uptime:</Text>
          <Text size="sm" fw={500}>{formatUptime(data.uptime_seconds)}</Text>
        </Group>

        <Group justify="space-between">
          <Text size="sm" c="dimmed">Last RMM Sync:</Text>
          <Text size="sm">
             {data.last_rmm_sync_at 
               ? formatDateTime(new Date(data.last_rmm_sync_at), Intl.DateTimeFormat().resolvedOptions().timeZone) 
               : 'Never'}
          </Text>
        </Group>

        <div className="pt-2 border-t">
          <Text size="xs" c="dimmed" fw={700} tt="uppercase" mb="xs">Network</Text>
          <Group grow>
            <CopyableField label="LAN IP" value={data.lan_ip} />
            <CopyableField label="WAN IP" value={data.wan_ip} />
          </Group>
        </div>
      </Stack>
    </Card>
  );
};