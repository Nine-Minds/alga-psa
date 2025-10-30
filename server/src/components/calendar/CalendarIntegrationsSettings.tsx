/**
 * Calendar Integrations Settings Page
 * Main interface for managing calendar provider configurations
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Alert, AlertDescription } from '../ui/Alert';
import { Plus, Settings, Trash2, CheckCircle, Clock, XCircle, RefreshCw } from 'lucide-react';
import { GoogleCalendarProviderForm } from './GoogleCalendarProviderForm';
import { MicrosoftCalendarProviderForm } from './MicrosoftCalendarProviderForm';
import { getCalendarProviders, deleteCalendarProvider, syncCalendarProvider } from '../../lib/actions/calendarActions';
import { CalendarProviderConfig } from '../../interfaces/calendar.interfaces';
import { useTenant } from '../TenantProvider';
import { Badge } from '../ui/Badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog';

export function CalendarIntegrationsSettings() {
  const tenant = useTenant();
  const [providers, setProviders] = useState<CalendarProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<CalendarProviderConfig | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [providerType, setProviderType] = useState<'google' | 'microsoft' | null>(null);
  const [syncingProviderId, setSyncingProviderId] = useState<string | null>(null);

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
        setError(result.error || 'Failed to load calendar providers');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load calendar providers');
    } finally {
      setLoading(false);
    }
  };

  const handleAddProvider = (type: 'google' | 'microsoft') => {
    setProviderType(type);
    setSelectedProvider(null);
    setShowAddDialog(true);
  };

  const handleEditProvider = (provider: CalendarProviderConfig) => {
    setSelectedProvider(provider);
    setProviderType(provider.provider_type);
    setShowEditDialog(true);
  };

  const handleDeleteProvider = async (providerId: string) => {
    if (!confirm('Are you sure you want to delete this calendar provider? This will stop syncing.')) {
      return;
    }

    try {
      const result = await deleteCalendarProvider(providerId);
      if (result.success) {
        await loadProviders();
      } else {
        setError(result.error || 'Failed to delete calendar provider');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete calendar provider');
    }
  };

  const handleSyncProvider = async (providerId: string) => {
    try {
      setSyncingProviderId(providerId);
      const result = await syncCalendarProvider(providerId);
      if (result.success) {
        await loadProviders();
      } else {
        setError(result.error || 'Failed to sync calendar provider');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to sync calendar provider');
    } finally {
      setSyncingProviderId(null);
    }
  };

  const handleFormSuccess = () => {
    setShowAddDialog(false);
    setShowEditDialog(false);
    setSelectedProvider(null);
    setProviderType(null);
    loadProviders();
  };

  const getStatusBadge = (provider: CalendarProviderConfig) => {
    switch (provider.connection_status) {
      case 'connected':
        return <Badge variant="success" className="flex items-center gap-1"><CheckCircle className="h-3 w-3" />Connected</Badge>;
      case 'disconnected':
        return <Badge variant="secondary" className="flex items-center gap-1"><XCircle className="h-3 w-3" />Disconnected</Badge>;
      case 'error':
        return <Badge variant="destructive" className="flex items-center gap-1"><XCircle className="h-3 w-3" />Error</Badge>;
      case 'configuring':
        return <Badge variant="secondary" className="flex items-center gap-1"><Clock className="h-3 w-3" />Configuring</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  const getSyncDirectionLabel = (direction: string) => {
    switch (direction) {
      case 'bidirectional':
        return 'Bidirectional';
      case 'to_external':
        return 'Alga → External';
      case 'from_external':
        return 'External → Alga';
      default:
        return direction;
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
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Calendar Integrations</CardTitle>
              <CardDescription>
                Connect your Google Calendar or Microsoft Outlook Calendar to sync schedule entries
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => handleAddProvider('google')}
                className="flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Add Google Calendar
              </Button>
              <Button
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
            <Alert variant="destructive" className="mb-4">
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
              {providers.map((provider) => (
                <Card key={provider.id}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="space-y-2 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{provider.name}</h3>
                          {getStatusBadge(provider)}
                          {provider.active ? (
                            <Badge variant="default">Active</Badge>
                          ) : (
                            <Badge variant="secondary">Inactive</Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          <p>Type: {provider.provider_type === 'google' ? 'Google Calendar' : 'Microsoft Outlook Calendar'}</p>
                          <p>Calendar ID: {provider.calendar_id}</p>
                          <p>Sync Direction: {getSyncDirectionLabel(provider.sync_direction)}</p>
                          {provider.last_sync_at && (
                            <p>Last Sync: {new Date(provider.last_sync_at).toLocaleString()}</p>
                          )}
                          {provider.error_message && (
                            <p className="text-red-600">Error: {provider.error_message}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSyncProvider(provider.id)}
                          disabled={syncingProviderId === provider.id}
                        >
                          <RefreshCw className={`h-4 w-4 mr-2 ${syncingProviderId === provider.id ? 'animate-spin' : ''}`} />
                          Sync Now
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditProvider(provider)}
                        >
                          <Settings className="h-4 w-4 mr-2" />
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteProvider(provider.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Provider Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Add {providerType === 'google' ? 'Google' : 'Microsoft'} Calendar Provider
            </DialogTitle>
            <DialogDescription>
              Configure a new calendar integration
            </DialogDescription>
          </DialogHeader>
          {providerType === 'google' && (
            <GoogleCalendarProviderForm
              tenant={tenant}
              onSuccess={handleFormSuccess}
              onCancel={() => setShowAddDialog(false)}
            />
          )}
          {providerType === 'microsoft' && (
            <MicrosoftCalendarProviderForm
              tenant={tenant}
              onSuccess={handleFormSuccess}
              onCancel={() => setShowAddDialog(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Provider Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Edit {providerType === 'google' ? 'Google' : 'Microsoft'} Calendar Provider
            </DialogTitle>
            <DialogDescription>
              Update calendar provider configuration
            </DialogDescription>
          </DialogHeader>
          {selectedProvider && providerType === 'google' && (
            <GoogleCalendarProviderForm
              tenant={tenant}
              provider={selectedProvider}
              onSuccess={handleFormSuccess}
              onCancel={() => setShowEditDialog(false)}
            />
          )}
          {selectedProvider && providerType === 'microsoft' && (
            <MicrosoftCalendarProviderForm
              tenant={tenant}
              provider={selectedProvider}
              onSuccess={handleFormSuccess}
              onCancel={() => setShowEditDialog(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}


