import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import {
  Settings,
  Trash2,
  TestTube,
  RefreshCw,
  MoreVertical,
  Mail,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  Repeat,
  Stethoscope,
} from 'lucide-react';
import type { EmailProvider } from './types';
import { INBOUND_DEFAULTS_WARNING, providerNeedsInboundDefaults } from './emailProviderDefaults';

interface EmailProviderCardProps {
  provider: EmailProvider;
  defaultsOptions: { value: string; label: string }[];
  updatingProviderId: string | null;
  busy?: boolean;
  busyAction?: 'test' | 'resync' | null;
  onEdit: (provider: EmailProvider) => void;
  onDelete: (providerId: string) => void;
  onTestConnection: (provider: EmailProvider) => void | Promise<void>;
  onRefreshWatchSubscription: (provider: EmailProvider) => void;
  onRetryRenewal: (provider: EmailProvider) => void;
  onReconnectOAuth?: (provider: EmailProvider) => void;
  onResyncProvider?: (provider: EmailProvider) => void | Promise<void>;
  onRunDiagnostics: (provider: EmailProvider) => void;
  onChangeDefaults: (provider: EmailProvider, defaultsId?: string) => void | Promise<void>;
}

const getProviderIcon = (providerType: string) => {
  switch (providerType) {
    case 'microsoft':
      return '🟦';
    case 'google':
      return '🟩';
    case 'imap':
      return '🟪';
    default:
      return '📧';
  }
};

