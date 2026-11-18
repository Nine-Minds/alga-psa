'use client';

import { useAssetSurfaceControls } from '../context/AssetSurfaceAccessContext';
import { useCallback, useState } from 'react';
import { AlertCircle, ExternalLink, Loader2, Monitor, Terminal } from 'lucide-react';
import type { Asset } from '@alga-psa/types';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@alga-psa/ui/components/DropdownMenu';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { describeRmmConnectionType, rmmConnectionTypesForProvider } from '@alga-psa/types';
import { useAssetCrossFeature, type AssetRemoteConnectionType } from '../context/AssetCrossFeatureContext';
import { getRemoteAccessLinksForAsset, type RenderedRemoteAccessLink } from '../actions/remoteAccessLinkActions';
import { assetActionErrorMessage, isAssetActionError } from '../actions/assetActionErrors';

export interface RemoteAccessButtonProps {
  asset: Asset;
  variant?: 'default' | 'secondary' | 'ghost' | 'outline';
  size?: 'default' | 'sm' | 'lg';
  className?: string;
  hasTemplateLinks?: boolean;
  iconOnly?: boolean;
  surface?: 'asset-header' | 'asset-drawer' | 'ticket-sidebar';
}

function connectionLabel(type: AssetRemoteConnectionType, t: (key: string, options?: { defaultValue?: string }) => string): string {
  const { labelKey, fallbackLabel } = describeRmmConnectionType(type);
  if (labelKey) return t(labelKey, { defaultValue: fallbackLabel || undefined });
  return fallbackLabel;
}

/** Providers that publish a closed set keep it (in their order); everything else is shown as the adapter returned it, in registry order. */
function presentableTypes(provider: string | null | undefined, reported: AssetRemoteConnectionType[]): AssetRemoteConnectionType[] {
  const allowed = rmmConnectionTypesForProvider(provider);
  const hint = allowed ?? [];
  const rank = (type: AssetRemoteConnectionType) => {
    const index = hint.indexOf(type);
    return index >= 0 ? index : hint.length;
  };
  return [...new Set(reported)]
    .filter((type) => !allowed || allowed.includes(type))
    .sort((a, b) => rank(a) - rank(b) || describeRmmConnectionType(a).order - describeRmmConnectionType(b).order);
}

/** Not rendered at all when the server's seat authority closes remote access to the signed-in user. */
export function RemoteAccessButton(props: RemoteAccessButtonProps) {
  const { canRemoteAccess } = useAssetSurfaceControls();
  return canRemoteAccess ? <RemoteAccessButtonControl {...props} /> : null;
}

function RemoteAccessButtonControl({ asset, variant = 'default', size = 'sm', className = '', hasTemplateLinks = false, iconOnly = false, surface = 'asset-header' }: RemoteAccessButtonProps) {
  const { t } = useTranslation('msp/assets');
  const { rmm } = useAssetCrossFeature();
  const [availableTypes, setAvailableTypes] = useState<AssetRemoteConnectionType[] | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [hasLoadedOptions, setHasLoadedOptions] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState(false);
  const [assetLinks, setAssetLinks] = useState<RenderedRemoteAccessLink[]>([]);
  const hasRmmCandidates = Boolean(asset.rmm_provider && asset.rmm_device_id);

  const loadOptions = useCallback(async () => {
    if (hasLoadedOptions || isLoadingOptions) return;
    setIsLoadingOptions(true);
    setLoadFailed(false);
    const typeRequest = hasRmmCandidates
      ? rmm.getAssetRemoteControlTypes(asset.asset_id)
          .then((types) => setAvailableTypes(presentableTypes(asset.rmm_provider, types)))
          .catch(() => { setAvailableTypes([]); setLoadFailed(true); })
      : Promise.resolve().then(() => setAvailableTypes([]));
    const linkRequest = getRemoteAccessLinksForAsset(asset.asset_id)
      .then((result) => {
        if (isAssetActionError(result)) throw new Error(assetActionErrorMessage(result));
        setAssetLinks(result);
      })
      .catch(() => { setAssetLinks([]); setLoadFailed(true); });
    await Promise.all([typeRequest, linkRequest]);
    setHasLoadedOptions(true);
    setIsLoadingOptions(false);
  }, [asset.asset_id, asset.rmm_provider, hasRmmCandidates, hasLoadedOptions, isLoadingOptions, rmm]);

  const availableRmmTypes = availableTypes ?? [];

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
          <Button id={`remote-access-button-${surface}-${asset.asset_id}`} data-asset-id={asset.asset_id} aria-label={iconOnly ? t('remoteAccess.remoteAccess') : undefined} title={iconOnly ? t('remoteAccess.remoteAccess') : undefined} variant={variant} size={size} className={`${iconOnly ? 'px-2' : 'gap-2'} ${className}`} disabled={isPending}>
            {isPending || isLoadingOptions ? <Loader2 className="h-4 w-4 animate-spin" /> : <Monitor className="h-4 w-4" />}
            {!iconOnly && t('remoteAccess.remoteAccess')}
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
              {describeRmmConnectionType(type).icon === 'terminal' ? <Terminal className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
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
