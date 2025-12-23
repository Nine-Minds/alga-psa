import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { RefreshCw, WifiOff } from 'lucide-react';
import Spinner from 'server/src/components/ui/Spinner';
import { RmmCachedData } from '../../../interfaces/asset.interfaces';
import { StatusBadge } from '../shared/StatusBadge';
import { formatRelativeDateTime } from '../../../lib/utils/dateTimeUtils';
import { cn } from 'server/src/lib/utils';

interface RmmVitalsPanelProps {
  data: RmmCachedData | null | undefined;
  isLoading: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
}

const VitalRow = ({ label, value }: { label: string, value: React.ReactNode }) => (
  <div className="flex items-start gap-2 min-h-[24px]">
    <span className="text-sm font-bold text-gray-700 w-32 shrink-0">{label}:</span>
    <div className="flex-1">
      {typeof value === 'string' ? <span className="text-sm text-gray-900">{value}</span> : value}
    </div>
  </div>
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
            <span className="text-sm">Not connected to RMM</span>
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
            variant="ghost" 
            size="sm" 
            className="h-8 gap-2 text-primary-600 hover:text-primary-700 hover:bg-primary-50"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? <Spinner size="sm" className="h-3 w-3" /> : <RefreshCw size={14} />}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          <VitalRow 
            label="Agent Status" 
            value={
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-900">{data.agent_status === 'online' ? 'Online' : 'Offline'}</span>
                {data.last_check_in && (
                  <span className="text-sm text-gray-500">
                    (Last check-in: {formatRelativeDateTime(new Date(data.last_check_in), Intl.DateTimeFormat().resolvedOptions().timeZone)})
                  </span>
                )}
              </div>
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
        </div>
      </CardContent>
    </Card>
  );
};