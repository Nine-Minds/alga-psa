'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ISlaSettings } from '../types';
import {
  getSlaSettings,
  updateSlaSettings,
  getStatusSlaPauseConfigs,
  getBoardOwnedTicketStatusesForSlaPauseConfig,
  bulkUpdateStatusSlaPauseConfigs,
} from '../actions';
import { getResponseStateTrackingSetting, updateResponseStateTrackingSetting } from '../actions';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@alga-psa/ui/components/Card';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Label } from '@alga-psa/ui/components/Label';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import toast from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';

interface StatusPauseState {
  statusId: string;
  statusName: string;
  boardName: string;
  pausesSla: boolean;
  originalPausesSla: boolean;
}

export function SlaPauseSettings() {
  const [slaSettings, setSlaSettings] = useState<ISlaSettings | null>(null);
  const [statusPauseStates, setStatusPauseStates] = useState<StatusPauseState[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [responseStateTrackingEnabled, setResponseStateTrackingEnabled] = useState<boolean>(true);

  // Load initial data
  useEffect(() => {
    async function loadData() {
      try {
        setIsLoading(true);
        setError(null);

        // Fetch SLA settings, status pause configs, ticket statuses, and display settings in parallel
        const [settings, pauseConfigs, allStatuses, responseStateEnabled] = await Promise.all([
          getSlaSettings(),
          getStatusSlaPauseConfigs(),
          getBoardOwnedTicketStatusesForSlaPauseConfig(),
          getResponseStateTrackingSetting(),
        ]);

        setSlaSettings(settings);
        setResponseStateTrackingEnabled(responseStateEnabled);

        // Build a map of status_id -> pauses_sla from existing configs
        const pauseConfigMap = new Map<string, boolean>();
        pauseConfigs.forEach((config) => {
          pauseConfigMap.set(config.status_id, config.pauses_sla);
        });

        // Create status pause states for each ticket status
        const states: StatusPauseState[] = allStatuses.map((status) => ({
          statusId: status.status_id,
          statusName: status.name,
          boardName: status.board_name,
          pausesSla: pauseConfigMap.get(status.status_id) ?? false,
          originalPausesSla: pauseConfigMap.get(status.status_id) ?? false,
        }));

        states.sort((a, b) => {
          if (a.boardName !== b.boardName) {
            return a.boardName.localeCompare(b.boardName);
          }

          return a.statusName.localeCompare(b.statusName);
        });

        setStatusPauseStates(states);
      } catch (err) {
        handleError(err, 'Failed to load SLA pause settings');
        setError(err instanceof Error ? err.message : 'Failed to load SLA pause settings');
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, []);

  // Handle response state tracking toggle
  const handleResponseStateTrackingChange = useCallback(async (checked: boolean) => {
    try {
      await updateResponseStateTrackingSetting(checked);
      setResponseStateTrackingEnabled(checked);
      toast.success(checked ? 'Response state tracking enabled' : 'Response state tracking disabled');
    } catch (err) {
      handleError(err, 'Failed to update response state tracking');
    }
  }, []);

  // Handle global setting toggle
  const handleGlobalSettingChange = useCallback(async (checked: boolean) => {
    if (!slaSettings) return;

    try {
      const updatedSettings = await updateSlaSettings({
        pause_on_awaiting_client: checked,
      });
      setSlaSettings(updatedSettings);
      toast.success('Global SLA settings updated successfully');
    } catch (err) {
      handleError(err, 'Failed to update global SLA settings');
    }
  }, [slaSettings]);

  // Handle status pause checkbox change
  const handleStatusPauseChange = useCallback((statusId: string, checked: boolean) => {
    setStatusPauseStates((prevStates) =>
      prevStates.map((state) =>
        state.statusId === statusId ? { ...state, pausesSla: checked } : state
      )
    );
  }, []);

  // Check if there are unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    return statusPauseStates.some((state) => state.pausesSla !== state.originalPausesSla);
  }, [statusPauseStates]);

  // Get the changed items for saving
  const changedItems = useMemo(() => {
    return statusPauseStates
      .filter((state) => state.pausesSla !== state.originalPausesSla)
      .map((state) => ({
        statusId: state.statusId,
        pausesSla: state.pausesSla,
      }));
  }, [statusPauseStates]);

  // Save status pause configurations
  const handleSaveStatusConfigs = useCallback(async () => {
    if (changedItems.length === 0) {
      toast.success('No changes to save');
      return;
    }

    try {
      setIsSaving(true);
      await bulkUpdateStatusSlaPauseConfigs(changedItems);

      // Update original values to match current values
      setStatusPauseStates((prevStates) =>
        prevStates.map((state) => ({
          ...state,
          originalPausesSla: state.pausesSla,
        }))
      );

      toast.success(`Successfully updated ${changedItems.length} status configuration(s)`);
    } catch (err) {
      handleError(err, 'Failed to save status configurations');
    } finally {
      setIsSaving(false);
    }
  }, [changedItems]);

  // Reset changes
  const handleResetChanges = useCallback(() => {
    setStatusPauseStates((prevStates) =>
      prevStates.map((state) => ({
        ...state,
        pausesSla: state.originalPausesSla,
      }))
    );
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator
          layout="stacked"
          text="Loading SLA pause settings..."
          spinnerProps={{ size: 'md' }}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-md bg-red-50 border border-red-200">
        <p className="text-red-700">{error}</p>
        <Button
          id="retry-load-sla-settings"
          variant="outline"
          className="mt-2"
          onClick={() => window.location.reload()}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Global SLA Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Global SLA Settings</CardTitle>
          <CardDescription>
            Configure global behavior for SLA timer pausing
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Response State Tracking toggle */}
          <div className="flex items-center space-x-4">
            <Switch
              id="response-state-tracking"
              checked={responseStateTrackingEnabled}
              onCheckedChange={handleResponseStateTrackingChange}
            />
            <div className="space-y-1">
              <Label htmlFor="response-state-tracking" className="text-base font-medium">
                Track response state on tickets
              </Label>
              <p className="text-sm text-muted-foreground">
                When enabled, tickets automatically track who needs to respond next
                (awaiting client or awaiting internal response).
                This also controls the visibility of response state badges and filters.
              </p>
            </div>
          </div>

          {/* Pause on Awaiting Client toggle */}
          <div className={`flex items-center space-x-4 ${!responseStateTrackingEnabled ? 'opacity-50' : ''}`}>
            <Switch
              id="pause-on-awaiting-client"
              checked={slaSettings?.pause_on_awaiting_client ?? false}
              onCheckedChange={handleGlobalSettingChange}
              disabled={!responseStateTrackingEnabled}
            />
            <div className="space-y-1">
              <Label htmlFor="pause-on-awaiting-client" className="text-base font-medium">
                Automatically pause SLA when awaiting client response
              </Label>
              <p className="text-sm text-muted-foreground">
                When enabled, the SLA timer will automatically pause when a ticket is marked as
                awaiting a response from the client. The timer will resume when the client responds
                or the ticket status changes.
              </p>
              {!responseStateTrackingEnabled && (
                <p className="text-sm text-amber-600">
                  Enable response state tracking above to use this option.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Per-Status Pause Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Per-Status Pause Configuration</CardTitle>
          <CardDescription>
            Configure which ticket statuses should pause the SLA timer. When a ticket is moved to a
            status with pausing enabled, the SLA timer will stop until the ticket is moved to
            another status.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {statusPauseStates.length === 0 ? (
            <p className="text-muted-foreground">No ticket statuses found.</p>
          ) : (
            <>
              <div className="space-y-3">
                {statusPauseStates.map((state) => (
                  <div
                    key={state.statusId}
                    className="flex items-center space-x-3 py-2 border-b border-gray-100 last:border-0"
                  >
                    <Checkbox
                      id={`status-pause-${state.statusId}`}
                      checked={state.pausesSla}
                      onChange={(e) => handleStatusPauseChange(state.statusId, e.target.checked)}
                      containerClassName="mb-0"
                    />
                    <Label
                      htmlFor={`status-pause-${state.statusId}`}
                      className="flex-1 cursor-pointer"
                    >
                      <span className="block font-medium">{state.statusName}</span>
                      <span className="block text-xs text-muted-foreground">{state.boardName}</span>
                    </Label>
                    {state.pausesSla !== state.originalPausesSla && (
                      <span className="text-xs text-amber-600 font-medium">Modified</span>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between mt-6 pt-4 border-t">
                <div className="text-sm text-muted-foreground">
                  {hasUnsavedChanges
                    ? `${changedItems.length} status(es) modified`
                    : 'No unsaved changes'}
                </div>
                <div className="flex items-center space-x-2">
                  {hasUnsavedChanges && (
                    <Button
                      id="reset-status-pause-changes"
                      variant="outline"
                      onClick={handleResetChanges}
                      disabled={isSaving}
                    >
                      Reset Changes
                    </Button>
                  )}
                  <Button
                    id="save-status-pause-configs"
                    onClick={handleSaveStatusConfigs}
                    disabled={!hasUnsavedChanges || isSaving}
                  >
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default SlaPauseSettings;
