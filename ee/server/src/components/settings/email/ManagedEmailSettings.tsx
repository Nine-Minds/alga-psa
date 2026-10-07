/**
 * Enterprise Email Settings with managed domain orchestration UI.
 */

'use client';

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import {
  getErrorMessage,
  isActionMessageError,
  type ActionMessageError,
} from '@alga-psa/ui/lib/errorHandling';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Globe, Send, Inbox, Mail, Eye, EyeOff, CheckCircle, XCircle } from 'lucide-react';
import { useTier } from 'server/src/context/TierContext';
import {
  getManagedEmailDomains,
  requestManagedEmailDomain,
  refreshManagedEmailDomain,
  deleteManagedEmailDomain,
  type ManagedDomainStatus,
  type ManagedDomainActionResult,
  type ManagedDomainActionFailure,
} from '@ee/lib/actions/email-actions/managedDomainActions';
import { EmailProviderConfiguration, EmailSenderAddressesCard, EmailSenderCardsProvider, EmailSenderRoutingCard, OutboundEmailDiagnosticsDialog } from '@alga-psa/integrations/components';
import type { TenantEmailSettings } from 'server/src/types/email.types';
import { createDefaultProviderConfig } from '@alga-psa/email/providerConfig';
import { isValidEmail } from '@alga-psa/validation';
import {
  getEmailSettings,
  updateEmailSettings,
  testOutboundEmail,
  getMicrosoftOutboundMailboxes,
  type EmailSettingsView,
  type MicrosoftOutboundMailboxOption,
} from '@alga-psa/integrations/actions';
import ManagedDomainList from './ManagedDomainList';

type OutboundProvider = 'resend' | 'smtp' | 'microsoft';
type EmailSettingsUpdateInput = Omit<Partial<TenantEmailSettings>, 'defaultFromDomain' | 'ticketingFromEmail' | 'ticketingFromName'> & {
  defaultFromDomain?: string | null;
};

type ManagedEmailOverrides = {
  getManagedEmailDomains?: () => Promise<ManagedDomainStatus[] | ManagedDomainActionFailure>;
  requestManagedEmailDomain?: (
    domain: string
  ) => Promise<ManagedDomainActionResult>;
  refreshManagedEmailDomain?: (
    domain: string
  ) => Promise<ManagedDomainActionResult>;
  deleteManagedEmailDomain?: (domain: string) => Promise<ManagedDomainActionResult>;
};

/**
 * Optional runtime overrides for automated UI tests and harnesses.
 *
 * This is intentionally generic and does not depend on Playwright directly.
 * Test suites can attach an implementation to:
 *   window.__ALGA_MANAGED_EMAIL_OVERRIDES__
 * to intercept calls without baking test logic into production code.
 */
function getManagedEmailOverrides(): ManagedEmailOverrides | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const globalWithOverrides = window as typeof window & {
    __ALGA_MANAGED_EMAIL_OVERRIDES__?: ManagedEmailOverrides;
  };

  return globalWithOverrides.__ALGA_MANAGED_EMAIL_OVERRIDES__;
}

function getManagedDomainFailureMessage(result: ManagedDomainActionResult, fallback: string): string {
  return 'error' in result ? result.error || fallback : fallback;
}

function isManagedDomainActionFailure(value: unknown): value is ManagedDomainActionFailure {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as { success?: unknown }).success === false &&
    typeof (value as { error?: unknown }).error === 'string'
  );
}

type EmailSettingsActionResult = EmailSettingsView | ActionMessageError | null;

interface EmailSettingsProps {}

