'use client';

import { useCallback, useMemo, useState } from 'react';
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
  hasTemplateLinks?: boolean;
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

export function RemoteAccessButton({ asset, variant = 'default', size = 'sm', className = '', hasTemplateLinks = false }: RemoteAccessButtonProps) {
  const { t } = useTranslation('msp/assets');
  const { rmm } = useAssetCrossFeature();
  const [availableTypes, setAvailableTypes] = useState<AssetRemoteConnectionType[] | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [hasLoadedOptions, setHasLoadedOptions] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState(false);
  const [assetLinks, setAssetLinks] = useState<RenderedRemoteAccessLink[]>([]);
  const candidates = useMemo(() => asset.rmm_provider ? providerTypes[asset.rmm_provider] ?? [] : [], [asset.rmm_provider]);
  const hasRmmCandidates = Boolean(asset.rmm_provider && asset.rmm_device_id && candidates.length > 0);

  const loadOptions = useCallback(async () => {
    if (hasLoadedOptions || isLoadingOptions) return;
    setIsLoadingOptions(true);
    setLoadFailed(false);
    const typeRequest = asset.rmm_provider && asset.rmm_device_id && candidates.length > 0
      ? rmm.getAssetRemoteControlTypes(asset.asset_id)
          .then((types) => setAvailableTypes(types.filter((type) => candidates.includes(type))))
          .catch(() => { setAvailableTypes([]); setLoadFailed(true); })
      : Promise.resolve().then(() => setAvailableTypes([]));
    const linkRequest = getRemoteAccessLinksForAsset(asset.asset_id)
      .then(setAssetLinks)
      .catch(() => { setAssetLinks([]); setLoadFailed(true); });
    await Promise.all([typeRequest, linkRequest]);
    setHasLoadedOptions(true);
    setIsLoadingOptions(false);
  }, [asset.asset_id, asset.rmm_device_id, asset.rmm_provider, candidates, hasLoadedOptions, isLoadingOptions, rmm]);

  const availableRmmTypes = availableTypes?.filter((type) => candidates.includes(type)) ?? [];

  if (!hasRmmCandidates && !hasTemplateLinks) return null;

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
      <DropdownMenu onOpenChange={(open) => { if (open) void loadOptions(); }}>
        <DropdownMenuTrigger asChild>
          <Button id={`remote-access-button-${asset.asset_id}`} data-asset-id={asset.asset_id} variant={variant} size={size} className={`gap-2 ${className}`} disabled={isPending}>
            {isPending || isLoadingOptions ? <Loader2 className="h-4 w-4 animate-spin" /> : <Monitor className="h-4 w-4" />}
            {t('remoteAccess.remoteAccess')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {isLoadingOptions && <div role="status" className="px-2 py-1 text-sm">{t('remoteAccess.links.loading')}</div>}
          {loadFailed && hasLoadedOptions && <div role="alert" className="px-2 py-1 text-sm">{t('remoteAccess.errors.urlFetchFailed')}</div>}
          {hasLoadedOptions && !isLoadingOptions && !loadFailed && !availableRmmTypes.length && !assetLinks.length && (
            <div className="px-2 py-1 text-sm text-muted-foreground">{t('remoteAccess.links.noneAvailable')}</div>
          )}
          {availableRmmTypes.map((type) => (
            <DropdownMenuItem key={type} id={`remote-access-${asset.asset_id}-${type}`} data-asset-id={asset.asset_id} onClick={() => void connect(type)} disabled={isPending} className="gap-2">
              {type === 'shell' ? <Terminal className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
              <span>{connectionLabel(type, t)}</span>
              <ExternalLink className="ml-auto h-3 w-3 text-muted-foreground" />
            </DropdownMenuItem>
          ))}
          {assetLinks.map((link, index) => {
            const url = link.url;
            return (
              <DropdownMenuItem
                key={`${link.label}-${index}`}
                id={`remote-access-template-link-${asset.asset_id}-${index}`}
                data-link-index={index}
                data-asset-id={asset.asset_id}
                onClick={url ? () => window.open(url, '_blank', 'noopener,noreferrer') : undefined}
                disabled={!url}
                className="gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                <span>{link.label}</span>
                {!url && <span className="ml-auto text-xs text-muted-foreground">{t('remoteAccess.links.unavailable')}</span>}
              </DropdownMenuItem>
            );
          })}
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
