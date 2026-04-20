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
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Globe, Send, Inbox, Mail, Eye, EyeOff, Lock } from 'lucide-react';
import { TIER_FEATURES } from '@alga-psa/types';
import { useTier } from 'server/src/context/TierContext';
import {
  getManagedEmailDomains,
  requestManagedEmailDomain,
  refreshManagedEmailDomain,
  deleteManagedEmailDomain,
  ManagedDomainStatus,
} from '@ee/lib/actions/email-actions/managedDomainActions';
import { EmailProviderConfiguration } from '@alga-psa/integrations/components';
import type { EmailProvider } from '@alga-psa/integrations/components';
import type { TenantEmailSettings, EmailProviderConfig } from 'server/src/types/email.types';
import { getEmailSettings, updateEmailSettings, getEmailProviders } from '@alga-psa/integrations/actions';
import ManagedDomainList from './ManagedDomainList';

type OutboundProvider = 'resend' | 'smtp';
type EmailSettingsUpdateInput = Partial<TenantEmailSettings> & {
  defaultFromDomain?: string | null;
  ticketingFromEmail?: string | null;
};

type ManagedEmailOverrides = {
  getManagedEmailDomains?: () => Promise<ManagedDomainStatus[]>;
  requestManagedEmailDomain?: (
    domain: string
  ) => Promise<{ success: boolean; alreadyRunning?: boolean }>;
  refreshManagedEmailDomain?: (
    domain: string
  ) => Promise<{ success: boolean; alreadyRunning?: boolean }>;
  deleteManagedEmailDomain?: (domain: string) => Promise<{ success: boolean }>;
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
  const { hasFeature } = useTier();
  const canUseManagedEmail = hasFeature(TIER_FEATURES.MANAGED_EMAIL);
  const [domains, setDomains] = useState<ManagedDomainStatus[]>([]);
  const [loadingDomains, setLoadingDomains] = useState(true);
  const [activeTab, setActiveTab] = useState<'inbound' | 'outbound'>('outbound');
  const [newDomain, setNewDomain] = useState('');
  const [busyDomain, setBusyDomain] = useState<string | null>(null);
  const [overrides] = useState<ManagedEmailOverrides | undefined>(() => getManagedEmailOverrides());
  const [emailSettings, setEmailSettings] = useState<TenantEmailSettings | null>(null);
  const [inboundProviders, setInboundProviders] = useState<EmailProvider[]>([]);
  const [ticketingFromOption, setTicketingFromOption] = useState<string>('custom');
  const [ticketingFromCustom, setTicketingFromCustom] = useState('');
  const [ticketingFromError, setTicketingFromError] = useState<string | null>(null);
  const [ticketingFromWarning, setTicketingFromWarning] = useState<string | null>(null);
  const [savingTicketingFrom, setSavingTicketingFrom] = useState(false);
  const [showClearTicketingFromDialog, setShowClearTicketingFromDialog] = useState(false);
  const [loadingOutbound, setLoadingOutbound] = useState(true);
  const [outboundProvider, setOutboundProvider] = useState<OutboundProvider>('resend');
  const [showSmtpPassword, setShowSmtpPassword] = useState(false);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [pendingDomainRemoval, setPendingDomainRemoval] = useState<string | null>(null);

  useEffect(() => {
    loadDomains();
  }, []);

  useEffect(() => {
    loadOutboundState();
  }, []);

  const loadDomains = async () => {
    setLoadingDomains(true);
    try {
      const fetcher = overrides?.getManagedEmailDomains ?? getManagedEmailDomains;
      const data = await fetcher();
      setDomains(data);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || t('managed.messages.loadDomainsFailed'));
    } finally {
      setLoadingDomains(false);
    }
  };

  const loadOutboundState = async () => {
    setLoadingOutbound(true);
    try {
      const [settings, providerResult] = await Promise.all([
        getEmailSettings(),
        getEmailProviders()
      ]);

      if (settings) {
        setEmailSettings(settings);
        setOutboundProvider(
          !canUseManagedEmail ? 'smtp' : settings.emailProvider === 'smtp' ? 'smtp' : 'resend'
        );
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
    if (!value || !value.trim()) {
      return t('managed.validation.enterFromAddress');
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
      setTicketingFromOption(hasMatch ? current : 'custom');
      setTicketingFromCustom(current);
    } else {
      setTicketingFromOption('custom');
      setTicketingFromCustom('');
    }

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

  const handleSaveTicketingFrom = async () => {
    const outboundDomain = getOutboundDomain(emailSettings);
    const candidate = ticketingFromOption === 'custom' ? ticketingFromCustom : ticketingFromOption;
    const error = validateTicketingFrom(candidate, outboundDomain);
    setTicketingFromError(error);

    if (error) {
      return;
    }

    setSavingTicketingFrom(true);
    try {
      const normalized = candidate.trim();
      const updated = await updateEmailSettings({
        ticketingFromEmail: normalized,
        defaultFromDomain: outboundDomain || emailSettings?.defaultFromDomain
      } satisfies EmailSettingsUpdateInput);

      setEmailSettings(updated);
      initializeTicketingFromSelection(updated, inboundProviders);
      toast.success(t('managed.messages.ticketingFromUpdated'));
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
      const updated = await updateEmailSettings({
        ticketingFromEmail: null,
      } satisfies EmailSettingsUpdateInput);

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
      const newConfig: EmailProviderConfig = {
        providerId: `${provider}-provider`,
        providerType: provider,
        isEnabled: true,
        config: provider === 'smtp' ? { host: '', port: 587, username: '', password: '', from: '' } : { apiKey: '', from: '' }
      };
      updatedSettings.providerConfigs = [...(updatedSettings.providerConfigs || []), newConfig];
    }

    try {
      const updated = await updateEmailSettings(updatedSettings);
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

  const updateSmtpField = (field: string, value: string | number) => {
    if (!emailSettings) return;
    const smtpConfig = getSmtpConfig();
    if (!smtpConfig) return;

    const updatedConfigs = emailSettings.providerConfigs.map(config =>
      config.providerType === 'smtp'
        ? { ...config, config: { ...config.config, [field]: value } }
        : config
    );
    setEmailSettings({ ...emailSettings, providerConfigs: updatedConfigs });
  };

  const handleSaveSmtp = async () => {
    const smtpConfig = getSmtpConfig();
    if (!smtpConfig || !emailSettings) return;

    const { host, from } = smtpConfig.config;
    if (!host?.trim()) {
      toast.error(t('managed.messages.smtpHostRequired'));
      return;
    }
    if (!from?.trim()) {
      toast.error(t('managed.messages.fromAddressRequired'));
      return;
    }

    setSavingSmtp(true);
    try {
      const updated = await updateEmailSettings({
        emailProvider: 'smtp',
        providerConfigs: emailSettings.providerConfigs,
        defaultFromDomain: from.trim().split('@').pop() || emailSettings.defaultFromDomain
      });
      setEmailSettings(updated);
      toast.success(t('managed.messages.smtpSaved'));
    } catch (err: any) {
      console.error('[ManagedEmailSettings] Failed to save SMTP settings', err);
      toast.error(err.message || t('managed.messages.smtpSaveFailed'));
    } finally {
      setSavingSmtp(false);
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
      await requester(newDomain.trim());
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
      await refresher(domain);
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
      await deleter(domain);

      if (emailSettings && (removesActiveOutboundDomain || removesTicketingFromDomain)) {
        const updatedSettings = await updateEmailSettings({
          defaultFromDomain: removesActiveOutboundDomain ? null : emailSettings.defaultFromDomain,
          ticketingFromEmail: removesTicketingFromDomain ? null : emailSettings.ticketingFromEmail,
        } satisfies EmailSettingsUpdateInput);
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
            {canUseManagedEmail ? (
              <>
                <CustomSelect
                  id="outbound-provider-select"
                  value={outboundProvider}
                  disabled={loadingOutbound}
                  onValueChange={(val: string) => handleProviderSwitch(val as OutboundProvider)}
                  options={[
                    { value: 'resend', label: t('managed.outbound.providerOptions.resend') },
                    { value: 'smtp', label: t('managed.outbound.providerOptions.smtp') }
                  ]}
                  placeholder={t('managed.outbound.providerPlaceholder')}
                />
                <p className="text-sm text-muted-foreground mt-2">
                  {outboundProvider === 'resend'
                    ? t('managed.outbound.resendDescription')
                    : t('managed.outbound.smtpDescription')}
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-medium">{t('managed.outbound.smtpLabel')}</span>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3 flex items-start gap-3">
                  <Lock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <p className="text-sm text-muted-foreground">
                    {t('managed.outbound.upgradeNotice')}
                  </p>
                </div>
              </>
            )}
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

                    <div>
                      <Label htmlFor="smtp-from">{t('managed.outbound.smtp.fromLabel')}</Label>
                      <Input
                        id="smtp-from"
                        value={smtpConfig?.config.from || ''}
                        placeholder={t('managed.outbound.smtp.fromPlaceholder')}
                        onChange={(e) => updateSmtpField('from', e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        {t('managed.outbound.smtp.fromHelp')}
                      </p>
                    </div>

                    <div className="flex justify-end">
                      <Button
                        id="save-smtp-settings"
                        onClick={handleSaveSmtp}
                        disabled={savingSmtp || loadingOutbound}
                      >
                        {savingSmtp ? t('managed.outbound.smtp.savingButton') : t('managed.outbound.smtp.saveButton')}
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              {t('managed.outbound.ticketingFrom.title')}
            </CardTitle>
            <CardDescription>
              {t('managed.outbound.ticketingFrom.description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm text-muted-foreground">
              {outboundProvider === 'smtp'
                ? t('managed.outbound.ticketingFrom.smtpHint', { domain: outboundDomain || t('managed.outbound.ticketingFrom.domainNotSet') })
                : t('managed.outbound.ticketingFrom.managedHint', { domain: outboundDomain || t('managed.outbound.ticketingFrom.domainNotSet') })}
            </p>

            {!outboundDomain ? (
              <Alert variant="warning">
                <AlertTitle>{t('managed.outbound.ticketingFrom.outboundRequiredTitle')}</AlertTitle>
                <AlertDescription>
                  {outboundProvider === 'smtp'
                    ? t('managed.outbound.ticketingFrom.smtpRequiredMessage')
                    : t('managed.outbound.ticketingFrom.managedRequiredMessage')}
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-4">
                {inboundMailboxOptions.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="ticketing-from-select">{t('managed.outbound.ticketingFrom.connectedInboxLabel')}</Label>
                    <CustomSelect
                      id="ticketing-from-select"
                      value={ticketingFromOption}
                      disabled={loadingOutbound}
                      onValueChange={(val: string) => {
                        setTicketingFromOption(val);
                        if (val !== 'custom') {
                          setTicketingFromCustom(val);
                          handleTicketingFromChange(val);
                        } else {
                          handleTicketingFromChange(ticketingFromCustom);
                        }
                      }}
                      options={[
                        ...inboundMailboxOptions.map((mailbox) => ({ value: mailbox, label: mailbox })),
                        { value: 'custom', label: t('managed.outbound.ticketingFrom.customOptionLabel', { domain: outboundDomain }) }
                      ]}
                      placeholder={t('managed.outbound.ticketingFrom.selectPlaceholder')}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('managed.outbound.ticketingFrom.connectedInboxHelp')}
                    </p>
                  </div>
                )}

                {(inboundMailboxOptions.length === 0 || ticketingFromOption === 'custom') && (
                  <div className="space-y-2">
                    <Label htmlFor="ticketing-from-custom">{t('managed.outbound.ticketingFrom.customLabel')}</Label>
                    <Input
                      id="ticketing-from-custom"
                      value={ticketingFromCustom}
                      disabled={loadingOutbound || !outboundDomain}
                      placeholder={t('managed.outbound.ticketingFrom.customPlaceholder', { domain: outboundDomain })}
                      onChange={(e) => handleTicketingFromChange(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {outboundProvider === 'smtp'
                        ? t('managed.outbound.ticketingFrom.customSmtpHelp')
                        : t('managed.outbound.ticketingFrom.customManagedHelp', { domain: outboundDomain })}
                    </p>
                  </div>
                )}

                {ticketingFromWarning && (
                  <Alert variant="warning">
                    <AlertTitle>{t('managed.outbound.ticketingFrom.warningTitle')}</AlertTitle>
                    <AlertDescription>{ticketingFromWarning}</AlertDescription>
                  </Alert>
                )}

                {ticketingFromError && (
                  <Alert variant="destructive">
                    <AlertTitle>{t('managed.outbound.ticketingFrom.errorTitle')}</AlertTitle>
                    <AlertDescription>{ticketingFromError}</AlertDescription>
                  </Alert>
                )}

                <div className="flex justify-end gap-2">
                  {emailSettings?.ticketingFromEmail ? (
                    <Button
                      id="clear-ticketing-from"
                      variant="outline"
                      onClick={() => setShowClearTicketingFromDialog(true)}
                      disabled={savingTicketingFrom || loadingOutbound}
                    >
                      {t('managed.outbound.ticketingFrom.clearButton')}
                    </Button>
                  ) : null}
                  <Button
                    id="save-ticketing-from"
                    onClick={handleSaveTicketingFrom}
                    disabled={
                      savingTicketingFrom ||
                      loadingOutbound ||
                      !!ticketingFromError ||
                      !outboundDomain ||
                      !(ticketingFromOption === 'custom' ? ticketingFromCustom.trim() : ticketingFromOption)
                    }
                  >
                    {savingTicketingFrom ? t('managed.outbound.ticketingFrom.savingButton') : t('managed.outbound.ticketingFrom.saveButton')}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
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
