/**
 * Microsoft Calendar Provider Configuration Form
 * Form for setting up Microsoft Outlook Calendar integration
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Label } from '../ui/Label';
import { Switch } from '../ui/Switch';
import { Alert, AlertDescription } from '../ui/Alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/Card';
import { CheckCircle, Clock, ExternalLink } from 'lucide-react';
import { initiateCalendarOAuth, createCalendarProvider, updateCalendarProvider } from '../../lib/actions/calendarActions';
import CustomSelect from '../ui/CustomSelect';
import { CalendarProviderConfig } from '../../interfaces/calendar.interfaces';

const microsoftCalendarProviderSchema = z.object({
  providerName: z.string().min(1, 'Provider name is required'),
  calendarId: z.string().min(1, 'Calendar ID is required'),
  syncDirection: z.enum(['bidirectional', 'to_external', 'from_external']),
  isActive: z.boolean(),
});

type MicrosoftCalendarProviderFormData = z.infer<typeof microsoftCalendarProviderSchema>;

interface MicrosoftCalendarProviderFormProps {
  tenant: string;
  provider?: CalendarProviderConfig;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function MicrosoftCalendarProviderForm({ 
  tenant, 
  provider,
  onSuccess,
  onCancel 
}: MicrosoftCalendarProviderFormProps) {
  const [oauthStatus, setOAuthStatus] = useState<'idle' | 'authorizing' | 'success' | 'error'>('idle');
  const [oauthError, setOAuthError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [calendarProviderId, setCalendarProviderId] = useState<string | undefined>(provider?.id);

  const form = useForm<MicrosoftCalendarProviderFormData>({
    resolver: zodResolver(microsoftCalendarProviderSchema),
    defaultValues: {
      providerName: provider?.name || 'Outlook Calendar',
      calendarId: provider?.calendar_id || 'calendar',
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
      if (event.data?.type === 'oauth-callback' && event.data?.provider === 'microsoft' && event.data?.resource === 'calendar') {
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

  const handleAuthorize = async () => {
    try {
      setOAuthStatus('authorizing');
      setOAuthError(null);

      // Create or get provider ID
      let providerId = calendarProviderId;
      
      if (!providerId) {
        // Create provider first
        const formData = form.getValues();
        const result = await createCalendarProvider({
          providerType: 'microsoft',
          providerName: formData.providerName,
          calendarId: formData.calendarId,
          syncDirection: formData.syncDirection,
          vendorConfig: {
            client_id: '',
            client_secret: '',
            tenant_id: '',
            redirect_uri: ''
          }
        });

        if (!result.success || !result.provider) {
          throw new Error(result.error || 'Failed to create calendar provider');
        }

        providerId = result.provider.id;
        setCalendarProviderId(providerId);
      }

      // Initiate OAuth flow
      const oauthResult = await initiateCalendarOAuth({
        provider: 'microsoft',
        calendarProviderId: providerId,
      });

      if (!oauthResult.success) {
        throw new Error(oauthResult.error || 'Failed to initiate OAuth');
      }

      // Open OAuth popup
      const popup = window.open(
        oauthResult.authUrl,
        'microsoft-calendar-oauth',
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

  const onSubmit = async (data: MicrosoftCalendarProviderFormData) => {
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
          providerType: 'microsoft',
          providerName: data.providerName,
          calendarId: data.calendarId,
          syncDirection: data.syncDirection,
          vendorConfig: {
            client_id: '',
            client_secret: '',
            tenant_id: '',
            redirect_uri: ''
          }
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

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      {/* Basic Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Microsoft Outlook Calendar Configuration</CardTitle>
          <CardDescription>
            Connect your Microsoft Outlook Calendar to sync schedule entries
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="providerName">Provider Name *</Label>
              <Input
                id="providerName"
                {...form.register('providerName')}
                placeholder="e.g., My Outlook Calendar"
                className={hasAttemptedSubmit && form.formState.errors.providerName ? 'border-red-500' : ''}
              />
              {form.formState.errors.providerName && (
                <p className="text-sm text-red-500">{form.formState.errors.providerName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="calendarId">Calendar ID *</Label>
              <Input
                id="calendarId"
                {...form.register('calendarId')}
                placeholder="calendar"
                className={hasAttemptedSubmit && form.formState.errors.calendarId ? 'border-red-500' : ''}
              />
              {form.formState.errors.calendarId && (
                <p className="text-sm text-red-500">{form.formState.errors.calendarId.message}</p>
              )}
              <p className="text-xs text-muted-foreground">Usually "calendar" for your main calendar</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="syncDirection">Sync Direction *</Label>
            <CustomSelect
              value={form.watch('syncDirection')}
              onValueChange={(value) => form.setValue('syncDirection', value as any)}
              options={[
                { value: 'bidirectional', label: 'Bidirectional (recommended)' },
                { value: 'to_external', label: 'Alga → Outlook Calendar only' },
                { value: 'from_external', label: 'Outlook Calendar → Alga only' },
              ]}
            />
            {form.formState.errors.syncDirection && (
              <p className="text-sm text-red-500">{form.formState.errors.syncDirection.message}</p>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="isActive"
              checked={form.watch('isActive')}
              onCheckedChange={(checked: boolean) => form.setValue('isActive', checked)}
            />
            <Label htmlFor="isActive">Enable this provider</Label>
          </div>
        </CardContent>
      </Card>

      {/* OAuth Section */}
      <Card>
        <CardHeader>
          <CardTitle>Microsoft OAuth Authorization</CardTitle>
          <CardDescription>
            Authorize access to your Microsoft Outlook Calendar
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className={`p-4 rounded-lg transition-colors ${
              oauthStatus === 'success' ? 'bg-green-50 border-2 border-green-200' : 'bg-blue-50'
            }`}>
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium">Microsoft Outlook Calendar Access</h4>
                  <p className="text-sm text-muted-foreground">
                    {oauthStatus === 'success' 
                      ? 'Successfully connected to Outlook Calendar' 
                      : 'Click the button below to authorize access to your Outlook Calendar'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAuthorize}
                  disabled={oauthStatus === 'authorizing'}
                >
                  {oauthStatus === 'authorizing' && (
                    <>
                      <Clock className="h-4 w-4 mr-2 animate-spin" />
                      Authorizing...
                    </>
                  )}
                  {oauthStatus === 'success' && (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Authorized
                    </>
                  )}
                  {(oauthStatus === 'idle' || oauthStatus === 'error') && (
                    <>
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Authorize Outlook Calendar
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
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting || oauthStatus === 'authorizing'}>
          {isSubmitting ? 'Saving...' : isEditing ? 'Update Provider' : 'Create Provider'}
        </Button>
      </div>
    </form>
  );
}


