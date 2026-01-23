/**
 * Calendar Integrations Settings Page
 * Main interface for managing calendar provider configurations
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Plus, Settings, Trash2, CheckCircle, Clock, XCircle, RefreshCw, AlertTriangle } from 'lucide-react';
import { GoogleCalendarProviderForm } from './GoogleCalendarProviderForm';
import { MicrosoftCalendarProviderForm } from './MicrosoftCalendarProviderForm';
import { getCalendarProviders, deleteCalendarProvider, syncCalendarProvider } from '@alga-psa/integrations/actions';
import { CalendarProviderConfig } from '@alga-psa/types';
import { useTenant } from '@alga-psa/ui/components/providers/TenantProvider';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Dialog, DialogContent, DialogDescription } from '@alga-psa/ui/components/Dialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useToast } from '@alga-psa/ui/hooks/use-toast';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';

type SyncFeedbackMap = Record<string, { variant: 'success' | 'error'; message: string }>;

type ProviderType = 'google' | 'microsoft';

export function CalendarIntegrationsSettings() {
  const tenant = useTenant();
  const { toast } = useToast();
  const [providers, setProviders] = useState<CalendarProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<CalendarProviderConfig | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [providerType, setProviderType] = useState<ProviderType | null>(null);
  const [syncingProviderId, setSyncingProviderId] = useState<string | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<SyncFeedbackMap>({});
  const [providerPendingDeletion, setProviderPendingDeletion] = useState<CalendarProviderConfig | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeletingProvider, setIsDeletingProvider] = useState(false);

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    try {
      setLoading(true);
      const result = await getCalendarProviders();
      if (result.success && result.providers) {
        setProviders(result.providers);
        setError(null);
      } else {
        const message = result.error || 'Failed to load calendar providers';
        setError(message);
      }
    } catch (err: any) {
      const message = err?.message || 'Failed to load calendar providers';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddProvider = (type: ProviderType) => {
    setProviderType(type);
    setSelectedProvider(null);
    setShowAddDialog(true);
  };

  const handleEditProvider = (provider: CalendarProviderConfig) => {
    setSelectedProvider(provider);
    setProviderType(provider.provider_type);
    setShowEditDialog(true);
  };

  const closeAddDialog = () => {
    setShowAddDialog(false);
    setProviderType(null);
  };

  const closeEditDialog = () => {
    setShowEditDialog(false);
    setSelectedProvider(null);
    setProviderType(null);
  };

  const openDeleteDialog = (provider: CalendarProviderConfig) => {
    setProviderPendingDeletion(provider);
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!providerPendingDeletion) {
      return;
    }

    try {
      setIsDeletingProvider(true);
      const result = await deleteCalendarProvider(providerPendingDeletion.id);
      if (result.success) {
        toast({
          title: 'Calendar provider deleted',
          description: `${providerPendingDeletion.name} was removed successfully.`,
        });
        setIsDeleteDialogOpen(false);
        setProviderPendingDeletion(null);
        await loadProviders();
      } else {
        const message = result.error || 'Failed to delete calendar provider';
        setError(message);
        toast({
          title: 'Unable to delete calendar provider',
          description: message,
          variant: 'destructive',
        });
      }
    } catch (err: any) {
      const message = err?.message || 'Failed to delete calendar provider';
      setError(message);
      toast({
        title: 'Unable to delete calendar provider',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsDeletingProvider(false);
    }
  };

  const handleSyncProvider = async (providerId: string) => {
    const providerName = providers.find((p) => p.id === providerId)?.name;
    try {
      setSyncingProviderId(providerId);
      setSyncFeedback((prev) => {
        const next = { ...prev };
        delete next[providerId];
        return next;
      });

      const result = await syncCalendarProvider(providerId);
      if (result.success) {
        toast({
          title: 'Sync started',
          description: providerName ? `${providerName} sync is running in the background.` : 'Calendar sync is running in the background.',
        });
        setSyncFeedback((prev) => ({
          ...prev,
          [providerId]: {
            variant: 'success',
            message: 'Sync started. Check back shortly for results.',
          },
        }));
        // Refresh providers after a short delay to pick up status changes
        setTimeout(() => loadProviders(), 3000);
      } else {
        const message = result.error || 'Failed to start sync.';
        toast({
          title: 'Failed to start sync',
          description: message,
          variant: 'destructive',
        });
        setSyncFeedback((prev) => ({
          ...prev,
          [providerId]: {
            variant: 'error',
            message,
          },
        }));
      }
    } catch (err: any) {
      const message = err?.message || 'Failed to sync calendar provider';
      setError(message);
      toast({
        title: 'Manual sync failed',
        description: message,
        variant: 'destructive',
      });
      setSyncFeedback((prev) => ({
        ...prev,
        [providerId]: {
          variant: 'error',
          message,
        },
      }));
    } finally {
      setSyncingProviderId(null);
    }
  };

  const getProviderLabel = (type: ProviderType | null) => {
    if (type === 'google') return 'Google';
    if (type === 'microsoft') return 'Microsoft';
    return 'Calendar';
  };

  const handleFormSuccess = () => {
    closeAddDialog();
    closeEditDialog();
    loadProviders();
  };

  const renderConnectionBadge = (provider: CalendarProviderConfig, index: number) => {
    switch (provider.connection_status) {
      case 'connected':
        return (
          <Badge variant="success" className="flex items-center gap-1" id={`calendar-provider-${index}-connection-status-badge`}>
            <CheckCircle className="h-3 w-3" />
            Connected
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="error" className="flex items-center gap-1" id={`calendar-provider-${index}-connection-status-badge`}>
            <XCircle className="h-3 w-3" />
            Error
          </Badge>
        );
      case 'disconnected':
        return (
          <Badge variant="secondary" className="flex items-center gap-1" id={`calendar-provider-${index}-connection-status-badge`}>
            <AlertTriangle className="h-3 w-3" />
            Disconnected
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="flex items-center gap-1" id={`calendar-provider-${index}-connection-status-badge`}>
            <Clock className="h-3 w-3" />
            Configuring
          </Badge>
        );
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-2 w-full max-w-2xl">
                <Skeleton className="h-7 w-48" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Pro Tip Skeleton */}
            <Skeleton className="h-24 w-full rounded-md mb-6" />
            
            {/* Empty State / Provider List Skeleton */}
            <Skeleton className="h-64 w-full rounded-lg" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
