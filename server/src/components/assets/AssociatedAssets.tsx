'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Asset, AssetAssociation, AssetListResponse } from '../../interfaces/asset.interfaces';
import { listEntityAssets, createAssetAssociation, removeAssetAssociation, listAssets } from '../../lib/actions/asset-actions/assetActions';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import CustomSelect, { SelectOption } from '../../components/ui/CustomSelect';
import { toast } from 'react-hot-toast';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { RmmStatusIndicator } from './RmmStatusIndicator';
import { RemoteAccessButton } from './RemoteAccessButton';
import { DataTable } from '../../components/ui/DataTable';
import { ColumnDefinition } from '../../interfaces/dataTable.interfaces';
import { SearchInput } from '../../components/ui/SearchInput';

interface AssociatedAssetsProps {
    id: string;
    entityId: string;
    entityType: 'ticket' | 'project';
    clientId: string;
}

export default function AssociatedAssets({ id, entityId, entityType, clientId }: AssociatedAssetsProps) {
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
    const [selectedAssetId, setSelectedAssetId] = useState<string>('');
    const [relationshipType, setRelationshipType] = useState<'affected' | 'related'>('affected');
    const [isLoading, setIsLoading] = useState(true);
    const [associatedAssets, setAssociatedAssets] = useState<AssetAssociation[]>([]);

    // Pagination and search state for asset selection
    const [availableAssets, setAvailableAssets] = useState<Asset[]>([]);
    const [totalAssets, setTotalAssets] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize] = useState(10);
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoadingAssets, setIsLoadingAssets] = useState(false);

    useEffect(() => {
        loadAssociatedAssets();
    }, [entityId, clientId]);

    // Load available assets when dialog opens or search/pagination changes
    useEffect(() => {
        if (isAddDialogOpen) {
            loadAvailableAssets();
        }
    }, [isAddDialogOpen, currentPage, searchTerm, clientId]);

    const loadAvailableAssets = useCallback(async () => {
        try {
            setIsLoadingAssets(true);
            const response: AssetListResponse = await listAssets({
                client_id: clientId,
                page: currentPage,
                limit: pageSize,
                search: searchTerm || undefined
            });
            setAvailableAssets(response.assets);
            setTotalAssets(response.total);
        } catch (error) {
            console.error('Error loading available assets:', error);
            toast.error('Failed to load available assets');
        } finally {
            setIsLoadingAssets(false);
        }
    }, [clientId, currentPage, pageSize, searchTerm]);

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
                    created_by: 'system',
                    created_at: new Date().toISOString(),
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
            handleCloseDialog();
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

    const handleCloseDialog = () => {
        setIsAddDialogOpen(false);
        setSelectedAssetId('');
        setSearchTerm('');
        setCurrentPage(1);
    };

    const handleOpenDialog = () => {
        setIsAddDialogOpen(true);
        setCurrentPage(1);
        setSearchTerm('');
    };

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(e.target.value);
        setCurrentPage(1); // Reset to first page when searching
    };

    const handlePageChange = (page: number) => {
        setCurrentPage(page);
    };

    const handleRowClick = (asset: Asset) => {
        setSelectedAssetId(asset.asset_id);
    };

    const relationshipOptions: SelectOption[] = [
        { label: 'Affected', value: 'affected' },
        { label: 'Related', value: 'related' }
    ];

    // Column definitions for the asset selection table
    const assetColumns: ColumnDefinition<Asset>[] = [
        {
            title: '',
            dataIndex: 'asset_id',
            width: '40px',
            render: (value: string) => (
                <input
                    type="radio"
                    name="selected-asset"
                    checked={selectedAssetId === value}
                    onChange={() => setSelectedAssetId(value)}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500"
                />
            )
        },
        {
            title: 'Name',
            dataIndex: 'name',
            render: (value: string, record: Asset) => (
                <div className="flex items-center gap-2">
                    <span className="font-medium">{value}</span>
                    <RmmStatusIndicator asset={record} size="sm" />
                </div>
            )
        },
        {
            title: 'Asset Tag',
            dataIndex: 'asset_tag'
        },
        {
            title: 'Type',
            dataIndex: 'asset_type',
            render: (value: string) => (
                <span className="capitalize">{value.replace('_', ' ')}</span>
            )
        },
        {
            title: 'Status',
            dataIndex: 'status',
            render: (value: string) => (
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    value === 'active' ? 'bg-green-100 text-green-800' :
                    value === 'inactive' ? 'bg-gray-100 text-gray-800' :
                    value === 'maintenance' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-gray-100 text-gray-800'
                }`}>
                    {value}
                </span>
            )
        }
    ];

    return (
        <ReflectionContainer id={id} label="Associated Assets">
            <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <h3 className="text-lg font-semibold">Associated Assets</h3>
                    <Button
                        id='add-asset-button'
                        variant="outline"
                        onClick={handleOpenDialog}
                    >
                        Add Asset
                    </Button>
                </div>

                {isLoading ? (
                    <div>Loading assets...</div>
                ) : associatedAssets.length === 0 ? (
                    <div className="text-gray-500">No assets associated</div>
                ) : (
                    <div className="space-y-2">
                        {associatedAssets.map((association): JSX.Element => (
                            <div
                                key={`${association.asset_id}-${association.entity_id}`}
                                className="flex justify-between items-center p-3 bg-white rounded-lg shadow-sm"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium truncate">{association.asset?.name}</span>
                                        {association.asset && (
                                            <RmmStatusIndicator asset={association.asset} size="sm" />
                                        )}
                                    </div>
                                    <div className="text-sm text-gray-500">
                                        {association.asset?.asset_tag} • {association.relationship_type}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 ml-2">
                                    {association.asset && association.asset.rmm_provider && association.asset.rmm_device_id && (
                                        <RemoteAccessButton
                                            asset={association.asset}
                                            variant="ghost"
                                            size="sm"
                                        />
                                    )}
                                    <Button
                                        id={`remove-asset-${association.asset_id}`}
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleRemoveAsset(association.asset_id)}
                                    >
                                        Remove
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <Dialog
                    id={`${id}-dialog`}
                    isOpen={isAddDialogOpen}
                    onClose={handleCloseDialog}
                    title="Add Asset"
                >
                    <div className="space-y-4 min-w-[600px]">
                        {/* Search input */}
                        <div className="flex gap-4 items-end">
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Search Assets
                                </label>
                                <SearchInput
                                    id={`${id}-search`}
                                    value={searchTerm}
                                    onChange={handleSearchChange}
                                    placeholder="Search by name, tag, or serial..."
                                    className="w-full"
                                />
                            </div>
                            <div className="w-48">
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Relationship Type
                                </label>
                                <CustomSelect
                                    options={relationshipOptions}
                                    value={relationshipType}
                                    onValueChange={(value) => setRelationshipType(value as 'affected' | 'related')}
                                    placeholder="Select type..."
                                />
                            </div>
                        </div>

                        {/* Asset selection table */}
                        <div className="border rounded-lg overflow-hidden">
                            {isLoadingAssets ? (
                                <div className="p-8 text-center text-gray-500">
                                    Loading assets...
                                </div>
                            ) : availableAssets.length === 0 ? (
                                <div className="p-8 text-center text-gray-500">
                                    {searchTerm ? 'No assets found matching your search' : 'No assets available for this client'}
                                </div>
                            ) : (
                                <DataTable
                                    id={`${id}-asset-table`}
                                    data={availableAssets}
                                    columns={assetColumns}
                                    pagination={true}
                                    currentPage={currentPage}
                                    pageSize={pageSize}
                                    totalItems={totalAssets}
                                    onPageChange={handlePageChange}
                                    onRowClick={handleRowClick}
                                />
                            )}
                        </div>

                        {/* Selected asset indicator */}
                        {selectedAssetId && (
                            <div className="p-2 bg-primary-50 rounded-md text-sm text-primary-700">
                                Selected: {availableAssets.find(a => a.asset_id === selectedAssetId)?.name || 'Asset'}
                            </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex justify-end space-x-2 pt-2 border-t">
                            <Button
                                id='cancel-button'
                                variant="outline"
                                onClick={handleCloseDialog}
                            >
                                Cancel
                            </Button>
                            <Button
                                id='confirm-add-asset-button'
                                onClick={handleAddAsset}
                                disabled={!selectedAssetId}
                            >
                                Add Asset
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </div>
        </ReflectionContainer>
    );
}
