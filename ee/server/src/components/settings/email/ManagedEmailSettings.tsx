/**
 * Enterprise Email Settings with managed domain orchestration UI.
 */

'use client';

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Globe, Send, Inbox } from 'lucide-react';
import {
  getManagedEmailDomains,
  requestManagedEmailDomain,
  refreshManagedEmailDomain,
  deleteManagedEmailDomain,
  ManagedDomainStatus,
} from '@ee/lib/actions/email-actions/managedDomainActions';
import { EmailProviderConfiguration } from '@alga-psa/integrations/components';
import type { EmailProvider } from '@alga-psa/integrations/components';
import type { TenantEmailSettings } from 'server/src/types/email.types';
import { getEmailSettings, updateEmailSettings } from 'server/src/lib/actions/email-actions/emailSettingsActions';
import { getEmailProviders } from 'server/src/lib/actions/email-actions/emailProviderActions';
import ManagedDomainList from './ManagedDomainList';

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

export const ManagedEmailSettings: React.FC<EmailSettingsProps> = () => {
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
  const [loadingOutbound, setLoadingOutbound] = useState(true);

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
      toast.error(err.message || 'Failed to load managed domains');
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
      }

      const providers = providerResult?.providers || [];
      setInboundProviders(providers);
      initializeTicketingFromSelection(settings, providers);
    } catch (err: any) {
      console.error('[ManagedEmailSettings] Failed to load outbound settings', err);
      toast.error(err.message || 'Failed to load outbound email settings');
    } finally {
      setLoadingOutbound(false);
    }
  };

  const getOutboundDomain = (settings?: TenantEmailSettings | null): string | null => {
    const verifiedDomain = domains.find((d) => d.status === 'verified')?.domain || null;
    return settings?.defaultFromDomain || verifiedDomain || null;
  };

  const validateTicketingFrom = (value: string, outboundDomain?: string | null): string | null => {
    if (!value || !value.trim()) {
      return 'Enter a from email address';
    }

    if (!outboundDomain) {
      return 'Add and verify an outbound domain before choosing a from address';
    }

    const trimmed = value.trim();
    if (!/^[^\s@]+@[^\s@]+$/.test(trimmed)) {
      return 'Enter a valid email address';
    }

    const domain = trimmed.split('@').pop()?.toLowerCase();
    if (!domain || domain !== outboundDomain.toLowerCase()) {
      return `From address must use @${outboundDomain}`;
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
    } else if (mailboxes.length > 0) {
      setTicketingFromOption(mailboxes[0]);
      setTicketingFromCustom(mailboxes[0]);
    } else {
      setTicketingFromOption('custom');
      setTicketingFromCustom('');
    }

    setTicketingFromError(current ? validateTicketingFrom(current, outboundDomain) : null);

    if (mailboxes.length > 0 && current && !hasMatch) {
      setTicketingFromWarning('Using a custom address may prevent inbound ticket replies from threading correctly.');
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

    if (mailboxes.length > 0 && value && !mailboxes.includes(value.trim().toLowerCase())) {
      setTicketingFromWarning('Inbound ticket processing may not work with this address because it is not one of your connected inboxes.');
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
      });

      setEmailSettings(updated);
      initializeTicketingFromSelection(updated, inboundProviders);
      toast.success('Ticketing from address updated');
    } catch (err: any) {
      console.error('[ManagedEmailSettings] Failed to update ticketing from address', err);
      toast.error(err.message || 'Failed to save ticketing from address');
    } finally {
      setSavingTicketingFrom(false);
    }
  };


  const handleAddDomain = async () => {
    if (!newDomain.trim()) {
      toast.error('Enter a domain name');
      return;
    }

    setBusyDomain(newDomain.trim());
    try {
      const requester = overrides?.requestManagedEmailDomain ?? requestManagedEmailDomain;
      await requester(newDomain.trim());
      toast.success('Domain request submitted');
      setNewDomain('');
      await loadDomains();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to request domain');
    } finally {
      setBusyDomain(null);
    }
  };

  const handleRefreshDomain = async (domain: string) => {
    setBusyDomain(domain);
    try {
      const refresher = overrides?.refreshManagedEmailDomain ?? refreshManagedEmailDomain;
      await refresher(domain);
      toast.success('Verification re-check scheduled');
      await loadDomains();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to refresh domain status');
    } finally {
      setBusyDomain(null);
    }
  };

  const handleDeleteDomain = async (domain: string) => {
    setBusyDomain(domain);
    try {
      const deleter = overrides?.deleteManagedEmailDomain ?? deleteManagedEmailDomain;
      await deleter(domain);
      toast.success('Domain removal scheduled');
      await loadDomains();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to remove domain');
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
          Inbound Email
        </TabsTrigger>
        <TabsTrigger value="outbound" className="flex items-center gap-2">
          <Send className="h-4 w-4" />
          Outbound Email
        </TabsTrigger>
      </TabsList>

      <TabsContent value="outbound" className="space-y-6">
        <div className="text-sm text-muted-foreground mb-4">
          Configure managed sending domains for your organization.
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Managed Domains
            </CardTitle>
            <CardDescription>
              Add a custom domain and follow the DNS instructions to verify ownership.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-4">
              <div>
                <Label htmlFor="managed-domain-input">Domain</Label>
                <Input
                  id="managed-domain-input"
                  placeholder="example.com"
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
                Add Domain
              </Button>
            </div>

            <ManagedDomainList
              domains={domains}
              loading={loadingDomains}
              busyDomain={busyDomain}
              onRefresh={handleRefreshDomain}
              onDelete={handleDeleteDomain}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Ticketing From Address
            </CardTitle>
            <CardDescription>
              Choose the email address that will appear in the From header on ticket notifications.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Address must use your outbound domain ({outboundDomain || 'not set'}). Replies work best when you use a connected inbound inbox.
            </p>

            {!outboundDomain ? (
              <Alert variant="warning">
                <AlertTitle>Outbound domain required</AlertTitle>
                <AlertDescription>
                  Add and verify a managed domain before selecting a ticketing from address.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-4">
                {inboundMailboxOptions.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="ticketing-from-select">Connected inbox</Label>
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
                        { value: 'custom', label: `Other address on ${outboundDomain}` }
                      ]}
                      placeholder="Select from address"
                    />
                    <p className="text-xs text-muted-foreground">
                      Select a connected inbox to keep inbound replies threaded.
                    </p>
                  </div>
                )}

                {(inboundMailboxOptions.length === 0 || ticketingFromOption === 'custom') && (
                  <div className="space-y-2">
                    <Label htmlFor="ticketing-from-custom">From address</Label>
                    <Input
                      id="ticketing-from-custom"
                      value={ticketingFromCustom}
                      disabled={loadingOutbound || !outboundDomain}
                      placeholder={`support@${outboundDomain}`}
                      onChange={(e) => handleTicketingFromChange(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Must match {outboundDomain}. If this isn&apos;t one of your inbound inboxes, inbound ticket processing may not work.
                    </p>
                  </div>
                )}

                {ticketingFromWarning && (
                  <Alert variant="warning">
                    <AlertTitle>Heads up</AlertTitle>
                    <AlertDescription>{ticketingFromWarning}</AlertDescription>
                  </Alert>
                )}

                {ticketingFromError && (
                  <Alert variant="destructive">
                    <AlertTitle>Fix the from address</AlertTitle>
                    <AlertDescription>{ticketingFromError}</AlertDescription>
                  </Alert>
                )}

                <div className="flex justify-end">
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
                    {savingTicketingFrom ? 'Saving...' : 'Save From Address'}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="inbound" className="space-y-6">
        <div className="text-sm text-muted-foreground mb-4">
          Configure inbound email routing and provider-specific automation.
        </div>
        <EmailProviderConfiguration />
      </TabsContent>
    </Tabs>
  );
};

export default ManagedEmailSettings;