export function EmailProviderCard({
  provider,
  defaultsOptions,
  updatingProviderId,
  busy = false,
  busyAction = null,
  onEdit,
  onDelete,
  onTestConnection,
  onRefreshWatchSubscription,
  onRetryRenewal,
  onReconnectOAuth,
  onResyncProvider,
  onRunDiagnostics,
  onChangeDefaults,
}: EmailProviderCardProps) {
  const { t } = useTranslation('msp/email-providers');

  const getExpirationStatus = (activeProvider: EmailProvider) => {
    if (activeProvider.providerType !== 'microsoft' || !activeProvider.microsoftConfig?.webhook_expires_at) {
      return null;
    }
    const expiresAt = new Date(activeProvider.microsoftConfig.webhook_expires_at);
    const now = new Date();
    const diffMs = expiresAt.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours < 0) {
      return { label: t('providerCard.subscription.expired', { defaultValue: 'Expired' }), color: 'text-red-500' };
    }
    if (diffHours < 24) {
      return {
        label: t('providerCard.subscription.expiresInHours', { defaultValue: 'Expires in {{count}}h', count: Math.ceil(diffHours) }),
        color: 'text-yellow-600'
      };
    }
    return {
      label: t('providerCard.subscription.expiresInDays', { defaultValue: 'Expires in {{count}}d', count: Math.ceil(diffHours / 24) }),
      color: 'text-muted-foreground'
    };
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
      return <Badge variant="secondary">{t('providerCard.badges.disabled', { defaultValue: 'Disabled' })}</Badge>;
    }

    switch (status) {
      case 'connected':
        return <Badge variant="success">{t('providerCard.badges.connected', { defaultValue: 'Connected' })}</Badge>;
      case 'disconnected':
        return <Badge variant="secondary">{t('providerCard.badges.disconnected', { defaultValue: 'Disconnected' })}</Badge>;
      case 'error':
        return <Badge variant="error">{t('providerCard.badges.error', { defaultValue: 'Error' })}</Badge>;
      case 'configuring':
        return <Badge variant="secondary">{t('providerCard.badges.configuring', { defaultValue: 'Configuring' })}</Badge>;
      default:
        return <Badge variant="secondary">{t('providerCard.badges.unknown', { defaultValue: 'Unknown' })}</Badge>;
    }
  };

  const formatLastSync = (lastSyncAt?: string) => {
    if (!lastSyncAt) return t('providerCard.lastSync.never', { defaultValue: 'Never' });

    const date = new Date(lastSyncAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));

    if (diffMins < 1) return t('providerCard.lastSync.justNow', { defaultValue: 'Just now' });
    if (diffMins < 60) return t('providerCard.lastSync.minutesAgo', { defaultValue: '{{count}}m ago', count: diffMins });
    if (diffMins < 1440) return t('providerCard.lastSync.hoursAgo', { defaultValue: '{{count}}h ago', count: Math.floor(diffMins / 60) });
    return t('providerCard.lastSync.daysAgo', { defaultValue: '{{count}}d ago', count: Math.floor(diffMins / 1440) });
  };

  const expirationStatus = getExpirationStatus(provider);

  return (
    <Card className={`transition-all ${!provider.isActive ? 'opacity-60' : ''}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="text-2xl">{getProviderIcon(provider.providerType)}</div>
            <div>
              <CardTitle className="text-base">{provider.providerName}</CardTitle>
              <CardDescription className="flex items-center space-x-2">
                <span>{provider.mailbox}</span>
                <span>•</span>
                <span>{t(`providerCard.types.${provider.providerType}`, { defaultValue: provider.providerType })}</span>
              </CardDescription>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {getStatusBadge(provider.status, provider.isActive)}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button id={`provider-menu-${provider.id}`} variant="ghost" size="sm" disabled={busy}>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(provider)} disabled={busy}>
                  <Settings className="h-4 w-4 mr-2" />
                  {t('providerCard.actions.edit', { defaultValue: 'Edit Configuration' })}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onTestConnection(provider)} disabled={busy}>
                  <TestTube className="h-4 w-4 mr-2" />
                  {busy && busyAction === 'test'
                    ? t('providerCard.actions.testing', { defaultValue: 'Testing…' })
                    : t('providerCard.actions.testConnection', { defaultValue: 'Test Connection' })}
                </DropdownMenuItem>
                {provider.providerType === 'google' && (
                  <DropdownMenuItem onClick={() => onRefreshWatchSubscription(provider)} disabled={busy}>
                    <Repeat className="h-4 w-4 mr-2" />
                    {t('providerCard.actions.refreshWatch', { defaultValue: 'Refresh Pub/Sub & Watch' })}
                  </DropdownMenuItem>
                )}
                {provider.providerType === 'microsoft' && (
                  <>
                    <DropdownMenuItem onClick={() => onRetryRenewal(provider)} disabled={busy}>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      {t('providerCard.actions.retryRenewal', { defaultValue: 'Retry Renewal' })}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onRunDiagnostics(provider)} disabled={busy}>
                      <Stethoscope className="h-4 w-4 mr-2" />
                      {t('providerCard.actions.runDiagnostics', { defaultValue: 'Run Microsoft 365 Diagnostics' })}
                    </DropdownMenuItem>
                  </>
                )}
                {provider.providerType === 'imap' && provider.imapConfig?.auth_type === 'oauth2' && onReconnectOAuth && (
                  <DropdownMenuItem onClick={() => onReconnectOAuth(provider)} disabled={busy}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    {t('providerCard.actions.reconnectOauth', { defaultValue: 'Reconnect OAuth' })}
                  </DropdownMenuItem>
                )}
                {provider.providerType === 'imap' && onResyncProvider && (
                  <DropdownMenuItem onClick={() => onResyncProvider(provider)} disabled={busy}>
                    <Repeat className="h-4 w-4 mr-2" />
                    {busy && busyAction === 'resync'
                      ? t('providerCard.actions.resyncing', { defaultValue: 'Resyncing…' })
                      : t('providerCard.actions.resyncMailbox', { defaultValue: 'Resync Mailbox' })}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onDelete(provider.id)}
                  className="text-red-600"
                  disabled={busy}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t('providerCard.actions.delete', { defaultValue: 'Delete Provider' })}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="flex items-center space-x-1 text-muted-foreground mb-1">
              {getStatusIcon(provider.status)}
              <span>{t('providerCard.fields.status', { defaultValue: 'Status' })}</span>
            </div>
            <div className="font-medium">
              {provider.status === 'connected' && provider.isActive
                ? t('providerCard.values.active', { defaultValue: 'Active' })
                : provider.status === 'error'
                ? t('providerCard.values.error', { defaultValue: 'Error' })
                : !provider.isActive
                ? t('providerCard.values.disabled', { defaultValue: 'Disabled' })
                : t('providerCard.values.inactive', { defaultValue: 'Inactive' })}
            </div>
          </div>

          <div>
            <div className="text-muted-foreground mb-1">{t('providerCard.fields.lastSync', { defaultValue: 'Last Sync' })}</div>
            <div className="font-medium">{formatLastSync(provider.lastSyncAt)}</div>
          </div>

          <div>
            <div className="text-muted-foreground mb-1">{t('providerCard.fields.created', { defaultValue: 'Created' })}</div>
            <div className="font-medium">
              {new Date(provider.createdAt).toLocaleDateString()}
            </div>
          </div>

          {expirationStatus && (
            <div>
              <div className="text-muted-foreground mb-1">{t('providerCard.fields.subscription', { defaultValue: 'Subscription' })}</div>
              <div className={`font-medium ${expirationStatus.color}`}>
                {expirationStatus.label}
              </div>
            </div>
          )}
        </div>

        {provider.status === 'error' && provider.errorMessage && (
          <Alert variant="destructive" className="mt-3">
            <AlertDescription>
              <strong>{t('providerCard.fields.error', { defaultValue: 'Error:' })}</strong> {provider.errorMessage}
            </AlertDescription>
          </Alert>
        )}

        {providerNeedsInboundDefaults(provider) && (
          <Alert variant="destructive" className="mt-3">
            <AlertDescription>{t('providerCard.warnings.inboundDefaults', {
              defaultValue: INBOUND_DEFAULTS_WARNING,
            })}</AlertDescription>
          </Alert>
        )}

        <div className="mt-3 pt-3 border-t">
          <div className="text-xs text-muted-foreground space-x-4">
            {provider.providerType === 'microsoft' && provider.microsoftConfig && (
              <>
                {provider.microsoftConfig.folder_filters && provider.microsoftConfig.folder_filters.length > 0 && (
                  <span>{t('providerCard.filters.folders', {
                    defaultValue: 'Folders: {{filters}}',
                    filters: provider.microsoftConfig.folder_filters.join(', '),
                  })}</span>
                )}
              </>
            )}
            {provider.providerType === 'google' && provider.googleConfig && (
              <>
                {provider.googleConfig.label_filters && provider.googleConfig.label_filters.length > 0 && (
                  <span>{t('providerCard.filters.labels', {
                    defaultValue: 'Labels: {{filters}}',
                    filters: provider.googleConfig.label_filters.join(', '),
                  })}</span>
                )}
              </>
            )}
            {provider.providerType === 'imap' && provider.imapConfig && (
              <>
                {provider.imapConfig.folder_filters && provider.imapConfig.folder_filters.length > 0 && (
                  <span>{t('providerCard.filters.folders', {
                    defaultValue: 'Folders: {{filters}}',
                    filters: provider.imapConfig.folder_filters.join(', '),
                  })}</span>
                )}
              </>
            )}
          </div>
        </div>

        <div className="mt-4">
          <CustomSelect
            id={`provider-defaults-select-${provider.id}`}
            label={t('providerCard.fields.defaults', { defaultValue: 'Ticket Defaults' })}
            value={provider.inboundTicketDefaultsId || ''}
            onValueChange={(v) => onChangeDefaults(provider, v || undefined)}
            options={defaultsOptions}
            placeholder={defaultsOptions.length
              ? t('providerCard.defaults.placeholder', { defaultValue: 'Select defaults...' })
              : t('providerCard.defaults.empty', { defaultValue: 'No defaults available' })}
            allowClear
            disabled={updatingProviderId === provider.id}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function EmptyProviderPlaceholder({ onAddClick }: { onAddClick?: () => void }) {
  const { t } = useTranslation('msp/email-providers');

  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12">
        <Mail className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">{t('providerCard.empty.title', { defaultValue: 'No Email Providers Configured' })}</h3>
        <p className="text-muted-foreground text-center mb-4">
          {t('providerCard.empty.description', { defaultValue: 'Add an email provider to start receiving and processing inbound emails as tickets.' })}
        </p>
        {onAddClick && (
          <Button id="empty-add-provider-btn" onClick={onAddClick}>
            {t('providerCard.empty.action', { defaultValue: 'Add Email Provider' })}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
