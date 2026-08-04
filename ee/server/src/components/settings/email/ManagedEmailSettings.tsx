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
import { EmailProviderConfiguration, EmailSenderIdentityCards } from '@alga-psa/integrations/components';
import type { EmailProvider } from '@alga-psa/integrations/components';
import type { TenantEmailSettings } from 'server/src/types/email.types';
import { createDefaultProviderConfig } from '@alga-psa/email/providerConfig';
import {
  getEmailSettings,
  updateEmailSettings,
  getEmailProviders,
  testOutboundEmail,
  getMicrosoftOutboundMailboxes,
  type EmailSettingsView,
  type MicrosoftOutboundMailboxOption,
} from '@alga-psa/integrations/actions';
import ManagedDomainList from './ManagedDomainList';

type OutboundProvider = 'resend' | 'smtp' | 'microsoft';
type EmailSettingsUpdateInput = Partial<TenantEmailSettings> & {
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
  const [inboundProviders, setInboundProviders] = useState<EmailProvider[]>([]);
  const [ticketingFromCustom, setTicketingFromCustom] = useState('');
  const [ticketingFromName, setTicketingFromName] = useState('');
  const [ticketingFromError, setTicketingFromError] = useState<string | null>(null);
  const [ticketingFromWarning, setTicketingFromWarning] = useState<string | null>(null);
  const [savingTicketingFrom, setSavingTicketingFrom] = useState(false);
  const [showClearTicketingFromDialog, setShowClearTicketingFromDialog] = useState(false);
  const [loadingOutbound, setLoadingOutbound] = useState(true);
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
  const [pendingDomainRemoval, setPendingDomainRemoval] = useState<string | null>(null);

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
      toast.error(err.message || t('managed.messages.loadDomainsFailed'));
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
        setOutboundProvider(resolveOutboundProvider(settings.emailProvider));
      }

      const providers = providerResult?.providers || [];
      setInboundProviders(providers);
      initializeTicketingFromSelection(settings, providers);
    } catch (err: any) {
      console.error('[ManagedEmailSettings] Failed to load outbound settings', err);
      toast.error(err.message || t('managed.messages.loadOutboundSettingsFailed'));
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

  const validateTicketingFrom = (value: string, outboundDomain?: string | null): string | null => {
    // The ticketing From address is optional: an empty value means "use the
    // default sender address" and only the display name (if configured) is
    // applied. Address-format checks below only run when a value is present.
    if (!value || !value.trim()) {
      return null;
    }

    if (!outboundDomain) {
      return outboundProvider === 'smtp'
        ? t('managed.validation.saveSmtpFirst')
        : t('managed.validation.addOutboundFirst');
    }

    const trimmed = value.trim();
    if (!/^[^\s@]+@[^\s@]+$/.test(trimmed)) {
      return t('managed.validation.invalidEmail');
    }

    if (outboundProvider === 'microsoft') {
      const selectedMailbox = getMicrosoftConfig()?.config.mailbox?.trim();
      if (selectedMailbox && trimmed.toLowerCase() !== selectedMailbox.toLowerCase()) {
        return t('managed.validation.microsoftMustMatchMailbox', { mailbox: selectedMailbox });
      }
    }

    // For managed/resend, the domain must match exactly.
    // For SMTP, domain mismatch is a warning (handled separately), not a hard error.
    if (outboundProvider !== 'smtp') {
      const domain = trimmed.split('@').pop()?.toLowerCase();
      if (!domain || domain !== outboundDomain.toLowerCase()) {
        return t('managed.validation.mustMatchDomain', { domain: outboundDomain });
      }
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

    setTicketingFromError(current ? validateTicketingFrom(current, outboundDomain) : null);

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
    const enteredDomain = trimmedValue.split('@').pop();

    if (outboundProvider === 'smtp' && outboundDomain && enteredDomain && enteredDomain !== outboundDomain.toLowerCase()) {
      setTicketingFromWarning(t('managed.validation.smtpDomainMismatchWarning', { domain: outboundDomain }));
    } else if (mailboxes.length > 0 && value && !mailboxes.includes(trimmedValue)) {
      setTicketingFromWarning(t('managed.validation.notConnectedWarning'));
    } else {
      setTicketingFromWarning(null);
    }
  };

  const handleSaveSenderIdentities = async () => {
    const outboundDomain = getOutboundDomain(emailSettings);
    const candidate = ticketingFromCustom.trim();

    // The From address is optional: a tenant may configure only a display name
    // and keep the default sender address. Validate the address only when set.
    const error = candidate ? validateTicketingFrom(candidate, outboundDomain) : null;
    setTicketingFromError(error);

    if (error) {
      return;
    }

    setSavingTicketingFrom(true);
    try {
      const updates: EmailSettingsUpdateInput = {
        providerConfigs: emailSettings?.providerConfigs,
        ticketingFromEmail: candidate || null,
        ticketingFromName: ticketingFromName.trim() || null,
      };
      if (candidate || outboundProvider === 'smtp') {
        updates.defaultFromDomain = outboundDomain || emailSettings?.defaultFromDomain;
      }

      const updatedResult = await updateEmailSettings(updates);
      const updated = resolveEmailSettingsResult(updatedResult, t('managed.messages.ticketingFromSaveFailed'));
      if (!updated) {
        return;
      }

      setEmailSettings(updated);
      initializeTicketingFromSelection(updated, inboundProviders);
      toast.success(t('managed.messages.senderIdentitiesUpdated'));
    } catch (err: any) {
      console.error('[ManagedEmailSettings] Failed to update ticketing from address', err);
      toast.error(err.message || t('managed.messages.ticketingFromSaveFailed'));
    } finally {
      setSavingTicketingFrom(false);
    }
  };

  const handleClearTicketingFrom = async () => {
    if (!emailSettings?.ticketingFromEmail) {
      return;
    }

    setSavingTicketingFrom(true);
    try {
      const updatedResult = await updateEmailSettings({
        ticketingFromEmail: null,
        ticketingFromName: null,
      } satisfies EmailSettingsUpdateInput);
      const updated = resolveEmailSettingsResult(updatedResult, t('managed.messages.ticketingFromClearFailed'));
      if (!updated) {
        return;
      }

      setEmailSettings(updated);
      initializeTicketingFromSelection(updated, inboundProviders);
      setShowClearTicketingFromDialog(false);
      toast.success(t('managed.messages.ticketingFromCleared'));
    } catch (err: any) {
      console.error('[ManagedEmailSettings] Failed to clear ticketing from address', err);
      toast.error(err.message || t('managed.messages.ticketingFromClearFailed'));
    } finally {
      setSavingTicketingFrom(false);
    }
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

  const handleMicrosoftMailboxSelect = async (providerId: string) => {
    if (!emailSettings) return;
    const mailbox = microsoftMailboxes.find(option => option.providerId === providerId);
    if (!mailbox) return;

    const providerConfigs = emailSettings.providerConfigs.map(config =>
      config.providerType === 'microsoft'
        ? { ...config, providerId: mailbox.providerId, config: microsoftConfigFor(mailbox) }
        : config
    );

    try {
      const result = await updateEmailSettings({ emailProvider: 'microsoft', providerConfigs });
      const updated = resolveEmailSettingsResult(result, t('managed.messages.switchProviderFailed'));
      if (!updated) return;
      setEmailSettings(updated);
      toast.success(t('managed.outbound.microsoft.saved', 'Outbound sending mailbox updated.'));
    } catch (err: any) {
      console.error('[ManagedEmailSettings] Failed to select Microsoft mailbox', err);
      toast.error(err.message || t('managed.messages.switchProviderFailed'));
    }
  };

  const handleProviderSwitch = async (provider: OutboundProvider) => {
    setOutboundProvider(provider);

    if (!emailSettings) return;

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

    try {
      const updatedResult = await updateEmailSettings(updatedSettings);
      const updated = resolveEmailSettingsResult(updatedResult, t('managed.messages.switchProviderFailed'));
      if (!updated) {
        setOutboundProvider(emailSettings.emailProvider === 'smtp' ? 'smtp' : 'resend');
        return;
      }
      setEmailSettings(updated);
    } catch (err: any) {
      console.error('[ManagedEmailSettings] Failed to switch provider', err);
      toast.error(err.message || t('managed.messages.switchProviderFailed'));
      // Revert UI selection
      setOutboundProvider(emailSettings.emailProvider === 'smtp' ? 'smtp' : 'resend');
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
      toast.error(err.message || t('managed.messages.smtpSaveFailed'));
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
      toast.error(err.message || t('managed.messages.domainRequestFailed'));
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
      toast.error(err.message || t('managed.messages.refreshStatusFailed'));
    } finally {
      setBusyDomain(null);
    }
  };

  const handleDeleteDomain = async () => {
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
      toast.error(err.message || t('managed.messages.removeDomainFailed'));
    } finally {
      setBusyDomain(null);
    }
  };

  const outboundDomain = getOutboundDomain(emailSettings);
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
              disabled={loadingOutbound}
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
                  disabled={loadingOutbound || microsoftMailboxes.length === 0}
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
                        disabled={savingSmtp || testingSmtp || loadingOutbound}
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
                          disabled={testingSmtp || savingSmtp || loadingOutbound}
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
                : t('managed.outbound.senderIdentities.ticket.addressHelp'),
              ticketNameLabel: t('managed.outbound.senderIdentities.ticket.nameLabel'),
              ticketNamePlaceholder: t('managed.outbound.senderIdentities.ticket.namePlaceholder'),
              ticketNameHelp: t('managed.outbound.senderIdentities.ticket.nameHelp'),
              warningTitle: t('managed.outbound.senderIdentities.warningTitle'),
              errorTitle: t('managed.outbound.senderIdentities.errorTitle'),
              notificationTitle: t('managed.outbound.senderIdentities.notification.title'),
              notificationDescription: t('managed.outbound.senderIdentities.notification.description'),
              notificationAddressLabel: t('managed.outbound.senderIdentities.notification.addressLabel'),
              notificationAddressPlaceholder: t('managed.outbound.senderIdentities.notification.addressPlaceholder'),
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
            ticketFieldsDisabled={loadingOutbound || !outboundDomain}
            ticketWarning={ticketingFromWarning}
            ticketError={ticketingFromError}
            notificationAddress={notificationConfig?.config.from || emailSettings.effectiveNotificationFrom.email}
            notificationName={notificationConfig?.config.fromName || ''}
            notificationAddressReadOnly={outboundProvider !== 'smtp'}
            notificationFieldsDisabled={loadingOutbound}
            onTicketAddressChange={handleTicketingFromChange}
            onTicketNameChange={setTicketingFromName}
            onNotificationAddressChange={(value) => updateNotificationIdentityField('from', value)}
            onNotificationNameChange={(value) => updateNotificationIdentityField('fromName', value)}
            actions={(
              <div className="flex justify-end gap-2">
                {emailSettings.ticketingFromEmail ? (
                  <Button
                    id="clear-ticketing-from"
                    variant="outline"
                    onClick={() => setShowClearTicketingFromDialog(true)}
                    disabled={savingTicketingFrom || loadingOutbound}
                  >
                    {t('managed.outbound.senderIdentities.clearButton')}
                  </Button>
                ) : null}
                <Button
                  id="save-sender-identities"
                  onClick={handleSaveSenderIdentities}
                  disabled={savingTicketingFrom || loadingOutbound || !!ticketingFromError || !outboundDomain}
                >
                  {savingTicketingFrom
                    ? t('managed.outbound.senderIdentities.savingButton')
                    : t('managed.outbound.senderIdentities.saveButton')}
                </Button>
              </div>
            )}
          />
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
        message={t('managed.dialogs.clearTicketingFrom.message')}
        confirmLabel={t('managed.dialogs.clearTicketingFrom.confirm')}
        cancelLabel={t('managed.dialogs.cancel')}
        isConfirming={savingTicketingFrom}
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
