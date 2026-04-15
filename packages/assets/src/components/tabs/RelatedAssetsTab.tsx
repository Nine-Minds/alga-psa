import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import type { Asset } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Network, Link as LinkIcon } from 'lucide-react';
import { formatDateTime } from '@alga-psa/core';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { SearchInput } from '@alga-psa/ui/components/SearchInput';
import useSWR, { useSWRConfig } from 'swr';
import { createAssetRelationship, deleteAssetRelationship, getAssetRelationships, listAssets } from '../../actions/assetActions';
import { Input } from '@alga-psa/ui/components/Input';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface RelatedAssetsTabProps {
  asset: Asset;
}

export const RelatedAssetsTab: React.FC<RelatedAssetsTabProps> = ({ asset }) => {
  const { t } = useTranslation('msp/assets');
  const { mutate } = useSWRConfig();
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [relationshipType, setRelationshipType] = useState('related');
  const [isSaving, setIsSaving] = useState(false);

  const { data: relationships, isLoading: isLoadingRelationships, mutate: mutateRelationships } = useSWR(
    asset?.asset_id ? ['asset', asset.asset_id, 'relationships'] : null,
    ([, id]) => getAssetRelationships(id)
  );

  const existingLinkedIds = useMemo(() => {
    const rels = relationships || asset.relationships || [];
    const ids = new Set<string>();
    for (const rel of rels) {
      ids.add(rel.parent_asset_id);
      ids.add(rel.child_asset_id);
    }
    ids.delete(asset.asset_id);
    return ids;
  }, [relationships, asset.asset_id, asset.relationships]);

  const { data: availableAssetsResp, isLoading: isLoadingAssets } = useSWR(
    isLinkDialogOpen
      ? ['asset', asset.asset_id, 'relationship-candidates', asset.client_id, searchTerm]
      : null,
    async () => {
      // Keep it simple: list assets for the same client, filter locally
      return await listAssets({
        client_id: asset.client_id,
        search: searchTerm,
        page: 1,
        limit: 10
      } as any);
    }
  );

  const availableAssets = useMemo(() => {
    const items = (availableAssetsResp?.assets || []) as Asset[];
    return items.filter((a) => a.asset_id !== asset.asset_id && !existingLinkedIds.has(a.asset_id));
  }, [availableAssetsResp, asset.asset_id, existingLinkedIds]);

  useEffect(() => {
    if (!isLinkDialogOpen) {
      setSearchTerm('');
      setSelectedAssetId('');
      setRelationshipType('related');
      setIsSaving(false);
    }
  }, [isLinkDialogOpen]);

  const openLinkDialog = useCallback(() => setIsLinkDialogOpen(true), []);

  const handleCreateRelationship = useCallback(async () => {
    if (!selectedAssetId) {
      toast.error(t('relatedAssetsTab.errors.selectAsset', {
        defaultValue: 'Select an asset to link'
      }));
      return;
    }

    setIsSaving(true);
    try {
      await createAssetRelationship({
        parent_asset_id: asset.asset_id,
        child_asset_id: selectedAssetId,
        relationship_type: relationshipType || 'related'
      });

      toast.success(t('relatedAssetsTab.success.linked', { defaultValue: 'Asset linked' }));
      setIsLinkDialogOpen(false);

      // Refresh relationships in this tab
      await mutateRelationships();
      // Best-effort: also refresh any cached asset fetches
      mutate(['asset', asset.asset_id]);
    } catch (error) {
      handleError(error, t('relatedAssetsTab.errors.linkFailed', {
        defaultValue: 'Failed to link asset'
      }));
    } finally {
      setIsSaving(false);
    }
  }, [asset.asset_id, mutate, mutateRelationships, relationshipType, selectedAssetId, t]);

  const handleUnlink = useCallback(async (parentId: string, childId: string) => {
    try {
      await deleteAssetRelationship(parentId, childId);
      toast.success(t('relatedAssetsTab.success.unlinked', { defaultValue: 'Asset unlinked' }));
      await mutateRelationships();
      mutate(['asset', asset.asset_id]);
    } catch (error) {
      handleError(error, t('relatedAssetsTab.errors.unlinkFailed', {
        defaultValue: 'Failed to unlink asset'
      }));
    }
  }, [asset.asset_id, mutate, mutateRelationships, t]);

  const relsToRender = relationships ?? asset.relationships ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-base font-semibold">
          {t('relatedAssetsTab.title', {
            defaultValue: 'Related Assets ({{count}})',
            count: relsToRender.length
          })}
        </CardTitle>
        <Button id="link-asset-btn" variant="outline" size="xs" className="flex items-center gap-2" onClick={openLinkDialog}>
          <LinkIcon size={14} />
          {t('relatedAssetsTab.actions.linkAsset', { defaultValue: 'Link Asset' })}
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('relatedAssetsTab.table.assetName', { defaultValue: 'Asset Name' })}</TableHead>
                <TableHead>{t('relatedAssetsTab.table.relationship', { defaultValue: 'Relationship' })}</TableHead>
                <TableHead>{t('relatedAssetsTab.table.linkedDate', { defaultValue: 'Linked Date' })}</TableHead>
                <TableHead>{t('relatedAssetsTab.table.actions', { defaultValue: 'Actions' })}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingRelationships ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-gray-400">
                    {t('relatedAssetsTab.loading', { defaultValue: 'Loading related assets...' })}
                  </TableCell>
                </TableRow>
              ) : relsToRender.length > 0 ? (
                relsToRender.map((rel, index) => (
                  <TableRow key={`${rel.child_asset_id}-${index}`}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Network size={16} className="text-gray-400" />
                        <span className="text-gray-900">{rel.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="bg-primary-50 text-primary-700 border-primary-100">
                        {t(`relatedAssetsTab.relationshipTypes.${rel.relationship_type}`, {
                          defaultValue: rel.relationship_type
                        })}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-gray-500">
                      {formatDateTime(new Date(rel.created_at), Intl.DateTimeFormat().resolvedOptions().timeZone)}
                    </TableCell>
                    <TableCell>
                      <Button
                        id={`unlink-asset-${rel.child_asset_id}-btn`}
                        variant="ghost"
                        size="xs"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleUnlink(rel.parent_asset_id, rel.child_asset_id)}
                      >
                        {t('relatedAssetsTab.actions.unlink', { defaultValue: 'Unlink' })}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center text-gray-500">
                    <div className="flex flex-col items-center gap-2">
                      <Network size={32} className="opacity-20" />
                      <p className="text-sm">
                        {t('relatedAssetsTab.empty.linked', { defaultValue: 'No related assets linked.' })}
                      </p>
                      <Button id="link-asset-empty-state-btn" variant="ghost" size="xs" onClick={openLinkDialog}>
                        {t('relatedAssetsTab.actions.linkEmptyState', { defaultValue: 'Link an asset' })}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog
        id="link-related-asset"
        title={t('relatedAssetsTab.dialog.title', { defaultValue: 'Link Asset' })}
        isOpen={isLinkDialogOpen}
        onClose={() => setIsLinkDialogOpen(false)}
        footer={(
          <div className="flex justify-end space-x-2">
            <Button
              id="cancel-link-related-asset"
              variant="ghost"
              size="sm"
              onClick={() => setIsLinkDialogOpen(false)}
              disabled={isSaving}
            >
              {t('common.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id="confirm-link-related-asset"
              variant="default"
              size="sm"
              onClick={handleCreateRelationship}
              disabled={isSaving || !selectedAssetId}
            >
              {isSaving
                ? t('relatedAssetsTab.dialog.actions.linking', { defaultValue: 'Linking...' })
                : t('relatedAssetsTab.dialog.actions.confirm', { defaultValue: 'Link asset' })}
            </Button>
          </div>
        )}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              {t('relatedAssetsTab.dialog.search.label', { defaultValue: 'Search assets' })}
            </label>
            <SearchInput
              id="link-related-asset-search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('relatedAssetsTab.dialog.search.placeholder', {
                defaultValue: 'Search by name, tag, serial...'
              })}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              {t('relatedAssetsTab.dialog.relationshipType.label', {
                defaultValue: 'Relationship type'
              })}
            </label>
            <Input
              id="link-related-asset-relationship-type"
              value={relationshipType}
              onChange={(e) => setRelationshipType(e.target.value)}
              placeholder={t('relatedAssetsTab.dialog.relationshipType.placeholder', {
                defaultValue: 'related'
              })}
            />
          </div>

          <div className="rounded-md border border-gray-200">
            <div className="max-h-[260px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('relatedAssetsTab.dialog.table.asset', { defaultValue: 'Asset' })}</TableHead>
                    <TableHead className="w-[120px] text-right">
                      {t('relatedAssetsTab.dialog.table.select', { defaultValue: 'Select' })}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingAssets ? (
                    <TableRow>
                      <TableCell colSpan={2} className="h-24 text-center text-gray-400">
                        {t('relatedAssetsTab.dialog.loadingAssets', { defaultValue: 'Loading assets...' })}
                      </TableCell>
                    </TableRow>
                  ) : availableAssets.length > 0 ? (
                    availableAssets.map((a) => (
                      <TableRow key={a.asset_id}>
                        <TableCell className="text-gray-900">
                          <div className="flex flex-col">
                            <span className="font-medium">{a.name}</span>
                            <span className="text-xs text-gray-500">{a.asset_tag}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            id={`select-related-asset-${a.asset_id}`}
                            variant={selectedAssetId === a.asset_id ? 'default' : 'outline'}
                            size="xs"
                            onClick={() => setSelectedAssetId(a.asset_id)}
                          >
                            {selectedAssetId === a.asset_id
                              ? t('relatedAssetsTab.dialog.actions.selected', { defaultValue: 'Selected' })
                              : t('common.actions.select', { defaultValue: 'Select' })}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={2} className="h-24 text-center text-gray-400">
                        {t('relatedAssetsTab.dialog.empty', {
                          defaultValue: 'No available assets found.'
                        })}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

        </div>
      </Dialog>
    </Card>
  );
};
