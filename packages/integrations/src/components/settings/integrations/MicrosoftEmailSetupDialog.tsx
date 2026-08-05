'use client';

import React from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { useToast } from '@alga-psa/ui/hooks/use-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  createMicrosoftEmailApplication,
  configureMicrosoftEmailManualApplication,
  getMicrosoftEmailSetupOptions,
  type MicrosoftEmailSetupCompletionResult,
  type MicrosoftEmailSetupOptionsResult,
  configureMicrosoftEmailPlatformApplication,
} from '../../../actions/integrations/microsoftEmailSetupActions';
import { Copy, ExternalLink, KeyRound, Settings2, WandSparkles } from 'lucide-react';

type SetupStep = 'choose' | 'platform' | 'automated' | 'manual' | 'complete';

// The setup callback route reports failures as stable codes (never prose), so
// the popup's English payload never reaches the user. Keys live in
// msp/email-providers alongside the rest of the Microsoft mailbox setup copy.
const CALLBACK_ERROR_TEXT: Record<string, { key: string; defaultValue: string }> = {
  invalid_state: {
    key: 'integrations.microsoft.emailSetup.errors.invalidState',
    defaultValue: 'This Microsoft setup request is invalid or expired. Start again from Providers settings.',
  },
  session_mismatch: {
    key: 'integrations.microsoft.emailSetup.errors.sessionMismatch',
    defaultValue: 'Your Alga PSA session does not match the administrator who started this setup. Sign in and try again.',
  },
  consent_denied: {
    key: 'integrations.microsoft.emailSetup.errors.consentDenied',
    defaultValue: 'Microsoft sign-in or administrator consent was denied. Choose another setup option or try again.',
  },
  microsoft_error: {
    key: 'integrations.microsoft.emailSetup.errors.microsoftError',
    defaultValue: 'Microsoft could not complete the setup request. Try again or use manual setup.',
  },
  consent_not_granted: {
    key: 'integrations.microsoft.emailSetup.errors.consentNotGranted',
    defaultValue: 'Microsoft did not confirm tenant administrator consent.',
  },
  consent_persist_failed: {
    key: 'integrations.microsoft.emailSetup.errors.consentPersistFailed',
    defaultValue: 'Failed to record Microsoft administrator consent.',
  },
  missing_code: {
    key: 'integrations.microsoft.emailSetup.errors.missingCode',
    defaultValue: 'Microsoft did not return an authorization code. Start setup again.',
  },
};

interface MicrosoftEmailSetupDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCompleted: () => void | Promise<void>;
}

