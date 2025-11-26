'use client';

/**
 * Asset Alerts Section - EE Component
 *
 * Displays active RMM alerts for an asset with actions to acknowledge
 * or create tickets from alerts.
 */

import React, { useState, useEffect } from 'react';
import { AlertTriangle, Check, ExternalLink, Ticket, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { Button } from '../../../../../server/src/components/ui/Button';
import type { Asset } from '../../../../../server/src/interfaces/asset.interfaces';
import type { RmmAlert } from '../../interfaces/rmm.interfaces';
import { getAssetAlerts, acknowledgeRmmAlert, createTicketFromRmmAlert } from '../../lib/actions/integrations/ninjaoneActions';
import { toast } from 'react-hot-toast';

interface AssetAlertsSectionProps {
  asset: Asset;
  className?: string;
}

/**
 * Format relative time from ISO string
 */
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) {
    return 'Just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return date.toLocaleDateString();
  }
}

/**
 * Get severity color classes
 */
function getSeverityClasses(severity: string): string {
  switch (severity?.toUpperCase()) {
    case 'CRITICAL':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'MAJOR':
      return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'MODERATE':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'MINOR':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
}

/**
 * Asset Alerts Section
 */
export function AssetAlertsSection({ asset, className = '' }: AssetAlertsSectionProps) {
  const [alerts, setAlerts] = useState<RmmAlert[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [processingAlertId, setProcessingAlertId] = useState<string | null>(null);

  // Don't render if not RMM managed
  if (!asset.rmm_provider || !asset.rmm_device_id) {
    return null;
  }

  // Fetch alerts on mount
  useEffect(() => {
    loadAlerts();
  }, [asset.asset_id]);

  const loadAlerts = async () => {
    setIsLoading(true);
    try {
      const result = await getAssetAlerts(asset.asset_id);
      if (result.success && result.alerts) {
        setAlerts(result.alerts);
      }
    } catch (error) {
      console.error('Failed to load alerts:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAcknowledge = async (alertId: string) => {
    setProcessingAlertId(alertId);
    try {
      const result = await acknowledgeRmmAlert(alertId);
      if (result.success) {
        toast.success('Alert acknowledged');
        // Update local state
        setAlerts(prev => prev.map(a =>
          a.alert_id === alertId
            ? { ...a, status: 'acknowledged', acknowledged_at: new Date().toISOString() }
            : a
        ));
      } else {
        toast.error(result.error || 'Failed to acknowledge alert');
      }
    } catch (error) {
      toast.error('Failed to acknowledge alert');
    } finally {
      setProcessingAlertId(null);
    }
  };

  const handleCreateTicket = async (alertId: string) => {
    setProcessingAlertId(alertId);
    try {
      const result = await createTicketFromRmmAlert(alertId);
      if (result.success && result.ticketId) {
        toast.success('Ticket created successfully');
        // Update local state
        setAlerts(prev => prev.map(a =>
          a.alert_id === alertId
            ? { ...a, ticket_id: result.ticketId }
            : a
        ));
      } else {
        toast.error(result.error || 'Failed to create ticket');
      }
    } catch (error) {
      toast.error('Failed to create ticket');
    } finally {
      setProcessingAlertId(null);
    }
  };

  const activeAlerts = alerts.filter(a => a.status === 'active' || a.status === 'acknowledged');
  const hasAlerts = activeAlerts.length > 0;

  return (
    <div className={`bg-white rounded-lg border border-gray-200 ${className}`}>
      {/* Header */}
      <button
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className={`h-5 w-5 ${hasAlerts ? 'text-amber-500' : 'text-gray-400'}`} />
          <span className="font-medium">Active Alerts</span>
          {hasAlerts && (
            <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800">
              {activeAlerts.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            id="refresh-alerts-btn"
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              loadAlerts();
            }}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="border-t border-gray-200">
          {isLoading && alerts.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2" />
              Loading alerts...
            </div>
          ) : !hasAlerts ? (
            <div className="p-4 text-center text-gray-500">
              <Check className="h-5 w-5 mx-auto mb-2 text-green-500" />
              No active alerts
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {activeAlerts.map((alert) => (
                <div key={alert.alert_id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border ${getSeverityClasses(alert.severity)}`}>
                          {alert.severity}
                        </span>
                        {alert.status === 'acknowledged' && (
                          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">
                            Acknowledged
                          </span>
                        )}
                        {alert.ticket_id && (
                          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-purple-100 text-purple-600">
                            <Ticket className="h-3 w-3 mr-1" />
                            Ticket Created
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {alert.activity_type?.replace(/_/g, ' ')}
                      </p>
                      {alert.message && (
                        <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                          {alert.message}
                        </p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {formatRelativeTime(alert.triggered_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {alert.status !== 'acknowledged' && (
                        <Button
                          id={`acknowledge-alert-${alert.alert_id}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => handleAcknowledge(alert.alert_id)}
                          disabled={processingAlertId === alert.alert_id}
                          title="Acknowledge"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      )}
                      {!alert.ticket_id && (
                        <Button
                          id={`create-ticket-from-alert-${alert.alert_id}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCreateTicket(alert.alert_id)}
                          disabled={processingAlertId === alert.alert_id}
                          title="Create Ticket"
                        >
                          <Ticket className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AssetAlertsSection;
