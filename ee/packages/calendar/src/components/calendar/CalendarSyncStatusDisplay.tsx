/**
 * Calendar Sync Status Component
 * Displays calendar sync status for a schedule entry
 */

'use client';

import React, { useState, useEffect, useId } from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { CheckCircle, Clock, XCircle, RefreshCw, AlertTriangle } from 'lucide-react';
import { getScheduleEntrySyncStatus } from '../../actions';
import { CalendarSyncStatus } from '@alga-psa/types';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface CalendarSyncStatusDisplayProps {
  entryId: string;
  compact?: boolean;
}

export function CalendarSyncStatusDisplay({ entryId, compact = false }: CalendarSyncStatusDisplayProps) {
  const [syncStatuses, setSyncStatuses] = useState<CalendarSyncStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const componentId = useId();
  const { t } = useTranslation('msp/calendar');

  useEffect(() => {
    if (entryId) {
      loadSyncStatus();
    }
  }, [entryId]);

  const loadSyncStatus = async () => {
    try {
      setLoading(true);
      const result = await getScheduleEntrySyncStatus(entryId);
      if (result.success && result.status) {
        setSyncStatuses(result.status);
        setError(null);
      } else {
        setError(result.error || null);
      }
    } catch (err: any) {
      setError(err.message || t('calendar.sync.loadError', { defaultValue: 'Failed to load sync status' }));
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return compact ? (
      <Badge variant="secondary" className="flex items-center gap-1">
        <Clock className="h-3 w-3 animate-pulse" />
        {t('calendar.sync.compact.syncing', { defaultValue: 'Syncing...' })}
      </Badge>
    ) : null;
  }

  if (error || syncStatuses.length === 0) {
    return null;
  }

  const getStatusIcon = (status: CalendarSyncStatus) => {
    const syncStatus = status.entrySyncStatus?.syncStatus;
    switch (syncStatus) {
      case 'synced':
        return <CheckCircle className="h-3 w-3 text-green-600" />;
      case 'pending':
        return <Clock className="h-3 w-3 text-yellow-600" />;
      case 'conflict':
        return <AlertTriangle className="h-3 w-3 text-orange-600" />;
      case 'error':
        return <XCircle className="h-3 w-3 text-red-600" />;
      default:
        return null;
    }
  };

  const getStatusLabel = (status: CalendarSyncStatus) => {
    const syncStatus = status.entrySyncStatus?.syncStatus;
    switch (syncStatus) {
      case 'synced':
        return t('calendar.sync.status.synced', { defaultValue: 'Synced' });
      case 'pending':
        return t('calendar.sync.status.pending', { defaultValue: 'Pending' });
      case 'conflict':
        return t('calendar.sync.status.conflict', { defaultValue: 'Conflict' });
      case 'error':
        return t('calendar.sync.status.error', { defaultValue: 'Error' });
      default:
        return t('calendar.sync.status.unknown', { defaultValue: 'Unknown' });
    }
  };

  const getStatusVariant = (status: CalendarSyncStatus): 'default' | 'secondary' | 'error' | 'outline' => {
    const syncStatus = status.entrySyncStatus?.syncStatus;
    switch (syncStatus) {
      case 'synced':
        return 'default';
      case 'pending':
        return 'secondary';
      case 'conflict':
        return 'outline';
      case 'error':
        return 'error';
      default:
        return 'secondary';
    }
  };

  if (compact) {
    // Show compact badges for each provider
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {syncStatuses.map((status, index) => (
          <Tooltip
            key={status.providerId}
            content={
              <div className="space-y-1">
                <p className="font-semibold">{status.providerName}</p>
                <p>{t('calendar.sync.tooltip.status', { defaultValue: 'Status: {{status}}', status: getStatusLabel(status) })}</p>
                {status.lastSyncAt && (
                  <p className="text-xs">{t('calendar.sync.tooltip.lastSync', { defaultValue: 'Last sync: {{value}}', value: new Date(status.lastSyncAt).toLocaleString() })}</p>
                )}
                {status.errorMessage && (
                  <p className="text-xs text-red-600">{t('calendar.sync.tooltip.error', { defaultValue: 'Error: {{message}}', message: status.errorMessage })}</p>
                )}
              </div>
            }
          >
            <Badge
              id={`${componentId}-compact-provider-${index}-badge`}
              variant={getStatusVariant(status)}
              className="flex items-center gap-1 cursor-help"
            >
              {getStatusIcon(status)}
              <span className="text-xs">
                {status.providerType === 'google'
                  ? t('calendar.sync.compact.google', { defaultValue: 'Google' })
                  : t('calendar.sync.compact.outlook', { defaultValue: 'Outlook' })}
              </span>
            </Badge>
          </Tooltip>
        ))}
      </div>
    );
  }

  // Full display with details
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">{t('calendar.sync.header.title', { defaultValue: 'Calendar Sync Status' })}</h4>
        <button
          id={`${componentId}-refresh-button`}
          onClick={loadSyncStatus}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <RefreshCw className="h-3 w-3" />
          {t('calendar.sync.header.refresh', { defaultValue: 'Refresh' })}
        </button>
      </div>

      {syncStatuses.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('calendar.sync.empty', { defaultValue: 'No calendar integrations configured' })}</p>
      ) : (
        <div className="space-y-2">
          {syncStatuses.map((status, index) => (
            <div
              key={status.providerId}
              className="p-3 border rounded-lg space-y-1"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getStatusIcon(status)}
                  <span className="text-sm font-medium">{status.providerName}</span>
                  <Badge
                    id={`${componentId}-detail-provider-${index}-badge`}
                    variant={getStatusVariant(status)}
                    className="text-xs"
                  >
                    {getStatusLabel(status)}
                  </Badge>
                </div>
                {!status.isActive && (
                  <Badge
                    id={`${componentId}-detail-provider-${index}-inactive-badge`}
                    variant="secondary"
                    className="text-xs"
                  >
                    {t('calendar.sync.inactive', { defaultValue: 'Inactive' })}
                  </Badge>
                )}
              </div>
              
              <div className="text-xs space-y-1 mt-2">
                <p className="text-[rgb(var(--color-text-600))]">
                  <span className="font-medium text-[rgb(var(--color-text-900))]">{t('calendar.sync.fields.syncDirection', { defaultValue: 'Sync Direction:' })}</span> {status.syncDirection}
                </p>
                {status.lastSyncAt && (
                  <p className="text-[rgb(var(--color-text-600))]">
                    <span className="font-medium text-[rgb(var(--color-text-900))]">{t('calendar.sync.fields.lastSync', { defaultValue: 'Last Sync:' })}</span> {new Date(status.lastSyncAt).toLocaleString()}
                  </p>
                )}
                {status.entrySyncStatus?.externalEventId && (
                  <div className="flex items-center gap-1 text-[rgb(var(--color-text-600))]">
                    <span className="font-medium text-[rgb(var(--color-text-900))] flex-shrink-0">{t('calendar.sync.fields.externalId', { defaultValue: 'External ID:' })}</span>
                    <code 
                      className="bg-[rgb(var(--color-secondary-50))] text-[rgb(var(--color-secondary-900))] px-1.5 py-0.5 rounded text-[10px] font-mono truncate max-w-[180px] inline-block align-middle border border-[rgb(var(--color-secondary-200))]" 
                      title={status.entrySyncStatus.externalEventId}
                    >
                      {status.entrySyncStatus.externalEventId}
                    </code>
                  </div>
                )}
              </div>

              {status.errorMessage && (
                <Alert
                  id={`${componentId}-detail-provider-${index}-error-alert`}
                  variant="destructive"
                  className="mt-2"
                >
                  <AlertDescription className="text-xs">{status.errorMessage}</AlertDescription>
                </Alert>
              )}

              {status.entrySyncStatus?.syncStatus === 'conflict' && (
                <Alert
                  id={`${componentId}-detail-provider-${index}-conflict-alert`}
                  variant="info"
                  className="mt-2 border-orange-500/30 bg-orange-500/10"
                >
                  <AlertDescription className="text-xs">
                    {t('calendar.sync.conflictAlert', { defaultValue: 'Conflict detected: Both calendars have been modified. Please resolve in Calendar Settings.' })}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
