/**
 * Email Provider List Component
 * Displays a list of configured email providers with management actions
 */

'use client';

import React from 'react';
import { Button } from './ui/Button';
import { getInboundTicketDefaults } from 'server/src/lib/actions/email-actions/inboundTicketDefaultsActions';
import { updateEmailProvider } from 'server/src/lib/actions/email-actions/emailProviderActions';
import type { EmailProvider } from './EmailProviderConfiguration';
import { EmailProviderCard, EmptyProviderPlaceholder } from './EmailProviderCard';
import { RefreshCw } from 'lucide-react';

interface EmailProviderListProps {
  providers: EmailProvider[];
  onEdit: (provider: EmailProvider) => void;
  onDelete: (providerId: string) => void;
  onTestConnection: (provider: EmailProvider) => void;
  onRefresh: () => void;
  onRefreshWatchSubscription: (provider: EmailProvider) => void;
  onRetryRenewal: (provider: EmailProvider) => void;
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
  onRunDiagnostics,
  onAddClick
}: EmailProviderListProps) {
  const [defaultsOptions, setDefaultsOptions] = React.useState<{ value: string; label: string }[]>([]);
  const [updatingProviderId, setUpdatingProviderId] = React.useState<string | null>(null);

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

  if (providers.length === 0) {
    return <EmptyProviderPlaceholder onAddClick={onAddClick} />;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Email Providers ({providers.length})</h3>
        <Button id="refresh-providers" variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Provider Cards */}
      <div className="grid gap-4">
        {providers.map((provider) => (
          <EmailProviderCard
            key={provider.id}
            provider={provider}
            defaultsOptions={defaultsOptions}
            updatingProviderId={updatingProviderId}
            onEdit={onEdit}
            onDelete={onDelete}
            onTestConnection={onTestConnection}
            onRefreshWatchSubscription={onRefreshWatchSubscription}
            onRetryRenewal={onRetryRenewal}
            onRunDiagnostics={onRunDiagnostics}
            onChangeDefaults={handleChangeDefaults}
          />
        ))}
      </div>
    </div>
  );
}
