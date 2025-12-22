'use client';

/**
 * NinjaOne Compliance Dashboard Widget
 *
 * Displays fleet-wide compliance metrics for RMM-managed devices:
 * - Device online/offline status
 * - Patch compliance summary
 * - Active alert count
 * - Software inventory stats
 */

import React, { useEffect, useRef, useState, useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import LoadingIndicator from '@/components/ui/LoadingIndicator';
import {
  Monitor,
  MonitorOff,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import {
  getRmmComplianceSummary,
  triggerPatchStatusSync,
  triggerSoftwareInventorySync,
} from '../../../lib/actions/integrations/ninjaoneActions';

interface ComplianceSummary {
  totalDevices: number;
  devicesOnline: number;
  devicesOffline: number;
  devicesWithAlerts: number;
  devicesNeedingPatches: number;
  patchesPending: number;
  patchesFailed: number;
  lastSyncAt?: string;
}

interface MetricCardProps {
  icon: React.ElementType;
  label: string;
  value: number;
  total?: number;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}

const MetricCard: React.FC<MetricCardProps> = ({
  icon: Icon,
  label,
  value,
  total,
  variant = 'default',
}) => {
  const variantClasses = {
    default: 'text-muted-foreground',
    success: 'text-green-600',
    warning: 'text-amber-600',
    danger: 'text-red-600',
  };

  const iconClasses = {
    default: 'text-muted-foreground',
    success: 'text-green-500',
    warning: 'text-amber-500',
    danger: 'text-red-500',
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border/50">
      <div className={`p-2 rounded-full bg-background ${iconClasses[variant]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-lg font-semibold ${variantClasses[variant]}`}>
          {value}
          {total !== undefined && (
            <span className="text-sm font-normal text-muted-foreground">
              /{total}
            </span>
          )}
        </p>
      </div>
    </div>
  );
};

interface NinjaOneComplianceDashboardProps {
  /**
   * When this value changes, re-fetch compliance summary.
   * Used to refresh after device sync.
   */
  refreshKey?: number;
}

const NinjaOneComplianceDashboard: React.FC<NinjaOneComplianceDashboardProps> = ({ refreshKey }) => {
  const [summary, setSummary] = useState<ComplianceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncingPatches, startPatchSync] = useTransition();
  const [isSyncingSoftware, startSoftwareSync] = useTransition();

  const fetchSummary = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getRmmComplianceSummary();
      if (!result.success || result.error) {
        setError(result.error ?? 'Failed to load compliance summary');
        setSummary(null);
      } else if (result.summary) {
        setSummary(result.summary);
      } else {
        setSummary(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load compliance summary';
      setError(message);
      setSummary(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  // Parent-driven refresh without double-fetching on mount.
  const lastRefreshKeyRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (refreshKey === undefined) return;
    if (lastRefreshKeyRef.current === undefined) {
      lastRefreshKeyRef.current = refreshKey;
      return;
    }
    if (refreshKey !== lastRefreshKeyRef.current) {
      lastRefreshKeyRef.current = refreshKey;
      fetchSummary();
    }
  }, [refreshKey]);

  const handleSyncPatches = () => {
    startPatchSync(async () => {
      try {
        await triggerPatchStatusSync();
        await fetchSummary();
      } catch (err) {
        console.error('Patch sync failed:', err);
      }
    });
  };

  const handleSyncSoftware = () => {
    startSoftwareSync(async () => {
      try {
        await triggerSoftwareInventorySync({ trackChanges: true });
        await fetchSummary();
      } catch (err) {
        console.error('Software sync failed:', err);
      }
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fleet Compliance</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <LoadingIndicator
            spinnerProps={{ size: 'sm' }}
            text="Loading compliance data..."
          />
        </CardContent>
      </Card>
    );
  }

  if (error || !summary) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fleet Compliance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            {error || 'No compliance data available'}
          </div>
          <Button
            id="ninjaone-compliance-retry-btn"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={fetchSummary}
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Calculate compliance scores
  const onlinePercentage = summary.totalDevices > 0
    ? Math.round((summary.devicesOnline / summary.totalDevices) * 100)
    : 0;

  const patchCompliant = summary.totalDevices - (summary.patchesPending > 0 ? 1 : 0) - (summary.patchesFailed > 0 ? 1 : 0);
  const isHealthy = summary.devicesOffline === 0 && summary.patchesFailed === 0 && summary.devicesWithAlerts === 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              Fleet Compliance
              {isHealthy && (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              )}
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              RMM-managed device health overview
            </CardDescription>
          </div>
          <Button
            id="ninjaone-compliance-refresh-btn"
            variant="ghost"
            size="sm"
            onClick={fetchSummary}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Device Status */}
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            icon={Monitor}
            label="Devices Online"
            value={summary.devicesOnline}
            total={summary.totalDevices}
            variant={onlinePercentage >= 90 ? 'success' : onlinePercentage >= 70 ? 'warning' : 'danger'}
          />
          <MetricCard
            icon={MonitorOff}
            label="Devices Offline"
            value={summary.devicesOffline}
            variant={summary.devicesOffline === 0 ? 'success' : summary.devicesOffline < 5 ? 'warning' : 'danger'}
          />
        </div>

        {/* Patch Status */}
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            icon={ShieldAlert}
            label="Patches Pending"
            value={summary.patchesPending}
            variant={summary.patchesPending === 0 ? 'success' : summary.patchesPending < 10 ? 'warning' : 'danger'}
          />
          <MetricCard
            icon={summary.patchesFailed === 0 ? ShieldCheck : XCircle}
            label="Patches Failed"
            value={summary.patchesFailed}
            variant={summary.patchesFailed === 0 ? 'success' : 'danger'}
          />
        </div>

        {/* Alerts */}
        <MetricCard
          icon={AlertTriangle}
          label="Devices With Alerts"
          value={summary.devicesWithAlerts}
          variant={summary.devicesWithAlerts === 0 ? 'success' : summary.devicesWithAlerts < 5 ? 'warning' : 'danger'}
        />

        {/* Sync Actions */}
        <div className="flex gap-2 pt-2 border-t">
          <Button
            id="ninjaone-sync-patches-btn"
            variant="outline"
            size="sm"
            onClick={handleSyncPatches}
            disabled={isSyncingPatches || isSyncingSoftware}
            className="flex-1"
          >
            {isSyncingPatches ? (
              <>
                <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                Syncing...
              </>
            ) : (
              'Sync Patches'
            )}
          </Button>
          <Button
            id="ninjaone-sync-software-btn"
            variant="outline"
            size="sm"
            onClick={handleSyncSoftware}
            disabled={isSyncingPatches || isSyncingSoftware}
            className="flex-1"
          >
            {isSyncingSoftware ? (
              <>
                <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                Syncing...
              </>
            ) : (
              'Sync Software'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default NinjaOneComplianceDashboard;
