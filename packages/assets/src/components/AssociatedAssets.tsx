'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Asset, AssetAssociation, AssetListResponse } from '@alga-psa/types';
import { listEntityAssets, createAssetAssociation, removeAssetAssociation, listAssets } from '../actions/assetActions';
import { loadAssetDetailDrawerData } from '../actions/assetDrawerActions';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { toast } from 'react-hot-toast';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { RmmStatusIndicator } from './RmmStatusIndicator';
import { RemoteAccessButton } from './RemoteAccessButton';
import { SearchInput } from '@alga-psa/ui/components/SearchInput';
import Pagination from '@alga-psa/ui/components/Pagination';
import { AssetDetailDrawerClient } from './AssetDetailDrawerClient';
import { Monitor, Server, Smartphone, Printer, Network, Boxes } from 'lucide-react';
import { ContentCard } from '@alga-psa/ui/components';
import {
    ASSET_DRAWER_TABS,
    type AssetDrawerTab,
    type AssetDrawerServerData,
    tabToPanelParam,
} from './AssetDetailDrawer.types';

interface AssociatedAssetsProps {
    id: string;
    entityId: string;
    entityType: 'ticket' | 'project';
    clientId: string;
    defaultBoardId?: string;
}

interface SelectedAsset {
    asset: Asset;
    relationshipType: 'affected' | 'related';
}

