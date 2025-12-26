import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Alert, AlertDescription } from './ui/Alert';
import CustomSelect from './ui/CustomSelect';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/DropdownMenu';
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
} from 'lucide-react';
import type { EmailProvider } from './EmailProviderConfiguration';
import { INBOUND_DEFAULTS_WARNING, providerNeedsInboundDefaults } from './emailProviderDefaults';

interface EmailProviderCardProps {
  provider: EmailProvider;
  defaultsOptions: { value: string; label: string }[];
  updatingProviderId: string | null;
  onEdit: (provider: EmailProvider) => void;
  onDelete: (providerId: string) => void;
  onTestConnection: (provider: EmailProvider) => void;
  onRefreshWatchSubscription: (provider: EmailProvider) => void;
  onRetryRenewal: (provider: EmailProvider) => void;
  onReconnectOAuth?: (provider: EmailProvider) => void;
  onResyncProvider?: (provider: EmailProvider) => void;
  onChangeDefaults: (provider: EmailProvider, defaultsId?: string) => void | Promise<void>;
}

const getExpirationStatus = (provider: EmailProvider) => {
  if (provider.providerType !== 'microsoft' || !provider.microsoftConfig?.webhook_expires_at) {
    return null;
  }
  const expiresAt = new Date(provider.microsoftConfig.webhook_expires_at);
  const now = new Date();
  const diffMs = expiresAt.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 0) {
    return { label: 'Expired', color: 'text-red-500' };
  }
  if (diffHours < 24) {
    return { label: `Expires in ${Math.ceil(diffHours)}h`, color: 'text-yellow-600' };
  }
  return { label: `Expires in ${Math.ceil(diffHours / 24)}d`, color: 'text-muted-foreground' };
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
      return '🟦';
    case 'google':
      return '🟩';
    case 'imap':
      return '🟪';
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

export function EmailProviderCard({
  provider,
  defaultsOptions,
  updatingProviderId,
  onEdit,
  onDelete,
  onTestConnection,
  onRefreshWatchSubscription,
  onRetryRenewal,
  onChangeDefaults,
  onReconnectOAuth,
  onResyncProvider,
}: EmailProviderCardProps) {
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
                <span className="capitalize">{provider.providerType}</span>
              </CardDescription>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {getStatusBadge(provider.status, provider.isActive)}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button id={`provider-menu-${provider.id}`} variant="ghost" size="sm">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(provider)}>
                  <Settings className="h-4 w-4 mr-2" />
                  Edit Configuration
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onTestConnection(provider)}>
                  <TestTube className="h-4 w-4 mr-2" />
                  Test Connection
                </DropdownMenuItem>
                {provider.providerType === 'google' && (
                  <DropdownMenuItem onClick={() => onRefreshWatchSubscription(provider)}>
                    <Repeat className="h-4 w-4 mr-2" />
                    Refresh Pub/Sub & Watch
                  </DropdownMenuItem>
                )}
                {provider.providerType === 'microsoft' && (
                  <DropdownMenuItem onClick={() => onRetryRenewal(provider)}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Retry Renewal
                  </DropdownMenuItem>
                )}
                {provider.providerType === 'imap' && onReconnectOAuth && (
                  <DropdownMenuItem onClick={() => onReconnectOAuth(provider)}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Reconnect OAuth
                  </DropdownMenuItem>
                )}
                {provider.providerType === 'imap' && onResyncProvider && (
                  <DropdownMenuItem onClick={() => onResyncProvider(provider)}>
                    <Repeat className="h-4 w-4 mr-2" />
                    Resync Mailbox
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onDelete(provider.id)}
                  className="text-red-600"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Provider
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
              <span>Status</span>
            </div>
            <div className="font-medium">
              {provider.status === 'connected' && provider.isActive
                ? 'Active'
                : provider.status === 'error'
                ? 'Error'
                : !provider.isActive
                ? 'Disabled'
                : 'Inactive'}
            </div>
          </div>

          <div>
            <div className="text-muted-foreground mb-1">Last Sync</div>
            <div className="font-medium">{formatLastSync(provider.lastSyncAt)}</div>
          </div>

          <div>
            <div className="text-muted-foreground mb-1">Created</div>
            <div className="font-medium">
              {new Date(provider.createdAt).toLocaleDateString()}
            </div>
          </div>

          {expirationStatus && (
            <div>
              <div className="text-muted-foreground mb-1">Subscription</div>
              <div className={`font-medium ${expirationStatus.color}`}>
                {expirationStatus.label}
              </div>
            </div>
          )}
        </div>

        {provider.status === 'error' && provider.errorMessage && (
          <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            <strong>Error:</strong> {provider.errorMessage}
          </div>
        )}

        {providerNeedsInboundDefaults(provider) && (
          <Alert variant="destructive" className="mt-3">
            <AlertDescription>{INBOUND_DEFAULTS_WARNING}</AlertDescription>
          </Alert>
        )}

        <div className="mt-3 pt-3 border-t">
          <div className="text-xs text-muted-foreground space-x-4">
            {provider.providerType === 'microsoft' && provider.microsoftConfig && (
              <>
                {provider.microsoftConfig.folder_filters && provider.microsoftConfig.folder_filters.length > 0 && (
                  <span>Folders: {provider.microsoftConfig.folder_filters.join(', ')}</span>
                )}
              </>
            )}
            {provider.providerType === 'google' && provider.googleConfig && (
              <>
                {provider.googleConfig.label_filters && provider.googleConfig.label_filters.length > 0 && (
                  <span>Labels: {provider.googleConfig.label_filters.join(', ')}</span>
                )}
              </>
            )}
            {provider.providerType === 'imap' && provider.imapConfig && (
              <>
                {provider.imapConfig.folder_filters && provider.imapConfig.folder_filters.length > 0 && (
                  <span>Folders: {provider.imapConfig.folder_filters.join(', ')}</span>
                )}
              </>
            )}
          </div>
        </div>

        <div className="mt-4">
          <CustomSelect
            id={`provider-defaults-select-${provider.id}`}
            label="Ticket Defaults"
            value={provider.inboundTicketDefaultsId || ''}
            onValueChange={(v) => onChangeDefaults(provider, v || undefined)}
            options={defaultsOptions}
            placeholder={defaultsOptions.length ? 'Select defaults...' : 'No defaults available'}
            allowClear
            disabled={updatingProviderId === provider.id}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function EmptyProviderPlaceholder({ onAddClick }: { onAddClick?: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12">
        <Mail className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">No Email Providers Configured</h3>
        <p className="text-muted-foreground text-center mb-4">
          Add an email provider to start receiving and processing inbound emails as tickets.
        </p>
        {onAddClick && (
          <Button id="empty-add-provider-btn" onClick={onAddClick}>
            Add Email Provider
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
