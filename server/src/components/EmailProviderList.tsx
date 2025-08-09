/**
 * Email Provider List Component
 * Displays a list of configured email providers with management actions
 */

'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
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
  Repeat
} from 'lucide-react';
import type { EmailProvider } from './EmailProviderConfiguration';

interface EmailProviderListProps {
  providers: EmailProvider[];
  onEdit: (provider: EmailProvider) => void;
  onDelete: (providerId: string) => void;
  onTestConnection: (provider: EmailProvider) => void;
  onRefresh: () => void;
  onRefreshWatchSubscription: (provider: EmailProvider) => void;
}

export function EmailProviderList({
  providers,
  onEdit,
  onDelete,
  onTestConnection,
  onRefresh,
  onRefreshWatchSubscription
}: EmailProviderListProps) {
  
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
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Mail className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No Email Providers Configured</h3>
          <p className="text-muted-foreground text-center mb-4">
            Add an email provider to start receiving and processing inbound emails as tickets.
          </p>
        </CardContent>
      </Card>
    );
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
          <Card key={provider.id} className={`transition-all ${!provider.isActive ? 'opacity-60' : ''}`}>
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
                    {provider.status === 'connected' && provider.isActive ? 'Active' : 
                     provider.status === 'error' ? 'Error' : 
                     !provider.isActive ? 'Disabled' : 'Inactive'}
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
              </div>

              {/* Error Message */}
              {provider.status === 'error' && provider.errorMessage && (
                <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                  <strong>Error:</strong> {provider.errorMessage}
                </div>
              )}

              {/* Configuration Summary */}
              <div className="mt-3 pt-3 border-t">
                <div className="text-xs text-muted-foreground space-x-4">
                  {provider.providerType === 'microsoft' && provider.microsoftConfig && (
                    <>
                      <span>Auto-process: {provider.microsoftConfig.auto_process_emails ? 'Enabled' : 'Disabled'}</span>
                      <span>Max per sync: {provider.microsoftConfig.max_emails_per_sync || 50}</span>
                      {provider.microsoftConfig.folder_filters && provider.microsoftConfig.folder_filters.length > 0 && (
                        <span>Folders: {provider.microsoftConfig.folder_filters.join(', ')}</span>
                      )}
                    </>
                  )}
                  {provider.providerType === 'google' && provider.googleConfig && (
                    <>
                      <span>Auto-process: {provider.googleConfig.auto_process_emails ? 'Enabled' : 'Disabled'}</span>
                      <span>Max per sync: {provider.googleConfig.max_emails_per_sync || 50}</span>
                      {provider.googleConfig.label_filters && provider.googleConfig.label_filters.length > 0 && (
                        <span>Labels: {provider.googleConfig.label_filters.join(', ')}</span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}