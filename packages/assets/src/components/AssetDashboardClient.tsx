'use client';

import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react';
import { useAssetCrossFeature } from '../context/AssetCrossFeatureContext';
import { useRegisterUIComponent } from '@alga-psa/ui/ui-reflection/useRegisterUIComponent';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { useClientDrawer } from '@alga-psa/ui';
import { Card } from '@alga-psa/ui/components/Card';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import ClientNameCell from '@alga-psa/ui/components/ClientNameCell';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { usePrintAction } from '@alga-psa/ui/components/PrintButton';
import {
  createPrintColumnsFromColumnDefinitions,
  PrintOptionsDialog,
  usePrintColumnSelection,
} from '@alga-psa/ui/components/PrintOptionsDialog';
import { ShareActionsMenu, type ShareAction } from '@alga-psa/ui/components/ShareActionsMenu';
import { PrintableTable } from '@alga-psa/ui/components/PrintableTable';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@alga-psa/ui/components/DropdownMenu';
import type { Asset, AssetListResponse, AssetQueryParams, ClientMaintenanceSummary, ColumnDefinition, IClient, IClientLocation } from '@alga-psa/types';
import { bulkDeleteAssets, bulkUpdateAssets, getClientMaintenanceSummaries, listAssets } from '../actions/assetActions';
import { unwrapAssetActionResult } from '../actions/assetActionErrors';
import { loadAssetDetailDrawerData } from '../actions/assetDrawerActions';
import { getAllClientsForAssets, getClientLocationsForAssets } from '../actions/clientLookupActions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useRangeSelection } from '@alga-psa/ui/hooks';
import { toast } from 'react-hot-toast';
import { formatClientLocation } from '../lib/formatClientLocation';
import { QuickAddAsset } from './QuickAddAsset';
import { AssetCommandPalette } from './AssetCommandPalette';
import { AssetTypeBreakdownCard } from './AssetTypeBreakdownCard';
import { useAssetTypeRegistry } from './shared/useAssetTypeOptions';
import { fallbackAssetTypeLabel, resolveAssetTypeLabel } from '../lib/assetTypeDisplay';
import { isBuiltinAssetTypeSlug } from '../lib/assetTypeAttributes';
import { getIconComponent } from '@alga-psa/ui/components/IconPicker';
import { BulkActionBar } from '@alga-psa/ui/components/BulkActionBar';
import { ShortcutActiveRegion, useCatalogShortcut, usePageCreateShortcut, useShortcutScope } from '@alga-psa/ui/keyboard-shortcuts';
import { AssetDetailDrawerClient } from './AssetDetailDrawerClient';
import { RmmStatusIndicator } from './RmmStatusIndicator';
import {
  useFormatRmmAgentStatus,
  useRmmAgentStatusOptions,
} from '../hooks/useRmmAgentStatusOptions';
import {
  ASSET_DRAWER_TABS,
  type AssetDrawerTab,
  tabToPanelParam,
  type AssetDrawerServerData,
} from './AssetDetailDrawer.types';
import {
  Monitor,
  Server,
  Smartphone,
  Printer,
  Network,
  Boxes,
  Clock,
  AlertTriangle,
  TrendingUp,
  Filter,
  Search,
  MoreVertical,
  ChevronDown,
  RefreshCw,
  X,
  Settings2,
  Trash2,
  MapPin,
  CircleDot,
} from 'lucide-react';

interface AssetDashboardClientProps {
  initialAssets: AssetListResponse;
}

type ColumnKey =
  | 'select'
  | 'name'
  | 'asset_tag'
  | 'asset_type'
  | 'details'
  | 'status'
  | 'agent_status'
  | 'client_name'
  | 'location'
  | 'actions';

const STATUS_OPTIONS: string[] = ['active', 'inactive', 'maintenance'];
const TYPE_OPTIONS: string[] = ['workstation', 'server', 'network_device', 'mobile_device', 'printer'];
const ASSETS_PRINT_PAGE_SIZE = 5000;