export default function AssociatedAssets({ id, entityId, entityType, clientId, defaultBoardId }: AssociatedAssetsProps) {
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

    // Track already-associated asset IDs to filter them out
    const [associatedAssetIds, setAssociatedAssetIds] = useState<Set<string>>(new Set());

    // Asset detail drawer state
    const [drawerAssetId, setDrawerAssetId] = useState<string | null>(null);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [activeDrawerTab, setActiveDrawerTab] = useState<AssetDrawerTab>(ASSET_DRAWER_TABS.OVERVIEW);
    const [drawerData, setDrawerData] = useState<AssetDrawerServerData>({ asset: null });
    const [drawerError, setDrawerError] = useState<string | null>(null);
    const [drawerLoading, setDrawerLoading] = useState(false);
    const lastRequestIdRef = useRef<number>(0);

    useEffect(() => {
        loadAssociatedAssets();
    }, [entityId, clientId]);

    // Load available assets when dialog opens or search/pagination changes
    useEffect(() => {
        if (isAddDialogOpen) {
            loadAvailableAssets();
        }
    }, [isAddDialogOpen, currentPage, searchTerm, clientId, associatedAssetIds]);

    const loadAvailableAssets = useCallback(async () => {
        try {
            setIsLoadingAssets(true);
            const response: AssetListResponse = await listAssets({
                client_id: clientId,
                page: currentPage,
                limit: pageSize,
                search: searchTerm || undefined
            });
            // Filter out already-associated assets
            const filteredAssets = response.assets.filter(
                asset => !associatedAssetIds.has(asset.asset_id)
            );
            setAvailableAssets(filteredAssets);
            // Adjust total count (approximate - server-side filtering would be more accurate)
            const alreadyAssociatedOnPage = response.assets.length - filteredAssets.length;
            setTotalAssets(Math.max(0, response.total - associatedAssetIds.size));
        } catch (error) {
            console.error('Error loading available assets:', error);
            toast.error('Failed to load available assets');
        } finally {
            setIsLoadingAssets(false);
        }
    }, [clientId, currentPage, pageSize, searchTerm, associatedAssetIds]);

    // Drawer data loading
    const loadDrawerData = useCallback(async (assetId: string, tab: AssetDrawerTab) => {
        const requestId = lastRequestIdRef.current + 1;
        lastRequestIdRef.current = requestId;

        setDrawerLoading(true);
        setDrawerError(null);

        try {
            const result = await loadAssetDetailDrawerData({ assetId, panel: tabToPanelParam(tab) });

            if (lastRequestIdRef.current !== requestId) {
                return;
            }

            setDrawerData(result.data ?? { asset: null });
            setDrawerError(result.error ?? null);
        } catch (error) {
            if (lastRequestIdRef.current !== requestId) {
                return;
            }
            console.error('Failed to load asset drawer data', error);
            setDrawerData({ asset: null });
            setDrawerError('Unable to load asset details right now. Please try again.');
        } finally {
            if (lastRequestIdRef.current === requestId) {
                setDrawerLoading(false);
            }
        }
    }, []);

    // Cleanup drawer fetch on unmount
    useEffect(() => {
        return () => {
            // No cleanup needed
        };
    }, []);

    const openDrawerForAsset = useCallback((asset: Asset, tab?: AssetDrawerTab) => {
        const nextTab = tab ?? ASSET_DRAWER_TABS.OVERVIEW;
        if (drawerAssetId !== asset.asset_id) {
            setDrawerAssetId(asset.asset_id);
        }
        if (!isDrawerOpen) {
            setIsDrawerOpen(true);
        }
        if (activeDrawerTab !== nextTab) {
            setActiveDrawerTab(nextTab);
        }
        void loadDrawerData(asset.asset_id, nextTab);
    }, [activeDrawerTab, drawerAssetId, isDrawerOpen, loadDrawerData]);

    const handleDrawerClose = useCallback(() => {
        setIsDrawerOpen(false);
        setDrawerAssetId(null);
        setActiveDrawerTab(ASSET_DRAWER_TABS.OVERVIEW);
        setDrawerData({ asset: null });
        setDrawerError(null);
    }, []);

    const handleDrawerTabChange = useCallback((tab: AssetDrawerTab) => {
        if (activeDrawerTab !== tab) {
            setActiveDrawerTab(tab);
        }
        if (drawerAssetId) {
            void loadDrawerData(drawerAssetId, tab);
        }
    }, [activeDrawerTab, drawerAssetId, loadDrawerData]);

    const loadAssociatedAssets = async () => {
        try {
            setIsLoading(true);
            const assets = await listEntityAssets(entityId, entityType);

            // Track associated asset IDs to filter them from available list
            setAssociatedAssetIds(new Set(assets.map(a => a.asset_id)));

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
            // Create associations for all selected assets, tracking successes and failures
            const results = await Promise.allSettled(
                Array.from(selectedAssets.values()).map(({ asset, relationshipType }) =>
                    createAssetAssociation({
                        asset_id: asset.asset_id,
                        entity_id: entityId,
                        entity_type: entityType,
                        relationship_type: relationshipType
                    })
                )
            );

            const succeeded = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;

            if (succeeded > 0 && failed === 0) {
                toast.success(`${succeeded} asset(s) associated successfully`);
            } else if (succeeded > 0 && failed > 0) {
                toast.success(`${succeeded} asset(s) associated successfully, ${failed} failed (may already be associated)`);
            } else {
                toast.error('Failed to associate assets - they may already be associated');
            }

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

    // Condensed list - show first 2 by default, expandable
    const INITIAL_DISPLAY_COUNT = 2;
    const [isExpanded, setIsExpanded] = useState(false);
    const visibleAssets = isExpanded ? associatedAssets : associatedAssets.slice(0, INITIAL_DISPLAY_COUNT);
    const hiddenCount = associatedAssets.length - INITIAL_DISPLAY_COUNT;

    const getAssetTypeIcon = (type: string) => {
        const iconProps = { className: 'h-4 w-4 text-gray-600' };
        switch (type.toLowerCase()) {
            case 'workstation':
                return <Monitor {...iconProps} />;
            case 'server':
                return <Server {...iconProps} />;
            case 'mobile_device':
                return <Smartphone {...iconProps} />;
            case 'printer':
                return <Printer {...iconProps} />;
            case 'network_device':
                return <Network {...iconProps} />;
            default:
                return <Boxes {...iconProps} />;
        }
    };

    return (
        <ReflectionContainer id={id} label="Associated Assets">
            <ContentCard>
                <div className="flex justify-between items-center">
                    <ContentCard.Header>
                        <Boxes className="w-5 h-5 mr-2" />
                        Associated Assets
                    </ContentCard.Header>
                    <Button
                        id='add-asset-button'
                        variant="outline"
                        size="sm"
                        onClick={handleOpenDialog}
                    >
                        Add Asset
                    </Button>
                </div>

                {isLoading ? (
                    <div className="text-gray-500 text-center py-8">Loading assets...</div>
                ) : associatedAssets.length === 0 ? (
                    <div className="text-gray-500 text-center py-8">No assets associated with this ticket.</div>
                ) : (
                    <div className="space-y-2">
                        {visibleAssets.map((association): React.JSX.Element => (
                            <div
                                key={`${association.asset_id}-${association.entity_id}`}
                                className="p-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                            >
                                {/* Row 1: Name + Status + Remove */}
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                        {association.asset ? (
                                            <Button
                                                id={`asset-name-${association.asset_id}`}
                                                variant="link"
                                                size="sm"
                                                onClick={() => openDrawerForAsset(association.asset!)}
                                                className="h-auto p-0 text-sm font-medium truncate text-left justify-start"
                                            >
                                                {association.asset.name}
                                            </Button>
                                        ) : (
                                            <span className="text-sm font-medium text-gray-900 truncate">
                                                Unknown Asset
                                            </span>
                                        )}
                                        {association.asset && (
                                            <RmmStatusIndicator asset={association.asset} size="sm" />
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        {association.asset && (
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                                association.asset.status === 'active' ? 'bg-purple-100 text-purple-800' :
                                                association.asset.status === 'inactive' ? 'bg-gray-100 text-gray-800' :
                                                association.asset.status === 'maintenance' ? 'bg-yellow-100 text-yellow-800' :
                                                'bg-gray-100 text-gray-800'
                                            }`}>
                                                {association.asset.status}
                                            </span>
                                        )}
                                        {association.asset && association.asset.rmm_provider && association.asset.rmm_device_id && (
                                            <RemoteAccessButton
                                                asset={association.asset}
                                                variant="ghost"
                                                size="sm"
                                            />
                                        )}
                                        <Button
                                            id={`remove-asset-${association.asset_id}`}
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleRemoveAsset(association.asset_id)}
                                            className="text-gray-600 hover:text-gray-900"
                                        >
                                            <span className="mr-1">×</span> Remove
                                        </Button>
                                    </div>
                                </div>
                                {/* Row 2: Icon + Tag + Type + Relationship */}
                                <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500">
                                    {association.asset && (
                                        <span className="flex-shrink-0">{getAssetTypeIcon(association.asset.asset_type)}</span>
                                    )}
                                    <span className="font-mono">{association.asset?.asset_tag || 'N/A'}</span>
                                    <span>•</span>
                                    <span>{association.asset?.asset_type.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}</span>
                                    <span>•</span>
                                    <span className="capitalize">{association.relationship_type}</span>
                                </div>
                            </div>
                        ))}

                        {/* Expandable section for additional assets */}
                        {hiddenCount > 0 && (
                            <Button
                                id="expand-assets-button"
                                variant="outline"
                                onClick={() => setIsExpanded(!isExpanded)}
                                className="flex items-center gap-1 px-4 py-3 w-full text-left text-primary-600 hover:text-primary-700 justify-start"
                            >
                                <span className="text-lg">+</span>
                                <span className="underline">
                                    {isExpanded ? 'Show less' : `${hiddenCount} more asset${hiddenCount !== 1 ? 's' : ''}`}
                                </span>
                                <svg
                                    className={`w-4 h-4 ml-1 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </Button>
                        )}
                    </div>
                )}

                <Dialog
                    id={`${id}-dialog`}
                    isOpen={isAddDialogOpen}
                    onClose={handleCloseDialog}
                    title="Add Asset"
                >
                    <div className="space-y-4" style={{ minWidth: '700px' }}>
                        {/* Search input */}
                        <div>
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
                                                <Checkbox
                                                    id="select-all-assets"
                                                    checked={areAllCurrentPageSelected()}
                                                    indeterminate={areSomeCurrentPageSelected()}
                                                    onChange={handleSelectAll}
                                                    containerClassName="mb-0"
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
                                                        <Checkbox
                                                            id={`select-asset-${asset.asset_id}`}
                                                            checked={isSelected}
                                                            onChange={() => handleAssetToggle(asset)}
                                                            containerClassName="mb-0"
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

                <AssetDetailDrawerClient
                    isOpen={isDrawerOpen}
                    selectedAssetId={drawerAssetId}
                    activeTab={activeDrawerTab}
                    asset={drawerData.asset}
                    maintenanceReport={drawerData.maintenanceReport}
                    maintenanceHistory={drawerData.maintenanceHistory}
                    history={drawerData.history}
                    tickets={drawerData.tickets}
                    documents={drawerData.documents}
                    error={drawerError}
                    isLoading={drawerLoading}
                    onClose={handleDrawerClose}
                    onTabChange={handleDrawerTabChange}
                    defaultBoardId={defaultBoardId}
                />
            </ContentCard>
        </ReflectionContainer>
    );
}
