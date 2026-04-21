/**
 * Microsoft Calendar Provider Configuration Form
 * Form for setting up Microsoft Outlook Calendar integration
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
import {
  initiateCalendarOAuth,
  createCalendarProvider,
  updateCalendarProvider,
} from '../../actions';
import { getMicrosoftCalendarSetupStatus } from '../../lib/actions/integrations/calendarSetupActions';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { CalendarProviderConfig } from '@alga-psa/types';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const microsoftCalendarProviderSchema = z.object({
  providerName: z.string().min(1, 'Provider name is required'),
  calendarId: z.string().min(1, 'Calendar ID is required'),
  syncDirection: z.enum(['bidirectional', 'to_external', 'from_external']),
  isActive: z.boolean(),
});

type MicrosoftCalendarProviderFormData = z.infer<typeof microsoftCalendarProviderSchema>;

interface MicrosoftCalendarProviderFormProps {
  tenant: string | null | undefined;
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
  const [providerSetupReady, setProviderSetupReady] = useState(false);
  const [providerSetupLoading, setProviderSetupLoading] = useState(true);
  const [providerSetupReasonCode, setProviderSetupReasonCode] = useState<
    'unsupported_consumer' | 'binding_not_configured' | 'profile_missing' | 'profile_credentials_missing' | null
  >(null);
  const { t } = useTranslation('msp/calendar');

  const form = useForm<MicrosoftCalendarProviderFormData>({
    resolver: zodResolver(microsoftCalendarProviderSchema),
    defaultValues: {
      providerName: provider?.name || t('calendar.providers.microsoft.defaults.providerName', { defaultValue: 'Outlook Calendar' }),
      calendarId: provider?.calendar_id || t('calendar.providers.microsoft.defaults.calendarId', { defaultValue: 'calendar' }),
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

  useEffect(() => {
    const loadProviderSetupStatus = async () => {
      try {
        const res = await getMicrosoftCalendarSetupStatus();
        setProviderSetupReady(Boolean(res.success && res.ready));
        setProviderSetupReasonCode(res.success ? res.reasonCode || null : null);
      } catch {
        setProviderSetupReady(false);
        setProviderSetupReasonCode(null);
      } finally {
        setProviderSetupLoading(false);
      }
    };

    loadProviderSetupStatus();
  }, []);

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
          setOAuthError(event.data.errorDescription || t('calendar.providers.common.oauth.callbackFailed', { defaultValue: 'OAuth authorization failed' }));
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
          throw new Error(result.error || t('calendar.providers.common.errors.createFailed', { defaultValue: 'Failed to create calendar provider' }));
        }

        providerId = result.provider.id;
        setCalendarProviderId(providerId);
      }

      // Initiate OAuth flow
      const oauthResult = await initiateCalendarOAuth({
        provider: 'microsoft',
        calendarProviderId: providerId,
        isPopup: true,
      });

      if (!oauthResult.success) {
        throw new Error((oauthResult as { success: false; error: string }).error || t('calendar.providers.common.oauth.initiateFailed', { defaultValue: 'Failed to initiate OAuth' }));
      }

      // Open OAuth popup
      const popup = window.open(
        oauthResult.authUrl,
        'microsoft-calendar-oauth',
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
          <CardTitle>{t('calendar.providers.microsoft.config.title', { defaultValue: 'Microsoft Outlook Calendar Configuration' })}</CardTitle>
          <CardDescription>
            {t('calendar.providers.microsoft.config.description', { defaultValue: 'Connect your Microsoft Outlook Calendar to sync schedule entries' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="microsoft-provider-name-input">{t('calendar.providers.microsoft.fields.providerName', { defaultValue: 'Provider Name *' })}</Label>
              <Input
                id="microsoft-provider-name-input"
                {...form.register('providerName')}
                placeholder={t('calendar.providers.microsoft.fields.providerNamePlaceholder', { defaultValue: 'e.g., My Outlook Calendar' })}
                className={hasAttemptedSubmit && form.formState.errors.providerName ? 'border-red-500' : ''}
              />
              {form.formState.errors.providerName && (
                <p className="text-sm text-red-500">{form.formState.errors.providerName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="microsoft-calendar-id-input">{t('calendar.providers.microsoft.fields.calendarId', { defaultValue: 'Calendar ID *' })}</Label>
              <Input
                id="microsoft-calendar-id-input"
                {...form.register('calendarId')}
                placeholder={t('calendar.providers.microsoft.fields.calendarIdPlaceholder', { defaultValue: 'calendar' })}
                className={hasAttemptedSubmit && form.formState.errors.calendarId ? 'border-red-500' : ''}
              />
              {form.formState.errors.calendarId && (
                <p className="text-sm text-red-500">{form.formState.errors.calendarId.message}</p>
              )}
              <p className="text-xs text-muted-foreground">{t('calendar.providers.microsoft.fields.calendarIdHint', { defaultValue: 'Usually "calendar" for your main calendar' })}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="microsoft-sync-direction-select">{t('calendar.providers.microsoft.fields.syncDirection', { defaultValue: 'Sync Direction *' })}</Label>
            <CustomSelect
              id="microsoft-sync-direction-select"
              value={form.watch('syncDirection')}
              onValueChange={(value) => form.setValue('syncDirection', value as any)}
              options={[
                { value: 'bidirectional', label: t('calendar.providers.common.syncDirections.bidirectional', { defaultValue: 'Bidirectional (recommended)' }) },
                { value: 'to_external', label: t('calendar.providers.microsoft.syncDirections.toExternal', { defaultValue: 'Alga → Outlook Calendar only' }) },
                { value: 'from_external', label: t('calendar.providers.microsoft.syncDirections.fromExternal', { defaultValue: 'Outlook Calendar → Alga only' }) },
              ]}
            />
            {form.formState.errors.syncDirection && (
              <p className="text-sm text-red-500">{form.formState.errors.syncDirection.message}</p>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="microsoft-provider-active-switch"
              checked={form.watch('isActive')}
              onCheckedChange={(checked: boolean) => form.setValue('isActive', checked)}
            />
            <Label htmlFor="microsoft-provider-active-switch">{t('calendar.providers.microsoft.fields.enableProvider', { defaultValue: 'Enable this provider' })}</Label>
          </div>
        </CardContent>
      </Card>

      {/* OAuth Section */}
      <Card>
        <CardHeader>
          <CardTitle>{t('calendar.providers.microsoft.oauth.title', { defaultValue: 'Microsoft OAuth Authorization' })}</CardTitle>
          <CardDescription>
            {t('calendar.providers.microsoft.oauth.description', { defaultValue: 'Authorize access to your Microsoft Outlook Calendar' })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {!providerSetupLoading && !providerSetupReady && (
              <Alert>
                <AlertDescription>
                  <div className="space-y-2">
                    <div className="font-medium">{t('calendar.providers.microsoft.configAlert.title', { defaultValue: 'Microsoft provider settings are not configured.' })}</div>
                    <div className="text-sm text-muted-foreground">
                      {providerSetupReasonCode
                        ? t(`calendar.providers.microsoft.setupReason.${providerSetupReasonCode}`, {
                            defaultValue: t('calendar.providers.microsoft.configAlert.body', {
                              defaultValue: 'Configure Providers first in Settings → Integrations → Providers, then return here to connect Outlook Calendar.',
                            }),
                          })
                        : t('calendar.providers.microsoft.configAlert.body', { defaultValue: 'Configure Providers first in Settings → Integrations → Providers, then return here to connect Outlook Calendar.' })}
                    </div>
                    <Button
                      id="configure-microsoft-calendar-providers-link"
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => window.location.assign('/msp/settings?category=providers')}
                    >
                      {t('calendar.providers.microsoft.configAlert.openSettings', { defaultValue: 'Open Providers Settings' })}
                    </Button>
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
                      id="microsoft-oauth-status-badge"
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
                  id="microsoft-authorize-button"
                  type="button"
                  variant="outline"
                  onClick={handleAuthorize}
                  disabled={!providerSetupReady || oauthStatus === 'authorizing'}
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
          <Button id="microsoft-provider-cancel-button" type="button" variant="outline" onClick={onCancel}>
            {t('calendar.providers.common.actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
        )}
        <Button
          id="microsoft-provider-submit-button"
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
