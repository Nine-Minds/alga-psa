/**
 * Enterprise Edition Gmail Provider Configuration Form
 * Tenant-owned Google OAuth configuration (same model as CE)
 */

'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Alert, AlertDescription, Card, CardContent, CardDescription, CardHeader, CardTitle, CustomSelect } from '@alga-psa/ui/components';
import { Shield } from 'lucide-react';
import type { EmailProvider } from '@alga-psa/integrations';
import {
  createEmailProvider,
  updateEmailProvider,
  upsertEmailProvider,
  initiateEmailOAuth,
  getInboundTicketDefaults,
  getGoogleIntegrationStatus,
  useOAuthPopup,
  BasicConfigCard,
  ProcessingSettingsCard,
  OAuthSection,
  baseGmailProviderSchema
} from '@alga-psa/integrations';

type EEGmailProviderFormData = import('@alga-psa/integrations/components').BaseGmailProviderFormData;

interface EEGmailProviderFormProps {
  tenant: string;
  provider?: EmailProvider;
  onSuccess: (provider: EmailProvider) => void;
  onCancel: () => void;
}

export function GmailProviderForm({ 
  tenant,
  provider, 
  onSuccess, 
  onCancel 
}: EEGmailProviderFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupWarnings, setSetupWarnings] = useState<string[]>([]);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const { oauthStatus, oauthData, autoSubmitCountdown, openOAuthPopup, cancelAutoSubmit, setOauthStatus } = useOAuthPopup<any>({ provider: 'google', countdownSeconds: 0 });
  const [defaultsOptions, setDefaultsOptions] = useState<{ value: string; label: string }[]>([]);
  const [googleConfigReady, setGoogleConfigReady] = useState(false);

  const isEditing = !!provider;

  // No manual cleanup needed; handled by hook

  const form = useForm<EEGmailProviderFormData>({
    resolver: zodResolver(baseGmailProviderSchema) as any,
    defaultValues: provider && provider.googleConfig ? {
      providerName: provider.providerName,
      mailbox: provider.mailbox,
      isActive: provider.isActive,
      autoProcessEmails: provider.googleConfig.auto_process_emails ?? true,
      labelFilters: provider.googleConfig.label_filters?.join(', ') || '',
      maxEmailsPerSync: provider.googleConfig.max_emails_per_sync ?? 50,
      inboundTicketDefaultsId: (provider as any).inboundTicketDefaultsId || undefined
    } : {
      isActive: true,
      autoProcessEmails: true,
      labelFilters: '',
      maxEmailsPerSync: 50,
      inboundTicketDefaultsId: undefined
    }
  });

  // Load inbound ticket defaults options and listen for refresh
  React.useEffect(() => {
    const loadDefaults = async () => {
      try {
        const res = await getInboundTicketDefaults();
        const options = (res.defaults || []).map((d) => ({ value: d.id, label: d.display_name || d.short_name }));
        setDefaultsOptions(options);
      } catch (e) {
        console.error('Failed to load inbound defaults', e);
      }
    };
    loadDefaults();
    const onUpdate = () => loadDefaults();
    window.addEventListener('inbound-defaults-updated', onUpdate as any);
    return () => window.removeEventListener('inbound-defaults-updated', onUpdate as any);
  }, []);

  React.useEffect(() => {
    const loadGoogleStatus = async () => {
      try {
        const res = await getGoogleIntegrationStatus();
        if (!res.success) {
          setGoogleConfigReady(false);
          return;
        }
        const hasClient = Boolean(res.config?.gmailClientId);
        const hasSecret = Boolean(res.config?.gmailClientSecretMasked);
        const hasProject = Boolean(res.config?.projectId);
        const hasSvc = Boolean(res.config?.hasServiceAccountKey);
        setGoogleConfigReady(hasClient && hasSecret && hasProject && hasSvc);
      } catch {
        setGoogleConfigReady(false);
      }
    };
    loadGoogleStatus();
  }, []);

  
  const onSubmit = async (data: EEGmailProviderFormData, providedOauthData?: any) => {
    setHasAttemptedSubmit(true);
    
    // Check if form is valid
    const isValid = await form.trigger();
    if (!isValid) {
      return;
    }
    
    try {
      setLoading(true);
      setError(null);

      // Use provided OAuth data if available, otherwise fall back to state
      const activeOauthData = providedOauthData || oauthData;

      const payload = {
        tenant,
        providerType: 'google',
        providerName: data.providerName,
        mailbox: data.mailbox,
        isActive: data.isActive,
        inboundTicketDefaultsId: (form.getValues() as any).inboundTicketDefaultsId || undefined,
        googleConfig: {
          // Null client credentials indicate tenant-level OAuth is used
          client_id: null,
          client_secret: null,
          auto_process_emails: data.autoProcessEmails,
          label_filters: data.labelFilters ? data.labelFilters.split(',').map(l => l.trim()) : ['INBOX'],
          max_emails_per_sync: data.maxEmailsPerSync,
          // Include OAuth tokens if available from authorization
          ...(activeOauthData && {
            access_token: activeOauthData.accessToken,
            refresh_token: activeOauthData.refreshToken,
            token_expires_at: activeOauthData.expiresAt
          })
        }
      };

      // After OAuth, run automation once to set up Pub/Sub + watch
      const result = isEditing
        ? await updateEmailProvider(provider.id, payload, false) // skipAutomation: false
        : await createEmailProvider(payload, false); // skipAutomation: false

      // Check for setup errors or warnings
      if (result.setupError) {
        setError(`Provider saved but setup incomplete: ${result.setupError}`);
      }
      if (result.setupWarnings && result.setupWarnings.length > 0) {
        setSetupWarnings(result.setupWarnings);
      }

      // Still call onSuccess so the provider appears in the list
      // The user can see the error/warning state in the UI
      onSuccess(result.provider);

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFormSubmit = form.handleSubmit(
    onSubmit as any,
    () => setHasAttemptedSubmit(true)
  );

  const handleOAuthAuthorization = async () => {
    try {
      setOauthStatus('authorizing');
      setError(null);

      const formData = form.getValues();

      // Validate required fields for OAuth
      const isValid = await form.trigger();
      if (!isValid) {
        setOauthStatus('error');
        setError('Please fill in all required fields before authorizing');
        return;
      }

      if (!googleConfigReady) {
        setOauthStatus('error');
        setError('Google integration is not configured for this tenant. Configure Google first, then retry.');
        return;
      }

      // Save provider first so credentials are available for OAuth
      let providerId = provider?.id;
      if (!providerId) {
        const payload = {
          tenant,
          providerType: 'google',
          providerName: formData.providerName,
          mailbox: formData.mailbox,
          isActive: formData.isActive,
          inboundTicketDefaultsId: (form.getValues() as any).inboundTicketDefaultsId || undefined,
          googleConfig: {
            // Null client credentials indicate tenant-level OAuth is used
            client_id: null,
            client_secret: null,
            auto_process_emails: formData.autoProcessEmails,
            label_filters: formData.labelFilters ? formData.labelFilters.split(',').map(l => l.trim()) : ['INBOX'],
            max_emails_per_sync: formData.maxEmailsPerSync ?? 50
          }
        };

        // Pre-auth save should not trigger automation yet (tokens absent)
        const result = await upsertEmailProvider(payload, true); // skipAutomation: true
        providerId = result.provider.id;
      }

      // Get OAuth URL from server action (tenant-owned OAuth configuration)
      const redirectUri = `${window.location.origin}/api/auth/google/callback`;
      const oauthResult = await initiateEmailOAuth({
        provider: 'google',
        redirectUri,
        providerId,
      });
      if (!oauthResult.success) {
        throw new Error('error' in oauthResult ? oauthResult.error : 'Failed to initiate OAuth');
      }
      const { authUrl } = oauthResult;

      openOAuthPopup(authUrl, {
        onAfterSuccess: () => {},
        onAutoSubmit: (oauthDataForSubmit) => {
          form.handleSubmit((data) => onSubmit(data, oauthDataForSubmit))();
        },
        onError: (message) => setError(message),
      });

    } catch (err: any) {
      setOauthStatus('error');
      setError(err.message);
    }
  };

  return (
    <form noValidate onSubmit={handleFormSubmit} className="space-y-6">
      {/* Header */}
      <Alert>
        <Shield className="h-4 w-4" />
        <AlertDescription>
          <strong>Gmail Integration</strong> — Connect your Gmail account and configure your email processing preferences.
        </AlertDescription>
      </Alert>

      {/* Error Display (at top for visibility) */}
      {hasAttemptedSubmit && Object.keys(form.formState.errors).length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <p className="font-medium mb-2">Please fill in the required fields:</p>
            <ul className="list-disc list-inside space-y-1">
              {form.formState.errors.providerName && <li>Provider Name</li>}
              {form.formState.errors.mailbox && <li>Gmail Address</li>}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {setupWarnings.length > 0 && (
        <Alert className="border-yellow-500 bg-yellow-50">
          <AlertDescription>
            <p className="font-medium text-yellow-800 mb-2">Setup completed with warnings:</p>
            <ul className="list-disc list-inside space-y-1 text-yellow-700">
              {setupWarnings.map((warning, idx) => (
                <li key={idx}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {!googleConfigReady && (
        <Alert variant="destructive">
          <AlertDescription>
            <div className="space-y-2">
              <div className="font-medium">Google integration is not configured for this tenant.</div>
              <div className="text-sm">
                Configure tenant-owned Google OAuth + Pub/Sub first: <strong>Settings → Integrations → Providers</strong>.
              </div>
              <div>
                <Button
                  id="open-google-settings-btn"
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

      <BasicConfigCard
        form={form}
        hasAttemptedSubmit={hasAttemptedSubmit}
        title="Gmail Account Setup"
        description="Configure your Gmail account for inbound email processing"
      />

      {/* Gmail Authentication */}
      <Card>
        <CardHeader>
          <CardTitle>Gmail Authentication</CardTitle>
          <CardDescription>
            Connect your Gmail account to enable email processing
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <OAuthSection
            oauthStatus={oauthStatus}
            onAuthorize={handleOAuthAuthorization}
            authorizeButtonId="gmail-oauth-btn"
            buttonDisabled={!form.watch('mailbox') || !googleConfigReady}
            isEditing={isEditing}
            labels={{
              title: 'Gmail Connection',
              descriptionIdle: 'Authorize access to your Gmail account',
              descriptionSuccess: 'Successfully connected! Saving your settings...',
              buttonIdleText: 'Connect Gmail',
              buttonAuthorizingText: 'Connecting...',
              buttonSuccessText: 'Connected',
            }}
          />
        </CardContent>
      </Card>

      <ProcessingSettingsCard
        form={form}
        title="Email Processing Settings"
        description="Configure how emails are processed and imported"
      />

      {/* Ticket Defaults selection */}
      <Card>
        <CardHeader>
          <CardTitle>Ticket Defaults</CardTitle>
          <CardDescription>
            Select defaults to apply to email-created tickets
            <Button
              id="manage-defaults-link"
              type="button"
              variant="link"
              className="ml-2 p-0 h-auto"
              onClick={() => window.dispatchEvent(new CustomEvent('open-defaults-tab'))}
            >
              Manage defaults
            </Button>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CustomSelect
            id="ee-gmail-inbound-defaults-select"
            label="Inbound Ticket Defaults"
            value={(form.watch('inboundTicketDefaultsId') as any) || ''}
            onValueChange={(v) => form.setValue('inboundTicketDefaultsId', v || undefined)}
            options={defaultsOptions}
            placeholder="Select defaults (optional)"
            allowClear
          />
          <div className="text-right">
            <Button id="refresh-defaults-list" type="button" variant="outline" size="sm" onClick={() => window.dispatchEvent(new CustomEvent('inbound-defaults-updated'))}>
              Refresh list
            </Button>
          </div>
        </CardContent>
      </Card>


      {/* OAuth Warning */}
      {oauthStatus !== 'success' && (
        <div className="bg-yellow-50 border-2 border-yellow-200 p-4 rounded-lg">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center">
                <span className="text-yellow-600 font-semibold">⚠</span>
              </div>
            </div>
            <div className="ml-3">
              <h4 className="font-medium text-yellow-800">Gmail Connection Required</h4>
              <p className="text-sm text-yellow-700">
                You must connect your Gmail account above before {isEditing ? 'updating' : 'adding'} the provider.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Form Actions */}
      <div className="flex items-center justify-end space-x-2">
        <Button id="gmail-cancel-btn" type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button 
          id="gmail-submit-btn" 
          type="submit" 
          disabled={loading}
          className={`${Object.keys(form.formState.errors).length > 0 && !loading ? 'opacity-50' : ''} ${
            oauthStatus === 'success' ? 'bg-green-600 hover:bg-green-700 animate-pulse' : ''
          }`}
        >
          {loading ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Setting up Gmail integration...
            </>
          ) : (
            <>
              {isEditing ? 'Update Provider' : 'Add Provider'}
              {oauthStatus === 'success' && ' & Complete Setup'}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
