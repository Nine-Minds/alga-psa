/**
 * Google Calendar Provider Configuration Form
 * Form for setting up Google Calendar integration
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { CheckCircle, Clock, ExternalLink, XCircle } from 'lucide-react';
import { initiateCalendarOAuth, createCalendarProvider, updateCalendarProvider } from '@alga-psa/integrations/actions';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { CalendarProviderConfig } from '@alga-psa/types';
import { Badge } from '@alga-psa/ui/components/Badge';
import { getGoogleIntegrationStatus } from '@alga-psa/integrations/actions';

const googleCalendarProviderSchema = z.object({
  providerName: z.string().min(1, 'Provider name is required'),
  calendarId: z.string().min(1, 'Calendar ID is required'),
  syncDirection: z.enum(['bidirectional', 'to_external', 'from_external']),
  isActive: z.boolean(),
});

type GoogleCalendarProviderFormData = z.infer<typeof googleCalendarProviderSchema>;

interface GoogleCalendarProviderFormProps {
  tenant: string | null | undefined;
  provider?: CalendarProviderConfig;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function GoogleCalendarProviderForm({ 
  tenant, 
  provider,
  onSuccess,
  onCancel 
}: GoogleCalendarProviderFormProps) {
  const [oauthStatus, setOAuthStatus] = useState<'idle' | 'authorizing' | 'success' | 'error'>('idle');
  const [oauthError, setOAuthError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [calendarProviderId, setCalendarProviderId] = useState<string | undefined>(provider?.id);
  const [googleConfigReady, setGoogleConfigReady] = useState<boolean>(false);

  const form = useForm<GoogleCalendarProviderFormData>({
    resolver: zodResolver(googleCalendarProviderSchema),
    defaultValues: {
      providerName: provider?.name || 'Google Calendar',
      calendarId: provider?.calendar_id || 'primary',
      syncDirection: provider?.sync_direction || 'bidirectional',
      isActive: provider?.active ?? true,
    },
  });

  const isEditing = !!provider;
  const hasAttemptedSubmit = form.formState.isSubmitted;

  // Set OAuth status based on provider status
  useEffect(() => {
    if (provider) {
      if (provider.connection_status === 'connected') {
        setOAuthStatus('success');
      } else if (provider.connection_status === 'error') {
        setOAuthStatus('error');
      }
    }
  }, [provider]);

  // Listen for OAuth callback messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'oauth-callback' && event.data?.provider === 'google' && event.data?.resource === 'calendar') {
        if (event.data.success) {
          setOAuthStatus('success');
          setOAuthError(null);
          if (event.data.data?.calendarProviderId) {
            setCalendarProviderId(event.data.data.calendarProviderId);
          }
          if (onSuccess) {
            onSuccess();
          }
        } else {
          setOAuthStatus('error');
          setOAuthError(event.data.errorDescription || 'OAuth authorization failed');
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onSuccess]);

  useEffect(() => {
    const loadGoogleStatus = async () => {
      try {
        const res = await getGoogleIntegrationStatus();
        if (!res.success) {
          setGoogleConfigReady(false);
          return;
        }
        const hasClient = Boolean(res.config?.calendarClientId);
        const hasSecret = Boolean(res.config?.calendarClientSecretMasked);
        setGoogleConfigReady(hasClient && hasSecret);
      } catch {
        setGoogleConfigReady(false);
      }
    };
    loadGoogleStatus();
  }, []);

  const handleAuthorize = async () => {
    try {
      setOAuthStatus('authorizing');
      setOAuthError(null);

      if (!googleConfigReady) {
        throw new Error('Google integration is not configured for this tenant. Configure Google first, then retry.');
      }

      // Create or get provider ID
      let providerId = calendarProviderId;
      
      if (!providerId) {
        // Create provider first
        const formData = form.getValues();
        const result = await createCalendarProvider({
          providerType: 'google',
          providerName: formData.providerName,
          calendarId: formData.calendarId,
          syncDirection: formData.syncDirection,
          vendorConfig: {}
        });

        if (!result.success || !result.provider) {
          throw new Error(result.error || 'Failed to create calendar provider');
        }

        providerId = result.provider.id;
        setCalendarProviderId(providerId);
      }

      // Initiate OAuth flow
      const oauthResult = await initiateCalendarOAuth({
        provider: 'google',
        calendarProviderId: providerId,
      });

      if (!oauthResult.success) {
        throw new Error(oauthResult.error || 'Failed to initiate OAuth');
      }

      // Open OAuth popup
      const popup = window.open(
        oauthResult.authUrl,
        'google-calendar-oauth',
        'width=600,height=700,scrollbars=yes,resizable=yes'
      );

      if (!popup) {
        throw new Error('Popup blocked. Please allow popups for this site.');
      }

      // Check if popup was closed (user cancelled)
      const checkPopup = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkPopup);
          if (oauthStatus === 'authorizing') {
            setOAuthStatus('idle');
          }
        }
      }, 1000);

    } catch (error: any) {
      setOAuthStatus('error');
      setOAuthError(error.message || 'Failed to initiate OAuth');
    }
  };

  const onSubmit = async (data: GoogleCalendarProviderFormData) => {
    setIsSubmitting(true);
    try {
      if (isEditing && calendarProviderId) {
        await updateCalendarProvider(calendarProviderId, {
          providerName: data.providerName,
          calendarId: data.calendarId,
          syncDirection: data.syncDirection,
          isActive: data.isActive,
        });
      } else {
        const result = await createCalendarProvider({
          providerType: 'google',
          providerName: data.providerName,
          calendarId: data.calendarId,
          syncDirection: data.syncDirection,
          vendorConfig: {}
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to create calendar provider');
        }

        setCalendarProviderId(result.provider?.id);
      }

      if (onSuccess) {
        onSuccess();
      }
    } catch (error: any) {
      form.setError('root', { message: error.message || 'Failed to save provider' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getOAuthBadgeVariant = () => {
    if (oauthStatus === 'success') return 'success';
    if (oauthStatus === 'error') return 'error';
    if (oauthStatus === 'authorizing') return 'secondary';
    return 'secondary';
  };

  const getOAuthBadgeLabel = () => {
    if (oauthStatus === 'success') return 'Authorized';
    if (oauthStatus === 'authorizing') return 'Authorizing';
    if (oauthStatus === 'error') return 'Authorization Error';
    return 'Not Authorized';
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      {/* Basic Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Google Calendar Configuration</CardTitle>
          <CardDescription>
            Connect your Google Calendar to sync schedule entries
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="google-provider-name-input">Provider Name *</Label>
              <Input
                id="google-provider-name-input"
                {...form.register('providerName')}
                placeholder="e.g., My Google Calendar"
                className={hasAttemptedSubmit && form.formState.errors.providerName ? 'border-red-500' : ''}
              />
              {form.formState.errors.providerName && (
                <p className="text-sm text-red-500">{form.formState.errors.providerName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="google-calendar-id-input">Calendar ID *</Label>
              <Input
                id="google-calendar-id-input"
                {...form.register('calendarId')}
                placeholder="primary"
                className={hasAttemptedSubmit && form.formState.errors.calendarId ? 'border-red-500' : ''}
              />
              {form.formState.errors.calendarId && (
                <p className="text-sm text-red-500">{form.formState.errors.calendarId.message}</p>
              )}
              <p className="text-xs text-muted-foreground">Usually "primary" for your main calendar</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="google-sync-direction-select">Sync Direction *</Label>
            <CustomSelect
              id="google-sync-direction-select"
              value={form.watch('syncDirection')}
              onValueChange={(value) => form.setValue('syncDirection', value as any)}
              options={[
                { value: 'bidirectional', label: 'Bidirectional (recommended)' },
                { value: 'to_external', label: 'Alga → Google Calendar only' },
                { value: 'from_external', label: 'Google Calendar → Alga only' },
              ]}
            />
            {form.formState.errors.syncDirection && (
              <p className="text-sm text-red-500">{form.formState.errors.syncDirection.message}</p>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="google-provider-active-switch"
              checked={form.watch('isActive')}
              onCheckedChange={(checked: boolean) => form.setValue('isActive', checked)}
            />
            <Label htmlFor="google-provider-active-switch">Enable this provider</Label>
          </div>
        </CardContent>
      </Card>

      {/* OAuth Section */}
      <Card>
        <CardHeader>
          <CardTitle>Google OAuth Authorization</CardTitle>
          <CardDescription>
            Authorize access to your Google Calendar
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {!googleConfigReady && (
              <Alert variant="destructive">
                <AlertDescription>
                  <div className="space-y-2">
                    <div className="font-medium">Google is not configured for this tenant.</div>
                    <div className="text-sm">
                      Configure tenant-owned Google OAuth first in <strong>Settings → Integrations → Providers</strong>.
                    </div>
                    <div>
                      <Button
                        id="google-calendar-open-google-settings"
                        type="button"
                        variant="outline"
                        onClick={() => {
                          window.location.href = '/msp/settings?tab=integrations&category=providers';
                        }}
                      >
                        Open Google Settings
                      </Button>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            )}
            <div className={`p-4 rounded-lg transition-colors ${
              oauthStatus === 'success' ? 'bg-green-50 border-2 border-green-200' : 'bg-blue-50'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium">Connection Status</h4>
                    <Badge
                      id="google-oauth-status-badge"
                      variant={getOAuthBadgeVariant()}
                      className="flex items-center gap-1"
                    >
                      {oauthStatus === 'success' && <CheckCircle className="h-3 w-3" />}
                      {oauthStatus === 'authorizing' && <Clock className="h-3 w-3" />}
                      {oauthStatus === 'error' && <XCircle className="h-3 w-3" />}
                      {getOAuthBadgeLabel()}
                    </Badge>
                  </div>
                </div>
                <Button
                  id="google-authorize-button"
                  type="button"
                  variant="outline"
                  onClick={handleAuthorize}
                  disabled={oauthStatus === 'authorizing' || !googleConfigReady}
                >
                  {oauthStatus === 'authorizing' && (
                    <>
                      <Clock className="h-4 w-4 mr-2 animate-spin" />
                      Connecting...
                    </>
                  )}
                  {oauthStatus === 'success' && (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Connected
                    </>
                  )}
                  {(oauthStatus === 'idle' || oauthStatus === 'error') && (
                    <>
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Connect
                    </>
                  )}
                </Button>
              </div>
            </div>

            {oauthError && (
              <Alert variant="destructive">
                <AlertDescription>{oauthError}</AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Error Display */}
      {form.formState.errors.root && (
        <Alert variant="destructive">
          <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
        </Alert>
      )}

      {/* Form Actions */}
      <div className="flex justify-end space-x-2">
        {onCancel && (
          <Button id="google-provider-cancel-button" type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          id="google-provider-submit-button"
          type="submit"
          disabled={isSubmitting || oauthStatus === 'authorizing'}
        >
          {isSubmitting ? 'Saving...' : isEditing ? 'Update Provider' : 'Create Provider'}
        </Button>
      </div>
    </form>
  );
}
