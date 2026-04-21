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
import { initiateCalendarOAuth, createCalendarProvider, updateCalendarProvider } from '../../actions';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { CalendarProviderConfig } from '@alga-psa/types';
import { Badge } from '@alga-psa/ui/components/Badge';
import { getGoogleCalendarSetupStatus } from '../../lib/actions/integrations/calendarSetupActions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  const { t } = useTranslation();

  const form = useForm<GoogleCalendarProviderFormData>({
    resolver: zodResolver(googleCalendarProviderSchema),
    defaultValues: {
      providerName: provider?.name || t('calendar.providers.google.defaults.providerName', { defaultValue: 'Google Calendar' }),
      calendarId: provider?.calendar_id || t('calendar.providers.google.defaults.calendarId', { defaultValue: 'primary' }),
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
          setOAuthError(event.data.errorDescription || t('calendar.providers.common.oauth.callbackFailed', { defaultValue: 'OAuth authorization failed' }));
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onSuccess]);

  useEffect(() => {
    const loadGoogleStatus = async () => {
      try {
        const res = await getGoogleCalendarSetupStatus();
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
        throw new Error(t('calendar.providers.google.errors.notConfigured', { defaultValue: 'Google integration is not configured for this tenant. Configure Google first, then retry.' }));
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
          throw new Error(result.error || t('calendar.providers.common.errors.createFailed', { defaultValue: 'Failed to create calendar provider' }));
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
        throw new Error((oauthResult as { success: false; error: string }).error || t('calendar.providers.common.oauth.initiateFailed', { defaultValue: 'Failed to initiate OAuth' }));
      }

      // Open OAuth popup
      const popup = window.open(
        oauthResult.authUrl,
        'google-calendar-oauth',
        'width=600,height=700,scrollbars=yes,resizable=yes'
      );

      if (!popup) {
        throw new Error(t('calendar.providers.common.oauth.popupBlocked', { defaultValue: 'Popup blocked. Please allow popups for this site.' }));
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
      setOAuthError(error.message || t('calendar.providers.common.oauth.initiateFailed', { defaultValue: 'Failed to initiate OAuth' }));
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
          throw new Error(result.error || t('calendar.providers.common.errors.createFailed', { defaultValue: 'Failed to create calendar provider' }));
        }

        setCalendarProviderId(result.provider?.id);
      }

      if (onSuccess) {
        onSuccess();
      }
    } catch (error: any) {
      form.setError('root', { message: error.message || t('calendar.providers.common.errors.saveFailed', { defaultValue: 'Failed to save provider' }) });
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
    if (oauthStatus === 'success') return t('calendar.providers.common.oauth.badge.authorized', { defaultValue: 'Authorized' });
    if (oauthStatus === 'authorizing') return t('calendar.providers.common.oauth.badge.authorizing', { defaultValue: 'Authorizing' });
    if (oauthStatus === 'error') return t('calendar.providers.common.oauth.badge.error', { defaultValue: 'Authorization Error' });
    return t('calendar.providers.common.oauth.badge.notAuthorized', { defaultValue: 'Not Authorized' });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      {/* Basic Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>{t('calendar.providers.google.config.title', { defaultValue: 'Google Calendar Configuration' })}</CardTitle>
          <CardDescription>
            {t('calendar.providers.google.config.description', { defaultValue: 'Connect your Google Calendar to sync schedule entries' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="google-provider-name-input">{t('calendar.providers.google.fields.providerName', { defaultValue: 'Provider Name *' })}</Label>
              <Input
                id="google-provider-name-input"
                {...form.register('providerName')}
                placeholder={t('calendar.providers.google.fields.providerNamePlaceholder', { defaultValue: 'e.g., My Google Calendar' })}
                className={hasAttemptedSubmit && form.formState.errors.providerName ? 'border-red-500' : ''}
              />
              {form.formState.errors.providerName && (
                <p className="text-sm text-red-500">{form.formState.errors.providerName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="google-calendar-id-input">{t('calendar.providers.google.fields.calendarId', { defaultValue: 'Calendar ID *' })}</Label>
              <Input
                id="google-calendar-id-input"
                {...form.register('calendarId')}
                placeholder={t('calendar.providers.google.fields.calendarIdPlaceholder', { defaultValue: 'primary' })}
                className={hasAttemptedSubmit && form.formState.errors.calendarId ? 'border-red-500' : ''}
              />
              {form.formState.errors.calendarId && (
                <p className="text-sm text-red-500">{form.formState.errors.calendarId.message}</p>
              )}
              <p className="text-xs text-muted-foreground">{t('calendar.providers.google.fields.calendarIdHint', { defaultValue: 'Usually "primary" for your main calendar' })}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="google-sync-direction-select">{t('calendar.providers.google.fields.syncDirection', { defaultValue: 'Sync Direction *' })}</Label>
            <CustomSelect
              id="google-sync-direction-select"
              value={form.watch('syncDirection')}
              onValueChange={(value) => form.setValue('syncDirection', value as any)}
              options={[
                { value: 'bidirectional', label: t('calendar.providers.common.syncDirections.bidirectional', { defaultValue: 'Bidirectional (recommended)' }) },
                { value: 'to_external', label: t('calendar.providers.google.syncDirections.toExternal', { defaultValue: 'Alga → Google Calendar only' }) },
                { value: 'from_external', label: t('calendar.providers.google.syncDirections.fromExternal', { defaultValue: 'Google Calendar → Alga only' }) },
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
            <Label htmlFor="google-provider-active-switch">{t('calendar.providers.google.fields.enableProvider', { defaultValue: 'Enable this provider' })}</Label>
          </div>
        </CardContent>
      </Card>

      {/* OAuth Section */}
      <Card>
        <CardHeader>
          <CardTitle>{t('calendar.providers.google.oauth.title', { defaultValue: 'Google OAuth Authorization' })}</CardTitle>
          <CardDescription>
            {t('calendar.providers.google.oauth.description', { defaultValue: 'Authorize access to your Google Calendar' })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {!googleConfigReady && (
              <Alert variant="destructive">
                <AlertDescription>
                  <div className="space-y-2">
                    <div className="font-medium">{t('calendar.providers.google.configAlert.title', { defaultValue: 'Google is not configured for this tenant.' })}</div>
                    <div
                      className="text-sm"
                      dangerouslySetInnerHTML={{
                        __html: t('calendar.providers.google.configAlert.body', {
                          defaultValue: 'Configure tenant-owned Google OAuth first in <strong>Settings → Integrations → Providers</strong>.',
                        }),
                      }}
                    />
                    <div>
                      <Button
                        id="google-calendar-open-google-settings"
                        type="button"
                        variant="outline"
                        onClick={() => {
                          window.location.href = '/msp/settings?tab=integrations&category=providers';
                        }}
                      >
                        {t('calendar.providers.google.configAlert.openSettings', { defaultValue: 'Open Google Settings' })}
                      </Button>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            )}
            <div className={`p-4 rounded-lg transition-colors ${
              oauthStatus === 'success' ? 'bg-success/10 border-2 border-success/30' : 'bg-muted/50'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium">{t('calendar.providers.common.oauth.status', { defaultValue: 'Connection Status' })}</h4>
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
                      {t('calendar.providers.common.oauth.connecting', { defaultValue: 'Connecting...' })}
                    </>
                  )}
                  {oauthStatus === 'success' && (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      {t('calendar.providers.common.oauth.connected', { defaultValue: 'Connected' })}
                    </>
                  )}
                  {(oauthStatus === 'idle' || oauthStatus === 'error') && (
                    <>
                      <ExternalLink className="h-4 w-4 mr-2" />
                      {t('calendar.providers.common.oauth.connect', { defaultValue: 'Connect' })}
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
            {t('calendar.providers.common.actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
        )}
        <Button
          id="google-provider-submit-button"
          type="submit"
          disabled={isSubmitting || oauthStatus === 'authorizing'}
        >
          {isSubmitting
            ? t('calendar.providers.common.actions.saving', { defaultValue: 'Saving...' })
            : isEditing
              ? t('calendar.providers.common.actions.updateProvider', { defaultValue: 'Update Provider' })
              : t('calendar.providers.common.actions.createProvider', { defaultValue: 'Create Provider' })}
        </Button>
      </div>
    </form>
  );
}