// ... rest of the component
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <CardTitle id="calendar-integrations-heading" className="text-xl">Calendar Integrations</CardTitle>
              <CardDescription className="max-w-2xl text-base">
                Connect your personal Google or Microsoft calendar to sync your assigned schedule entries. 
                Events you create in Alga will appear on your external calendar when you're assigned to them.
              </CardDescription>
            </div>
            {providers.length > 0 && (
              <div className="flex items-center gap-2">
                 <Button
                  id="add-google-calendar-button-header"
                  variant="outline"
                  onClick={() => handleAddProvider('google')}
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Google Calendar
                </Button>
                <Button
                  id="add-outlook-calendar-button-header"
                  variant="outline"
                  onClick={() => handleAddProvider('microsoft')}
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Outlook Calendar
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-6" id="calendar-provider-error-alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="mb-6 bg-[rgb(var(--color-secondary-50))] border border-[rgb(var(--color-secondary-200))] rounded-md p-4 flex items-start gap-3 text-sm text-[rgb(var(--color-text-700))]">
            <div className="mt-0.5 min-w-[16px]">
              <AlertTriangle className="h-4 w-4 text-[rgb(var(--color-secondary-500))]" />
            </div>
            <div>
              <span className="font-semibold text-[rgb(var(--color-secondary-700))] block mb-0.5">Pro Tip</span>
              To import an event from your external calendar into Alga, simply add <code className="px-1.5 py-0.5 rounded bg-[rgb(var(--color-secondary-100))] text-[rgb(var(--color-secondary-900))] font-mono text-xs font-medium">@alga</code> to its title or description.
            </div>
          </div>

          {providers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed rounded-lg border-muted-foreground/25 bg-muted/5">
              <div className="bg-background p-4 rounded-full mb-4 shadow-sm">
                <Settings className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No calendars connected</h3>
              <p className="text-muted-foreground max-w-sm mb-8">
                Connect a calendar to automatically sync your schedule and never miss an assignment.
              </p>
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <Button
                  id="add-google-calendar-button-empty"
                  variant="outline"
                  onClick={() => handleAddProvider('google')}
                  className="flex items-center gap-2 w-full sm:w-auto"
                >
                  <Plus className="h-4 w-4" />
                  Add Google Calendar
                </Button>
                <Button
                  id="add-outlook-calendar-button-empty"
                  variant="outline"
                  onClick={() => handleAddProvider('microsoft')}
                  className="flex items-center gap-2 w-full sm:w-auto"
                >
                  <Plus className="h-4 w-4" />
                  Add Outlook Calendar
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {providers.map((provider, index) => {
                const syncNotice = syncFeedback[provider.id];
                const needsAttention = provider.connection_status !== 'connected';

                return (
                  <Card key={provider.id}>
                    <CardContent className="pt-6">
                      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div className="flex-1 space-y-3">
                          <div className="flex flex-wrap items-center gap-2" id={`calendar-provider-${index}-identifiers`}>
                            <h3 className="font-semibold text-base" id={`calendar-provider-${index}-name`}>
                              {provider.name}
                            </h3>
                            {renderConnectionBadge(provider, index)}
                            <Badge
                              variant={needsAttention ? 'error' : 'success'}
                              className="flex items-center gap-1"
                              id={`calendar-provider-${index}-oauth-status-badge`}
                            >
                              {needsAttention ? (
                                <AlertTriangle className="h-3 w-3" />
                              ) : (
                                <CheckCircle className="h-3 w-3" />
                              )}
                              {needsAttention ? 'Action Required' : 'OAuth Complete'}
                            </Badge>
                            <Badge
                              variant={provider.active ? 'primary' : 'secondary'}
                              id={`calendar-provider-${index}-active-badge`}
                            >
                              {provider.active ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>

                          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2" id={`calendar-provider-${index}-meta`}>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground">Type:</span>
                              <span>{provider.provider_type === 'google' ? 'Google Calendar' : 'Microsoft Outlook Calendar'}</span>
                            </div>
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium text-foreground flex-shrink-0">Calendar ID:</span>
                              <span className="truncate" title={provider.calendar_id || 'Not set'}>{provider.calendar_id || 'Not set'}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground">Sync Direction:</span>
                              <span>
                                {provider.sync_direction === 'bidirectional'
                                  ? 'Bidirectional'
                                  : provider.sync_direction === 'to_external'
                                    ? 'Alga → External'
                                    : 'External → Alga'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground">Last Sync:</span>
                              <span>
                                {provider.last_sync_at
                                  ? new Date(provider.last_sync_at).toLocaleString()
                                  : 'Not yet run'}
                              </span>
                            </div>
                          </div>

                          {syncingProviderId === provider.id && (
                            <Badge
                              variant="secondary"
                              className="flex items-center gap-1 w-fit"
                              id={`calendar-provider-${index}-syncing-indicator`}
                            >
                              <RefreshCw className="h-3 w-3 animate-spin" />
                              Sync in progress...
                            </Badge>
                          )}

                          {provider.error_message && (
                            <Alert
                              variant="destructive"
                              className="mt-2"
                              id={`calendar-provider-${index}-status-error`}
                            >
                              <AlertDescription>
                                {provider.error_message}
                              </AlertDescription>
                            </Alert>
                          )}

                          {syncNotice && (
                            <Alert
                              variant={syncNotice.variant === 'success' ? 'success' : 'destructive'}
                              className="mt-2"
                              id={`calendar-provider-${index}-sync-feedback`}
                            >
                              <AlertDescription>{syncNotice.message}</AlertDescription>
                            </Alert>
                          )}
                        </div>

                        <div className="flex flex-col gap-2 md:items-end" id={`calendar-provider-${index}-actions`}>
                          <Button
                            id={`calendar-provider-${index}-sync-button`}
                            variant="outline"
                            size="sm"
                            onClick={() => handleSyncProvider(provider.id)}
                            disabled={syncingProviderId === provider.id}
                            className="flex items-center gap-2"
                          >
                            <RefreshCw
                              className={`h-4 w-4 ${syncingProviderId === provider.id ? 'animate-spin' : ''}`}
                            />
                            {syncingProviderId === provider.id ? 'Syncing…' : 'Sync Now'}
                          </Button>
                          <Button
                            id={`calendar-provider-${index}-edit-button`}
                            variant="outline"
                            size="sm"
                            onClick={() => handleEditProvider(provider)}
                            className="flex items-center gap-2"
                          >
                            <Settings className="h-4 w-4" />
                            Edit
                          </Button>
                          <Button
                            id={`calendar-provider-${index}-delete-button`}
                            variant="outline"
                            size="sm"
                            onClick={() => openDeleteDialog(provider)}
                            className="flex items-center gap-2 text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        isOpen={showAddDialog}
        onClose={closeAddDialog}
        id="add-calendar-provider-dialog"
        title={`Add ${getProviderLabel(providerType)} Calendar Provider`}
        className="max-w-2xl"
      >
        <DialogContent className="max-h-[70vh] overflow-y-auto">
          <DialogDescription>Connect your personal calendar to sync schedule entries you're assigned to.</DialogDescription>
          {providerType === 'google' && (
            <GoogleCalendarProviderForm
              tenant={tenant}
              onSuccess={handleFormSuccess}
              onCancel={closeAddDialog}
            />
          )}
          {providerType === 'microsoft' && (
            <MicrosoftCalendarProviderForm
              tenant={tenant}
              onSuccess={handleFormSuccess}
              onCancel={closeAddDialog}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        isOpen={showEditDialog}
        onClose={closeEditDialog}
        id="edit-calendar-provider-dialog"
        title={`Edit ${getProviderLabel(providerType)} Calendar Provider`}
        className="max-w-2xl"
      >
        <DialogContent className="max-h-[70vh] overflow-y-auto">
          <DialogDescription>Update your personal calendar connection settings.</DialogDescription>
          {selectedProvider && providerType === 'google' && (
            <GoogleCalendarProviderForm
              tenant={tenant}
              provider={selectedProvider}
              onSuccess={handleFormSuccess}
              onCancel={closeEditDialog}
            />
          )}
          {selectedProvider && providerType === 'microsoft' && (
            <MicrosoftCalendarProviderForm
              tenant={tenant}
              provider={selectedProvider}
              onSuccess={handleFormSuccess}
              onCancel={closeEditDialog}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => {
          setIsDeleteDialogOpen(false);
          setProviderPendingDeletion(null);
        }}
        onConfirm={handleConfirmDelete}
        title="Delete Calendar Provider"
        message={
          providerPendingDeletion
            ? `Deleting ${providerPendingDeletion.name} will stop future synchronisation and remove associated webhooks. This action cannot be undone.`
            : 'Are you sure you want to delete this calendar provider?'
        }
        confirmLabel="Delete Provider"
        cancelLabel="Keep Provider"
        id="delete-calendar-provider-dialog"
        isConfirming={isDeletingProvider}
      />
    </div>
  );
}
