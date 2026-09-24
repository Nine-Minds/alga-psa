'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ExternalLink, Loader2, Monitor, Terminal } from 'lucide-react';
import type { Asset } from '@alga-psa/types';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@alga-psa/ui/components/DropdownMenu';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useAssetCrossFeature, type AssetRemoteConnectionType } from '../context/AssetCrossFeatureContext';
import { getRemoteAccessLinksForAsset, type RenderedRemoteAccessLink } from '../actions/remoteAccessLinkActions';

export interface RemoteAccessButtonProps {
  asset: Asset;
  variant?: 'default' | 'secondary' | 'ghost' | 'outline';
  size?: 'default' | 'sm' | 'lg';
  className?: string;
}

const ninjaOneTypes: AssetRemoteConnectionType[] = ['splashtop', 'teamviewer', 'vnc', 'rdp', 'shell'];
const providerTypes: Record<string, AssetRemoteConnectionType[]> = {
  ninjaone: ninjaOneTypes,
  tacticalrmm: ['splashtop', 'shell'], // Tactical's `control` URL is its desktop session.
};

function connectionLabel(type: AssetRemoteConnectionType, t: (key: string) => string): string {
  if (type === 'splashtop') return t('remoteAccess.remoteDesktop');
  if (type === 'shell') return t('remoteAccess.remoteShell');
  return t(`remoteAccess.connectionTypes.${type}`);
}

export function RemoteAccessButton({ asset, variant = 'default', size = 'sm', className = '' }: RemoteAccessButtonProps) {
  const { t } = useTranslation('msp/assets');
  const { rmm } = useAssetCrossFeature();
  const [availableTypes, setAvailableTypes] = useState<AssetRemoteConnectionType[] | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState(false);
  const [assetLinks, setAssetLinks] = useState<RenderedRemoteAccessLink[]>([]);
  const candidates = useMemo(() => asset.rmm_provider ? providerTypes[asset.rmm_provider] ?? [] : [], [asset.rmm_provider]);

  useEffect(() => {
    let active = true;
    setAvailableTypes(null);
    if (!asset.rmm_provider || !asset.rmm_device_id || candidates.length === 0) { setAvailableTypes([]); return; }
    rmm.getAssetRemoteControlTypes(asset.asset_id)
      .then((types) => { if (active) setAvailableTypes(types.filter((type) => candidates.includes(type))); })
      .catch(() => { if (active) setAvailableTypes([]); });
    return () => { active = false; };
  }, [asset.asset_id, asset.rmm_device_id, asset.rmm_provider, candidates, rmm]);

  useEffect(() => {
    let active = true;
    getRemoteAccessLinksForAsset(asset.asset_id)
      .then((links) => { if (active) setAssetLinks(links); })
      .catch(() => { if (active) setAssetLinks([]); });
    return () => { active = false; };
  }, [asset.asset_id]);

  const availableRmmTypes = asset.rmm_provider && asset.rmm_device_id && candidates.length > 0
    ? availableTypes?.filter((type) => candidates.includes(type)) ?? []
    : [];
  if (!availableRmmTypes.length && !assetLinks.length) return null;

  const connect = async (type: AssetRemoteConnectionType) => {
    setError(false);
    setIsPending(true);
    // Reserve the tab in the user gesture so browsers do not block it after the async provider call.
    const popup = window.open('', '_blank');
    if (popup) popup.opener = null;
    try {
      const url = await rmm.getAssetRemoteControlUrl(asset.asset_id, type);
      if (!url) {
        setError(true);
        popup?.close();
        return;
      }
      if (popup) popup.location.href = url;
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setError(true);
      popup?.close();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="relative">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button id={`remote-access-button-${asset.asset_id}`} variant={variant} size={size} className={`gap-2 ${className}`} disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Monitor className="h-4 w-4" />}
            {t('remoteAccess.remoteAccess')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {availableRmmTypes.map((type) => (
            <DropdownMenuItem key={type} id={`remote-access-${type}-${asset.asset_id}`} onClick={() => void connect(type)} disabled={isPending} className="gap-2">
              {type === 'shell' ? <Terminal className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
              <span>{connectionLabel(type, t)}</span>
              <ExternalLink className="ml-auto h-3 w-3 text-muted-foreground" />
            </DropdownMenuItem>
          ))}
          {assetLinks.map((link, index) => (
            <DropdownMenuItem
              key={`${link.label}-${index}`}
              id={`remote-access-link-${asset.asset_id}-${index}`}
              onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')}
              className="gap-2"
            >
              <ExternalLink className="h-4 w-4" />
              <span>{link.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && <div className="absolute left-0 right-0 top-full z-50 mt-2"><Alert variant="destructive" className="py-2"><AlertCircle className="h-4 w-4" /><AlertDescription className="text-xs">{t('remoteAccess.errors.urlFetchFailed')}</AlertDescription></Alert></div>}
    </div>
  );
}

export function RemoteAccessIndicator(_props: { asset: Asset; className?: string }) {
  return null;
}

export default RemoteAccessButton;
