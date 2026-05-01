import React, { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useSWRConfig } from 'swr';
import {
  Laptop,
  Server,
  Smartphone,
  Printer,
  Network,
  HelpCircle,
  MoreVertical,
  Edit,
  Trash2,
  RefreshCw,
  Power,
  ArrowLeft
} from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import BackNav from '@alga-psa/ui/components/BackNav';
import { DeleteEntityDialog } from '@alga-psa/ui';
import { StatusBadge } from './shared/StatusBadge';
import type { Asset, DeletionValidationResult } from '@alga-psa/types';
import { useAssetCrossFeature } from '../context/AssetCrossFeatureContext';
import { RemoteAccessButton } from './RemoteAccessButton';
import { getRmmProviderDisplayName } from '../lib/rmmProviderDisplay';
import { deleteAsset } from '../actions/assetActions';
import { preCheckDeletion } from '@alga-psa/auth/lib/preCheckDeletion';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { 
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@alga-psa/ui/components/DropdownMenu';

interface AssetDetailHeaderProps {
  asset: Asset;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

const getAssetIcon = (type: string) => {
  switch (type) {
    case 'workstation': return Laptop; // Changed to Laptop as primary for workstation per mockup
    case 'server': return Server;
    case 'mobile_device': return Smartphone;
    case 'printer': return Printer;
    case 'network_device': return Network;
    default: return HelpCircle;
  }
};

export const AssetDetailHeader: React.FC<AssetDetailHeaderProps> = ({ 
  asset,
  onRefresh,
  isRefreshing 
}) => {
  const { t } = useTranslation('msp/assets');
  const router = useRouter();
  const [isTicketDialogOpen, setIsTicketDialogOpen] = useState(false);
  const { mutate } = useSWRConfig();
  const { renderQuickAddTicket } = useAssetCrossFeature();
  const Icon = getAssetIcon(asset.asset_type);

  // Determine badge status
  const badgeStatus = asset.agent_status || 'unknown';

  const handleTicketAdded = () => {
    mutate(['asset', asset.asset_id, 'tickets']);
  };

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);
  const [isDeletePending, startDeleteTransition] = useTransition();

  const resetDeleteState = useCallback(() => {
    setIsDeleteDialogOpen(false);
    setDeleteValidation(null);
    setIsDeleteValidating(false);
    setIsDeleteProcessing(false);
  }, []);

  const openDeleteDialog = useCallback(async () => {
    setIsDeleteDialogOpen(true);
    setIsDeleteValidating(true);
    try {
      const result = await preCheckDeletion('asset', asset.asset_id);
      setDeleteValidation(result);
    } catch (error) {
      console.error('Failed to validate asset deletion:', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: t('deleteAssetButton.errors.validationFailed', {
          defaultValue: 'Failed to validate deletion. Please try again.'
        }),
        dependencies: [],
        alternatives: []
      });
    } finally {
      setIsDeleteValidating(false);
    }
  }, [asset.asset_id, t]);

  const handleConfirmDelete = useCallback(() => {
    startDeleteTransition(async () => {
      try {
        setIsDeleteProcessing(true);
        const result = await deleteAsset(asset.asset_id);
        if (!result.success) {
          setDeleteValidation(result);
          return;
        }
        resetDeleteState();
        router.push('/msp/assets');
      } catch (err) {
        console.error('Failed to delete asset:', err);
        setDeleteValidation({
          canDelete: false,
          code: 'VALIDATION_FAILED',
          message: t('deleteAssetButton.errors.deleteFailed', {
            defaultValue: 'Failed to delete asset. Please try again.'
          }),
          dependencies: [],
          alternatives: []
        });
      } finally {
        setIsDeleteProcessing(false);
      }
    });
  }, [asset.asset_id, resetDeleteState, router, t]);

  return (
    <>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 p-4 bg-white border-b border-gray-200">
        <div className="flex items-center gap-4">
          <BackNav href="/msp/assets">
            <div className="flex items-center gap-2">
              <ArrowLeft size={16} />
              <span className="hidden sm:inline">
                {t('assetDetailHeader.backToAssets', { defaultValue: 'Back to Assets' })}
              </span>
            </div>
          </BackNav>
          <div className="h-10 w-px bg-gray-200 mx-2 hidden md:block" />
          <Icon size={40} className="text-gray-700" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold leading-none text-gray-900">
                {asset.name}
              </h1>
              {asset.rmm_provider && (
                <StatusBadge 
                  status={badgeStatus} 
                  provider={getRmmProviderDisplayName(asset.rmm_provider)} 
                  size="md"
                />
              )}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {t('assetDetailHeader.assetTag', {
                defaultValue: 'Asset Tag: {{tag}}',
                tag: asset.asset_tag
              })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {asset.rmm_provider && (
            <RemoteAccessButton
              asset={asset}
              variant="default"
            />
          )}
          
          <Button 
            id="create-ticket-header-btn"
            variant="outline"
            className="bg-white hover:bg-gray-50 text-gray-700 border-gray-300 flex items-center gap-2"
            onClick={() => setIsTicketDialogOpen(true)}
          >
            {t('assetDetailHeader.actions.createTicket', { defaultValue: 'Create Ticket' })}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                id="asset-actions-btn"
                variant="outline" 
                className="bg-white hover:bg-gray-50 text-gray-700 border-gray-300 flex items-center gap-2 px-3"
              >
                {t('assetDetailHeader.actions.menu', { defaultValue: 'Actions' })}
                <MoreVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <div className="px-2 py-1.5 text-sm font-semibold text-gray-900">
                {t('assetDetailHeader.actions.menu', { defaultValue: 'Actions' })}
              </div>
              {asset.rmm_provider && (
                <>
                  <DropdownMenuItem onClick={onRefresh} disabled={isRefreshing}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {isRefreshing
                      ? t('assetDetailHeader.actions.refreshing', { defaultValue: 'Refreshing...' })
                      : t('assetDetailHeader.actions.refreshData', { defaultValue: 'Refresh Data' })}
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Power className="mr-2 h-4 w-4" />
                    {t('assetDetailHeader.actions.rebootDevice', { defaultValue: 'Reboot Device' })}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                id="edit-asset-action"
                onSelect={() => router.push(`/msp/assets/${asset.asset_id}/edit`)}
              >
                <Edit className="mr-2 h-4 w-4" />
                {t('assetDetailHeader.actions.editAsset', { defaultValue: 'Edit Asset' })}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                id="delete-asset-action"
                className="text-red-600 focus:text-red-600"
                onSelect={() => { void openDeleteDialog(); }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t('assetDetailHeader.actions.deleteAsset', { defaultValue: 'Delete Asset' })}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {renderQuickAddTicket({
        open: isTicketDialogOpen,
        onOpenChange: setIsTicketDialogOpen,
        onTicketAdded: handleTicketAdded,
        prefilledClient: asset.client_id ? {
          id: asset.client_id,
          name: asset.client?.client_name || t('assetDetailHeader.values.unknownClient', {
            defaultValue: 'Unknown Client'
          })
        } : undefined,
        assetId: asset.asset_id,
        assetName: asset.name,
      })}

      <DeleteEntityDialog
        id={`delete-asset-dialog-${asset.asset_id}`}
        isOpen={isDeleteDialogOpen}
        onClose={resetDeleteState}
        onConfirmDelete={handleConfirmDelete}
        entityName={asset.name || t('deleteAssetButton.entityNameFallback', {
          defaultValue: 'this asset'
        })}
        validationResult={deleteValidation}
        isValidating={isDeleteValidating}
        isDeleting={isDeleteProcessing || isDeletePending}
      />
    </>
  );
};
