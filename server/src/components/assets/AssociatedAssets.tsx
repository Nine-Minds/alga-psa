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
import { SearchInput } from '../../components/ui/SearchInput';
import Pagination from '../../components/ui/Pagination';

interface AssociatedAssetsProps {
    id: string;
    entityId: string;
    entityType: 'ticket' | 'project';
    clientId: string;
}

interface SelectedAsset {
    asset: Asset;
    relationshipType: 'affected' | 'related';
}

export default function AssociatedAssets({ id, entityId, entityType, clientId }: AssociatedAssetsProps) {
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [associatedAssets, setAssociatedAssets] = useState<AssetAssociation[]>([]);

    // Multi-select state for asset selection
    const [selectedAssets, setSelectedAssets] = useState<Map<string, SelectedAsset>>(new Map());
    const [defaultRelationshipType, setDefaultRelationshipType] = useState<'affected' | 'related'>('affected');

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
                    relationship_type: 'affected',
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

    const handleAddAssets = async () => {
        if (selectedAssets.size === 0) {
            toast.error('Please select at least one asset');
            return;
        }

        try {
            // Create associations for all selected assets
            const promises = Array.from(selectedAssets.values()).map(({ asset, relationshipType }) =>
                createAssetAssociation({
                    asset_id: asset.asset_id,
                    entity_id: entityId,
                    entity_type: entityType,
                    relationship_type: relationshipType
                })
            );

            await Promise.all(promises);

            toast.success(`${selectedAssets.size} asset(s) associated successfully`);
            handleCloseDialog();
            loadAssociatedAssets();
        } catch (error) {
            console.error('Error associating assets:', error);
            toast.error('Failed to associate assets');
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
        setSelectedAssets(new Map());
        setSearchTerm('');
        setCurrentPage(1);
        setDefaultRelationshipType('affected');
    };

    const handleOpenDialog = () => {
        setIsAddDialogOpen(true);
        setCurrentPage(1);
        setSearchTerm('');
        setSelectedAssets(new Map());
    };

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(e.target.value);
        setCurrentPage(1);
    };

    const handlePageChange = (page: number) => {
        setCurrentPage(page);
    };

    const handleAssetToggle = (asset: Asset) => {
        setSelectedAssets(prev => {
            const newMap = new Map(prev);
            if (newMap.has(asset.asset_id)) {
                newMap.delete(asset.asset_id);
            } else {
                newMap.set(asset.asset_id, { asset, relationshipType: defaultRelationshipType });
            }
            return newMap;
        });
    };

    const handleSelectAll = () => {
        if (areAllCurrentPageSelected()) {
            // Deselect all on current page
            setSelectedAssets(prev => {
                const newMap = new Map(prev);
                availableAssets.forEach(asset => newMap.delete(asset.asset_id));
                return newMap;
            });
        } else {
            // Select all on current page
            setSelectedAssets(prev => {
                const newMap = new Map(prev);
                availableAssets.forEach(asset => {
                    if (!newMap.has(asset.asset_id)) {
                        newMap.set(asset.asset_id, { asset, relationshipType: defaultRelationshipType });
                    }
                });
                return newMap;
            });
        }
    };

    const handleRelationshipTypeChange = (assetId: string, type: 'affected' | 'related') => {
        setSelectedAssets(prev => {
            const newMap = new Map(prev);
            const existing = newMap.get(assetId);
            if (existing) {
                newMap.set(assetId, { ...existing, relationshipType: type });
            }
            return newMap;
        });
    };

    const areAllCurrentPageSelected = () => {
        return availableAssets.length > 0 && availableAssets.every(asset => selectedAssets.has(asset.asset_id));
    };

    const areSomeCurrentPageSelected = () => {
        return availableAssets.some(asset => selectedAssets.has(asset.asset_id)) && !areAllCurrentPageSelected();
    };

    const relationshipOptions: SelectOption[] = [
        { label: 'Affected', value: 'affected' },
        { label: 'Related', value: 'related' }
    ];

    const getSelectedAssetNames = () => {
        return Array.from(selectedAssets.values()).map(({ asset }) => asset.name).join(', ');
    };

    const totalPages = Math.ceil(totalAssets / pageSize);

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
                    <div className="space-y-4" style={{ minWidth: '700px' }}>
                        {/* Search and relationship type row */}
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
                                    value={defaultRelationshipType}
                                    onValueChange={(value) => setDefaultRelationshipType(value as 'affected' | 'related')}
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
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-4 py-3 text-left w-10">
                                                <input
                                                    type="checkbox"
                                                    checked={areAllCurrentPageSelected()}
                                                    ref={(el) => {
                                                        if (el) el.indeterminate = areSomeCurrentPageSelected();
                                                    }}
                                                    onChange={handleSelectAll}
                                                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                                />
                                            </th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Name
                                            </th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Asset Tag
                                            </th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Type
                                            </th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Status
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {availableAssets.map((asset) => {
                                            const isSelected = selectedAssets.has(asset.asset_id);
                                            const selectedData = selectedAssets.get(asset.asset_id);
                                            return (
                                                <tr
                                                    key={asset.asset_id}
                                                    className={`hover:bg-gray-50 cursor-pointer ${isSelected ? 'bg-primary-50' : ''}`}
                                                    onClick={() => handleAssetToggle(asset)}
                                                >
                                                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            onChange={() => handleAssetToggle(asset)}
                                                            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-medium text-gray-900">{asset.name}</span>
                                                            <RmmStatusIndicator asset={asset} size="sm" />
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-gray-600">
                                                        {asset.asset_tag}
                                                    </td>
                                                    <td className="px-4 py-3 text-gray-600 capitalize">
                                                        {asset.asset_type.replace('_', ' ')}
                                                    </td>
                                                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                                        {isSelected ? (
                                                            <CustomSelect
                                                                options={relationshipOptions}
                                                                value={selectedData?.relationshipType || 'affected'}
                                                                onValueChange={(value) => handleRelationshipTypeChange(asset.asset_id, value as 'affected' | 'related')}
                                                                placeholder="Type..."
                                                            />
                                                        ) : (
                                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                                                asset.status === 'active' ? 'bg-purple-100 text-purple-800' :
                                                                asset.status === 'inactive' ? 'bg-gray-100 text-gray-800' :
                                                                asset.status === 'maintenance' ? 'bg-yellow-100 text-yellow-800' :
                                                                'bg-gray-100 text-gray-800'
                                                            }`}>
                                                                {asset.status}
                                                            </span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <Pagination
                                id={`${id}-pagination`}
                                currentPage={currentPage}
                                totalItems={totalAssets}
                                itemsPerPage={pageSize}
                                onPageChange={handlePageChange}
                                variant="compact"
                            />
                        )}

                        {/* Selected assets indicator */}
                        {selectedAssets.size > 0 && (
                            <div className="p-3 bg-primary-50 rounded-lg text-sm text-primary-700">
                                <span className="font-medium">Selected:</span> {getSelectedAssetNames()}
                            </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex justify-end space-x-3 pt-2">
                            <Button
                                id='cancel-button'
                                variant="outline"
                                onClick={handleCloseDialog}
                            >
                                Cancel
                            </Button>
                            <Button
                                id='confirm-add-asset-button'
                                onClick={handleAddAssets}
                                disabled={selectedAssets.size === 0}
                            >
                                Add Asset{selectedAssets.size > 1 ? 's' : ''}
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </div>
        </ReflectionContainer>
    );
}
