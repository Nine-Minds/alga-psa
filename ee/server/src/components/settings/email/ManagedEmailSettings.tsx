/**
 * Enterprise Email Settings with managed domain orchestration UI.
 */

'use client';

import React, { useState, useEffect, useRef } from 'react';
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
import { Globe, Send, Inbox, Mail, Eye, EyeOff } from 'lucide-react';
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
import { EmailProviderConfiguration, EmailSenderIdentityCards, OutboundEmailDiagnosticsDialog } from '@alga-psa/integrations/components';
import type { EmailProvider } from '@alga-psa/integrations/components';
import type { TenantEmailSettings } from 'server/src/types/email.types';
import { createDefaultProviderConfig } from '@alga-psa/email/providerConfig';
import { isValidEmail } from '@alga-psa/validation';
import {
  getEmailSettings,
  updateEmailSettings,
  getEmailProviders,
  getMicrosoftOutboundMailboxes,
  type EmailSettingsView,
  type MicrosoftOutboundMailboxOption,
} from '@alga-psa/integrations/actions';
import ManagedDomainList from './ManagedDomainList';

type OutboundProvider = 'resend' | 'smtp' | 'microsoft';
type EmailSettingsUpdateInput = Omit<Partial<TenantEmailSettings>, 'defaultFromDomain' | 'ticketingFromEmail' | 'ticketingFromName'> & {
  defaultFromDomain?: string | null;
  ticketingFromEmail?: string | null;
  ticketingFromName?: string | null;
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

function extractEmailDomain(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const parts = trimmed.split('@');
  if (parts.length !== 2) {
    return null;
  }

  return parts[1]?.trim().toLowerCase() || null;
}

export const ManagedEmailSettings: React.FC<EmailSettingsProps> = () => {
  const { t } = useTranslation('msp/email-providers');
  const { isHosted } = useTier();
  const canUseManagedEmail = isHosted;
  const [domains, setDomains] = useState<ManagedDomainStatus[]>([]);
  const [loadingDomains, setLoadingDomains] = useState(canUseManagedEmail);
  const [activeTab, setActiveTab] = useState<'inbound' | 'outbound'>('outbound');
  const [newDomain, setNewDomain] = useState('');
  const [busyDomain, setBusyDomain] = useState<string | null>(null);
  const [overrides] = useState<ManagedEmailOverrides | undefined>(() => getManagedEmailOverrides());
  const [emailSettings, setEmailSettings] = useState<EmailSettingsView | null>(null);
  const [savedEmailSettings, setSavedEmailSettings] = useState<EmailSettingsView | null>(null);
  const saveInFlight = useRef(false);
  const [inboundProviders, setInboundProviders] = useState<EmailProvider[]>([]);
  const [ticketingFromCustom, setTicketingFromCustom] = useState('');
  const [ticketingFromName, setTicketingFromName] = useState('');
  const [ticketingFromError, setTicketingFromError] = useState<string | null>(null);
  const [ticketingFromWarning, setTicketingFromWarning] = useState<string | null>(null);
  const [savingOutbound, setSavingOutbound] = useState(false);
  const [showClearTicketingFromDialog, setShowClearTicketingFromDialog] = useState(false);
  const [loadingOutbound, setLoadingOutbound] = useState(true);
  const [outboundProvider, setOutboundProvider] = useState<OutboundProvider>(
    canUseManagedEmail ? 'resend' : 'smtp'
  );
  const [microsoftMailboxes, setMicrosoftMailboxes] = useState<MicrosoftOutboundMailboxOption[]>([]);
  const [microsoftMailboxError, setMicrosoftMailboxError] = useState<string | null>(null);
  const [showSmtpPassword, setShowSmtpPassword] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [pendingDomainRemoval, setPendingDomainRemoval] = useState<string | null>(null);
  const outboundBusy = loadingOutbound || savingOutbound || busyDomain !== null;
  const hasUnsavedChanges = Boolean(emailSettings && savedEmailSettings && (
    outboundProvider !== resolveOutboundProvider(savedEmailSettings.emailProvider)
    || JSON.stringify(emailSettings.providerConfigs) !== JSON.stringify(savedEmailSettings.providerConfigs)
    || ticketingFromCustom.trim() !== (savedEmailSettings.ticketingFromEmail?.trim() || '')
    || ticketingFromName.trim() !== (savedEmailSettings.ticketingFromName?.trim() || '')
  ));

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [hasUnsavedChanges]);

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
  function resolveOutboundProvider(stored: string | null | undefined): OutboundProvider {
    if (stored === 'microsoft') return 'microsoft';
    if (stored === 'smtp') return 'smtp';
    return canUseManagedEmail ? 'resend' : 'smtp';
  };

  const loadOutboundState = async () => {
    setLoadingOutbound(true);
    try {
      const [settingsResult, providerResult, mailboxResult] = await Promise.all([
        getEmailSettings(),
        getEmailProviders(),
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
        setSavedEmailSettings(settings);
        setOutboundProvider(resolveOutboundProvider(settings.emailProvider));
      }

      const providers = providerResult?.providers || [];
      setInboundProviders(providers);
      initializeTicketingFromSelection(settings, providers);
    } catch (err: any) {
      console.error('[ManagedEmailSettings] Failed to load outbound settings', err);
      toast.error(t('managed.messages.loadOutboundSettingsFailed'));
    } finally {
      setLoadingOutbound(false);
    }
  };

  const getOutboundDomain = (settings?: TenantEmailSettings | null): string | null => {
    if (settings?.emailProvider === 'microsoft') {
      return extractEmailDomain(settings.providerConfigs.find(config => config.providerType === 'microsoft')?.config.mailbox);
    }
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

  const validateTicketingFrom = (value: string, outboundDomain?: string | null, provider = outboundProvider, selectedMailbox = getMicrosoftConfig()?.config.mailbox?.trim()): string | null => {
    // The ticketing From address is optional: an empty value means "use the
    // default sender address" and only the display name (if configured) is
    // applied. Address-format checks below only run when a value is present.
    if (!value || !value.trim()) {
      return null;
    }

    if (provider === 'smtp') return isValidEmail(value.trim()) ? null : t('managed.validation.invalidEmail');

    if (!outboundDomain) {
      return t('managed.validation.addOutboundFirst');
    }

    const trimmed = value.trim();
    if (!isValidEmail(trimmed)) {
      return t('managed.validation.invalidEmail');
    }

    if (provider === 'microsoft') {
      if (selectedMailbox && trimmed.toLowerCase() !== selectedMailbox.toLowerCase()) {
        return t('managed.validation.microsoftMustMatchMailbox', { mailbox: selectedMailbox });
      }
    }

    const domain = trimmed.split('@').pop()?.toLowerCase();
    if (!domain || domain !== outboundDomain.toLowerCase()) {
      return t('managed.validation.mustMatchDomain', { domain: outboundDomain });
    }

    return null;
  };

  const initializeTicketingFromSelection = (
    settings?: TenantEmailSettings | null,
    providers?: EmailProvider[]
  ) => {
    const outboundDomain = getOutboundDomain(settings);
    const providerList = providers ?? inboundProviders;
    const mailboxes = providerList
      .map((p) => p.mailbox?.trim())
      .filter(Boolean) as string[];
    const current = settings?.ticketingFromEmail?.trim() || '';
    const hasMatch = current && mailboxes.some((m) => m.toLowerCase() === current.toLowerCase());

    if (current) {
      setTicketingFromCustom(current);
    } else {
      setTicketingFromCustom('');
    }

    setTicketingFromName(settings?.ticketingFromName?.trim() || '');

    setTicketingFromError(current ? validateTicketingFrom(current, outboundDomain, resolveOutboundProvider(settings?.emailProvider), settings?.providerConfigs.find(config => config.providerType === 'microsoft')?.config.mailbox) : null);

    if (mailboxes.length > 0 && current && !hasMatch) {
      setTicketingFromWarning(t('managed.validation.customAddressThreadWarning'));
    } else {
      setTicketingFromWarning(null);
    }
  };

  const handleTicketingFromChange = (value: string) => {
    const outboundDomain = getOutboundDomain(emailSettings);
    setTicketingFromCustom(value);
    setTicketingFromError(validateTicketingFrom(value, outboundDomain));

    const mailboxes = inboundProviders
      .map((p) => p.mailbox?.trim())
      .filter(Boolean)
      .map((m) => m!.toLowerCase());

    const trimmedValue = value.trim().toLowerCase();
    if (mailboxes.length > 0 && value && !mailboxes.includes(trimmedValue)) {
      setTicketingFromWarning(t('managed.validation.notConnectedWarning'));
    } else {
      setTicketingFromWarning(null);
    }
  };

  const handleSaveOutbound = async () => {
    if (!emailSettings || outboundBusy || saveInFlight.current || !hasUnsavedChanges) return;
    const candidate = ticketingFromCustom.trim();
    const senderDomain = outboundProvider === 'smtp' ? extractEmailDomain(candidate) : getOutboundDomain(emailSettings);
    const error = outboundProvider === 'smtp' && !isValidEmail(candidate)
      ? t('managed.outbound.smtp.ticketIdentityRequired', { defaultValue: 'Choose a ticket email identity below to set the sending domain.' })
      : validateTicketingFrom(candidate, senderDomain);
    setTicketingFromError(error);
    if (error) return;

    let providerConfigs = emailSettings.providerConfigs;
    if (outboundProvider === 'smtp') {
      const smtp = getSmtpConfig();
      const mailbox = smtp?.config.from?.split('@')[0].trim();
      const from = mailbox && senderDomain ? `${mailbox}@${senderDomain}` : '';
      if (!smtp?.config.host?.trim()) {
        toast.error(t('managed.messages.smtpHostRequired'));
        return;
      }
      if (!isValidEmail(from)) {
        toast.error(from ? t('managed.validation.invalidEmail') : t('managed.messages.fromAddressRequired'));
        return;
      }
      providerConfigs = providerConfigs.map(config => config.providerType === 'smtp'
        ? { ...config, config: { ...config.config, from } } : config);
    }
    saveInFlight.current = true;
    setSavingOutbound(true);
    try {
      const updates: EmailSettingsUpdateInput = {
        emailProvider: outboundProvider,
        providerConfigs: providerConfigs.map(config => ({ ...config, isEnabled: config.providerType === outboundProvider })),
        ticketingFromEmail: candidate || null,
        ticketingFromName: ticketingFromName.trim() || null,
        defaultFromDomain: senderDomain || emailSettings.defaultFromDomain,
      };
      const result = await updateEmailSettings(updates);
      const updated = resolveEmailSettingsResult(result, t('managed.outbound.saveFailed', { defaultValue: 'Could not save outbound settings. Your changes are still here. Try again.' }));
      if (!updated) return;
      setEmailSettings(updated);
      setSavedEmailSettings(updated);
      setOutboundProvider(resolveOutboundProvider(updated.emailProvider));
      initializeTicketingFromSelection(updated, inboundProviders);
      toast.success(t('managed.outbound.saved', { defaultValue: 'Outbound settings saved.' }));
    } catch (err) {
      console.error('[ManagedEmailSettings] Failed to save outbound settings', err);
      toast.error(t('managed.outbound.saveFailed', { defaultValue: 'Could not save outbound settings. Your changes are still here. Try again.' }));
    } finally {
      saveInFlight.current = false;
      setSavingOutbound(false);
    }
  };

  const handleDiscardOutbound = () => {
    if (!savedEmailSettings || outboundBusy) return;
    setEmailSettings(savedEmailSettings);
    setOutboundProvider(resolveOutboundProvider(savedEmailSettings.emailProvider));
    initializeTicketingFromSelection(savedEmailSettings, inboundProviders);
  };

  const handleClearTicketingFrom = () => {
    setTicketingFromCustom('');
    setTicketingFromName('');
    setTicketingFromError(null);
    setTicketingFromWarning(null);
    setShowClearTicketingFromDialog(false);
  };

  const getDomainRemovalImpact = (domain: string | null) => {
    const normalizedDomain = domain?.trim().toLowerCase() || '';
    const removesActiveOutboundDomain =
      emailSettings?.defaultFromDomain?.trim().toLowerCase() === normalizedDomain;
    const removesTicketingFromDomain =
      removesActiveOutboundDomain ||
      extractEmailDomain(emailSettings?.ticketingFromEmail) === normalizedDomain;

    return {
      removesActiveOutboundDomain,
      removesTicketingFromDomain,
    };
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

  const handleMicrosoftMailboxSelect = (providerId: string) => {
    if (!emailSettings || outboundBusy) return;
    const mailbox = microsoftMailboxes.find(option => option.providerId === providerId);
    if (!mailbox) return;
    setEmailSettings({ ...emailSettings, providerConfigs: emailSettings.providerConfigs.map(config =>
      config.providerType === 'microsoft'
        ? { ...config, providerId: mailbox.providerId, config: microsoftConfigFor(mailbox) }
        : config
    ) });
    setTicketingFromCustom(mailbox.mailbox);
    setTicketingFromError(null);
    setTicketingFromWarning(null);
  };

  const handleProviderSwitch = (provider: OutboundProvider) => {
    if (!emailSettings || outboundBusy || provider === outboundProvider) return;
    let providerConfigs = emailSettings.providerConfigs;
    if (!providerConfigs.some(config => config.providerType === provider)) {
      providerConfigs = [...providerConfigs, createDefaultProviderConfig(provider, { isEnabled: true })];
    }
    if (provider === 'microsoft') {
      const existing = providerConfigs.find(config => config.providerType === 'microsoft');
      const mailbox = microsoftMailboxes.find(m => m.providerId === existing?.config.inboundProviderId && m.status === 'connected')
        || microsoftMailboxes.find(m => m.status === 'connected');
      if (!mailbox) {
        toast.error(t('managed.outbound.microsoft.noneConnected', 'Authorize a Microsoft 365 mailbox on the Inbound Email tab first.'));
        return;
      }
      providerConfigs = providerConfigs.map(config => config.providerType === 'microsoft'
        ? { ...config, providerId: mailbox.providerId, config: microsoftConfigFor(mailbox) } : config);
      setTicketingFromCustom(mailbox.mailbox);
    }
    setOutboundProvider(provider);
    setEmailSettings({ ...emailSettings, emailProvider: provider, providerConfigs });
    setTicketingFromError(null);
    setTicketingFromWarning(null);
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
  };

  const updateNotificationIdentityField = (field: 'from' | 'fromName', value: string) => {
    if (!emailSettings) return;
    const providerConfigs = emailSettings.providerConfigs.map(config =>
      config.providerType === outboundProvider
        ? { ...config, config: { ...config.config, [field]: value } }
        : config
    );
    setEmailSettings({ ...emailSettings, providerConfigs });
  };

  const handleOpenDiagnostics = () => {
    if (outboundBusy || hasUnsavedChanges || !savedEmailSettings) return;
    setDiagnosticsOpen(true);
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
    if (outboundBusy || saveInFlight.current) return;
    if (hasUnsavedChanges) {
      toast.error(t('managed.outbound.saveBeforeDomainRemoval', { defaultValue: 'Save or discard your outbound changes before removing a domain.' }));
      return;
    }
    if (!pendingDomainRemoval) {
      return;
    }

    const domain = pendingDomainRemoval;
    const { removesActiveOutboundDomain, removesTicketingFromDomain } = getDomainRemovalImpact(domain);

    setBusyDomain(domain);
    try {
      const deleter = overrides?.deleteManagedEmailDomain ?? deleteManagedEmailDomain;
      const result = await deleter(domain);
      if (!result.success) {
        toast.error(getManagedDomainFailureMessage(result, t('managed.messages.removeDomainFailed')));
        return;
      }

      if (emailSettings && (removesActiveOutboundDomain || removesTicketingFromDomain)) {
        const updatedSettingsResult = await updateEmailSettings({
          defaultFromDomain: removesActiveOutboundDomain ? null : emailSettings.defaultFromDomain,
          ticketingFromEmail: removesTicketingFromDomain ? null : emailSettings.ticketingFromEmail,
        } satisfies EmailSettingsUpdateInput);
        const updatedSettings = resolveEmailSettingsResult(
          updatedSettingsResult,
          t('managed.messages.removeDomainFailed')
        );
        if (!updatedSettings) {
          return;
        }

        setEmailSettings(updatedSettings);
        setSavedEmailSettings(updatedSettings);
        initializeTicketingFromSelection(updatedSettings, inboundProviders);
      }

      setPendingDomainRemoval(null);
      toast.success(
        removesTicketingFromDomain
          ? t('managed.messages.domainRemovalScheduledWithClear')
          : t('managed.messages.domainRemovalScheduled')
      );
      await loadDomains();
    } catch (err: any) {
      console.error(err);
      toast.error(t('managed.messages.removeDomainFailed'));
    } finally {
      setBusyDomain(null);
    }
  };

  const outboundDomain = getOutboundDomain(emailSettings);
  const smtpSenderDomain = isValidEmail(ticketingFromCustom.trim()) ? extractEmailDomain(ticketingFromCustom) : null;
  const inboundMailboxOptions = inboundProviders
    .map((provider) => provider.mailbox?.trim())
    .filter(Boolean) as string[];
  const notificationConfig = emailSettings?.providerConfigs.find(
    config => config.providerType === outboundProvider
  );
  const microsoftMailbox = getMicrosoftConfig()?.config.mailbox?.trim() || '';
  const ticketMailboxOptions = outboundProvider === 'microsoft' && microsoftMailbox
    ? [microsoftMailbox]
    : inboundMailboxOptions;

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
            <div className="border-t pt-4 mt-4">
              <Button
                id="open-outbound-diagnostics"
                variant="outline"
                onClick={handleOpenDiagnostics}
                disabled={outboundBusy || !emailSettings || hasUnsavedChanges}
                aria-describedby="outbound-diagnostics-save-help"
              >
                <Send className="h-4 w-4 mr-2" />
                {t('managed.outbound.diagnosticsButton', 'Run Outbound Diagnostics')}
              </Button>
              {hasUnsavedChanges && (
                <p id="outbound-diagnostics-save-help" className="text-sm text-muted-foreground mt-2">
                  {t('managed.outbound.diagnosticsSaveHelp', { defaultValue: 'Save or discard your changes before checking the outbound settings.' })}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <OutboundEmailDiagnosticsDialog
          isOpen={diagnosticsOpen}
          onClose={() => setDiagnosticsOpen(false)}
          hasUnsavedChanges={hasUnsavedChanges}
        />

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
              <fieldset disabled={outboundBusy} className="min-w-0">
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
                        <div className="flex items-stretch">
                          <Input
                            id="smtp-from"
                            type="text"
                            value={(smtpConfig?.config.from || '').split('@')[0]}
                            placeholder={t('managed.outbound.smtp.fromPlaceholder').split('@')[0]}
                            disabled={!smtpSenderDomain}
                            containerClassName="min-w-0 flex-1"
                            className="rounded-r-none"
                            aria-describedby="smtp-from-domain smtp-from-help"
                            onChange={(e) => {
                              const mailbox = e.target.value.split('@')[0].trim();
                              updateSmtpField('from', mailbox && smtpSenderDomain ? `${mailbox}@${smtpSenderDomain}` : '');
                            }}
                          />
                          {smtpSenderDomain && (
                            <span id="smtp-from-domain" className="flex items-center rounded-r-md border border-l-0 border-border bg-muted px-3 text-sm text-muted-foreground break-all">
                              @{smtpSenderDomain}
                            </span>
                          )}
                        </div>
                        <p id="smtp-from-help" className="text-sm text-muted-foreground mt-1">
                          {smtpSenderDomain
                            ? t('managed.outbound.smtp.fromHelp')
                            : t('managed.outbound.smtp.ticketIdentityRequired', {
                                defaultValue: 'Choose a ticket email identity below to set the sending domain.',
                              })}
                        </p>
                      </div>
                      <div>
                        <Label htmlFor="smtp-from-name">
                          {t('managed.outbound.senderIdentities.notification.nameLabel')}
                        </Label>
                        <Input
                          id="smtp-from-name"
                          value={smtpConfig?.config.fromName || ''}
                          placeholder={t('managed.outbound.senderIdentities.notification.namePlaceholder')}
                          onChange={(e) => updateSmtpField('fromName', e.target.value)}
                        />
                        <p className="text-sm text-muted-foreground mt-1">
                          {t('managed.outbound.senderIdentities.notification.nameHelp', {
                            company: emailSettings?.tenantCompanyName
                              || t('managed.outbound.senderIdentities.notification.companyFallback'),
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

                  </div>
                );
              })()}
              </fieldset>
            </CardContent>
          </Card>
        )}

        {emailSettings && (
          <EmailSenderIdentityCards
            copy={{
              ticketTitle: t('managed.outbound.senderIdentities.ticket.title'),
              ticketDescription: t('managed.outbound.senderIdentities.ticket.description'),
              connectedInboxLabel: t('managed.outbound.senderIdentities.ticket.connectedInboxLabel'),
              connectedInboxHelp: t('managed.outbound.senderIdentities.ticket.connectedInboxHelp'),
              customAddressOption: t('managed.outbound.senderIdentities.ticket.customAddressOption'),
              ticketAddressLabel: t('managed.outbound.senderIdentities.ticket.addressLabel'),
              ticketAddressPlaceholder: t('managed.outbound.senderIdentities.ticket.addressPlaceholder'),
              ticketAddressHelp: outboundProvider === 'microsoft'
                ? t('managed.outbound.senderIdentities.ticket.microsoftAddressHelp', { mailbox: microsoftMailbox })
                : outboundProvider === 'smtp'
                  ? t('managed.outbound.senderIdentities.ticket.smtpAddressHelp', {
                      defaultValue: 'This address sets the domain for the SMTP sender above. Replies must reach a connected inbox to appear on tickets.',
                    })
                  : t('managed.outbound.senderIdentities.ticket.addressHelp'),
              ticketNameLabel: t('managed.outbound.senderIdentities.ticket.nameLabel'),
              ticketNamePlaceholder: t('managed.outbound.senderIdentities.ticket.namePlaceholder'),
              ticketNameHelp: t('managed.outbound.senderIdentities.ticket.nameHelp'),
              warningTitle: t('managed.outbound.senderIdentities.warningTitle'),
              errorTitle: t('managed.outbound.senderIdentities.errorTitle'),
              notificationTitle: t('managed.outbound.senderIdentities.notification.title'),
              notificationDescription: t('managed.outbound.senderIdentities.notification.description'),
              notificationAddressLabel: t('managed.outbound.senderIdentities.notification.addressLabel'),
              // Effective fallback sender goes in the placeholder, never the value:
              // rendering it as the value makes an unsaved field look configured.
              notificationAddressPlaceholder: outboundProvider === resolveOutboundProvider(savedEmailSettings?.emailProvider)
                ? savedEmailSettings?.effectiveNotificationFrom.email || ''
                : t('managed.outbound.senderAddressAfterSave', { defaultValue: 'Shown after saving.' }),
              notificationAddressHelp: outboundProvider === 'smtp'
                ? t('managed.outbound.senderIdentities.notification.smtpAddressHelp')
                : t('managed.outbound.senderIdentities.notification.lockedAddressHelp'),
              notificationNameLabel: t('managed.outbound.senderIdentities.notification.nameLabel'),
              notificationNamePlaceholder: t('managed.outbound.senderIdentities.notification.namePlaceholder'),
              notificationNameHelp: t('managed.outbound.senderIdentities.notification.nameHelp', {
                company: emailSettings.tenantCompanyName || t('managed.outbound.senderIdentities.notification.companyFallback'),
              }),
            }}
            ticketAddress={ticketingFromCustom}
            ticketName={ticketingFromName}
            connectedInboxes={ticketMailboxOptions}
            ticketFieldsDisabled={outboundBusy || (outboundProvider !== 'smtp' && !outboundDomain)}
            ticketWarning={
              !loadingOutbound && outboundProvider !== 'smtp' && !outboundDomain
                ? t('managed.validation.addOutboundFirst')
                : ticketingFromWarning
            }
            ticketError={ticketingFromError}
            notificationAddress={notificationConfig?.config.from || ''}
            notificationName={notificationConfig?.config.fromName || ''}
            // Shown only for managed/Microsoft, where the address comes from the
            // domain or mailbox selection; SMTP edits its identity in the SMTP card.
            showNotificationCard={outboundProvider !== 'smtp'}
            notificationAddressReadOnly
            notificationFieldsDisabled={outboundBusy}
            onTicketAddressChange={handleTicketingFromChange}
            onTicketNameChange={setTicketingFromName}
            onNotificationAddressChange={(value) => updateNotificationIdentityField('from', value)}
            onNotificationNameChange={(value) => updateNotificationIdentityField('fromName', value)}
            actions={ticketingFromCustom && outboundProvider !== 'smtp' ? (
              <Button id="clear-ticketing-from" variant="outline"
                onClick={() => setShowClearTicketingFromDialog(true)} disabled={outboundBusy}>
                {t('managed.outbound.senderIdentities.clearButton')}
              </Button>
            ) : undefined}
          />
        )}
        {emailSettings && (
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card py-4">
            <p id="outbound-save-status" role="status" className="text-sm text-muted-foreground">
              {savingOutbound
                ? t('managed.outbound.saving', { defaultValue: 'Saving outbound settings…' })
                : hasUnsavedChanges
                  ? t('managed.outbound.unsaved', { defaultValue: 'Unsaved changes' })
                  : t('managed.outbound.noPendingChanges', { defaultValue: 'No unsaved changes' })}
            </p>
            <div className="flex gap-2">
              <Button id="discard-outbound-changes" variant="outline" onClick={handleDiscardOutbound} disabled={outboundBusy || !hasUnsavedChanges}>
                {t('managed.outbound.discardChanges', { defaultValue: 'Discard changes' })}
              </Button>
              <Button id="save-outbound-settings" onClick={handleSaveOutbound} disabled={outboundBusy || !hasUnsavedChanges}>
                {t('managed.outbound.saveSettings', { defaultValue: 'Save outbound settings' })}
              </Button>
            </div>
          </div>
        )}
      </TabsContent>

      <TabsContent value="inbound" className="space-y-6">
        <div className="text-sm text-muted-foreground mb-4">
          {t('managed.inbound.intro')}
        </div>
        <EmailProviderConfiguration />
      </TabsContent>
      <ConfirmationDialog
        isOpen={showClearTicketingFromDialog}
        onClose={() => setShowClearTicketingFromDialog(false)}
        onConfirm={handleClearTicketingFrom}
        title={t('managed.dialogs.clearTicketingFrom.title')}
        message={t('managed.dialogs.clearTicketingFrom.message', { defaultValue: 'Clear this ticket email identity from the form? This takes effect when you save outbound settings.' })}
        confirmLabel={t('managed.dialogs.clearTicketingFrom.confirm')}
        cancelLabel={t('managed.dialogs.cancel')}
        isConfirming={savingOutbound}
        id="managed-email-clear-ticketing-from"
      />
      <ConfirmationDialog
        isOpen={!!pendingDomainRemoval}
        onClose={() => setPendingDomainRemoval(null)}
        onConfirm={handleDeleteDomain}
        title={t('managed.dialogs.removeDomain.title')}
        message={
          pendingDomainRemoval && getDomainRemovalImpact(pendingDomainRemoval).removesActiveOutboundDomain
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
