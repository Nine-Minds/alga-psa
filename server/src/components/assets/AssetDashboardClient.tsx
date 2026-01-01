'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRegisterUIComponent } from '../../types/ui-reflection/useRegisterUIComponent';
import { withDataAutomationId } from '../../types/ui-reflection/withDataAutomationId';
import { Card } from 'server/src/components/ui/Card';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Badge } from 'server/src/components/ui/Badge';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator
} from 'server/src/components/ui/DropdownMenu';
import { Asset, AssetListResponse, ClientMaintenanceSummary } from 'server/src/interfaces/asset.interfaces';
import { getClientMaintenanceSummaries, listAssets } from 'server/src/lib/actions/asset-actions/assetActions';
import { loadAssetDetailDrawerData } from 'server/src/lib/actions/asset-actions/assetDrawerActions';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { QuickAddAsset } from './QuickAddAsset';
import { AssetCommandPalette } from './AssetCommandPalette';
import { AssetDetailDrawerClient } from './AssetDetailDrawerClient';
import { RmmStatusIndicator } from './RmmStatusIndicator';
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
  RefreshCw
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
const AGENT_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'unknown', label: 'Unknown' },
];
const RMM_MANAGED_OPTIONS: { value: string; label: string }[] = [
  { value: 'managed', label: 'RMM Managed' },
  { value: 'unmanaged', label: 'Not Managed' },
];

