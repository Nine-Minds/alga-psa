/**
 * Calendar Sync Status Component
 * Displays calendar sync status for a schedule entry
 */

'use client';

import React, { useState, useEffect, useId } from 'react';
import { Badge } from '../ui/Badge';
import { Alert, AlertDescription } from '../ui/Alert';
import { CheckCircle, Clock, XCircle, RefreshCw, AlertTriangle } from 'lucide-react';
import { getScheduleEntrySyncStatus } from '../../lib/actions/calendarActions';
import { CalendarSyncStatus } from '../../interfaces/calendar.interfaces';
import { Tooltip } from '../ui/Tooltip';

interface CalendarSyncStatusDisplayProps {
  entryId: string;
  compact?: boolean;
}

export function CalendarSyncStatusDisplay({ entryId, compact = false }: CalendarSyncStatusDisplayProps) {
  const [syncStatuses, setSyncStatuses] = useState<CalendarSyncStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const componentId = useId();

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
      setError(err.message || 'Failed to load sync status');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return compact ? (
      <Badge variant="secondary" className="flex items-center gap-1">
        <Clock className="h-3 w-3 animate-pulse" />
        Syncing...
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
        return 'Synced';
      case 'pending':
        return 'Pending';
      case 'conflict':
        return 'Conflict';
      case 'error':
        return 'Error';
      default:
        return 'Unknown';
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
                <p>Status: {getStatusLabel(status)}</p>
                {status.lastSyncAt && (
                  <p className="text-xs">Last sync: {new Date(status.lastSyncAt).toLocaleString()}</p>
                )}
                {status.errorMessage && (
                  <p className="text-xs text-red-600">Error: {status.errorMessage}</p>
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
                {status.providerType === 'google' ? 'Google' : 'Outlook'}
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
        <h4 className="text-sm font-medium">Calendar Sync Status</h4>
        <button
          id={`${componentId}-refresh-button`}
          onClick={loadSyncStatus}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {syncStatuses.length === 0 ? (
        <p className="text-sm text-muted-foreground">No calendar integrations configured</p>
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
                    Inactive
                  </Badge>
                )}
              </div>
              
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Sync Direction: {status.syncDirection}</p>
                {status.lastSyncAt && (
                  <p>Last Sync: {new Date(status.lastSyncAt).toLocaleString()}</p>
                )}
                {status.entrySyncStatus?.externalEventId && (
                  <p>External Event ID: {status.entrySyncStatus.externalEventId}</p>
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
                  className="mt-2 border-orange-200 bg-orange-50"
                >
                  <AlertDescription className="text-xs">
                    Conflict detected: Both calendars have been modified. Please resolve in Calendar Settings.
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

