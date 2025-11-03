/**
 * Calendar Integrations Settings Page
 * Main interface for managing calendar provider configurations
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Alert, AlertDescription } from '../ui/Alert';
import { Plus, Settings, Trash2, CheckCircle, Clock, XCircle, RefreshCw, AlertTriangle } from 'lucide-react';
import { GoogleCalendarProviderForm } from './GoogleCalendarProviderForm';
import { MicrosoftCalendarProviderForm } from './MicrosoftCalendarProviderForm';
import { getCalendarProviders, deleteCalendarProvider, syncCalendarProvider } from '../../lib/actions/calendarActions';
import { CalendarProviderConfig } from '../../interfaces/calendar.interfaces';
import { useTenant } from '../TenantProvider';
import { Badge } from '../ui/Badge';
import { Dialog, DialogContent, DialogDescription } from '../ui/Dialog';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';
import { useToast } from '../../hooks/use-toast';

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
          title: 'Manual sync completed',
          description: providerName ? `${providerName} synced successfully.` : 'Calendar provider synced successfully.',
        });
        setSyncFeedback((prev) => ({
          ...prev,
          [providerId]: {
            variant: 'success',
            message: 'Manual sync completed successfully.',
          },
        }));
        await loadProviders();
      } else {
        const message = result.error || 'Manual sync encountered issues.';
        toast({
          title: 'Manual sync encountered issues',
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
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">Loading calendar providers...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle id="calendar-integrations-heading">Calendar Integrations</CardTitle>
              <CardDescription>
                Connect your Google Calendar or Microsoft Outlook Calendar to sync schedule entries
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                id="add-google-calendar-button"
                variant="outline"
                onClick={() => handleAddProvider('google')}
                className="flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Add Google Calendar
              </Button>
              <Button
                id="add-outlook-calendar-button"
                variant="outline"
                onClick={() => handleAddProvider('microsoft')}
                className="flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Add Outlook Calendar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4" id="calendar-provider-error-alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {providers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No calendar providers configured.</p>
              <p className="text-sm mt-2">Click "Add Google Calendar" or "Add Outlook Calendar" to get started.</p>
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
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground">Calendar ID:</span>
                              <span>{provider.calendar_id || 'Not set'}</span>
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
          <DialogDescription>Configure a new calendar integration.</DialogDescription>
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
          <DialogDescription>Update calendar provider configuration.</DialogDescription>
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