export const ManagedEmailSettings: React.FC<EmailSettingsProps> = () => {
  const { t } = useTranslation('msp/email-providers');
  const { t: adminT } = useTranslation('msp/admin');
  const { isHosted } = useTier();
  const canUseManagedEmail = isHosted;
  const [domains, setDomains] = useState<ManagedDomainStatus[]>([]);
  const [loadingDomains, setLoadingDomains] = useState(canUseManagedEmail);
  const [activeTab, setActiveTab] = useState<'inbound' | 'outbound'>('outbound');
  const [newDomain, setNewDomain] = useState('');
  const [busyDomain, setBusyDomain] = useState<string | null>(null);
  const [overrides] = useState<ManagedEmailOverrides | undefined>(() => getManagedEmailOverrides());
  const [emailSettings, setEmailSettings] = useState<EmailSettingsView | null>(null);
  const [loadingOutbound, setLoadingOutbound] = useState(true);
  const [savingProvider, setSavingProvider] = useState(false);
  const [outboundProvider, setOutboundProvider] = useState<OutboundProvider>(
    canUseManagedEmail ? 'resend' : 'smtp'
  );
  const [microsoftMailboxes, setMicrosoftMailboxes] = useState<MicrosoftOutboundMailboxOption[]>([]);
  const [microsoftMailboxError, setMicrosoftMailboxError] = useState<string | null>(null);
  const [showSmtpPassword, setShowSmtpPassword] = useState(false);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [smtpTestRecipient, setSmtpTestRecipient] = useState('');
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [smtpDirty, setSmtpDirty] = useState(false);
  const [pendingDomainRemoval, setPendingDomainRemoval] = useState<string | null>(null);
  // Provider changes return the configuration required by dependent saves.
  // Keep those operations serialized so the UI cannot submit an older config.
  const outboundBusy = loadingOutbound || savingProvider || savingSmtp || testingSmtp;

  const resolveEmailSettingsResult = (
    result: EmailSettingsActionResult,
    fallback: string
  ): EmailSettingsView | null => {
    if (isActionMessageError(result)) {
      toast.error(getErrorMessage(result) || fallback);
      return null;
    }

    return result;
  };

  useEffect(() => {
    if (!canUseManagedEmail) {
      setDomains([]);
      setLoadingDomains(false);
      return;
    }

    loadDomains();
  }, [canUseManagedEmail]);

  useEffect(() => {
    loadOutboundState();
  }, []);

  const loadDomains = async () => {
    if (!canUseManagedEmail) {
      setDomains([]);
      setLoadingDomains(false);
      return;
    }

    setLoadingDomains(true);
    try {
      const fetcher = overrides?.getManagedEmailDomains ?? getManagedEmailDomains;
      const data = await fetcher();
      if (isManagedDomainActionFailure(data)) {
        setDomains([]);
        toast.error(data.error || t('managed.messages.loadDomainsFailed'));
        return;
      }
      setDomains(data);
    } catch (err: any) {
      console.error(err);
      toast.error(t('managed.messages.loadDomainsFailed'));
    } finally {
      setLoadingDomains(false);
    }
  };

  // Self-hosted tenants have no managed (Resend) option, so an unrecognised
  // stored provider falls back to SMTP rather than something unselectable.
  const resolveOutboundProvider = (stored: string | null | undefined): OutboundProvider => {
    if (stored === 'microsoft') return 'microsoft';
    if (stored === 'smtp') return 'smtp';
    return canUseManagedEmail ? 'resend' : 'smtp';
  };

  const loadOutboundState = async () => {
    setLoadingOutbound(true);
    try {
      const [settingsResult, mailboxResult] = await Promise.all([
        getEmailSettings(),
        getMicrosoftOutboundMailboxes()
      ]);
      const settings = resolveEmailSettingsResult(settingsResult, t('managed.messages.loadOutboundSettingsFailed'));

      if (isActionMessageError(mailboxResult)) {
        setMicrosoftMailboxError(getErrorMessage(mailboxResult));
      } else {
        setMicrosoftMailboxError(null);
        setMicrosoftMailboxes(mailboxResult.mailboxes);
      }

      if (settings) {
        setEmailSettings(settings);
        setOutboundProvider(resolveOutboundProvider(settings.emailProvider));
        setSmtpDirty(false);
      }

    } catch (err: any) {
      console.error('[ManagedEmailSettings] Failed to load outbound settings', err);
      toast.error(t('managed.messages.loadOutboundSettingsFailed'));
    } finally {
      setLoadingOutbound(false);
    }
  };

  const getOutboundDomain = (settings?: TenantEmailSettings | null): string | null => {
    if (settings?.defaultFromDomain) return settings.defaultFromDomain;

    // For SMTP, derive from the SMTP from address
    const smtpFrom = settings?.providerConfigs
      .find(c => c.providerType === 'smtp')?.config.from as string | undefined;
    if (settings?.emailProvider === 'smtp' && smtpFrom) {
      const domain = smtpFrom.trim().split('@').pop()?.toLowerCase();
      if (domain) return domain;
    }

    // For managed/resend, fall back to a verified managed domain
    const verifiedDomain = domains.find((d) => d.status === 'verified')?.domain || null;
    return verifiedDomain;
  };

  const getMicrosoftConfig = () =>
    emailSettings?.providerConfigs.find(c => c.providerType === 'microsoft');

  const microsoftConfigFor = (mailbox: MicrosoftOutboundMailboxOption) => ({
    inboundProviderId: mailbox.providerId,
    mailbox: mailbox.mailbox,
    from: mailbox.mailbox,
    fromName: getMicrosoftConfig()?.config.fromName === undefined
      ? mailbox.senderDisplayName || undefined
      : getMicrosoftConfig()?.config.fromName,
  });

  const handleMicrosoftMailboxSelect = async (providerId: string) => {
    if (!emailSettings || outboundBusy) return;
    const mailbox = microsoftMailboxes.find(option => option.providerId === providerId);
    if (!mailbox) return;

    const providerConfigs = emailSettings.providerConfigs.map(config =>
      config.providerType === 'microsoft'
        ? { ...config, providerId: mailbox.providerId, config: microsoftConfigFor(mailbox) }
        : config
    );

    setSavingProvider(true);
    try {
      const result = await updateEmailSettings({ emailProvider: 'microsoft', providerConfigs });
      const updated = resolveEmailSettingsResult(result, t('managed.messages.switchProviderFailed'));
      if (!updated) return;
      setEmailSettings(updated);
      setSmtpDirty(false);
      toast.success(t('managed.outbound.microsoft.saved', 'Outbound sending mailbox updated.'));
    } catch (err: any) {
      console.error('[ManagedEmailSettings] Failed to select Microsoft mailbox', err);
      toast.error(t('managed.messages.switchProviderFailed'));
    } finally {
      setSavingProvider(false);
    }
  };

  const handleProviderSwitch = async (provider: OutboundProvider) => {
    if (!emailSettings || outboundBusy) return;
    setOutboundProvider(provider);

    const updatedSettings: Partial<TenantEmailSettings> = {
      emailProvider: provider,
      providerConfigs: emailSettings.providerConfigs.map(config => ({
        ...config,
        isEnabled: config.providerType === provider
      }))
    };

    // Ensure a config entry exists for the selected provider
    const hasProvider = emailSettings.providerConfigs.some(c => c.providerType === provider);
    if (!hasProvider) {
      const newConfig = createDefaultProviderConfig(provider, { isEnabled: true });
      updatedSettings.providerConfigs = [...(updatedSettings.providerConfigs || []), newConfig];
    }

    // updateEmailSettings rejects a Microsoft selection that names no mailbox,
    // so carry the current choice (or the first connected one) into the switch.
    if (provider === 'microsoft') {
      const existing = updatedSettings.providerConfigs?.find(c => c.providerType === 'microsoft');
      const mailbox = microsoftMailboxes.find(m => m.providerId === existing?.config?.inboundProviderId)
        || microsoftMailboxes.find(m => m.status === 'connected');
      if (!mailbox) {
        toast.error(t('managed.outbound.microsoft.noneConnected', 'Authorize a Microsoft 365 mailbox on the Inbound Email tab first.'));
        setOutboundProvider(resolveOutboundProvider(emailSettings.emailProvider));
        return;
      }
      updatedSettings.providerConfigs = (updatedSettings.providerConfigs || []).map(config =>
        config.providerType === 'microsoft'
          ? { ...config, providerId: mailbox.providerId, config: microsoftConfigFor(mailbox) }
          : config
      );
    }

    setSavingProvider(true);
    try {
      const updatedResult = await updateEmailSettings(updatedSettings);
      const updated = resolveEmailSettingsResult(updatedResult, t('managed.messages.switchProviderFailed'));
      if (!updated) {
        setOutboundProvider(resolveOutboundProvider(emailSettings.emailProvider));
        return;
      }
      setEmailSettings(updated);
      setSmtpDirty(false);
    } catch (err: any) {
      console.error('[ManagedEmailSettings] Failed to switch provider', err);
      toast.error(t('managed.messages.switchProviderFailed'));
      // Revert UI selection
      setOutboundProvider(resolveOutboundProvider(emailSettings.emailProvider));
    } finally {
      setSavingProvider(false);
    }
  };

  const getSmtpConfig = () => {
    return emailSettings?.providerConfigs.find(c => c.providerType === 'smtp');
  };

  const updateSmtpField = (field: string, value: string | number | boolean) => {
    if (!emailSettings) return;
    const smtpConfig = getSmtpConfig();
    const providerConfigs = smtpConfig
      ? emailSettings.providerConfigs
      : [...emailSettings.providerConfigs, createDefaultProviderConfig('smtp', { isEnabled: true })];

    const updatedConfigs = providerConfigs.map(config =>
      config.providerType === 'smtp'
        ? { ...config, config: { ...config.config, [field]: value } }
        : config
    );
    setEmailSettings({ ...emailSettings, providerConfigs: updatedConfigs });
    setSmtpDirty(true);
  };

  const persistSmtpSettings = async (): Promise<TenantEmailSettings | null> => {
    if (!emailSettings) return null;
    const existingSmtpConfig = getSmtpConfig();
    const smtpConfig = existingSmtpConfig
      ?? createDefaultProviderConfig('smtp', { isEnabled: true });

    const { host, from } = smtpConfig.config;
    if (!host?.trim()) {
      toast.error(t('managed.messages.smtpHostRequired'));
      return null;
    }
    if (!from?.trim()) {
      toast.error(t('managed.messages.fromAddressRequired'));
      return null;
    }
    // A junk address here poisons defaultFromDomain (derived below by splitting
    // on '@'), which then leaks into every synthesized fallback sender.
    if (!isValidEmail(from)) {
      toast.error(t('managed.validation.invalidEmail'));
      return null;
    }

    const providerConfigs = (existingSmtpConfig
      ? emailSettings.providerConfigs
      : [...emailSettings.providerConfigs, smtpConfig]
    ).map(config => ({
      ...config,
      isEnabled: config.providerType === 'smtp',
    }));

    const updatedResult = await updateEmailSettings({
      emailProvider: 'smtp',
      providerConfigs,
      defaultFromDomain: from.trim().split('@').pop() || emailSettings.defaultFromDomain
    });
    const updated = resolveEmailSettingsResult(updatedResult, t('managed.messages.smtpSaveFailed'));
    if (!updated) {
      return null;
    }

    setEmailSettings(updated);
    setSmtpDirty(false);
    return updated;
  };

  const handleSaveSmtp = async () => {
    setSavingSmtp(true);
    try {
      const updated = await persistSmtpSettings();
      if (updated) {
        toast.success(t('managed.messages.smtpSaved'));
      }
    } catch (err: any) {
      console.error('[ManagedEmailSettings] Failed to save SMTP settings', err);
      toast.error(t('managed.messages.smtpSaveFailed'));
    } finally {
      setSavingSmtp(false);
    }
  };

  const handleTestSmtp = async () => {
    setTestingSmtp(true);
    setSmtpTestResult(null);
    try {
      // Persist current edits first so the test reflects what's on screen.
      // The masked password ('***') is resolved to the stored secret server-side.
      const updated = await persistSmtpSettings();
      if (!updated) return;
      const result = await testOutboundEmail(smtpTestRecipient.trim() || undefined);
      setSmtpTestResult(result);
    } catch (err: any) {
      console.error('[ManagedEmailSettings] Failed to test outbound email', err);
      setSmtpTestResult({
        success: false,
        error: err?.message || t('managed.messages.testOutboundFailed')
      });
    } finally {
      setTestingSmtp(false);
    }
  };

  const handleAddDomain = async () => {
    if (!newDomain.trim()) {
      toast.error(t('managed.messages.domainRequired'));
      return;
    }

    setBusyDomain(newDomain.trim());
    try {
      const requester = overrides?.requestManagedEmailDomain ?? requestManagedEmailDomain;
      const result = await requester(newDomain.trim());
      if (!result.success) {
        toast.error(getManagedDomainFailureMessage(result, t('managed.messages.domainRequestFailed')));
        return;
      }
      toast.success(t('managed.messages.domainSubmitted'));
      setNewDomain('');
      await loadDomains();
    } catch (err: any) {
      console.error(err);
      toast.error(t('managed.messages.domainRequestFailed'));
    } finally {
      setBusyDomain(null);
    }
  };

  const handleRefreshDomain = async (domain: string) => {
    setBusyDomain(domain);
    try {
      const refresher = overrides?.refreshManagedEmailDomain ?? refreshManagedEmailDomain;
      const result = await refresher(domain);
      if (!result.success) {
        toast.error(getManagedDomainFailureMessage(result, t('managed.messages.refreshStatusFailed')));
        return;
      }
      toast.success(t('managed.messages.verificationRecheckScheduled'));
      await loadDomains();
    } catch (err: any) {
      console.error(err);
      toast.error(t('managed.messages.refreshStatusFailed'));
    } finally {
      setBusyDomain(null);
    }
  };

  const handleDeleteDomain = async () => {
    if (!pendingDomainRemoval) {
      return;
    }

    const domain = pendingDomainRemoval;
    const removesActiveOutboundDomain =
      emailSettings?.defaultFromDomain?.trim().toLowerCase() === domain.trim().toLowerCase();

    setBusyDomain(domain);
    try {
      const deleter = overrides?.deleteManagedEmailDomain ?? deleteManagedEmailDomain;
      const result = await deleter(domain);
      if (!result.success) {
        toast.error(getManagedDomainFailureMessage(result, t('managed.messages.removeDomainFailed')));
        return;
      }

      if (emailSettings && removesActiveOutboundDomain) {
        const updatedSettingsResult = await updateEmailSettings({
          defaultFromDomain: removesActiveOutboundDomain ? null : emailSettings.defaultFromDomain,
        } satisfies EmailSettingsUpdateInput);
        const updatedSettings = resolveEmailSettingsResult(
          updatedSettingsResult,
          t('managed.messages.removeDomainFailed')
        );
        if (!updatedSettings) {
          return;
        }

        setEmailSettings(updatedSettings);
      }

      setPendingDomainRemoval(null);
      toast.success(t('managed.messages.domainRemovalScheduled'));
      await loadDomains();
    } catch (err: any) {
      console.error(err);
      toast.error(t('managed.messages.removeDomainFailed'));
    } finally {
      setBusyDomain(null);
    }
  };

  const outboundDomain = getOutboundDomain(emailSettings);
  const microsoftMailbox = getMicrosoftConfig()?.config.mailbox?.trim() || '';

  return (
    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'inbound' | 'outbound')} className="w-full">
      <TabsList className="grid w-full grid-cols-2 mb-6">
        <TabsTrigger value="inbound" className="flex items-center gap-2">
          <Inbox className="h-4 w-4" />
          {t('managed.tabs.inboundEmail')}
        </TabsTrigger>
        <TabsTrigger value="outbound" className="flex items-center gap-2">
          <Send className="h-4 w-4" />
          {t('managed.tabs.outboundEmail')}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="outbound" className="space-y-6">
        <div className="text-sm text-muted-foreground mb-4">
          {t('managed.outbound.intro')}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              {t('managed.outbound.providerTitle')}
            </CardTitle>
            <CardDescription>
              {t('managed.outbound.providerDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CustomSelect
              id="outbound-provider-select"
              value={outboundProvider}
              disabled={outboundBusy}
              onValueChange={(val: string) => handleProviderSwitch(val as OutboundProvider)}
              options={[
                ...(canUseManagedEmail
                  ? [{ value: 'resend', label: t('managed.outbound.providerOptions.resend') }]
                  : []),
                { value: 'smtp', label: t('managed.outbound.providerOptions.smtp') },
                {
                  value: 'microsoft',
                  label: t('managed.outbound.providerOptions.microsoft', 'Microsoft 365 (Microsoft Graph)')
                }
              ]}
              placeholder={t('managed.outbound.providerPlaceholder')}
            />
            <p className="text-sm text-muted-foreground mt-2">
              {outboundProvider === 'resend'
                ? t('managed.outbound.resendDescription')
                : outboundProvider === 'microsoft'
                ? t('managed.outbound.microsoft.description', 'Messages are sent as the selected mailbox through Microsoft Graph and saved to Sent Items.')
                : t('managed.outbound.smtpDescription')}
            </p>
          </CardContent>
        </Card>

        {outboundProvider === 'resend' && canUseManagedEmail && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                {t('managed.outbound.domainsTitle')}
              </CardTitle>
              <CardDescription>
                {t('managed.outbound.domainsDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="managed-domain-input">{t('managed.outbound.domainLabel')}</Label>
                  <Input
                    id="managed-domain-input"
                    placeholder={t('managed.outbound.domainPlaceholder')}
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  id="add-managed-domain-button"
                  onClick={handleAddDomain}
                  disabled={!newDomain.trim() || busyDomain !== null}
                >
                  {t('managed.outbound.addDomainButton')}
                </Button>
              </div>

              <ManagedDomainList
                domains={domains}
                loading={loadingDomains}
                busyDomain={busyDomain}
                onRefresh={handleRefreshDomain}
                onDelete={(domain) => setPendingDomainRemoval(domain)}
              />
            </CardContent>
          </Card>
        )}

        {outboundProvider === 'microsoft' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                {t('managed.outbound.microsoft.configTitle', 'Microsoft 365 Configuration')}
              </CardTitle>
              <CardDescription>
                {t('managed.outbound.microsoft.configDescription', 'Choose which authorized Microsoft 365 mailbox sends outbound email.')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="microsoft-outbound-mailbox">
                  {t('managed.outbound.microsoft.mailboxLabel', 'Sending Mailbox')}
                </Label>
                <CustomSelect
                  id="microsoft-outbound-mailbox"
                  value={getMicrosoftConfig()?.config?.inboundProviderId || ''}
                  disabled={outboundBusy || microsoftMailboxes.length === 0}
                  onValueChange={handleMicrosoftMailboxSelect}
                  options={microsoftMailboxes.map(mailbox => ({
                    value: mailbox.providerId,
                    label: `${mailbox.providerName} — ${mailbox.mailbox}${mailbox.status === 'connected' ? '' : ` (${mailbox.status})`}`
                  }))}
                  placeholder={t('managed.outbound.microsoft.mailboxPlaceholder', 'Select a connected Microsoft 365 mailbox')}
                />
              </div>
              {microsoftMailboxError ? (
                <p className="text-sm text-red-600 dark:text-red-400">{microsoftMailboxError}</p>
              ) : microsoftMailboxes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('managed.outbound.microsoft.none', 'Add and authorize a Microsoft 365 provider on the Inbound Email tab first.')}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t('managed.outbound.microsoft.help', 'Messages are sent as this mailbox through Microsoft Graph and saved to Sent Items. Reconnect existing mailboxes to grant Mail.Send.')}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {outboundProvider === 'smtp' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                {t('managed.outbound.smtpConfigTitle')}
              </CardTitle>
              <CardDescription>
                {t('managed.outbound.smtpConfigDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {(() => {
                const smtpConfig = getSmtpConfig();
                return (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="smtp-host">{t('managed.outbound.smtp.hostLabel')}</Label>
                        <Input
                          id="smtp-host"
                          value={smtpConfig?.config.host || ''}
                          placeholder={t('managed.outbound.smtp.hostPlaceholder')}
                          onChange={(e) => updateSmtpField('host', e.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="smtp-port">{t('managed.outbound.smtp.portLabel')}</Label>
                        <Input
                          id="smtp-port"
                          type="number"
                          value={smtpConfig?.config.port || 587}
                          placeholder="587"
                          onChange={(e) => updateSmtpField('port', parseInt(e.target.value) || 587)}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="smtp-username">{t('managed.outbound.smtp.usernameLabel')}</Label>
                        <Input
                          id="smtp-username"
                          value={smtpConfig?.config.username || ''}
                          placeholder={t('managed.outbound.smtp.usernamePlaceholder')}
                          onChange={(e) => updateSmtpField('username', e.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="smtp-password">{t('managed.outbound.smtp.passwordLabel')}</Label>
                        <div className="relative">
                          <Input
                            id="smtp-password"
                            type={showSmtpPassword ? 'text' : 'password'}
                            value={smtpConfig?.config.password === '***' ? '' : smtpConfig?.config.password || ''}
                            placeholder={t('managed.outbound.smtp.passwordPlaceholder')}
                            onChange={(e) => updateSmtpField('password', e.target.value)}
                          />
                          <button
                            type="button"
                            className="absolute inset-y-0 right-0 pr-3 flex items-center"
                            onClick={() => setShowSmtpPassword(!showSmtpPassword)}
                          >
                            {showSmtpPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                    </div>

                    <p className="text-sm text-muted-foreground">
                      {t('managed.outbound.smtp.authHint')}
                    </p>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="smtp-from">{t('managed.outbound.smtp.fromLabel')}</Label>
                        <Input
                          id="smtp-from"
                          type="email"
                          value={smtpConfig?.config.from || ''}
                          placeholder={t('managed.outbound.smtp.fromPlaceholder')}
                          onChange={(e) => updateSmtpField('from', e.target.value)}
                        />
                        <p className="text-sm text-muted-foreground mt-1">
                          {t('managed.outbound.smtp.fromHelp')}
                        </p>
                      </div>
                      <div>
                        <Label htmlFor="smtp-from-name">
                          {adminT('email.senderIdentities.notification.nameLabel')}
                        </Label>
                        <Input
                          id="smtp-from-name"
                          value={smtpConfig?.config.fromName || ''}
                          placeholder={adminT('email.senderIdentities.notification.namePlaceholder')}
                          onChange={(e) => updateSmtpField('fromName', e.target.value)}
                        />
                        <p className="text-sm text-muted-foreground mt-1">
                          {adminT('email.senderIdentities.notification.nameHelp', {
                            company: emailSettings?.tenantCompanyName
                              || adminT('email.senderIdentities.notification.companyFallback'),
                          })}
                        </p>
                      </div>
                    </div>

                    <div className="border-t pt-4 space-y-4">
                      <h4 className="text-sm font-medium">
                        {t('managed.outbound.smtp.security.title')}
                      </h4>

                      <div className="flex items-center space-x-2">
                        <Switch
                          id="smtp-secure"
                          checked={smtpConfig?.config.secure ?? (Number(smtpConfig?.config.port) === 465)}
                          onCheckedChange={(checked: boolean) => updateSmtpField('secure', checked)}
                        />
                        <Label htmlFor="smtp-secure">
                          {t('managed.outbound.smtp.security.secure')}
                        </Label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Switch
                          id="smtp-require-tls"
                          checked={smtpConfig?.config.requireTLS ?? false}
                          onCheckedChange={(checked: boolean) => updateSmtpField('requireTLS', checked)}
                        />
                        <Label htmlFor="smtp-require-tls">
                          {t('managed.outbound.smtp.security.requireTls')}
                        </Label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Switch
                          id="smtp-reject-unauthorized"
                          checked={smtpConfig?.config.rejectUnauthorized !== false}
                          onCheckedChange={(checked: boolean) => updateSmtpField('rejectUnauthorized', checked)}
                        />
                        <Label htmlFor="smtp-reject-unauthorized">
                          {t('managed.outbound.smtp.security.verifyCert')}
                        </Label>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t('managed.outbound.smtp.security.verifyCertHint')}
                      </p>
                    </div>

                    <div className="flex justify-end">
                      <Button
                        id="save-smtp-settings"
                        onClick={handleSaveSmtp}
                        disabled={outboundBusy}
                      >
                        {savingSmtp ? t('managed.outbound.smtp.savingButton') : t('managed.outbound.smtp.saveButton')}
                      </Button>
                    </div>

                    <div className="border-t pt-4 space-y-4">
                      <h4 className="text-sm font-medium flex items-center gap-2">
                        <Send className="h-4 w-4" />
                        {t('managed.outbound.smtp.test.title')}
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        {t('managed.outbound.smtp.test.description')}
                      </p>
                      <div className="flex items-end gap-2">
                        <div className="flex-1">
                          <Label htmlFor="test-recipient">
                            {t('managed.outbound.smtp.test.recipientLabel')}
                          </Label>
                          <Input
                            id="test-recipient"
                            type="email"
                            value={smtpTestRecipient}
                            placeholder={t('managed.outbound.smtp.test.recipientPlaceholder')}
                            onChange={(e) => setSmtpTestRecipient(e.target.value)}
                          />
                        </div>
                        <Button
                          id="test-outbound-email"
                          variant="outline"
                          onClick={handleTestSmtp}
                          disabled={outboundBusy}
                        >
                          {testingSmtp
                            ? t('managed.outbound.smtp.test.testingButton')
                            : t('managed.outbound.smtp.test.runButton')}
                        </Button>
                      </div>
                      {smtpTestResult && (
                        <div className={`flex items-start gap-2 text-sm ${smtpTestResult.success ? 'text-green-600' : 'text-red-600'}`}>
                          {smtpTestResult.success
                            ? <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
                            : <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
                          <span>{smtpTestResult.success ? smtpTestResult.message : smtpTestResult.error}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}

        {emailSettings && (
          <EmailSenderCardsProvider>
          <div className="space-y-4">
            <EmailSenderAddressesCard
              transport={outboundProvider}
              verifiedDomains={domains.filter((domain) => domain.status === 'verified').map((domain) => domain.domain)}
              microsoftMailboxes={microsoftMailboxes.map((mailbox) => ({ providerId: mailbox.providerId, mailbox: mailbox.mailbox, providerName: mailbox.providerName }))}
            />
            <EmailSenderRoutingCard transport={outboundProvider} />
          </div>
          </EmailSenderCardsProvider>
        )}

        {emailSettings && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                {t('managed.outbound.diagnosticsButton', 'Run Outbound Diagnostics')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                id="open-outbound-diagnostics"
                variant="outline"
                onClick={() => setDiagnosticsOpen(true)}
                disabled={outboundBusy || smtpDirty}
                aria-describedby="outbound-diagnostics-save-help"
              >
                <Send className="h-4 w-4 mr-2" />
                {t('managed.outbound.diagnosticsButton', 'Run Outbound Diagnostics')}
              </Button>
              {smtpDirty && (
                <p id="outbound-diagnostics-save-help" className="text-sm text-muted-foreground">
                  {t('managed.outbound.diagnosticsSaveHelp', { defaultValue: 'Save or discard your changes before checking the outbound settings.' })}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <OutboundEmailDiagnosticsDialog
          isOpen={diagnosticsOpen}
          onClose={() => setDiagnosticsOpen(false)}
          hasUnsavedChanges={smtpDirty}
        />
      </TabsContent>

      <TabsContent value="inbound" className="space-y-6">
        <div className="text-sm text-muted-foreground mb-4">
          {t('managed.inbound.intro')}
        </div>
        <EmailProviderConfiguration />
      </TabsContent>
      <ConfirmationDialog
        isOpen={!!pendingDomainRemoval}
        onClose={() => setPendingDomainRemoval(null)}
        onConfirm={handleDeleteDomain}
        title={t('managed.dialogs.removeDomain.title')}
        message={
          pendingDomainRemoval && emailSettings?.defaultFromDomain?.trim().toLowerCase() === pendingDomainRemoval.trim().toLowerCase()
            ? t('managed.dialogs.removeDomain.messageWithClear', { domain: pendingDomainRemoval })
            : t('managed.dialogs.removeDomain.message', { domain: pendingDomainRemoval ?? t('managed.dialogs.removeDomain.fallbackDomain') })
        }
        confirmLabel={t('managed.dialogs.removeDomain.confirm')}
        cancelLabel={t('managed.dialogs.cancel')}
        isConfirming={Boolean(pendingDomainRemoval && busyDomain === pendingDomainRemoval)}
        id="managed-email-remove-domain"
      />
    </Tabs>
  );
};

export default ManagedEmailSettings;