export function MicrosoftEmailSetupDialog({
  isOpen,
  onClose,
  onCompleted,
}: MicrosoftEmailSetupDialogProps) {
  const { t } = useTranslation('msp/integrations');
  const { toast } = useToast();
  const [step, setStep] = React.useState<SetupStep>('choose');
  const [options, setOptions] = React.useState<MicrosoftEmailSetupOptionsResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tenantId, setTenantId] = React.useState('');
  const [displayName, setDisplayName] = React.useState('Alga PSA Microsoft Email');
  const [clientId, setClientId] = React.useState('');
  const [clientSecret, setClientSecret] = React.useState('');
  const [completion, setCompletion] = React.useState<MicrosoftEmailSetupCompletionResult | null>(null);
  const [adminConsentGranted, setAdminConsentGranted] = React.useState(false);
  const popupRef = React.useRef<Window | null>(null);
  const popupPollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const popupCompletedRef = React.useRef(false);
  const adminConsentUrl = completion?.adminConsentUrl;

  const clearPopupMonitor = React.useCallback(() => {
    if (popupPollRef.current) {
      clearInterval(popupPollRef.current);
      popupPollRef.current = null;
    }
    popupRef.current = null;
  }, []);

  React.useEffect(() => {
    if (!isOpen) return;
    setStep('choose');
    setError(null);
    setCompletion(null);
    setClientId('');
    setClientSecret('');
    setAdminConsentGranted(false);
    setLoading(true);
    void getMicrosoftEmailSetupOptions()
      .then((result) => {
        setOptions(result);
        if (!result.success) setError(result.error || 'Failed to load Microsoft Email setup options.');
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'microsoft-email-setup-callback') {
        return;
      }
      popupCompletedRef.current = true;
      clearPopupMonitor();
      setWorking(false);
      if (!event.data.success) {
        const mapped = CALLBACK_ERROR_TEXT[event.data.errorCode as string];
        setError(
          mapped
            ? t(mapped.key, { defaultValue: mapped.defaultValue })
            // Provisioning failures still arrive as a server-composed message.
            : event.data.error || t('integrations.microsoft.emailSetup.errors.generic', { defaultValue: 'Microsoft Email setup did not complete.' }),
        );
        return;
      }
      if (event.data.stage === 'admin_consent') {
        setAdminConsentGranted(true);
        toast({
          title: t('integrations.microsoft.emailSetup.consent.confirmedTitle', { defaultValue: 'Administrator consent confirmed' }),
          description: t('integrations.microsoft.emailSetup.consent.confirmedDescription', { defaultValue: 'The Microsoft app is ready for mailbox authorization.' }),
        });
        void onCompleted();
        return;
      }

      const result = event.data as MicrosoftEmailSetupCompletionResult;
      setCompletion(result);
      setTenantId(result.tenantId || '');
      setStep('complete');
      void onCompleted();
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [clearPopupMonitor, isOpen, onCompleted, t, toast]);

  React.useEffect(() => () => clearPopupMonitor(), [clearPopupMonitor]);

  const copyValue = React.useCallback(async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    toast({
      title: t('integrations.microsoft.emailSetup.copied', { defaultValue: '{{label}} copied', label }),
    });
  }, [t, toast]);

  const openPopup = React.useCallback((url: string) => {
    clearPopupMonitor();
    popupCompletedRef.current = false;
    const popup = window.open(url, 'microsoft-email-setup', 'width=720,height=760,noopener=false');
    if (!popup) {
      setError(t('integrations.microsoft.emailSetup.errors.popupBlocked', { defaultValue: 'Allow popups for this site, then try again.' }));
      return null;
    }
    popupRef.current = popup;
    popupPollRef.current = setInterval(() => {
      if (!popup.closed) return;
      clearPopupMonitor();
      if (!popupCompletedRef.current) {
        setWorking(false);
        setError(t('integrations.microsoft.emailSetup.errors.popupClosed', {
          defaultValue: 'The Microsoft window was closed before setup finished. Try again or choose another setup option.',
        }));
      }
    }, 500);
    popup.focus();
    return popup;
  }, [clearPopupMonitor, t]);

  const configurePlatformApplication = React.useCallback(async () => {
    if (!tenantId.trim()) {
      setError(t('integrations.microsoft.emailSetup.errors.tenantRequired', { defaultValue: 'Enter your Microsoft tenant ID or verified domain.' }));
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const result = await configureMicrosoftEmailPlatformApplication({ tenantId, displayName });
      if (!result.success) {
        setError(result.error || t('integrations.microsoft.emailSetup.errors.platform', { defaultValue: 'Could not configure the platform Microsoft app.' }));
        return;
      }
      setCompletion(result);
      setStep('complete');
      await onCompleted();
    } finally {
      setWorking(false);
    }
  }, [displayName, onCompleted, t, tenantId]);

  const startAutomatedCreation = React.useCallback(async () => {
    if (!displayName.trim()) {
      setError(t('integrations.microsoft.emailSetup.errors.nameRequired', { defaultValue: 'Enter a display name for the Microsoft app.' }));
      return;
    }
    setWorking(true);
    setError(null);
    const result = await createMicrosoftEmailApplication({ displayName });
    if (!result.success || !result.authUrl) {
      setWorking(false);
      setError(result.error || t('integrations.microsoft.emailSetup.errors.automated', { defaultValue: 'Could not start automated Microsoft app creation.' }));
      return;
    }
    if (!openPopup(result.authUrl)) setWorking(false);
  }, [displayName, openPopup, t]);

  const configureManualApplication = React.useCallback(async () => {
    if (!displayName.trim() || !clientId.trim() || !clientSecret.trim() || !tenantId.trim()) {
      setError(t('integrations.microsoft.emailSetup.errors.manualRequired', {
        defaultValue: 'Enter the display name, client ID, client secret, and Microsoft tenant ID.',
      }));
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const result = await configureMicrosoftEmailManualApplication({
        displayName,
        clientId,
        clientSecret,
        microsoftTenantId: tenantId,
      });
      if (!result.success) {
        setError(result.error || t('integrations.microsoft.emailSetup.errors.manual', {
          defaultValue: 'Could not configure the Microsoft app.',
        }));
        return;
      }
      setCompletion(result);
      setStep('complete');
      await onCompleted();
    } finally {
      setWorking(false);
    }
  }, [clientId, clientSecret, displayName, onCompleted, t, tenantId]);

  const startAdminConsent = React.useCallback(() => {
    if (!adminConsentUrl) return;
    setWorking(true);
    setError(null);
    if (!openPopup(adminConsentUrl)) setWorking(false);
  }, [adminConsentUrl, openPopup]);

  const close = React.useCallback(() => {
    if (working) return;
    onClose();
  }, [onClose, working]);

  const footer = step === 'choose' ? (
    <div className="flex justify-end">
      <Button id="microsoft-email-setup-cancel-button" type="button" variant="outline" onClick={close}>
        {t('integrations.microsoft.emailSetup.actions.cancel', { defaultValue: 'Cancel' })}
      </Button>
    </div>
  ) : step === 'complete' ? (
    <div className="flex flex-wrap justify-end gap-2">
      {adminConsentUrl && !adminConsentGranted && (
        <Button
          id="microsoft-email-copy-admin-approval-link-button"
          type="button"
          variant="outline"
          onClick={() => void copyValue(adminConsentUrl, t('integrations.microsoft.emailSetup.consent.approvalLink', { defaultValue: 'Approval link' }))}
          disabled={working}
        >
          <Copy className="mr-2 h-4 w-4" />
          {t('integrations.microsoft.emailSetup.actions.copyApprovalLink', { defaultValue: 'Copy approval link for your admin' })}
        </Button>
      )}
      {adminConsentUrl && !adminConsentGranted && (
        <Button id="microsoft-email-admin-consent-button" type="button" onClick={startAdminConsent} disabled={working}>
          <ExternalLink className="mr-2 h-4 w-4" />
          {t('integrations.microsoft.emailSetup.actions.approve', { defaultValue: 'Approve in Microsoft' })}
        </Button>
      )}
      <Button id="microsoft-email-setup-finish-button" type="button" variant="outline" onClick={close} disabled={working}>
        {t('integrations.microsoft.emailSetup.actions.finish', { defaultValue: 'Finish' })}
      </Button>
    </div>
  ) : (
    <div className="flex justify-between gap-2">
      <Button id="microsoft-email-setup-back-button" type="button" variant="outline" onClick={() => { setStep('choose'); setError(null); }} disabled={working}>
        {t('integrations.microsoft.emailSetup.actions.back', { defaultValue: 'Back' })}
      </Button>
      <Button
        id={step === 'platform'
          ? 'microsoft-email-platform-continue-button'
          : step === 'manual'
            ? 'microsoft-email-manual-continue-button'
            : 'microsoft-email-automated-continue-button'}
        type="button"
        onClick={() => void (step === 'platform'
          ? configurePlatformApplication()
          : step === 'manual'
            ? configureManualApplication()
            : startAutomatedCreation())}
        disabled={working}
      >
        {working
          ? t('integrations.microsoft.emailSetup.actions.working', { defaultValue: 'Working…' })
          : step === 'platform'
            ? t('integrations.microsoft.emailSetup.actions.savePlatform', { defaultValue: 'Create profile and continue' })
            : step === 'manual'
              ? t('integrations.microsoft.emailSetup.actions.saveManual', { defaultValue: 'Save app and continue' })
            : t('integrations.microsoft.emailSetup.actions.signIn', { defaultValue: 'Sign in to Microsoft' })}
      </Button>
    </div>
  );

  return (
    <Dialog
      id="microsoft-email-setup-dialog"
      isOpen={isOpen}
      onClose={close}
      title={t('integrations.microsoft.emailSetup.title', { defaultValue: 'Set up Microsoft' })}
      className="max-w-2xl"
      footer={footer}
    >
      <DialogContent>
        <div className="space-y-5">
          <div>
            <p className="text-sm text-[rgb(var(--color-text-700))]">
              {t('integrations.microsoft.emailSetup.description', { defaultValue: 'Choose how Alga PSA connects to Microsoft. You will connect mailboxes separately.' })}
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {loading ? (
            <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
          ) : step === 'choose' ? (
            <div className="grid gap-3">
              {options?.emailSetup?.platformOffered && (
                <button
                  id="microsoft-email-choose-platform-button"
                  type="button"
                  className="rounded-lg border bg-[rgb(var(--color-card))] p-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                  onClick={() => setStep('platform')}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-primary-500" />
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        {t('integrations.microsoft.emailSetup.platform.title', { defaultValue: 'Use the app provided by Alga PSA' })}
                        <Badge variant="success">{t('integrations.microsoft.emailSetup.recommended', { defaultValue: 'Recommended' })}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t('integrations.microsoft.emailSetup.platform.description', { defaultValue: 'Nothing to register in Microsoft Entra. Your Microsoft 365 administrator approves access.' })}
                      </p>
                    </div>
                  </div>
                </button>
              )}

              <button
                id="microsoft-email-choose-automated-button"
                type="button"
                className="rounded-lg border bg-[rgb(var(--color-card))] p-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!options?.automatedCreationAvailable}
                onClick={() => setStep('automated')}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <WandSparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary-500" />
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {t('integrations.microsoft.emailSetup.automated.title', { defaultValue: 'Create an app in your Microsoft organization' })}
                      {!options?.automatedCreationAvailable && <Badge variant="secondary">{t('integrations.microsoft.emailSetup.unavailable', { defaultValue: 'Unavailable' })}</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t('integrations.microsoft.emailSetup.automated.description', { defaultValue: 'Alga PSA registers a dedicated Entra app automatically. Sign in as a Microsoft 365 administrator.' })}
                    </p>
                  </div>
                </div>
              </button>

              <button
                id="microsoft-email-choose-manual-button"
                type="button"
                className="rounded-lg border bg-[rgb(var(--color-card))] p-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                onClick={() => setStep('manual')}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <Settings2 className="mt-0.5 h-5 w-5 shrink-0 text-primary-500" />
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {t('integrations.microsoft.emailSetup.manual.title', { defaultValue: 'Enter an existing app manually' })}
                      <Badge variant="secondary">{t('integrations.microsoft.emailSetup.advanced', { defaultValue: 'Advanced' })}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{t('integrations.microsoft.emailSetup.manual.description', { defaultValue: 'Use an existing Entra app maintained by your organization.' })}</p>
                  </div>
                </div>
              </button>
            </div>
          ) : step === 'platform' || step === 'automated' ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="microsoft-email-setup-display-name-input">{t('integrations.microsoft.emailSetup.fields.displayName', { defaultValue: 'Profile display name' })}</Label>
                <Input id="microsoft-email-setup-display-name-input" aria-label={t('integrations.microsoft.emailSetup.fields.displayName', { defaultValue: 'Profile display name' })} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              </div>
              {step === 'platform' && (
                <div className="space-y-2">
                  <Label htmlFor="microsoft-email-setup-tenant-input">{t('integrations.microsoft.emailSetup.fields.microsoftTenant', { defaultValue: 'Microsoft tenant ID or verified domain' })}</Label>
                  <Input id="microsoft-email-setup-tenant-input" aria-label={t('integrations.microsoft.emailSetup.fields.microsoftTenant', { defaultValue: 'Microsoft tenant ID or verified domain' })} value={tenantId} onChange={(event) => setTenantId(event.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                </div>
              )}
            </div>
          ) : step === 'manual' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="microsoft-email-manual-display-name-input">{t('integrations.microsoft.emailSetup.fields.displayName', { defaultValue: 'Profile display name' })}</Label>
                <Input id="microsoft-email-manual-display-name-input" aria-label={t('integrations.microsoft.emailSetup.fields.displayName', { defaultValue: 'Profile display name' })} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="microsoft-email-manual-client-id-input">{t('integrations.microsoft.emailSetup.fields.clientId', { defaultValue: 'Client ID' })}</Label>
                <Input id="microsoft-email-manual-client-id-input" aria-label={t('integrations.microsoft.emailSetup.fields.clientId', { defaultValue: 'Client ID' })} value={clientId} onChange={(event) => setClientId(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="microsoft-email-manual-tenant-id-input">{t('integrations.microsoft.emailSetup.fields.tenantId', { defaultValue: 'Microsoft tenant ID' })}</Label>
                <Input id="microsoft-email-manual-tenant-id-input" aria-label={t('integrations.microsoft.emailSetup.fields.tenantId', { defaultValue: 'Microsoft tenant ID' })} value={tenantId} onChange={(event) => setTenantId(event.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="microsoft-email-manual-client-secret-input">{t('integrations.microsoft.emailSetup.fields.clientSecret', { defaultValue: 'Client secret' })}</Label>
                <Input id="microsoft-email-manual-client-secret-input" aria-label={t('integrations.microsoft.emailSetup.fields.clientSecret', { defaultValue: 'Client secret' })} type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="microsoft-email-manual-redirect-uri-input">{t('integrations.microsoft.emailSetup.fields.redirectUri', { defaultValue: 'Redirect URI to add in Entra' })}</Label>
                  <Button
                    id="microsoft-email-copy-redirect-uri-button"
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void copyValue(options?.callbackUri || '', t('integrations.microsoft.emailSetup.fields.redirectUri', { defaultValue: 'Redirect URI' }))}
                    disabled={!options?.callbackUri}
                  >
                    <Copy className="mr-2 h-3.5 w-3.5" />
                    {t('integrations.microsoft.emailSetup.actions.copy', { defaultValue: 'Copy' })}
                  </Button>
                </div>
                <Input id="microsoft-email-manual-redirect-uri-input" aria-label={t('integrations.microsoft.emailSetup.fields.redirectUri', { defaultValue: 'Redirect URI to add in Entra' })} value={options?.callbackUri || ''} readOnly />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <Alert variant={adminConsentGranted ? 'success' : 'warning'}>
                <AlertDescription>
                  <div className="font-medium">
                    {adminConsentGranted
                      ? t('integrations.microsoft.emailSetup.complete.ready', { defaultValue: 'Microsoft is ready' })
                      : t('integrations.microsoft.emailSetup.complete.waiting', { defaultValue: 'Waiting for admin approval' })}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {adminConsentGranted
                      ? t('integrations.microsoft.emailSetup.complete.consentDone', { defaultValue: 'Approved by your Microsoft 365 administrator. You can now connect a mailbox.' })
                      : t('integrations.microsoft.emailSetup.complete.consentPending', { defaultValue: 'A Microsoft 365 administrator for your organization must approve access before mailboxes can connect.' })}
                  </p>
                </AlertDescription>
              </Alert>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
