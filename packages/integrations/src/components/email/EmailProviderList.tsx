/**
 * Email Provider List Component
 * Displays a list of configured email providers with management actions
 */

'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { getInboundTicketDefaults } from '@alga-psa/integrations/actions';
import { updateEmailProvider } from '@alga-psa/integrations/actions';
import type { EmailProvider } from './EmailProviderConfiguration';
import { EmailProviderCard, EmptyProviderPlaceholder } from './EmailProviderCard';
import { RefreshCw } from 'lucide-react';

interface EmailProviderListProps {
  providers: EmailProvider[];
  onEdit: (provider: EmailProvider) => void;
  onDelete: (providerId: string) => void;
  onTestConnection: (provider: EmailProvider) => Promise<void>;
  onRefresh: () => void;
  onRefreshWatchSubscription: (provider: EmailProvider) => void;
  onRetryRenewal: (provider: EmailProvider) => void;
  onReconnectOAuth?: (provider: EmailProvider) => void;
  onResyncProvider?: (provider: EmailProvider) => Promise<void>;
  onRunDiagnostics: (provider: EmailProvider) => void;
  onAddClick?: () => void;
}

export function EmailProviderList({
  providers,
  onEdit,
  onDelete,
  onTestConnection,
  onRefresh,
  onRefreshWatchSubscription,
  onRetryRenewal,
  onReconnectOAuth,
  onResyncProvider,
  onRunDiagnostics,
  onAddClick
}: EmailProviderListProps) {
  const [defaultsOptions, setDefaultsOptions] = React.useState<{ value: string; label: string }[]>([]);
  const [updatingProviderId, setUpdatingProviderId] = React.useState<string | null>(null);
  const [busyProviderId, setBusyProviderId] = React.useState<string | null>(null);
  const [busyAction, setBusyAction] = React.useState<'test' | 'resync' | null>(null);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [providerFilter, setProviderFilter] = React.useState<'all' | 'google' | 'microsoft' | 'imap'>('all');

  React.useEffect(() => {
    const loadDefaults = async () => {
      try {
        const res = await getInboundTicketDefaults();
        const options = (res.defaults || []).map((d) => ({ value: d.id, label: d.display_name || d.short_name }));
        setDefaultsOptions(options);
      } catch (e) {
        // Non-fatal; keep options empty
        console.error('Failed to load inbound defaults', e);
      }
    };
    loadDefaults();
  }, []);

  const handleChangeDefaults = async (provider: EmailProvider, newDefaultsId?: string) => {
    try {
      setUpdatingProviderId(provider.id);
      await updateEmailProvider(provider.id, {
        tenant: provider.tenant,
        providerType: provider.providerType,
        providerName: provider.providerName,
        mailbox: provider.mailbox,
        isActive: provider.isActive,
        inboundTicketDefaultsId: newDefaultsId || undefined,
      } as any);
      onRefresh();
    } catch (e) {
      console.error('Failed to update provider defaults', e);
    } finally {
      setUpdatingProviderId(null);
    }
  };

  const handleTestConnectionInternal = async (provider: EmailProvider) => {
    try {
      setBusyProviderId(provider.id);
      setBusyAction('test');
      await onTestConnection(provider);
    } finally {
      setBusyProviderId(null);
      setBusyAction(null);
    }
  };

  const handleResyncProviderInternal = async (provider: EmailProvider) => {
    if (!onResyncProvider) return;
    try {
      setBusyProviderId(provider.id);
      setBusyAction('resync');
      await onResyncProvider(provider);
    } finally {
      setBusyProviderId(null);
      setBusyAction(null);
    }
  };

  const filteredProviders = providers.filter((provider) => {
    const matchesFilter = providerFilter === 'all' || provider.providerType === providerFilter;
    const matchesSearch = !searchTerm
      || provider.providerName.toLowerCase().includes(searchTerm.toLowerCase())
      || provider.mailbox.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  if (filteredProviders.length === 0) {
    return <EmptyProviderPlaceholder onAddClick={onAddClick} />;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h3 className="text-lg font-medium">Email Providers ({filteredProviders.length})</h3>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <Input
            id="provider-search"
            placeholder="Search providers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <CustomSelect
            id="provider-filter"
            value={providerFilter}
            onValueChange={(v) => setProviderFilter(v as any)}
            options={[
              { value: 'all', label: 'All Providers' },
              { value: 'google', label: 'Gmail' },
              { value: 'microsoft', label: 'Microsoft 365' },
              { value: 'imap', label: 'IMAP' },
            ]}
          />
          <Button id="refresh-providers" variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
        </div>
      </div>

      {/* Provider Cards */}
      <div className="grid gap-4">
        {filteredProviders.map((provider) => (
          <EmailProviderCard
            key={provider.id}
            provider={provider}
            defaultsOptions={defaultsOptions}
            updatingProviderId={updatingProviderId}
            busy={busyProviderId === provider.id}
            busyAction={busyProviderId === provider.id ? busyAction : null}
            onEdit={onEdit}
            onDelete={onDelete}
            onTestConnection={handleTestConnectionInternal}
            onRefreshWatchSubscription={onRefreshWatchSubscription}
            onRetryRenewal={onRetryRenewal}
            onReconnectOAuth={onReconnectOAuth}
            onResyncProvider={onResyncProvider ? handleResyncProviderInternal : undefined}
            onRunDiagnostics={onRunDiagnostics}
            onChangeDefaults={handleChangeDefaults}
          />
        ))}
      </div>
    </div>
  );
}
