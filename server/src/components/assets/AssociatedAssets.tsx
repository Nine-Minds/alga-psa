'use client';

import React, { useState, useEffect } from 'react';
import { Asset, AssetAssociation } from '../../interfaces/asset.interfaces';
import { listEntityAssets, getAsset, createAssetAssociation, removeAssetAssociation, listAssets } from '../../lib/actions/asset-actions/assetActions';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import CustomSelect, { SelectOption } from '../../components/ui/CustomSelect';
import { toast } from 'react-hot-toast';
import { useRegisterUIComponent } from '../../types/ui-reflection/useRegisterUIComponent';
import { withDataAutomationId } from '../../types/ui-reflection/withDataAutomationId';

interface AssociatedAssetsProps {
    entityId: string;
    entityType: 'ticket' | 'project';
    companyId: string;
}

export default function AssociatedAssets({ entityId, entityType, companyId }: AssociatedAssetsProps) {
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
    const [selectedAssetId, setSelectedAssetId] = useState<string>('');
    const [relationshipType, setRelationshipType] = useState<'affected' | 'related'>('affected');
    const [isLoading, setIsLoading] = useState(true);
    const [availableAssets, setAvailableAssets] = useState<SelectOption[]>([]);
    const [associatedAssets, setAssociatedAssets] = useState<AssetAssociation[]>([]);

    const updateDialog = useRegisterUIComponent({
        id: 'add-asset-dialog',
        type: 'dialog',
        label: 'Add Asset Association',
        title: 'Add Asset',
        open: isAddDialogOpen
    });

    useEffect(() => {
        loadAssociatedAssets();
        loadAvailableAssets();
    }, [entityId, companyId]);

    const loadAvailableAssets = async () => {
        try {
            const response = await listAssets({ company_id: companyId });
            const options = response.assets.map((asset): SelectOption => ({
                value: asset.asset_id,
                label: `${asset.name} (${asset.asset_tag})`
            }));
            setAvailableAssets(options);
        } catch (error) {
            console.error('Error loading available assets:', error);
            toast.error('Failed to load available assets');
        }
    };

    const loadAssociatedAssets = async () => {
        try {
            setIsLoading(true);
            const assets = await listEntityAssets(entityId, entityType);
            
            // Create associations with assets
            const associations: AssetAssociation[] = await Promise.all(
                assets.map(async (asset): Promise<AssetAssociation> => ({
                    tenant: asset.tenant,
                    asset_id: asset.asset_id,
                    entity_id: entityId,
                    entity_type: entityType,
                    relationship_type: relationshipType,
                    created_by: 'system', // This should come from the actual association data
                    created_at: new Date().toISOString(), // This should come from the actual association data
                    asset: asset
                }))
            );

            setAssociatedAssets(associations);
        } catch (error) {
            console.error('Error loading associated assets:', error);
            toast.error('Failed to load associated assets');
        } finally {
            setIsLoading(false);
        }
    };

    const handleAddAsset = async () => {
        if (!selectedAssetId) {
            toast.error('Please select an asset');
            return;
        }

        try {
            await createAssetAssociation({
                asset_id: selectedAssetId,
                entity_id: entityId,
                entity_type: entityType,
                relationship_type: relationshipType
            });

            toast.success('Asset associated successfully');
            setIsAddDialogOpen(false);
            setSelectedAssetId('');
            loadAssociatedAssets();
        } catch (error) {
            console.error('Error associating asset:', error);
            toast.error('Failed to associate asset');
        }
    };

    const handleRemoveAsset = async (assetId: string) => {
        try {
            await removeAssetAssociation(assetId, entityId, entityType);
            toast.success('Asset association removed');
            loadAssociatedAssets();
        } catch (error) {
            console.error('Error removing asset association:', error);
            toast.error('Failed to remove asset association');
        }
    };

    const relationshipOptions: SelectOption[] = [
        { label: 'Affected', value: 'affected' },
        { label: 'Related', value: 'related' }
    ];

    return (
        <div {...withDataAutomationId({ id: 'associated-assets-container' })} className="space-y-4">
            <div {...withDataAutomationId({ id: 'associated-assets-header' })} className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Associated Assets</h3>
                <Button
                    {...withDataAutomationId({ id: 'add-asset-button' })}
                    variant="outline"
                    onClick={() => setIsAddDialogOpen(true)}
                >
                    Add Asset
                </Button>
            </div>

            {isLoading ? (
                <div {...withDataAutomationId({ id: 'loading-state' })}>Loading assets...</div>
            ) : associatedAssets.length === 0 ? (
                <div {...withDataAutomationId({ id: 'empty-state' })} className="text-gray-500">No assets associated</div>
            ) : (
                <div {...withDataAutomationId({ id: 'associated-assets-list' })} className="space-y-2">
                    {associatedAssets.map((association): JSX.Element => (
                        <div
                            {...withDataAutomationId({ id: `asset-association-${association.asset_id}` })}
                            key={`${association.asset_id}-${association.entity_id}`}
                            className="flex justify-between items-center p-2 bg-white rounded-lg shadow-sm"
                        >
                            <div>
                                <div className="font-medium">{association.asset?.name}</div>
                                <div className="text-sm text-gray-500">
                                    {association.asset?.asset_tag} • {association.relationship_type}
                                </div>
                            </div>
                            <Button
                                {...withDataAutomationId({ id: `remove-asset-${association.asset_id}` })}
                                variant="ghost"
                                onClick={() => handleRemoveAsset(association.asset_id)}
                            >
                                Remove
                            </Button>
                        </div>
                    ))}
                </div>
            )}

            <Dialog
                {...withDataAutomationId({ id: 'add-asset-dialog' })}
                isOpen={isAddDialogOpen}
                onClose={() => setIsAddDialogOpen(false)}
                title="Add Asset"
            >
                <div {...withDataAutomationId({ id: 'add-asset-form' })} className="space-y-4">
                    <CustomSelect
                        {...withDataAutomationId({ id: 'asset-select' })}
                        options={availableAssets}
                        value={selectedAssetId}
                        onValueChange={setSelectedAssetId}
                        placeholder="Select an asset..."
                    />
                    <CustomSelect
                        {...withDataAutomationId({ id: 'relationship-type-select' })}
                        options={relationshipOptions}
                        value={relationshipType}
                        onValueChange={(value) => setRelationshipType(value as 'affected' | 'related')}
                        placeholder="Select relationship type..."
                    />
                    <div {...withDataAutomationId({ id: 'dialog-actions' })} className="flex justify-end space-x-2">
                        <Button
                            {...withDataAutomationId({ id: 'cancel-button' })}
                            variant="outline"
                            onClick={() => setIsAddDialogOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button {...withDataAutomationId({ id: 'add-button' })} onClick={handleAddAsset}>
                            Add Asset
                        </Button>
                    </div>
                </div>
            </Dialog>
        </div>
    );
}
