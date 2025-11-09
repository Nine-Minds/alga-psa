/**
 * Enterprise Email Settings with managed domain orchestration UI.
 */

'use client';

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'server/src/components/ui/Tabs';
import { Globe, Send, Inbox } from 'lucide-react';
import {
  getManagedEmailDomains,
  requestManagedEmailDomain,
  refreshManagedEmailDomain,
  deleteManagedEmailDomain,
  ManagedDomainStatus,
} from '@ee/lib/actions/email-actions/managedDomainActions';
import { EmailProviderConfiguration } from 'server/src/components/EmailProviderConfiguration';
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

  useEffect(() => {
    loadDomains();
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
