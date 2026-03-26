import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { RefreshCw, WifiOff } from 'lucide-react';
import type { RmmCachedData } from '@alga-psa/types';
import { StatusBadge } from '../shared/StatusBadge';
import { formatRelativeDateTime } from '@alga-psa/core';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  const { t } = useTranslation('msp/assets');
  const formatUptime = (seconds: number | null) => {
    if (!seconds) {
      return t('common.states.na', { defaultValue: 'N/A' });
    }
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return t('rmmVitalsPanel.uptime', {
      defaultValue: '{{days}} days, {{hours}} hours, {{minutes}} minutes',
      days,
      hours,
      minutes
    });
  };

  if (isLoading) {
    return <Card className="h-64 animate-pulse bg-gray-50" />;
  }

  if (!data) {
    return (
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>{t('rmmVitalsPanel.empty.title', { defaultValue: 'RMM Vitals' })}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <WifiOff size={48} className="mb-2" />
            <span className="text-sm">
              {t('rmmVitalsPanel.empty.notConnected', { defaultValue: 'Not connected to RMM' })}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white">
      <CardHeader className="pb-2">
        <div className="flex flex-row items-center justify-between">
          <CardTitle>
            {t('rmmVitalsPanel.title', { defaultValue: 'RMM Vitals & Connectivity' })}
          </CardTitle>
          <Button 
            id="refresh-rmm-vitals-btn"
            variant="ghost" 
            size="sm" 
            className="h-8 gap-2 text-primary-600 hover:text-primary-700 hover:bg-primary-50"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            {t('rmmVitalsPanel.actions.refresh', { defaultValue: 'Refresh' })}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          <VitalRow 
            label={t('rmmVitalsPanel.fields.agentStatus', { defaultValue: 'Agent Status' })}
            value={
              <div className="flex items-center gap-2">
                <StatusBadge status={(data.agent_status as any) || 'unknown'} size="sm" showIcon={false} />
                {data.last_check_in && (
                  <span className="text-sm text-gray-500">
                    {t('rmmVitalsPanel.fields.lastCheckIn', {
                      defaultValue: '(Last check-in: {{value}})',
                      value: formatRelativeDateTime(new Date(data.last_check_in), Intl.DateTimeFormat().resolvedOptions().timeZone)
                    })}
                  </span>
                )}
              </div>
            } 
          />

          <VitalRow
            label={t('rmmVitalsPanel.fields.currentUser', { defaultValue: 'Current User' })}
            value={data.current_user || t('common.states.none', { defaultValue: 'None' })}
          />
          
          <VitalRow
            label={t('rmmVitalsPanel.fields.uptime', { defaultValue: 'Uptime' })}
            value={formatUptime(data.uptime_seconds)}
          />
          
          <VitalRow 
            label={t('rmmVitalsPanel.fields.lastSync', { defaultValue: 'Last RMM Sync' })}
            value={data.last_rmm_sync_at 
              ? formatRelativeDateTime(new Date(data.last_rmm_sync_at), Intl.DateTimeFormat().resolvedOptions().timeZone) 
              : t('rmmVitalsPanel.values.never', { defaultValue: 'Never' })
            } 
          />

          <VitalRow 
            label={t('rmmVitalsPanel.fields.network', { defaultValue: 'Network' })}
            value={t('rmmVitalsPanel.fields.networkValue', {
              defaultValue: 'LAN IP: {{lan}} | WAN IP: {{wan}}',
              lan: data.lan_ip || t('common.states.na', { defaultValue: 'N/A' }),
              wan: data.wan_ip || t('common.states.na', { defaultValue: 'N/A' })
            })}
          />
        </div>
      </CardContent>
    </Card>
  );
};
