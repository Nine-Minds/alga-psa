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
  getMicrosoftEmailSetupOptions,
  type MicrosoftEmailSetupCompletionResult,
  type MicrosoftEmailSetupOptionsResult,
  configureMicrosoftEmailPlatformApplication,
} from '../../../actions/integrations/microsoftEmailSetupActions';
import { CheckCircle2, Copy, ExternalLink, KeyRound, Settings2, WandSparkles } from 'lucide-react';

type SetupStep = 'choose' | 'platform' | 'automated' | 'complete';

interface MicrosoftEmailSetupDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCompleted: () => void | Promise<void>;
  onManualSetup: () => void;
}

export function MicrosoftEmailSetupDialog({
  isOpen,
  onClose,
  onCompleted,
  onManualSetup,
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
  const [completion, setCompletion] = React.useState<MicrosoftEmailSetupCompletionResult | null>(null);
  const [adminConsentGranted, setAdminConsentGranted] = React.useState(false);
  const adminConsentUrl = completion?.adminConsentUrl;

  React.useEffect(() => {
    if (!isOpen) return;
    setStep('choose');
    setError(null);
    setCompletion(null);
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
      setWorking(false);
      if (!event.data.success) {
        setError(event.data.error || t('integrations.microsoft.emailSetup.errors.generic', { defaultValue: 'Microsoft Email setup did not complete.' }));
        return;
      }
      if (event.data.stage === 'admin_consent') {
        setAdminConsentGranted(true);
        toast({
          title: t('integrations.microsoft.emailSetup.consent.confirmedTitle', { defaultValue: 'Administrator consent confirmed' }),
          description: t('integrations.microsoft.emailSetup.consent.confirmedDescription', { defaultValue: 'The Microsoft app is ready for mailbox authorization.' }),
        });
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
  }, [isOpen, onCompleted, t, toast]);

  const copyValue = React.useCallback(async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    toast({
      title: t('integrations.microsoft.emailSetup.copied', { defaultValue: '{{label}} copied', label }),
    });
  }, [t, toast]);

  const openPopup = React.useCallback((url: string) => {
    const popup = window.open(url, 'microsoft-email-setup', 'width=720,height=760,noopener=false');
    if (!popup) {
      setError(t('integrations.microsoft.emailSetup.errors.popupBlocked', { defaultValue: 'Allow popups for this site, then try again.' }));
      return false;
    }
    popup.focus();
    return true;
  }, [t]);

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

  const startAdminConsent = React.useCallback(() => {
    if (adminConsentUrl) openPopup(adminConsentUrl);
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
        <Button id="microsoft-email-admin-consent-button" type="button" onClick={startAdminConsent}>
          <ExternalLink className="mr-2 h-4 w-4" />
          {t('integrations.microsoft.emailSetup.actions.grantConsent', { defaultValue: 'Grant administrator consent' })}
        </Button>
      )}
      <Button id="microsoft-email-setup-finish-button" type="button" variant="outline" onClick={close}>
        {t('integrations.microsoft.emailSetup.actions.finish', { defaultValue: 'Finish' })}
      </Button>
    </div>
  ) : (
    <div className="flex justify-between gap-2">
      <Button id="microsoft-email-setup-back-button" type="button" variant="outline" onClick={() => { setStep('choose'); setError(null); }} disabled={working}>
        {t('integrations.microsoft.emailSetup.actions.back', { defaultValue: 'Back' })}
      </Button>
      <Button
        id={step === 'platform' ? 'microsoft-email-platform-continue-button' : 'microsoft-email-automated-continue-button'}
        type="button"
        onClick={() => void (step === 'platform' ? configurePlatformApplication() : startAutomatedCreation())}
        disabled={working}
      >
        {working
          ? t('integrations.microsoft.emailSetup.actions.working', { defaultValue: 'Working…' })
          : step === 'platform'
            ? t('integrations.microsoft.emailSetup.actions.savePlatform', { defaultValue: 'Create profile and continue' })
            : t('integrations.microsoft.emailSetup.actions.signIn', { defaultValue: 'Sign in to Microsoft' })}
      </Button>
    </div>
  );

  return (
    <Dialog
      id="microsoft-email-setup-dialog"
      isOpen={isOpen}
      onClose={close}
      title={t('integrations.microsoft.emailSetup.title', { defaultValue: 'Set up Microsoft Email' })}
      className="max-w-2xl"
      footer={footer}
    >
      <DialogContent>
        <div className="space-y-5">
          <div>
            <p className="text-sm text-[rgb(var(--color-text-700))]">
              {t('integrations.microsoft.emailSetup.description', { defaultValue: 'Choose how to configure the Microsoft app used for inbound email. Mailbox authorization remains a separate final step.' })}
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
              <button
                id="microsoft-email-choose-platform-button"
                type="button"
                className="rounded-lg border bg-[rgb(var(--color-card))] p-4 text-left transition-colors hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!options?.platformApplication?.available}
                onClick={() => setStep('platform')}
              >
                <div className="flex items-start gap-3">
                  <KeyRound className="mt-0.5 h-5 w-5 text-primary-500" />
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {t('integrations.microsoft.emailSetup.platform.title', { defaultValue: 'Use the Alga platform app' })}
                      {!options?.platformApplication?.available && <Badge variant="secondary">{t('integrations.microsoft.emailSetup.unavailable', { defaultValue: 'Unavailable' })}</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t('integrations.microsoft.emailSetup.platform.description', { defaultValue: 'Create an Email-bound profile from the server-managed multi-tenant app, then grant tenant administrator consent.' })}
                    </p>
                  </div>
                </div>
              </button>

              <button
                id="microsoft-email-choose-automated-button"
                type="button"
                className="rounded-lg border bg-[rgb(var(--color-card))] p-4 text-left transition-colors hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!options?.automatedCreationAvailable}
                onClick={() => setStep('automated')}
              >
                <div className="flex items-start gap-3">
                  <WandSparkles className="mt-0.5 h-5 w-5 text-primary-500" />
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {t('integrations.microsoft.emailSetup.automated.title', { defaultValue: 'Create an app in this tenant' })}
                      {!options?.automatedCreationAvailable && <Badge variant="secondary">{t('integrations.microsoft.emailSetup.unavailable', { defaultValue: 'Unavailable' })}</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t('integrations.microsoft.emailSetup.automated.description', { defaultValue: 'Sign in as a Microsoft administrator. Alga creates the app, service principal, secret, Email profile, and binding.' })}
                    </p>
                  </div>
                </div>
              </button>

              <button
                id="microsoft-email-choose-manual-button"
                type="button"
                className="rounded-lg border bg-[rgb(var(--color-card))] p-4 text-left transition-colors hover:bg-muted/30"
                onClick={onManualSetup}
              >
                <div className="flex items-start gap-3">
                  <Settings2 className="mt-0.5 h-5 w-5 text-primary-500" />
                  <div className="space-y-1">
                    <div className="font-medium">{t('integrations.microsoft.emailSetup.manual.title', { defaultValue: 'Enter an existing app manually' })}</div>
                    <p className="text-sm text-muted-foreground">{t('integrations.microsoft.emailSetup.manual.description', { defaultValue: 'Keep using the existing client ID, tenant ID, and client secret form.' })}</p>
                  </div>
                </div>
              </button>
            </div>
          ) : step === 'platform' || step === 'automated' ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="microsoft-email-setup-display-name-input">{t('integrations.microsoft.emailSetup.fields.displayName', { defaultValue: 'Profile display name' })}</Label>
                <Input id="microsoft-email-setup-display-name-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              </div>
              {step === 'platform' && (
                <div className="space-y-2">
                  <Label htmlFor="microsoft-email-setup-tenant-input">{t('integrations.microsoft.emailSetup.fields.tenant', { defaultValue: 'Microsoft tenant ID or verified domain' })}</Label>
                  <Input id="microsoft-email-setup-tenant-input" value={tenantId} onChange={(event) => setTenantId(event.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                </div>
              )}
              <div className="rounded-lg border bg-muted/10 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('integrations.microsoft.emailSetup.callbackUri', { defaultValue: 'Mailbox callback URI' })}</div>
                <div className="mt-2 break-all font-mono text-xs">{options?.callbackUri}</div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  <div className="font-medium">{t('integrations.microsoft.emailSetup.complete.profileCreated', { defaultValue: 'Microsoft Email profile created and bound' })}</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {adminConsentGranted
                      ? t('integrations.microsoft.emailSetup.complete.consentDone', { defaultValue: 'Administrator consent is confirmed. Return to Inbound Email and authorize the mailbox.' })
                      : t('integrations.microsoft.emailSetup.complete.consentPending', { defaultValue: 'Next, a Microsoft tenant administrator must grant consent. Mailbox authorization happens afterward in Inbound Email.' })}
                  </p>
                </AlertDescription>
              </Alert>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border bg-muted/10 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('integrations.microsoft.emailSetup.fields.clientId', { defaultValue: 'Client ID' })}</div>
                  <div className="mt-2 break-all font-mono text-xs">{completion?.clientId}</div>
                </div>
                <div className="rounded-lg border bg-muted/10 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('integrations.microsoft.emailSetup.fields.tenantId', { defaultValue: 'Tenant ID' })}</div>
                  <div className="mt-2 break-all font-mono text-xs">{completion?.tenantId}</div>
                </div>
              </div>
              {adminConsentUrl && (
                <div className="rounded-lg border bg-muted/10 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('integrations.microsoft.emailSetup.consent.url', { defaultValue: 'Administrator consent URL' })}</div>
                    <Button id="microsoft-email-copy-consent-url-button" type="button" variant="ghost" size="sm" onClick={() => void copyValue(adminConsentUrl, t('integrations.microsoft.emailSetup.consent.urlLabel', { defaultValue: 'Consent URL' }))}>
                      <Copy className="mr-2 h-3.5 w-3.5" />{t('integrations.microsoft.emailSetup.actions.copy', { defaultValue: 'Copy' })}
                    </Button>
                  </div>
                  <div className="mt-2 break-all font-mono text-xs">{adminConsentUrl}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
