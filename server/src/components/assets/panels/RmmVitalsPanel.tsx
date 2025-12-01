import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from 'server/src/components/ui/Card';
import { Group, Text, Stack, Button, Loader } from '@mantine/core';
import { RefreshCw, WifiOff } from 'lucide-react';
import { RmmCachedData } from '../../../interfaces/asset.interfaces';
import { StatusBadge } from '../shared/StatusBadge';
import { formatRelativeDateTime } from '../../../lib/utils/dateTimeUtils';

interface RmmVitalsPanelProps {
  data: RmmCachedData | null | undefined;
  isLoading: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
}

const VitalRow = ({ label, value }: { label: string, value: React.ReactNode }) => (
  <Group gap="xs" align="flex-start" className="min-h-[24px]">
    <Text size="sm" fw={700} className="w-32 shrink-0">{label}:</Text>
    <div className="flex-1">
      {typeof value === 'string' ? <Text size="sm">{value}</Text> : value}
    </div>
  </Group>
);

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
    return `${days} days, ${hours} hours, ${minutes} minutes`;
  };

  if (isLoading) {
    return <Card className="h-64 animate-pulse bg-gray-50" />;
  }

  if (!data) {
    return (
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>RMM Vitals</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <WifiOff size={48} className="mb-2" />
            <Text>Not connected to RMM</Text>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white">
      <CardHeader className="pb-2">
        <div className="flex flex-row items-center justify-between">
          <CardTitle>RMM Vitals & Connectivity</CardTitle>
          <Button 
            id="refresh-rmm-vitals-btn"
            variant="subtle" 
            size="xs" 
            leftSection={isRefreshing ? <Loader size={12} /> : <RefreshCw size={12} />}
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Stack gap="xs">
          <VitalRow 
            label="Agent Status" 
            value={
              <Group gap="xs">
                <Text size="sm">{data.agent_status === 'online' ? 'Online' : 'Offline'}</Text>
                {data.last_check_in && (
                  <Text size="sm" c="dimmed">
                    (Last check-in: {formatRelativeDateTime(new Date(data.last_check_in), Intl.DateTimeFormat().resolvedOptions().timeZone)})
                  </Text>
                )}
              </Group>
            } 
          />

          <VitalRow label="Current User" value={data.current_user || 'None'} />
          
          <VitalRow label="Uptime" value={formatUptime(data.uptime_seconds)} />
          
          <VitalRow 
            label="Last RMM Sync" 
            value={data.last_rmm_sync_at 
              ? formatRelativeDateTime(new Date(data.last_rmm_sync_at), Intl.DateTimeFormat().resolvedOptions().timeZone) 
              : 'Never'
            } 
          />

          <VitalRow 
            label="Network" 
            value={`LAN IP: ${data.lan_ip || 'N/A'}  |  WAN IP: ${data.wan_ip || 'N/A'}`} 
          />
        </Stack>
      </CardContent>
    </Card>
  );
};