export default function AssetDashboardClient({ initialAssets }: AssetDashboardClientProps) {
  useRegisterUIComponent({
    id: 'asset-dashboard',
    type: 'container',
    label: 'Asset Dashboard'
  });

  const [assets, setAssets] = useState<Asset[]>(initialAssets.assets);
  const [maintenanceSummaries, setMaintenanceSummaries] = useState<Record<string, ClientMaintenanceSummary>>({});
  const [loading, setLoading] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [typeFilters, setTypeFilters] = useState<string[]>([]);
  const [clientFilters, setClientFilters] = useState<string[]>([]);
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
  const [drawerAssetId, setDrawerAssetId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [activeDrawerTab, setActiveDrawerTab] = useState<AssetDrawerTab>(ASSET_DRAWER_TABS.OVERVIEW);
  const [drawerData, setDrawerData] = useState<AssetDrawerServerData>({ asset: null });
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const lastRequestIdRef = useRef<number>(0);

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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const assetsByClient = useMemo(() => {
    return assets.reduce((acc, asset) => {
      if (!asset.client_id) return acc;
      if (!acc[asset.client_id]) acc[asset.client_id] = [];
      acc[asset.client_id].push(asset);
      return acc;
    }, {} as Record<string, Asset[]>);
  }, [assets]);

  const totalAssets = assets.length;

  useEffect(() => {
    async function loadMaintenanceSummaries() {
      setLoading(true);
      try {
        const clientIds = Object.keys(assetsByClient);
        if (clientIds.length === 0) {
          setMaintenanceSummaries({});
        } else {
          const summaries = await getClientMaintenanceSummaries(clientIds);
          setMaintenanceSummaries(summaries);
        }
      } catch (error) {
        console.error('Error loading maintenance summaries:', error);
      }
      setLoading(false);
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

  const clientOptions = useMemo(() => {
    const unique = new Map<string, string>();
    assets.forEach(asset => {
      if (asset.client_id && asset.client?.client_name) {
        unique.set(asset.client_id, asset.client.client_name);
      }
    });
    return Array.from(unique.entries()).map(([value, label]) => ({ value, label }));
  }, [assets]);

  const filteredAssets = useMemo(() => {
    return assets.filter(asset => {
      const matchesSearch = !searchTerm
        || asset.name.toLowerCase().includes(searchTerm.toLowerCase())
        || asset.asset_tag?.toLowerCase().includes(searchTerm.toLowerCase())
        || asset.client?.client_name?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus = statusFilters.length === 0 || statusFilters.includes(asset.status);
      const matchesType = typeFilters.length === 0 || typeFilters.includes(asset.asset_type);
      const matchesClient = clientFilters.length === 0 || (asset.client_id && clientFilters.includes(asset.client_id));

      // RMM Agent Status filter
      const matchesAgentStatus = agentStatusFilters.length === 0 || (
        asset.rmm_provider && asset.agent_status && agentStatusFilters.includes(asset.agent_status)
      );

      // RMM Managed filter
      const matchesRmmManaged = rmmManagedFilter.length === 0 || (
        rmmManagedFilter.includes('managed') && asset.rmm_provider && asset.rmm_device_id
      ) || (
        rmmManagedFilter.includes('unmanaged') && (!asset.rmm_provider || !asset.rmm_device_id)
      );

      return matchesSearch && matchesStatus && matchesType && matchesClient && matchesAgentStatus && matchesRmmManaged;
    });
  }, [assets, searchTerm, statusFilters, typeFilters, clientFilters, agentStatusFilters, rmmManagedFilter]);

  const filteredCount = filteredAssets.length;
  const hasActiveFilters = Boolean(
    searchTerm ||
    statusFilters.length > 0 ||
    typeFilters.length > 0 ||
    clientFilters.length > 0 ||
    agentStatusFilters.length > 0 ||
    rmmManagedFilter.length > 0
  );

  const isAllSelected = filteredCount > 0 && filteredAssets.every(asset => selectedAssetIds.includes(asset.asset_id));
  const isIndeterminate = selectedAssetIds.length > 0 && !isAllSelected;

  const toggleSelectAll = useCallback(() => {
    setSelectedAssetIds(prev => {
      if (isAllSelected) {
        return [];
      }
      const ids = new Set(prev);
      filteredAssets.forEach(asset => ids.add(asset.asset_id));
      return Array.from(ids);
    });
  }, [filteredAssets, isAllSelected]);

  const handleAssetAdded = async () => {
    try {
      const response = await listAssets({});
      setAssets(response.assets);
    } catch (error) {
      console.error('Error reloading assets:', error);
    }
    // No-op: local state already refreshed
  };

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
      default:
        return <Boxes {...iconProps} />;
    }
  }, []);

  const renderAssetDetails = useCallback((asset: Asset): string => {
    if (asset.workstation) {
      return `${asset.workstation.os_type} - ${asset.workstation.cpu_model} - ${asset.workstation.ram_gb}GB RAM`;
    }
    if (asset.network_device) {
      return `${asset.network_device.device_type} - ${asset.network_device.management_ip || 'No IP'}`;
    }
    if (asset.server) {
      return `${asset.server.os_type} - ${asset.server.cpu_model} - ${asset.server.ram_gb}GB RAM`;
    }
    if (asset.mobile_device) {
      return `${asset.mobile_device.os_type} - ${asset.mobile_device.model}`;
    }
    if (asset.printer) {
      return `${asset.printer.model} - ${asset.printer.is_network_printer ? 'Network' : 'Local'}`;
    }
    return 'No details available';
  }, []);

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

  const toggleAssetSelection = useCallback((assetId: string) => {
    setSelectedAssetIds(prev =>
      prev.includes(assetId) ? prev.filter(id => id !== assetId) : [...prev, assetId]
    );
  }, []);

  const columnLibrary: Record<ColumnKey, ColumnDefinition<Asset>> = useMemo(() => ({
    select: {
      dataIndex: 'select',
      title: (
        <Checkbox
          id="asset-select-all"
          checked={isAllSelected}
          onChange={toggleSelectAll}
          aria-label="Select all visible assets"
          className="translate-y-0.5"
          indeterminate={isIndeterminate}
          containerClassName="m-0 flex items-center justify-center"
        />
      ),
      render: (_: unknown, record: Asset) => (
        <Checkbox
          id={`asset-select-${record.asset_id}`}
          checked={selectedAssetIds.includes(record.asset_id)}
          onChange={() => toggleAssetSelection(record.asset_id)}
          aria-label={`Select asset ${record.name}`}
          className="translate-y-0.5"
          onClick={(event) => event.stopPropagation()}
          containerClassName="m-0 flex items-center justify-center"
        />
      ),
      width: '40px',
      cellClassName: '!px-3'
    },
    name: {
      dataIndex: 'name',
      title: 'Name',
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

              if (event.shiftKey || event.altKey) {
                event.preventDefault();
                openAssetRecordPage(record.asset_id);
                return;
              }

              openDrawerForAsset(record);
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
      title: 'Tag',
      render: (value: unknown) => (
        <span className="font-mono text-sm text-gray-600">{value as string}</span>
      )
    },
    asset_type: {
      dataIndex: 'asset_type',
      title: 'Type',
      render: (value: string) => (
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-gray-50 rounded-lg border border-gray-100">
            {getAssetTypeIcon(value)}
          </div>
          <span className="text-sm font-medium text-gray-700">
            {value.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
          </span>
        </div>
      )
    },
    details: {
      dataIndex: 'details',
      title: 'Details',
      render: (_: unknown, record: Asset) => (
        <span className="text-sm text-gray-600">{renderAssetDetails(record)}</span>
      )
    },
    status: {
      dataIndex: 'status',
      title: 'Status',
      render: (value: unknown) => {
        const status = value as string;
        return (
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
              status === 'active'
                ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-600/20'
                : status === 'inactive'
                ? 'bg-gray-100 text-gray-700 ring-1 ring-gray-600/20'
                : 'bg-amber-100 text-amber-700 ring-1 ring-amber-600/20'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                status === 'active' ? 'bg-emerald-500' : status === 'inactive' ? 'bg-gray-500' : 'bg-amber-500'
              }`}
            ></span>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </span>
        );
      }
    },
    agent_status: {
      dataIndex: 'agent_status',
      title: 'Agent',
      render: (_: unknown, record: Asset) => {
        // Only show for RMM-managed assets
        if (!record.rmm_provider || !record.rmm_device_id) {
          return <span className="text-xs text-gray-400">—</span>;
        }
        return <RmmStatusIndicator asset={record} size="sm" />;
      }
    },
    client_name: {
      dataIndex: 'client_name',
      title: 'Client',
      render: (_: unknown, record: Asset) => (
        <span className="text-sm font-medium text-gray-700">
          {record.client?.client_name || 'Unassigned'}
        </span>
      )
    },
    location: {
      dataIndex: 'location',
      title: 'Location',
      render: (value: unknown) => (
        <span className="text-sm font-medium text-gray-700">{(value as string) || '—'}</span>
      )
    },
    actions: {
      dataIndex: 'actions',
      title: 'Actions',
      render: (_: unknown, record: Asset) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`asset-${record.asset_id}-actions-menu`}
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={`Open actions for asset ${record.name}`}
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
              View details
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`edit-asset-${record.asset_id}`}
              onSelect={() => {
                if (typeof window !== 'undefined') {
                  window.location.assign(`/msp/assets/${record.asset_id}/edit`);
                }
              }}
            >
              Edit asset
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              id={`create-ticket-${record.asset_id}`}
              onSelect={() => {
                if (typeof window !== 'undefined') {
                  window.location.assign(`/msp/tickets/new?assetId=${record.asset_id}`);
                }
              }}
            >
              Create ticket
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
  }), [
    isAllSelected,
    isIndeterminate,
    selectedAssetIds,
    toggleSelectAll,
    toggleAssetSelection,
    getAssetTypeIcon,
    renderAssetDetails,
    openDrawerForAsset,
    openAssetRecordPage
  ]);

  const columns: ColumnDefinition<Asset>[] = useMemo(() => {
    return visibleColumnIds.map((key) => columnLibrary[key]);
  }, [visibleColumnIds, columnLibrary]);

  return (
    <div className="relative p-6">
      <div className="space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Asset Workspace</h1>
              <p className="text-sm text-gray-500">Operate at scale with filters, saved views, and bulk actions.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                id="refresh-assets-button"
              variant="ghost"
              size="sm"
              className="gap-2"
              onClick={() => { void handleAssetAdded(); }}
            >
                <RefreshCw className="h-4 w-4" /> Refresh data
              </Button>
              <QuickAddAsset onAssetAdded={() => { void handleAssetAdded(); }} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total assets</p>
              <p className="text-3xl font-semibold text-gray-900 mt-2">{totalAssets}</p>
              <p className="text-xs text-gray-500 mt-1">Across all clients</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Filtered view</p>
              <p className="text-3xl font-semibold text-gray-900 mt-2">{filteredCount}</p>
              <p className="text-xs text-gray-500 mt-1">Matching active filters</p>
            </Card>
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Automation ready</p>
                <p className="text-3xl font-semibold text-gray-900 mt-2">{maintenanceStats.totalSchedules}</p>
                <p className="text-xs text-gray-500 mt-1">Active maintenance schedules</p>
              </div>
              <div className="flex flex-col gap-1 text-right text-xs text-gray-500">
                <span className="font-medium text-emerald-600">Upcoming: {maintenanceStats.upcomingMaintenances}</span>
                <span className="font-medium text-amber-600">Overdue: {maintenanceStats.overdueMaintenances}</span>
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
                    placeholder="Search by name, tag, or client"
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
                  Clear filters
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button id="status-filter-button" variant="ghost" size="sm" className="gap-1">
                      <Filter className="h-4 w-4" /> Status
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
                          containerClassName="m-0"
                        />
                        <span className="capitalize">{status.replace('_', ' ')}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button id="type-filter-button" variant="ghost" size="sm" className="gap-1">
                      <Filter className="h-4 w-4" /> Type
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-52">
                    {TYPE_OPTIONS.map((type) => (
                      <DropdownMenuItem key={type} id={`filter-type-${type}`} onSelect={(event) => event.preventDefault()}>
                        <Checkbox
                          id={`type-checkbox-${type}`}
                          checked={typeFilters.includes(type)}
                          onChange={() => toggleFilterValue(typeFilters, type, setTypeFilters)}
                          className="mr-2"
                          containerClassName="m-0"
                        />
                        <span className="capitalize">{type.replace('_', ' ')}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button id="client-filter-button" variant="ghost" size="sm" className="gap-1">
                      <Filter className="h-4 w-4" /> Client
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-60 max-h-72 overflow-y-auto">
                    {clientOptions.map(({ value, label }) => (
                      <DropdownMenuItem key={value} id={`filter-client-${value}`} onSelect={(event) => event.preventDefault()}>
                        <Checkbox
                          id={`client-checkbox-${value}`}
                          checked={clientFilters.includes(value)}
                          onChange={() => toggleFilterValue(clientFilters, value, setClientFilters)}
                          className="mr-2"
                          containerClassName="m-0"
                        />
                        <span>{label}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button id="agent-status-filter-button" variant="ghost" size="sm" className="gap-1">
                      <Monitor className="h-4 w-4" /> Agent
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    {AGENT_STATUS_OPTIONS.map(({ value, label }) => (
                      <DropdownMenuItem key={value} id={`filter-agent-${value}`} onSelect={(event) => event.preventDefault()}>
                        <Checkbox
                          id={`agent-checkbox-${value}`}
                          checked={agentStatusFilters.includes(value)}
                          onChange={() => toggleFilterValue(agentStatusFilters, value, setAgentStatusFilters)}
                          className="mr-2"
                          containerClassName="m-0"
                        />
                        <span>{label}</span>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    {RMM_MANAGED_OPTIONS.map(({ value, label }) => (
                      <DropdownMenuItem key={value} id={`filter-rmm-${value}`} onSelect={(event) => event.preventDefault()}>
                        <Checkbox
                          id={`rmm-checkbox-${value}`}
                          checked={rmmManagedFilter.includes(value)}
                          onChange={() => toggleFilterValue(rmmManagedFilter, value, setRmmManagedFilter)}
                          className="mr-2"
                          containerClassName="m-0"
                        />
                        <span>{label}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button id="column-chooser-button" variant="ghost" size="sm" className="gap-1">
                      Columns
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
                          containerClassName="m-0"
                        />
                        <span className="capitalize">{key.replace('_', ' ')}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {(statusFilters.length > 0 || typeFilters.length > 0 || clientFilters.length > 0 || agentStatusFilters.length > 0 || rmmManagedFilter.length > 0) && (
              <div className="flex flex-wrap gap-2" {...withDataAutomationId({ id: 'active-filters-bar' })}>
                {statusFilters.map((status) => (
                  <Badge key={`status-pill-${status}`} variant="outline" className="flex items-center gap-2">
                    Status: {status}
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
                    Type: {type.replace('_', ' ')}
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
                  const label = clientOptions.find(option => option.value === clientId)?.label || 'Client';
                  return (
                    <Badge key={`client-pill-${clientId}`} variant="outline" className="flex items-center gap-2">
                      Client: {label}
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
                  const label = AGENT_STATUS_OPTIONS.find(opt => opt.value === status)?.label || status;
                  return (
                    <Badge key={`agent-pill-${status}`} variant="outline" className="flex items-center gap-2">
                      Agent: {label}
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
                  const label = RMM_MANAGED_OPTIONS.find(opt => opt.value === filter)?.label || filter;
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
            {selectedAssetIds.length > 0 && (
              <div
                className="flex flex-col gap-2 rounded-lg border border-primary-200 bg-primary-50 p-3 text-sm text-primary-900 md:flex-row md:items-center md:justify-between"
                {...withDataAutomationId({ id: 'bulk-selection-banner' })}
              >
                <span className="font-medium">{selectedAssetIds.length} asset{selectedAssetIds.length === 1 ? '' : 's'} selected</span>
                <div className="flex items-center gap-2">
                  <Button
                    id="bulk-selection-clear-button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedAssetIds([])}
                  >
                    Clear selection
                  </Button>
                  <Button
                    id="bulk-selection-placeholder-button"
                    variant="secondary"
                    size="sm"
                    className="gap-2"
                    disabled
                  >
                    Bulk actions coming soon
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card className="p-6 space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4" {...withDataAutomationId({ id: 'asset-metrics-strip' })}>
              <SummaryTile
                id="metric-total-assets"
                title="Total Assets"
                helper="Across all tenants"
                icon={<Boxes className="h-4 w-4 text-blue-500" />}
                value={totalAssets}
                isLoading={loading}
              />
              <SummaryTile
                id="metric-active-schedules"
                title="Active Schedules"
                helper="Lifecycle automation"
                icon={<TrendingUp className="h-4 w-4 text-emerald-500" />}
                value={maintenanceStats.totalSchedules}
                isLoading={loading}
              />
              <SummaryTile
                id="metric-overdue-maintenance"
                title="Maintenance Overdue"
                helper="Needs attention"
                icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
                value={maintenanceStats.overdueMaintenances}
                isLoading={loading}
              />
              <SummaryTile
                id="metric-upcoming-maintenance"
                title="Upcoming Maintenance"
                helper="Next 30 days"
                icon={<Clock className="h-4 w-4 text-violet-500" />}
                value={maintenanceStats.upcomingMaintenances}
                isLoading={loading}
              />
            </div>

            <DataTable
              id="asset-table"
              data={filteredAssets}
              columns={columns}
              pagination
              onRowClick={(asset) => openDrawerForAsset(asset)}
            />
          </Card>
      </div>
      <AssetCommandPalette
        isOpen={isCommandPaletteOpen}
        assets={assets}
        filteredAssets={filteredAssets}
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
    </div>
  );
}

type SummaryTileProps = {
  id: string;
  title: string;
  helper: string;
  value: number;
  icon: React.ReactNode;
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