export default function AssetDashboardClient({ initialAssets }: AssetDashboardClientProps) {
  const { t } = useTranslation('msp/assets');
  const clientDrawer = useClientDrawer();
  const assetTypeEntries = useAssetTypeRegistry();
  const customAssetTypes = useMemo(
    () => (assetTypeEntries ?? []).filter((entry) => !entry.is_builtin),
    [assetTypeEntries]
  );
  // F311: built-in slugs first (existing labels), then tenant custom types
  // from the registry in registry order.
  const typeFilterOptions = useMemo(
    () => [...TYPE_OPTIONS, ...customAssetTypes.map((entry) => entry.slug)],
    [customAssetTypes]
  );
  const rmmManagedOptions = useMemo(() => [
    {
      value: 'managed',
      label: t('assetDashboardClient.filters.rmmManaged.managed', {
        defaultValue: 'RMM Managed'
      })
    },
    {
      value: 'unmanaged',
      label: t('assetDashboardClient.filters.rmmManaged.unmanaged', {
        defaultValue: 'Not Managed'
      })
    }
  ], [t]);
  useRegisterUIComponent({
    id: 'asset-dashboard',
    type: 'container',
    label: t('assetDashboardClient.reflection.label', { defaultValue: 'Asset Dashboard' })
  });

  const [assets, setAssets] = useState<Asset[]>(initialAssets.assets);
  const [totalAssets, setTotalAssets] = useState(initialAssets.total);
  const [systemTotalAssets] = useState(initialAssets.total);
  const [pageSize, setPageSize] = useState(initialAssets.limit || 10);
  const [currentPage, setCurrentPage] = useState(initialAssets.page || 1);
  const [maintenanceSummaries, setMaintenanceSummaries] = useState<Record<string, ClientMaintenanceSummary>>({});
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const loading = assetsLoading || maintenanceLoading;

  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<string>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [typeFilters, setTypeFilters] = useState<string[]>([]);
  const [clientFilters, setClientFilters] = useState<string[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [clientsLoading, setClientsLoading] = useState(false);
  const [agentStatusFilters, setAgentStatusFilters] = useState<string[]>([]);
  const [rmmManagedFilter, setRmmManagedFilter] = useState<string[]>([]);
  const [visibleColumnIds, setVisibleColumnIds] = useState<ColumnKey[]>([
    'select',
    'name',
    'asset_tag',
    'asset_type',
    'status',
    'client_name',
    'location',
    'actions'
  ]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [isBulkStatusOpen, setIsBulkStatusOpen] = useState(false);
  const [isBulkLocationOpen, setIsBulkLocationOpen] = useState(false);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [bulkStatusValue, setBulkStatusValue] = useState<string>('active');
  const [bulkLocationMode, setBulkLocationMode] = useState<'saved' | 'custom' | 'clear'>('saved');
  const [bulkLocationId, setBulkLocationId] = useState<string>('');
  const [bulkCustomLocation, setBulkCustomLocation] = useState<string>('');
  const [bulkLocations, setBulkLocations] = useState<IClientLocation[]>([]);
  const [bulkLocationsLoading, setBulkLocationsLoading] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [printAssets, setPrintAssets] = useState<Asset[]>([]);
  const [drawerAssetId, setDrawerAssetId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [activeDrawerTab, setActiveDrawerTab] = useState<AssetDrawerTab>(ASSET_DRAWER_TABS.OVERVIEW);
  const [drawerData, setDrawerData] = useState<AssetDrawerServerData>({ asset: null });
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [ticketDialogAsset, setTicketDialogAsset] = useState<Asset | null>(null);
  const { renderQuickAddTicket } = useAssetCrossFeature();
  const lastRequestIdRef = useRef<number>(0);
  const lastAssetsRequestIdRef = useRef<number>(0);
  const lastAssetsQueryKeyRef = useRef<string>('');
  const [refreshCounter, setRefreshCounter] = useState(0);

  const refreshAssets = useCallback(() => {
    setRefreshCounter((prev) => prev + 1);
  }, []);

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
      setDrawerError(t('assetDashboardClient.errors.loadDrawerFailed', {
        defaultValue: 'Unable to load asset details right now. Please try again.'
      }));
    } finally {
      if (lastRequestIdRef.current === requestId) {
        setDrawerLoading(false);
      }
    }
  }, [t]);

  useEffect(() => {
    return () => {
      // No cleanup needed
    };
  }, []);

  useEffect(() => {
    const fetchClients = async () => {
      setClientsLoading(true);
      try {
        const clientData = await getAllClientsForAssets(true);
        setClients(clientData);
      } catch (error) {
        console.error('Error fetching clients for asset filters:', error);
        setClients([]);
      } finally {
        setClientsLoading(false);
      }
    };

    void fetchClients();
  }, []);

  useEffect(() => {
    const trimmed = searchTerm.trim();
    const handle = window.setTimeout(() => {
      setDebouncedSearchTerm(trimmed);
    }, 250);

    return () => window.clearTimeout(handle);
  }, [searchTerm]);

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

  const triggerQuickAdd = useCallback(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    params.set('intent', 'new-asset');
    window.history.replaceState(window.history.state, '', `/msp/assets?${params.toString()}`);
  }, []);

  const openAssetRecordPage = useCallback((assetId: string, options?: { newTab?: boolean }) => {
    const url = `/msp/assets/${assetId}`;
    if (options?.newTab) {
      if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      return;
    }

    if (typeof window === 'undefined') return;
    window.location.assign(url);
  }, []);

  const handleCommandSelectAsset = useCallback((asset: Asset) => {
    openDrawerForAsset(asset);
  }, [openDrawerForAsset]);

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

  const assetCommandPaletteShortcut = useCallback(() => {
    setIsCommandPaletteOpen(prev => !prev);
  }, []);

  useShortcutScope('page');
  usePageCreateShortcut(triggerQuickAdd);
  useCatalogShortcut('assets.commandPalette', assetCommandPaletteShortcut);

  const assetsByClient = useMemo(() => {
    return assets.reduce((acc, asset) => {
      if (!asset.client_id) return acc;
      if (!acc[asset.client_id]) acc[asset.client_id] = [];
      acc[asset.client_id].push(asset);
      return acc;
    }, {} as Record<string, Asset[]>);
  }, [assets]);



  useEffect(() => {
    async function loadMaintenanceSummaries() {
      setMaintenanceLoading(true);
      try {
        const clientIds = Object.keys(assetsByClient);
        if (clientIds.length === 0) {
          setMaintenanceSummaries({});
        } else {
          const summaries = unwrapAssetActionResult(await getClientMaintenanceSummaries(clientIds));
          setMaintenanceSummaries(summaries);
        }
      } catch (error) {
        console.error('Error loading maintenance summaries:', error);
      }
      setMaintenanceLoading(false);
    }

    void loadMaintenanceSummaries();
  }, [assetsByClient]);

  const maintenanceStats = useMemo(() => {
    return Object.values(maintenanceSummaries).reduce(
      (acc, summary) => {
        acc.totalSchedules += summary.total_schedules;
        acc.overdueMaintenances += summary.overdue_maintenances;
        acc.upcomingMaintenances += summary.upcoming_maintenances;
        return acc;
      },
      { totalSchedules: 0, overdueMaintenances: 0, upcomingMaintenances: 0 }
    );
  }, [maintenanceSummaries]);

  const clientNameById = useMemo(() => {
    const map = new Map<string, string>();
    clients.forEach((client) => {
      map.set(client.client_id, client.client_name);
    });
    assets.forEach((asset) => {
      if (asset.client_id && asset.client?.client_name && !map.has(asset.client_id)) {
        map.set(asset.client_id, asset.client.client_name);
      }
    });
    return map;
  }, [assets, clients]);

  const clientLogoById = useMemo(() => {
    const map = new Map<string, string | null>();
    clients.forEach((client) => {
      map.set(client.client_id, client.logoUrl ?? null);
    });
    return map;
  }, [clients]);



  const filteredCount = totalAssets;
  const hasActiveFilters = Boolean(
    searchTerm ||
    statusFilters.length > 0 ||
    typeFilters.length > 0 ||
    clientFilters.length > 0 ||
    agentStatusFilters.length > 0 ||
    rmmManagedFilter.length > 0
  );

  const isAllSelected = filteredCount > 0 && assets.every(asset => selectedAssetIds.includes(asset.asset_id));
  const isIndeterminate = selectedAssetIds.length > 0 && !isAllSelected;
  const selectedAssetIdSet = useMemo(() => new Set(selectedAssetIds), [selectedAssetIds]);

  const rangeSelect = useRangeSelection<Asset>({
    items: assets,
    getId: (asset) => asset.asset_id,
    selectedIds: selectedAssetIdSet,
    onSelectedIdsChange: (next) => setSelectedAssetIds(Array.from(next)),
  });
  // Remember each selected asset's client_id so the "single-client" check
  // still works when selection spans pages (selectedAssetIds outlives the
  // visible assets[]). Cleared when an id is deselected.
  const [selectedAssetClientIds, setSelectedAssetClientIds] = useState<Record<string, string>>({});

  useEffect(() => {
    setSelectedAssetClientIds((prev) => {
      const next: Record<string, string> = {};
      let changed = false;
      for (const id of selectedAssetIds) {
        const known = prev[id];
        const loaded = assets.find((asset) => asset.asset_id === id);
        const clientId = loaded?.client_id ?? known;
        if (clientId) next[id] = clientId;
        if (clientId !== known) changed = true;
      }
      if (!changed && Object.keys(prev).length === Object.keys(next).length) {
        return prev;
      }
      return next;
    });
  }, [assets, selectedAssetIds]);

  const singleClientSelectionId = useMemo(() => {
    if (selectedAssetIds.length === 0) return null;
    const known = selectedAssetIds.map((id) => selectedAssetClientIds[id]);
    if (known.some((id) => !id)) return null;
    const unique = new Set(known);
    return unique.size === 1 ? known[0] : null;
  }, [selectedAssetIds, selectedAssetClientIds]);
  const canBulkAssignSavedLocation = Boolean(singleClientSelectionId);

  const toggleSelectAll = useCallback(() => {
    setSelectedAssetIds(prev => {
      if (isAllSelected) {
        return [];
      }
      const ids = new Set(prev);
      assets.forEach(asset => ids.add(asset.asset_id));
      return Array.from(ids);
    });
  }, [assets, isAllSelected]);

  const handleTableSortChange = useCallback((columnId: string, direction: 'asc' | 'desc') => {
    if (columnId === sortBy && direction === sortDirection) {
      return;
    }
    setSortBy(columnId);
    setSortDirection(direction);
  }, [sortBy, sortDirection]);

  const getAssetListParams = useCallback((overrides: Partial<AssetQueryParams> = {}): AssetQueryParams => {
    const rmmManaged =
      rmmManagedFilter.length === 0
        ? undefined
        : rmmManagedFilter.includes('managed') && rmmManagedFilter.includes('unmanaged')
          ? undefined
          : rmmManagedFilter.includes('managed');

    return {
      search: debouncedSearchTerm || undefined,
      status: statusFilters.length > 0 ? statusFilters[0] : undefined,
      asset_type: typeFilters.length > 0 ? typeFilters[0] : undefined,
      client_id: clientFilters.length > 0 ? clientFilters[0] : undefined,
      agent_status: agentStatusFilters.length > 0 ? (agentStatusFilters[0] as AssetQueryParams['agent_status']) : undefined,
      rmm_managed: rmmManaged,
      sort_by: sortBy,
      sort_direction: sortDirection,
      ...overrides,
    };
  }, [
    agentStatusFilters,
    clientFilters,
    debouncedSearchTerm,
    rmmManagedFilter,
    sortBy,
    sortDirection,
    statusFilters,
    typeFilters,
  ]);

  const preparePrintAssets = useCallback(async () => {
    const selectedAssetSet = new Set(selectedAssetIds);

    if (selectedAssetIds.length > 0) {
      const loadedSelectedAssets = assets.filter((asset) => selectedAssetSet.has(asset.asset_id));

      if (loadedSelectedAssets.length === selectedAssetIds.length) {
        setPrintAssets(loadedSelectedAssets);
        return;
      }
    }

    const response = unwrapAssetActionResult(await listAssets(getAssetListParams({
      page: 1,
      limit: Math.max(totalAssets, pageSize, ASSETS_PRINT_PAGE_SIZE),
    })));

    setPrintAssets(selectedAssetIds.length > 0
      ? response.assets.filter((asset) => selectedAssetSet.has(asset.asset_id))
      : response.assets);
  }, [assets, getAssetListParams, pageSize, selectedAssetIds, totalAssets]);

  const assetsQueryKey = useMemo(() => {
    return JSON.stringify({
      search: debouncedSearchTerm,
      status: statusFilters,
      type: typeFilters,
      client: clientFilters,
      agentStatus: agentStatusFilters,
      rmmManaged: rmmManagedFilter,
      pageSize,
      sortBy,
      sortDirection,
    });
  }, [agentStatusFilters, clientFilters, debouncedSearchTerm, pageSize, rmmManagedFilter, sortBy, sortDirection, statusFilters, typeFilters]);

  useEffect(() => {
    const queryChanged = assetsQueryKey !== lastAssetsQueryKeyRef.current;
    if (queryChanged) {
      lastAssetsQueryKeyRef.current = assetsQueryKey;
      if (currentPage !== 1) {
        setCurrentPage(1);
        return;
      }
    }

    const requestId = lastAssetsRequestIdRef.current + 1;
    lastAssetsRequestIdRef.current = requestId;

    setAssetsLoading(true);
    (async () => {
      try {
          const response = unwrapAssetActionResult(await listAssets(getAssetListParams({
            page: currentPage,
            limit: pageSize,
          })));

        if (lastAssetsRequestIdRef.current !== requestId) {
          return;
        }

        setAssets(response.assets);
        setTotalAssets(response.total);
      } catch (error) {
        if (lastAssetsRequestIdRef.current !== requestId) {
          return;
        }
        console.error('Error fetching assets:', error);
      } finally {
        if (lastAssetsRequestIdRef.current === requestId) {
          setAssetsLoading(false);
        }
      }
    })();
  }, [
    agentStatusFilters,
    assetsQueryKey,
    currentPage,
    clientFilters,
    debouncedSearchTerm,
    getAssetListParams,
    pageSize,
    rmmManagedFilter,
    sortBy,
    sortDirection,
    statusFilters,
    typeFilters,
    refreshCounter,
  ]);

  const handleAssetAdded = useCallback(() => {
    refreshAssets();
  }, [refreshAssets]);

  const toggleFilterValue = (values: string[], value: string, setter: (next: string[]) => void) => {
    setter(values.includes(value) ? values.filter(v => v !== value) : [...values, value]);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilters([]);
    setTypeFilters([]);
    setClientFilters([]);
    setAgentStatusFilters([]);
    setRmmManagedFilter([]);
  };

  const bulkLocationOptions = useMemo<SelectOption[]>(() => (
    bulkLocations.map((location) => ({
      value: location.location_id,
      label: location.location_name || formatClientLocation(location),
    }))
  ), [bulkLocations]);

  useEffect(() => {
    if (!isBulkLocationOpen || !singleClientSelectionId) {
      setBulkLocations([]);
      setBulkLocationId('');
      return;
    }

    // Reset before fetching so a stale id from a different client (kept after
    // close/reopen with new selection) can't be submitted while loading.
    setBulkLocationId('');
    let isMounted = true;
    setBulkLocationsLoading(true);
    (async () => {
      try {
        const locations = await getClientLocationsForAssets(singleClientSelectionId);
        if (!isMounted) return;
        setBulkLocations(locations);
        setBulkLocationId(locations[0]?.location_id ?? '');
      } catch (error) {
        console.error('Failed to load locations for bulk asset action:', error);
        if (isMounted) {
          setBulkLocations([]);
          setBulkLocationId('');
        }
      } finally {
        if (isMounted) {
          setBulkLocationsLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [isBulkLocationOpen, singleClientSelectionId]);

  const summarizeBulkResult = useCallback((action: string, succeeded: number, failed: number) => {
    if (failed > 0) {
      toast.error(t('assetDashboardClient.bulk.partialFailure', {
        defaultValue: '{{action}} completed for {{succeeded}} asset(s); {{failed}} failed.',
        action,
        succeeded,
        failed,
      }));
      return;
    }

    toast.success(t('assetDashboardClient.bulk.success', {
      defaultValue: '{{action}} completed for {{count}} asset(s).',
      action,
      count: succeeded,
    }));
  }, [t]);

  const removeSucceededSelections = useCallback((results: Array<{ asset_id: string; success: boolean }>) => {
    const succeededIds = new Set(results.filter((result) => result.success).map((result) => result.asset_id));
    if (succeededIds.size === 0) return;
    setSelectedAssetIds((current) => current.filter((id) => !succeededIds.has(id)));
  }, []);

  const handleBulkStatusUpdate = useCallback(async () => {
    setBulkActionLoading(true);
    try {
      const response = unwrapAssetActionResult(await bulkUpdateAssets(selectedAssetIds, { status: bulkStatusValue }));
      summarizeBulkResult(
        t('assetDashboardClient.bulk.actions.updateStatus', { defaultValue: 'Status update' }),
        response.succeeded,
        response.failed
      );
      removeSucceededSelections(response.results);
      setIsBulkStatusOpen(false);
      refreshAssets();
    } catch (error) {
      console.error('Failed to bulk update asset status:', error);
      toast.error(t('assetDashboardClient.bulk.errors.updateStatusFailed', {
        defaultValue: 'Unable to update selected assets.'
      }));
    } finally {
      setBulkActionLoading(false);
    }
  }, [bulkStatusValue, refreshAssets, removeSucceededSelections, selectedAssetIds, summarizeBulkResult, t]);

  const handleBulkLocationUpdate = useCallback(async () => {
    setBulkActionLoading(true);
    try {
      const payload =
        bulkLocationMode === 'saved'
          ? { location_id: bulkLocationId }
          : bulkLocationMode === 'clear'
            ? { location_id: null, location: '' }
            : { location_id: null, location: bulkCustomLocation.trim() };

      const response = unwrapAssetActionResult(await bulkUpdateAssets(selectedAssetIds, payload));
      summarizeBulkResult(
        t('assetDashboardClient.bulk.actions.updateLocation', { defaultValue: 'Location update' }),
        response.succeeded,
        response.failed
      );
      removeSucceededSelections(response.results);
      setIsBulkLocationOpen(false);
      refreshAssets();
    } catch (error) {
      console.error('Failed to bulk update asset location:', error);
      toast.error(t('assetDashboardClient.bulk.errors.updateLocationFailed', {
        defaultValue: 'Unable to update selected asset locations.'
      }));
    } finally {
      setBulkActionLoading(false);
    }
  }, [bulkCustomLocation, bulkLocationId, bulkLocationMode, refreshAssets, removeSucceededSelections, selectedAssetIds, summarizeBulkResult, t]);

  const handleBulkDelete = useCallback(async () => {
    setBulkActionLoading(true);
    try {
      const response = unwrapAssetActionResult(await bulkDeleteAssets(selectedAssetIds));
      summarizeBulkResult(
        t('assetDashboardClient.bulk.actions.deleteAssets', { defaultValue: 'Delete' }),
        response.succeeded,
        response.failed
      );
      removeSucceededSelections(response.results);
      setIsBulkDeleteOpen(false);
      refreshAssets();
    } catch (error) {
      console.error('Failed to bulk delete assets:', error);
      toast.error(t('assetDashboardClient.bulk.errors.deleteFailed', {
        defaultValue: 'Unable to delete selected assets.'
      }));
    } finally {
      setBulkActionLoading(false);
    }
  }, [refreshAssets, removeSucceededSelections, selectedAssetIds, summarizeBulkResult, t]);

  const getAssetTypeIcon = useCallback((type: string) => {
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
      default: {
        const customIcon = customAssetTypes.find((entry) => entry.slug === type)?.icon;
        if (customIcon) {
          const CustomIcon = getIconComponent(customIcon);
          return <CustomIcon {...iconProps} />;
        }
        return <Boxes {...iconProps} />;
      }
    }
  }, [customAssetTypes]);

  const renderAssetDetails = useCallback((asset: Asset): string => {
    if (asset.workstation) {
      return `${asset.workstation.os_type} - ${asset.workstation.cpu_model} - ${asset.workstation.ram_gb}GB RAM`;
    }
    if (asset.network_device) {
      return `${asset.network_device.device_type} - ${asset.network_device.management_ip || t('assetDashboardClient.details.noIp', { defaultValue: 'No IP' })}`;
    }
    if (asset.server) {
      return `${asset.server.os_type} - ${asset.server.cpu_model} - ${asset.server.ram_gb}GB RAM`;
    }
    if (asset.mobile_device) {
      return `${asset.mobile_device.os_type} - ${asset.mobile_device.model}`;
    }
    if (asset.printer) {
      return `${asset.printer.model} - ${asset.printer.is_network_printer ? t('assetDashboardClient.details.network', { defaultValue: 'Network' }) : t('assetDashboardClient.details.local', { defaultValue: 'Local' })}`;
    }
    return t('assetDashboardClient.details.noDetails', { defaultValue: 'No details available' });
  }, [t]);

  const getAssetStatusLabel = useCallback((status: string) => {
    return t(`assetDashboardClient.statuses.${status}`, {
      defaultValue: status.charAt(0).toUpperCase() + status.slice(1)
    });
  }, [t]);

  const getAssetTypeLabel = useCallback((type: string) => {
    // Built-ins keep their existing i18n labels; custom slugs resolve to the
    // registry name; unknown slugs keep the historical title-cased fallback.
    if (isBuiltinAssetTypeSlug(type)) {
      return t(`assetDashboardClient.types.${type}`, {
        defaultValue: fallbackAssetTypeLabel(type)
      });
    }
    return resolveAssetTypeLabel(assetTypeEntries, type);
  }, [assetTypeEntries, t]);

  const getAgentStatusLabel = useFormatRmmAgentStatus();
  const agentStatusOptions = useRmmAgentStatusOptions();

  const toggleColumn = useCallback((key: ColumnKey) => {
    setVisibleColumnIds(prev => {
      if (prev.includes(key)) {
        if (prev.length === 3) {
          return prev; // keep minimum columns visible
        }
        return prev.filter(id => id !== key);
      }
      return [...prev, key];
    });
  }, []);

  const columnLibrary: Record<ColumnKey, ColumnDefinition<Asset>> = useMemo(() => ({
    select: {
      dataIndex: 'select',
      title: (
        <div
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <Checkbox
            id="asset-select-all"
            checked={isAllSelected}
            onChange={toggleSelectAll}
            aria-label={t('assetDashboardClient.selection.selectAllVisibleAssets', {
              defaultValue: 'Select all visible assets'
            })}
            className="m-0"
            indeterminate={isIndeterminate}
            skipRegistration
          />
        </div>
      ),
      sortable: false,
      render: (_: unknown, record: Asset) => {
        const isChecked = rangeSelect.isSelected(record.asset_id);
        return (
          <div
            className="absolute inset-0 flex items-center justify-center cursor-pointer outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
            onClick={(event) => {
              event.stopPropagation();
              rangeSelect.handleSelect(record.asset_id, {
                shiftKey: event.shiftKey,
                selected: !isChecked,
                preventDefault: () => event.preventDefault(),
              });
              event.preventDefault();
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Checkbox
              id={`asset-select-${record.asset_id}`}
              checked={isChecked}
              onClick={(event: React.MouseEvent<HTMLInputElement>) => {
                event.stopPropagation();
                rangeSelect.handleSelect(record.asset_id, {
                  shiftKey: event.shiftKey,
                  selected: !isChecked,
                  preventDefault: () => event.preventDefault(),
                });
                event.preventDefault();
              }}
              onChange={() => { /* controlled via onClick for shift-range support */ }}
              aria-label={t('assetDashboardClient.selection.selectAsset', {
                defaultValue: 'Select asset {{name}}',
                name: record.name
              })}
              className="m-0 pointer-events-none"
              skipRegistration
            />
          </div>
        );
      },
      width: '4%',
      headerClassName: 'text-center px-4',
      cellClassName: 'relative text-center px-4'
    },
    name: {
      dataIndex: 'name',
      title: t('assetDashboardClient.table.name', { defaultValue: 'Name' }),
      render: (_value: unknown, record: Asset) => (
        <div className="max-w-[240px] truncate" title={record.name}>
          <button
            type="button"
            className="font-medium text-primary-600 hover:text-primary-700 hover:underline transition-colors block w-full truncate text-left"
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey) {
                event.preventDefault();
                openAssetRecordPage(record.asset_id, { newTab: true });
                return;
              }

              event.preventDefault();
              openAssetRecordPage(record.asset_id);
            }}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                openAssetRecordPage(record.asset_id, { newTab: true });
              }
            }}
          >
            <span className="truncate block">{record.name}</span>
          </button>
        </div>
      )
    },
    asset_tag: {
      dataIndex: 'asset_tag',
      title: t('assetDashboardClient.table.tag', { defaultValue: 'Tag' }),
      render: (value: unknown) => (
        <span className="font-mono text-sm text-gray-600">{value as string}</span>
      )
    },
    asset_type: {
      dataIndex: 'asset_type',
      title: t('assetDashboardClient.table.type', { defaultValue: 'Type' }),
      render: (value: string) => (
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-gray-50 rounded-lg border border-gray-100">
            {getAssetTypeIcon(value)}
          </div>
          <span className="text-sm font-medium text-gray-700">
            {getAssetTypeLabel(value)}
          </span>
        </div>
      )
    },
    details: {
      dataIndex: 'details',
      title: t('assetDashboardClient.table.details', { defaultValue: 'Details' }),
      sortable: false,
      render: (_: unknown, record: Asset) => (
        <span className="text-sm text-gray-600">{renderAssetDetails(record)}</span>
      )
    },
    status: {
      dataIndex: 'status',
      title: t('assetDashboardClient.table.status', { defaultValue: 'Status' }),
      render: (value: unknown) => {
        const status = value as string;
        return (
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
              status === 'active'
                ? 'bg-[rgb(var(--badge-success-bg))] text-[rgb(var(--badge-success-text))] ring-1 ring-[rgb(var(--badge-success-border))]'
                : status === 'inactive'
                ? 'bg-[rgb(var(--badge-default-bg))] text-[rgb(var(--badge-default-text))] ring-1 ring-[rgb(var(--badge-default-border))]'
                : 'bg-[rgb(var(--badge-warning-bg))] text-[rgb(var(--badge-warning-text))] ring-1 ring-[rgb(var(--badge-warning-border))]'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                status === 'active' ? 'bg-[rgb(var(--badge-success-text))]' : status === 'inactive' ? 'bg-[rgb(var(--badge-default-text))]' : 'bg-[rgb(var(--badge-warning-text))]'
              }`}
            ></span>
            {getAssetStatusLabel(status)}
          </span>
        );
      }
    },
    agent_status: {
      dataIndex: 'agent_status',
      title: t('assetDashboardClient.table.agent', { defaultValue: 'Agent' }),
      render: (_: unknown, record: Asset) => {
        // Only show for RMM-managed assets
        if (!record.rmm_provider || !record.rmm_device_id) {
          return <span className="text-xs text-gray-400">{t('common.states.none', { defaultValue: 'None' })}</span>;
        }
        return <RmmStatusIndicator asset={record} size="sm" />;
      }
    },
    client_name: {
      dataIndex: 'client_name',
      title: t('assetDashboardClient.table.client', { defaultValue: 'Client' }),
      render: (_: unknown, record: Asset) => {
        const name = record.client?.client_name || t('assetDashboardClient.details.unassigned', { defaultValue: 'Unassigned' });
        const logoUrl = record.client_id ? (clientLogoById.get(record.client_id) ?? null) : null;
        if (record.client_id && clientDrawer) {
          return (
            <ClientNameCell clientId={record.client_id} clientName={name} logoUrl={logoUrl}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  clientDrawer.openClientDrawer(record.client_id);
                }}
                className="text-sm font-medium text-blue-500 hover:underline text-left bg-transparent border-none p-0 truncate"
              >
                {name}
              </button>
            </ClientNameCell>
          );
        }
        return <ClientNameCell clientId={record.client_id} clientName={name} logoUrl={logoUrl} />;
      }
    },
    location: {
      dataIndex: 'location',
      title: t('assetDashboardClient.table.location', { defaultValue: 'Location' }),
      render: (value: unknown) => (
        <span className="text-sm font-medium text-gray-700">{(value as string) || t('common.states.none', { defaultValue: 'None' })}</span>
      )
    },
    actions: {
      dataIndex: 'actions',
      title: t('assetDashboardClient.table.actions', { defaultValue: 'Actions' }),
      sortable: false,
      render: (_: unknown, record: Asset) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`asset-${record.asset_id}-actions-menu`}
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={t('assetDashboardClient.actions.openActionsForAsset', {
                defaultValue: 'Open actions for asset {{name}}',
                name: record.name
              })}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              id={`view-asset-${record.asset_id}`}
              onSelect={() => {
                if (typeof window !== 'undefined') {
                  window.location.assign(`/msp/assets/${record.asset_id}`);
                }
              }}
            >
              {t('assetDashboardClient.actions.viewDetails', { defaultValue: 'View details' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`edit-asset-${record.asset_id}`}
              onSelect={() => {
                if (typeof window !== 'undefined') {
                  window.location.assign(`/msp/assets/${record.asset_id}/edit`);
                }
              }}
            >
              {t('assetDashboardClient.actions.editAsset', { defaultValue: 'Edit asset' })}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              id={`create-ticket-${record.asset_id}`}
              onSelect={() => setTicketDialogAsset(record)}
            >
              {t('assetDashboardClient.actions.createTicket', { defaultValue: 'Create ticket' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
  }), [
    t,
    isAllSelected,
    isIndeterminate,
    rangeSelect,
    toggleSelectAll,
    getAssetTypeIcon,
    renderAssetDetails,
    openAssetRecordPage,
    clientDrawer,
    clientLogoById,
    getAssetStatusLabel,
    getAssetTypeLabel,
  ]);

  const columns: ColumnDefinition<Asset>[] = useMemo(() => {
    return visibleColumnIds.map((key) => columnLibrary[key]);
  }, [visibleColumnIds, columnLibrary]);

  const printColumns = useMemo(() => (
    createPrintColumnsFromColumnDefinitions(Object.values(columnLibrary), {
      excludeColumnKeys: ['select', 'actions'],
      emptyValue: t('assetDashboardClient.print.emptyValue', { defaultValue: '-' }),
      renderers: {
        name: (asset) => asset.name,
        asset_tag: (asset) => asset.asset_tag || t('assetDashboardClient.print.emptyValue', { defaultValue: '-' }),
        asset_type: (asset) => getAssetTypeLabel(asset.asset_type),
        details: (asset) => renderAssetDetails(asset),
        status: (asset) => getAssetStatusLabel(asset.status),
        agent_status: (asset) => asset.rmm_provider && asset.rmm_device_id
          ? getAgentStatusLabel(asset.agent_status ?? 'unknown')
          : t('common.states.none', { defaultValue: 'None' }),
        client_name: (asset) => asset.client?.client_name
          || clientNameById.get(asset.client_id)
          || t('assetDashboardClient.details.unassigned', { defaultValue: 'Unassigned' }),
        location: (asset) => asset.location || t('assetDashboardClient.print.emptyValue', { defaultValue: '-' }),
      },
    })
  ), [clientNameById, columnLibrary, getAgentStatusLabel, getAssetStatusLabel, getAssetTypeLabel, renderAssetDetails, t]);
  const {
    selectedColumnKeys: selectedAssetPrintColumnKeys,
    selectedColumns: selectedAssetPrintColumns,
    setSelectedColumnKeys: setSelectedAssetPrintColumnKeys,
    resetSelectedColumnKeys: resetSelectedAssetPrintColumnKeys,
  } = usePrintColumnSelection('print-columns:assets-list', printColumns);

  const [isPrintOptionsOpen, setIsPrintOptionsOpen] = useState(false);

  const { triggerPrint: triggerPrintAssets, isPreparing: isPreparingAssetPrint } = usePrintAction({
    onBeforePrint: preparePrintAssets,
    onAfterPrint: () => setPrintAssets([]),
  });

  return (
    <div className="relative p-6">
      <div className="space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                {t('assetDashboardClient.title', { defaultValue: 'Asset Workspace' })}
              </h1>
              <p className="text-sm text-gray-500">
                {t('assetDashboardClient.description', {
                  defaultValue: 'Operate at scale with filters, saved views, and bulk actions.'
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ShareActionsMenu
                id="assets-share-actions"
                triggerSize="sm"
                tooltip={t('actions.print', { defaultValue: 'Print' })}
                actions={[
                  {
                    id: 'assets-share-print',
                    icon: Printer,
                    label: selectedAssetIds.length > 0
                      ? t('actions.printSelected', {
                          count: selectedAssetIds.length,
                          defaultValue: 'Print selected ({{count}})',
                        })
                      : t('actions.print', { defaultValue: 'Print' }),
                    onSelect: () => { void triggerPrintAssets(); },
                    disabled: isPreparingAssetPrint,
                  },
                  {
                    id: 'assets-share-print-options',
                    icon: Settings2,
                    label: t('actions.printOptions', { defaultValue: 'Print options' }),
                    onSelect: () => setIsPrintOptionsOpen(true),
                  },
                ] satisfies ShareAction[]}
              />
              <Button
                id="refresh-assets-button"
              variant="ghost"
              size="sm"
              className="gap-2"
              onClick={() => { void handleAssetAdded(); }}
            >
                <RefreshCw className="h-4 w-4" />
                {t('assetDashboardClient.actions.refreshData', { defaultValue: 'Refresh data' })}
              </Button>
              <QuickAddAsset onAssetAdded={() => { void handleAssetAdded(); }} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {t('assetDashboardClient.metrics.totalAssets.title', { defaultValue: 'Total assets' })}
              </p>
              <p className="text-3xl font-semibold text-gray-900 mt-2">{systemTotalAssets}</p>
              <p className="text-xs text-gray-500 mt-1">
                {t('assetDashboardClient.metrics.totalAssets.helper', {
                  defaultValue: 'Across all clients'
                })}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {t('assetDashboardClient.metrics.filteredView.title', { defaultValue: 'Filtered view' })}
              </p>
              <p className="text-3xl font-semibold text-gray-900 mt-2">{filteredCount}</p>
              <p className="text-xs text-gray-500 mt-1">
                {t('assetDashboardClient.metrics.filteredView.helper', {
                  defaultValue: 'Matching active filters'
                })}
              </p>
            </Card>
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {t('assetDashboardClient.metrics.automationReady.title', {
                    defaultValue: 'Automation ready'
                  })}
                </p>
                <p className="text-3xl font-semibold text-gray-900 mt-2">{maintenanceStats.totalSchedules}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {t('assetDashboardClient.metrics.automationReady.helper', {
                    defaultValue: 'Active maintenance schedules'
                  })}
                </p>
              </div>
              <div className="flex flex-col gap-1 text-right text-xs text-gray-500">
                <span className="font-medium text-emerald-600">
                  {t('assetDashboardClient.metrics.automationReady.upcoming', {
                    defaultValue: 'Upcoming: {{count}}',
                    count: maintenanceStats.upcomingMaintenances
                  })}
                </span>
                <span className="font-medium text-amber-600">
                  {t('assetDashboardClient.metrics.automationReady.overdue', {
                    defaultValue: 'Overdue: {{count}}',
                    count: maintenanceStats.overdueMaintenances
                  })}
                </span>
              </div>
            </Card>
          </div>

          <Card className="p-4 space-y-4" {...withDataAutomationId({ id: 'asset-toolbar-card' })}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-1 items-center gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    id="asset-search-input"
                    placeholder={t('assetDashboardClient.filters.searchPlaceholder', {
                      defaultValue: 'Search by name, tag, or serial number'
                    })}
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    className="pl-9"
                  />
                </div>
                  <Button
                    id="asset-filters-clear-button"
                    variant="ghost"
                    size="sm"
                    onClick={clearFilters}
                    disabled={!searchTerm && statusFilters.length === 0 && typeFilters.length === 0 && clientFilters.length === 0}
                  >
                  {t('assetDashboardClient.filters.reset', { defaultValue: 'Reset' })}
                  </Button>
                </div>
              <div className="flex flex-wrap items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button id="status-filter-button" variant="ghost" size="sm" className="gap-1">
                      <Filter className="h-4 w-4" />
                      {t('assetDashboardClient.filters.status', { defaultValue: 'Status' })}
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    {STATUS_OPTIONS.map((status) => (
                      <DropdownMenuItem key={status} id={`filter-status-${status}`} onSelect={(event) => event.preventDefault()}>
                        <Checkbox
                          id={`status-checkbox-${status}`}
                          checked={statusFilters.includes(status)}
                          onChange={() => toggleFilterValue(statusFilters, status, setStatusFilters)}
                          className="mr-2"
                        />
                        <span className="capitalize">{getAssetStatusLabel(status)}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button id="type-filter-button" variant="ghost" size="sm" className="gap-1">
                      <Filter className="h-4 w-4" />
                      {t('assetDashboardClient.filters.type', { defaultValue: 'Type' })}
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-52">
                    {typeFilterOptions.map((type) => (
                      <DropdownMenuItem key={type} id={`filter-type-${type}`} onSelect={(event) => event.preventDefault()}>
                        <Checkbox
                          id={`type-checkbox-${type}`}
                          checked={typeFilters.includes(type)}
                          onChange={() => toggleFilterValue(typeFilters, type, setTypeFilters)}
                          className="mr-2"
                        />
                        <span className="capitalize">{getAssetTypeLabel(type)}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button id="agent-status-filter-button" variant="ghost" size="sm" className="gap-1">
                      <Monitor className="h-4 w-4" />
                      {t('assetDashboardClient.filters.agent', { defaultValue: 'Agent' })}
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    {agentStatusOptions.map(({ value }) => (
                      <DropdownMenuItem key={value} id={`filter-agent-${value}`} onSelect={(event) => event.preventDefault()}>
                        <Checkbox
                          id={`agent-checkbox-${value}`}
                          checked={agentStatusFilters.includes(value)}
                          onChange={() => toggleFilterValue(agentStatusFilters, value, setAgentStatusFilters)}
                          className="mr-2"
                        />
                        <span>{getAgentStatusLabel(value)}</span>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    {rmmManagedOptions.map(({ value, label }) => (
                      <DropdownMenuItem key={value} id={`filter-rmm-${value}`} onSelect={(event) => event.preventDefault()}>
                        <Checkbox
                          id={`rmm-checkbox-${value}`}
                          checked={rmmManagedFilter.includes(value)}
                          onChange={() => toggleFilterValue(rmmManagedFilter, value, setRmmManagedFilter)}
                          className="mr-2"
                        />
                        <span>{label}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button id="column-chooser-button" variant="ghost" size="sm" className="gap-1">
                      {t('assetDashboardClient.filters.columns', { defaultValue: 'Columns' })}
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    {(Object.keys(columnLibrary) as ColumnKey[]).map((key) => (
                      <DropdownMenuItem key={key} id={`column-toggle-${key}`} onSelect={(event) => event.preventDefault()}>
                        <Checkbox
                          id={`column-checkbox-${key}`}
                          checked={visibleColumnIds.includes(key)}
                          onChange={() => toggleColumn(key)}
                          className="mr-2"
                        />
                        <span className="capitalize">
                          {t(`assetDashboardClient.columns.${key}`, {
                            defaultValue: key.replace('_', ' ')
                          })}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <div className="flex items-center gap-1 border-l border-gray-200 pl-2 ml-1">
                  <ClientPicker
                    id="asset-client-filter"
                    clients={clients}
                    selectedClientId={clientFilters[0] ?? null}
                    onSelect={(clientId) => setClientFilters(clientId ? [clientId] : [])}
                    filterState={clientFilterState}
                    onFilterStateChange={setClientFilterState}
                    clientTypeFilter={clientTypeFilter}
                    onClientTypeFilterChange={setClientTypeFilter}
                    placeholder={clientsLoading
                      ? t('assetDashboardClient.filters.client.loading', { defaultValue: 'Loading clients…' })
                      : t('assetDashboardClient.filters.client.placeholder', { defaultValue: 'Client' })}
                    fitContent
                    triggerVariant="ghost"
                    triggerSize="sm"
                    className="min-w-[200px]"
                    triggerButtonClassName="gap-1"
                  />
                  {clientFilters.length > 0 && (
                    <Button
                      id="asset-client-filter-clear"
                      variant="ghost"
                      size="sm"
                      className="px-0 w-9"
                      aria-label={t('assetDashboardClient.filters.client.clear', {
                        defaultValue: 'Clear client filter'
                      })}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setClientFilters([]);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {(statusFilters.length > 0 || typeFilters.length > 0 || clientFilters.length > 0 || agentStatusFilters.length > 0 || rmmManagedFilter.length > 0) && (
              <div className="flex flex-wrap gap-2" {...withDataAutomationId({ id: 'active-filters-bar' })}>
                {statusFilters.map((status) => (
                  <Badge key={`status-pill-${status}`} variant="outline" className="flex items-center gap-2">
                    {t('assetDashboardClient.activeFilters.status', {
                      defaultValue: 'Status: {{value}}',
                      value: getAssetStatusLabel(status)
                    })}
                    <Button
                      id={`remove-status-${status}`}
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => toggleFilterValue(statusFilters, status, setStatusFilters)}
                    >
                      ×
                    </Button>
                  </Badge>
                ))}
                {typeFilters.map((type) => (
                  <Badge key={`type-pill-${type}`} variant="outline" className="flex items-center gap-2">
                    {t('assetDashboardClient.activeFilters.type', {
                      defaultValue: 'Type: {{value}}',
                      value: getAssetTypeLabel(type)
                    })}
                    <Button
                      id={`remove-type-${type}`}
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => toggleFilterValue(typeFilters, type, setTypeFilters)}
                    >
                      ×
                    </Button>
                  </Badge>
                ))}
                {clientFilters.map((clientId) => {
                  const label = clientNameById.get(clientId) ?? t('assetDashboardClient.filters.client.placeholder', { defaultValue: 'Client' });
                  return (
                    <Badge key={`client-pill-${clientId}`} variant="outline" className="flex items-center gap-2">
                      {t('assetDashboardClient.activeFilters.client', {
                        defaultValue: 'Client: {{value}}',
                        value: label
                      })}
                      <Button
                        id={`remove-client-${clientId}`}
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => toggleFilterValue(clientFilters, clientId, setClientFilters)}
                      >
                        ×
                      </Button>
                    </Badge>
                  );
                })}
                {agentStatusFilters.map((status) => {
                  const label = getAgentStatusLabel(status);
                  return (
                    <Badge key={`agent-pill-${status}`} variant="outline" className="flex items-center gap-2">
                      {t('assetDashboardClient.activeFilters.agent', {
                        defaultValue: 'Agent: {{value}}',
                        value: label
                      })}
                      <Button
                        id={`remove-agent-${status}`}
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => toggleFilterValue(agentStatusFilters, status, setAgentStatusFilters)}
                      >
                        ×
                      </Button>
                    </Badge>
                  );
                })}
                {rmmManagedFilter.map((filter) => {
                  const label = rmmManagedOptions.find(opt => opt.value === filter)?.label || filter;
                  return (
                    <Badge key={`rmm-pill-${filter}`} variant="outline" className="flex items-center gap-2">
                      {label}
                      <Button
                        id={`remove-rmm-${filter}`}
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => toggleFilterValue(rmmManagedFilter, filter, setRmmManagedFilter)}
                      >
                        ×
                      </Button>
                    </Badge>
                  );
                })}
              </div>
            )}
          </Card>

          <Card className="p-6 space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4" {...withDataAutomationId({ id: 'asset-metrics-strip' })}>
              <SummaryTile
                id="metric-total-assets"
                title={t('assetDashboardClient.metrics.totalAssets.title', { defaultValue: 'Total Assets' })}
                helper={t('assetDashboardClient.metrics.totalAssets.helper', { defaultValue: 'Across all clients' })}
                icon={<Boxes className="h-4 w-4 text-blue-500" />}
                value={totalAssets}
                isLoading={loading}
              />
              <SummaryTile
                id="metric-active-schedules"
                title={t('assetDashboardClient.metrics.activeSchedules.title', { defaultValue: 'Active Schedules' })}
                helper={t('assetDashboardClient.metrics.activeSchedules.helper', { defaultValue: 'Lifecycle automation' })}
                icon={<TrendingUp className="h-4 w-4 text-emerald-500" />}
                value={maintenanceStats.totalSchedules}
                isLoading={loading}
              />
              <SummaryTile
                id="metric-overdue-maintenance"
                title={t('assetDashboardClient.metrics.overdueMaintenance.title', { defaultValue: 'Maintenance Overdue' })}
                helper={t('assetDashboardClient.metrics.overdueMaintenance.helper', { defaultValue: 'Needs attention' })}
                icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
                value={maintenanceStats.overdueMaintenances}
                isLoading={loading}
              />
              <SummaryTile
                id="metric-upcoming-maintenance"
                title={t('assetDashboardClient.metrics.upcomingMaintenance.title', { defaultValue: 'Upcoming Maintenance' })}
                helper={t('assetDashboardClient.metrics.upcomingMaintenance.helper', { defaultValue: 'Next 30 days' })}
                icon={<Clock className="h-4 w-4 text-violet-500" />}
                value={maintenanceStats.upcomingMaintenances}
                isLoading={loading}
              />
            </div>

            <AssetTypeBreakdownCard
              getTypeLabel={getAssetTypeLabel}
              refreshToken={refreshCounter}
              activeTypes={typeFilters}
              onSelectType={(slug) => toggleFilterValue(typeFilters, slug, setTypeFilters)}
            />

            <ShortcutActiveRegion id="assets-shortcut-region" className="outline-none">
              <DataTable
                id="asset-table"
                data={assets}
                columns={columns}
                pagination
                pageSize={pageSize}
                currentPage={currentPage}
                totalItems={totalAssets}
                onPageChange={setCurrentPage}
                onItemsPerPageChange={setPageSize}
                onRowClick={(asset) => openAssetRecordPage(asset.asset_id)}
                manualSorting={true}
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSortChange={handleTableSortChange}
              />
            </ShortcutActiveRegion>
            <div className="app-print-root app-print-only">
              <PrintableTable
                title={selectedAssetIds.length > 0
                  ? t('assetDashboardClient.print.selectedTitle', {
                      count: selectedAssetIds.length,
                      defaultValue: 'Selected Assets',
                    })
                  : t('assetDashboardClient.print.title', { defaultValue: 'Assets' })}
                subtitle={t('assetDashboardClient.print.subtitle', {
                  count: printAssets.length,
                  defaultValue: '{{count}} assets',
                })}
                rows={printAssets}
                columns={selectedAssetPrintColumns}
                getRowKey={(asset) => asset.asset_id}
                emptyMessage={t('assetDashboardClient.print.noAssets', { defaultValue: 'No assets to print' })}
              />
            </div>
          </Card>
      </div>
      <PrintOptionsDialog
        id="assets-print-options-dialog"
        open={isPrintOptionsOpen}
        onOpenChange={setIsPrintOptionsOpen}
        title={t('assetDashboardClient.print.optionsDialog.title', { defaultValue: 'Print options' })}
        description={t('assetDashboardClient.print.optionsDialog.description', {
          defaultValue: 'Choose which columns to include when printing assets.',
        })}
        columns={printColumns}
        selectedColumnKeys={selectedAssetPrintColumnKeys}
        onSelectedColumnKeysChange={setSelectedAssetPrintColumnKeys}
        onReset={resetSelectedAssetPrintColumnKeys}
        onPrint={() => triggerPrintAssets()}
        isPrinting={isPreparingAssetPrint}
        printLabel={selectedAssetIds.length > 0
          ? t('actions.printSelected', {
              count: selectedAssetIds.length,
              defaultValue: 'Print selected ({{count}})',
            })
          : t('actions.print', { defaultValue: 'Print' })
        }
      />
      <Dialog
        id="bulk-status-assets"
        isOpen={isBulkStatusOpen}
        onClose={() => setIsBulkStatusOpen(false)}
        title={t('assetDashboardClient.bulk.statusDialog.title', { defaultValue: 'Set asset status' })}
        className="max-w-md"
        disableFocusTrap
        footer={(
          <div className="flex justify-end gap-2">
            <Button id="bulk-status-cancel" variant="outline" onClick={() => setIsBulkStatusOpen(false)}>
              {t('common.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button id="bulk-status-apply" onClick={() => { void handleBulkStatusUpdate(); }} disabled={bulkActionLoading}>
              {bulkActionLoading
                ? t('assetDashboardClient.bulk.actions.applying', { defaultValue: 'Applying...' })
                : t('assetDashboardClient.bulk.actions.apply', { defaultValue: 'Apply' })}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {t('assetDashboardClient.bulk.statusDialog.description', {
                defaultValue: 'Update {{count}} selected asset(s).',
                count: selectedAssetIds.length,
              })}
            </p>
            <CustomSelect
              id="bulk-status-select"
              value={bulkStatusValue}
              onValueChange={setBulkStatusValue}
              options={STATUS_OPTIONS.map((status) => ({
                value: status,
                label: getAssetStatusLabel(status),
              }))}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        id="bulk-location-assets"
        isOpen={isBulkLocationOpen}
        onClose={() => setIsBulkLocationOpen(false)}
        title={t('assetDashboardClient.bulk.locationDialog.title', { defaultValue: 'Set asset location' })}
        className="max-w-lg"
        disableFocusTrap
        footer={(
          <div className="flex justify-end gap-2">
            <Button id="bulk-location-cancel" variant="outline" onClick={() => setIsBulkLocationOpen(false)}>
              {t('common.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id="bulk-location-apply"
              onClick={() => { void handleBulkLocationUpdate(); }}
              disabled={
                bulkActionLoading ||
                (bulkLocationMode === 'saved' && !bulkLocationId) ||
                (bulkLocationMode === 'custom' && bulkCustomLocation.trim().length === 0)
              }
            >
              {bulkActionLoading
                ? t('assetDashboardClient.bulk.actions.applying', { defaultValue: 'Applying...' })
                : t('assetDashboardClient.bulk.actions.apply', { defaultValue: 'Apply' })}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {t('assetDashboardClient.bulk.locationDialog.description', {
                defaultValue: 'Update {{count}} selected asset(s).',
                count: selectedAssetIds.length,
              })}
            </p>
            <CustomSelect
              id="bulk-location-mode"
              value={bulkLocationMode}
              onValueChange={(value) => setBulkLocationMode(value as 'saved' | 'custom' | 'clear')}
              options={[
                {
                  value: 'saved',
                  label: t('assetDashboardClient.bulk.locationDialog.savedLocation', {
                    defaultValue: 'Saved client location'
                  }),
                  disabled: !canBulkAssignSavedLocation,
                } as SelectOption,
                {
                  value: 'custom',
                  label: t('assetDashboardClient.bulk.locationDialog.customLocation', {
                    defaultValue: 'Custom location'
                  }),
                },
                {
                  value: 'clear',
                  label: t('assetDashboardClient.bulk.locationDialog.clearLocation', {
                    defaultValue: 'Clear location'
                  }),
                },
              ]}
            />
            {!canBulkAssignSavedLocation && (
              <p className="text-xs text-gray-500">
                {t('assetDashboardClient.bulk.locationDialog.savedDisabled', {
                  defaultValue: 'Saved client locations are available only when all selected assets are visible and belong to one client.'
                })}
              </p>
            )}
            {bulkLocationMode === 'saved' && (
              <CustomSelect
                id="bulk-location-select"
                value={bulkLocationId}
                onValueChange={setBulkLocationId}
                options={bulkLocationOptions}
                placeholder={bulkLocationsLoading
                  ? t('assetDashboardClient.bulk.locationDialog.loadingLocations', { defaultValue: 'Loading locations...' })
                  : t('assetDashboardClient.bulk.locationDialog.selectLocation', { defaultValue: 'Select location' })}
                disabled={!canBulkAssignSavedLocation || bulkLocationsLoading}
              />
            )}
            {bulkLocationMode === 'custom' && (
              <Input
                id="bulk-custom-location"
                value={bulkCustomLocation}
                onChange={(event) => setBulkCustomLocation(event.target.value)}
                placeholder={t('assetDashboardClient.bulk.locationDialog.customPlaceholder', {
                  defaultValue: 'Enter a custom location or area'
                })}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        id="bulk-delete-assets"
        isOpen={isBulkDeleteOpen}
        onClose={() => setIsBulkDeleteOpen(false)}
        title={t('assetDashboardClient.bulk.deleteDialog.title', { defaultValue: 'Delete selected assets' })}
        className="max-w-md"
        footer={(
          <div className="flex justify-end gap-2">
            <Button id="bulk-delete-cancel" variant="outline" onClick={() => setIsBulkDeleteOpen(false)}>
              {t('common.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button id="bulk-delete-confirm" variant="destructive" onClick={() => { void handleBulkDelete(); }} disabled={bulkActionLoading}>
              {bulkActionLoading
                ? t('assetDashboardClient.bulk.actions.deleting', { defaultValue: 'Deleting...' })
                : t('common.actions.delete', { defaultValue: 'Delete' })}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <p className="text-sm text-gray-600">
            {t('assetDashboardClient.bulk.deleteDialog.description', {
              defaultValue: 'Delete {{count}} selected asset(s). Assets with dependencies may be skipped.',
              count: selectedAssetIds.length,
            })}
          </p>
        </DialogContent>
      </Dialog>
      <BulkActionBar
        idPrefix="asset-bulk-action-bar"
        count={selectedAssetIds.length}
        selectedLabel={t('assetDashboardClient.bulk.actionBar.selectedCount', {
          defaultValue: '{{count}} selected',
          count: selectedAssetIds.length,
        })}
        actions={[
          {
            id: 'status',
            label: t('assetDashboardClient.bulk.actionBar.setStatus', { defaultValue: 'Set status' }),
            icon: <CircleDot className="h-4 w-4" />,
            onClick: () => setIsBulkStatusOpen(true),
          },
          {
            id: 'location',
            label: t('assetDashboardClient.bulk.actionBar.setLocation', { defaultValue: 'Set location' }),
            icon: <MapPin className="h-4 w-4" />,
            onClick: () => {
              setBulkLocationMode(canBulkAssignSavedLocation ? 'saved' : 'custom');
              setIsBulkLocationOpen(true);
            },
          },
          {
            id: 'delete',
            label: t('assetDashboardClient.bulk.actionBar.delete', { defaultValue: 'Delete' }),
            icon: <Trash2 className="h-4 w-4" />,
            onClick: () => setIsBulkDeleteOpen(true),
            destructive: true,
          },
        ]}
        onClear={() => setSelectedAssetIds([])}
        clearLabel={t('assetDashboardClient.bulk.actionBar.clear', { defaultValue: 'Clear' })}
      />
      <AssetCommandPalette
        isOpen={isCommandPaletteOpen}
        assets={assets}
        filteredAssets={assets}
        hasActiveFilters={hasActiveFilters}
        onClose={() => setIsCommandPaletteOpen(false)}
        onSelectAsset={handleCommandSelectAsset}
        onCreateAsset={triggerQuickAdd}
        onRefreshData={() => { void handleAssetAdded(); }}
        onClearFilters={clearFilters}
      />

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
      />

      {renderQuickAddTicket({
        open: Boolean(ticketDialogAsset),
        onOpenChange: (open) => {
          if (!open) setTicketDialogAsset(null);
        },
        onTicketAdded: () => setTicketDialogAsset(null),
        prefilledClient: ticketDialogAsset?.client_id
          ? {
              id: ticketDialogAsset.client_id,
              name:
                ticketDialogAsset.client?.client_name ||
                t('assetDetailHeader.values.unknownClient', { defaultValue: 'Unknown Client' }),
            }
          : undefined,
        assetId: ticketDialogAsset?.asset_id,
        assetName: ticketDialogAsset?.name,
      })}
    </div>
  );
}

type SummaryTileProps = {
  id: string;
  title: string;
  helper: string;
  value: number;
  icon: ReactNode;
  isLoading?: boolean;
};

function SummaryTile({ id, title, helper, value, icon, isLoading }: SummaryTileProps) {
  return (
    <Card className="p-4" {...withDataAutomationId({ id })}>
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-gray-100 p-2 text-gray-700">
          {icon}
        </div>
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          {isLoading ? (
            <div className="mt-1 h-6 w-20 animate-pulse rounded bg-gray-200" />
          ) : (
            <p className="text-2xl font-semibold text-gray-900">{value}</p>
          )}
          <p className="text-xs text-gray-500">{helper}</p>
        </div>
      </div>
    </Card>
  );
}
