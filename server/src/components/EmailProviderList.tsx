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
  onAddClick?: () => void;
}

export function EmailProviderList({
  providers,
  onEdit,
  onDelete,
  onTestConnection,
  onRefresh,
  onRefreshWatchSubscription,
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

  const getStatusIcon = (status: EmailProvider['status']) => {
    switch (status) {
      case 'connected':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'disconnected':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'configuring':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: EmailProvider['status'], isActive: boolean) => {
    if (!isActive) {
      return <Badge variant="secondary">Disabled</Badge>;
    }

    switch (status) {
      case 'connected':
        return <Badge variant="default" className="bg-green-100 text-green-800">Connected</Badge>;
      case 'disconnected':
        return <Badge variant="secondary">Disconnected</Badge>;
      case 'error':
        return <Badge variant="error">Error</Badge>;
      case 'configuring':
        return <Badge variant="secondary">Configuring</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  const getProviderIcon = (providerType: string) => {
    switch (providerType) {
      case 'microsoft':
        return '🟦'; // Microsoft blue square
      case 'google':
        return '🟩'; // Google green square
      default:
        return '📧';
    }
  };

  const formatLastSync = (lastSyncAt?: string) => {
    if (!lastSyncAt) return 'Never';
    
    const date = new Date(lastSyncAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return `${Math.floor(diffMins / 1440)}d ago`;
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
            onChangeDefaults={handleChangeDefaults}
          />
        ))}
      </div>
    </div>
  );
}
