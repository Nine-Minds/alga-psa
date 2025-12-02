'use client';

/**
 * Remote Access Button Component
 *
 * Allows users to initiate remote access sessions to RMM-managed assets.
 * Currently supports NinjaOne integration.
 */

import React, { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import {
  Monitor,
  Terminal,
  Loader2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { getNinjaOneRemoteAccessUrl } from '../../lib/actions/integrations/ninjaoneActions';
import type { Asset } from '@/interfaces/asset.interfaces';

interface RemoteAccessButtonProps {
  asset: Asset;
  variant?: 'default' | 'secondary' | 'ghost' | 'outline';
  size?: 'default' | 'sm' | 'lg';
  className?: string;
}

type ConnectionType = 'desktop' | 'shell';

export function RemoteAccessButton({
  asset,
  variant = 'secondary',
  size = 'sm',
  className = '',
}: RemoteAccessButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [activeConnection, setActiveConnection] = useState<ConnectionType | null>(null);

  // Check if asset is RMM-managed
  const isRmmManaged = asset.rmm_provider && asset.rmm_device_id;
  const isNinjaOne = asset.rmm_provider === 'ninjaone';

  // Don't render if not RMM managed or agent is offline
  if (!isRmmManaged) {
    return null;
  }

  const handleRemoteAccess = async (connectionType: ConnectionType) => {
    setError(null);
    setActiveConnection(connectionType);

    startTransition(async () => {
      try {
        const result = await getNinjaOneRemoteAccessUrl(asset.asset_id);

        if (!result.success || !result.url) {
          throw new Error(result.error || 'Failed to get remote access URL');
        }

        // Open in new window
        window.open(result.url, '_blank', 'noopener,noreferrer');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to initiate remote access';
        setError(message);
      } finally {
        setActiveConnection(null);
      }
    });
  };

  // If agent is offline, show disabled state with tooltip
  if (asset.agent_status === 'offline') {
    return (
      <Button
        id="remote-access-button"
        variant={variant}
        size={size}
        className={`gap-2 ${className}`}
        disabled
        title="Device is offline"
      >
        <Monitor className="h-4 w-4" />
        Remote Access
      </Button>
    );
  }

  return (
    <div className="relative">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            id="remote-access-button"
            variant={variant}
            size={size}
            className={`gap-2 ${className}`}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Monitor className="h-4 w-4" />
            )}
            Remote Access
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            onClick={() => handleRemoteAccess('desktop')}
            disabled={isPending}
            className="gap-2"
          >
            <Monitor className="h-4 w-4" />
            <span>Remote Desktop</span>
            <ExternalLink className="ml-auto h-3 w-3 text-muted-foreground" />
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => handleRemoteAccess('shell')}
            disabled={isPending}
            className="gap-2"
          >
            <Terminal className="h-4 w-4" />
            <span>Remote Shell</span>
            <ExternalLink className="ml-auto h-3 w-3 text-muted-foreground" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {error && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50">
          <Alert variant="destructive" className="py-2">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        </div>
      )}
    </div>
  );
}

/**
 * Inline remote access indicator for asset lists
 */
export function RemoteAccessIndicator({ asset }: { asset: Asset }) {
  const isRmmManaged = asset.rmm_provider && asset.rmm_device_id;

  if (!isRmmManaged) {
    return null;
  }

  const isOnline = asset.agent_status === 'online';

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${
        isOnline ? 'text-emerald-600' : 'text-gray-400'
      }`}
      title={isOnline ? 'Remote access available' : 'Device offline'}
    >
      <Monitor className="h-3 w-3" />
      {isOnline ? 'Online' : 'Offline'}
    </span>
  );
}

export default RemoteAccessButton;
