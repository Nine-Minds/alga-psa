'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ClientMaintenanceSummary, Asset, AssetGroup, AssetGroupKind, AssetTypeRegistryEntry } from '@alga-psa/types';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { BentoStat, BentoTile, BENTO_TONE_TEXT, type BentoTone } from '@alga-psa/ui/components/bento';
import { getClientMaintenanceSummary, listAssets } from '@alga-psa/assets/actions/assetActions';
import { unwrapAssetActionResult } from '@alga-psa/assets/actions/assetActionErrors';
import { loadAssetDetailDrawerData } from '@alga-psa/assets/actions/assetDrawerActions';
import { getAssetTypes } from '@alga-psa/assets/actions/assetTypeRegistryActions';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { AlertTriangle } from 'lucide-react';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import Spinner from '@alga-psa/ui/components/Spinner';
import { Button } from '@alga-psa/ui/components/Button';
import { QuickAddAsset } from '@alga-psa/assets/components/QuickAddAsset';
import { AssetGroupDrawer } from '@alga-psa/assets/components/groups/AssetGroupDrawer';
import { createAssetGroup, listAssetGroups } from '@alga-psa/assets/actions/assetGroupActions';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import {
  AssetAgentCell,
  AssetCoverageCell,
  AssetIdentityMeta,
  AssetPatchingCell,
} from '@alga-psa/assets/components/assetListCells';
import { AssetDetailDrawerClient } from '@alga-psa/assets/components/AssetDetailDrawerClient';
import { useAssetStatusRegistry } from '@alga-psa/assets/components/shared/useAssetStatusOptions';
import {
  ASSET_DRAWER_TABS,
  type AssetDrawerTab,
  tabToPanelParam,
  type AssetDrawerServerData,
} from '@alga-psa/assets/components/AssetDetailDrawer.types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ClientAssetsProps {
  clientId: string;
}

const ClientAssets: React.FC<ClientAssetsProps> = ({ clientId }) => {
  const { t } = useTranslation('msp/clients');
  const searchParams = useSearchParams();
  const assetTypeOptions: SelectOption[] = [
    { value: 'all', label: t('clientTabs.assets.types.all', { defaultValue: 'All Asset Types' }) },
    { value: 'workstation', label: t('clientTabs.assets.types.workstation', { defaultValue: 'Workstation' }) },
    { value: 'network_device', label: t('clientTabs.assets.types.networkDevice', { defaultValue: 'Network Device' }) },
    { value: 'server', label: t('clientTabs.assets.types.server', { defaultValue: 'Server' }) },
    { value: 'mobile_device', label: t('clientTabs.assets.types.mobileDevice', { defaultValue: 'Mobile Device' }) },
    { value: 'printer', label: t('clientTabs.assets.types.printer', { defaultValue: 'Printer' }) }
  ];
  const [summary, setSummary] = useState<ClientMaintenanceSummary | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedType, setSelectedType] = useState<string>('all');
  const [assetTypeEntries, setAssetTypeEntries] = useState<AssetTypeRegistryEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // F074: Assets | Groups — two views over the same client inventory. The
  // details page's "Add to group" link lands here with ?view=groups, so the
  // view it asked for is the one that opens.
  const [view, setView] = useState<'assets' | 'groups'>(
    searchParams?.get('view') === 'groups' ? 'groups' : 'assets',
  );
  const [groups, setGroups] = useState<AssetGroup[]>([]);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [isNewGroupOpen, setIsNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupKind, setNewGroupKind] = useState<AssetGroupKind>('bundle');
  const [loadError, setLoadError] = useState(false);
  // F021: the Coverage cell reads a custom status as its label, not its slug.
  const { statuses: assetStatuses } = useAssetStatusRegistry();
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  // Drawer state
  const [drawerAssetId, setDrawerAssetId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [activeDrawerTab, setActiveDrawerTab] = useState<AssetDrawerTab>(ASSET_DRAWER_TABS.OVERVIEW);
  const [drawerData, setDrawerData] = useState<AssetDrawerServerData>({ asset: null });
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const lastRequestIdRef = useRef<number>(0);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  // F311: tenant registry powers custom-type labels/icons and filter options.
  useEffect(() => {
    let mounted = true;
    getAssetTypes()
      .then((entries) => {
        if (!mounted) return;
        if (isActionPermissionError(entries)) {
          setAssetTypeEntries([]);
          return;
        }
        setAssetTypeEntries(entries);
      })
      .catch((error) => {
        console.error('Error loading asset types:', error);
        if (mounted) setAssetTypeEntries([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const typeFilterOptions: SelectOption[] = [
    ...assetTypeOptions,
    ...(assetTypeEntries ?? [])
      .filter((entry) => !entry.is_builtin)
      .map((entry) => ({ value: entry.slug, label: entry.name })),
  ];

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
      setDrawerError(t('clientTabs.assets.drawerLoadError', { defaultValue: 'Unable to load asset details right now. Please try again.' }));
    } finally {
      if (lastRequestIdRef.current === requestId) {
        setDrawerLoading(false);
      }
    }
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

  const loadData = useCallback(async () => {
    try {
      setLoadError(false);
      const [summaryData, assetsData] = await Promise.all([
        getClientMaintenanceSummary(clientId).then(unwrapAssetActionResult),
        listAssets({
          client_id: clientId,
          asset_type: selectedType === 'all' ? undefined : selectedType,
          page: currentPage,
          limit: pageSize,
          // Patch/OS state lives on the per-type extension row.
          include_extension_data: true
        }).then(unwrapAssetActionResult)
      ]);
      setSummary(summaryData);
      setAssets(assetsData.assets);
      setTotalItems(assetsData.total);
    } catch (error) {
      // A failed load must not render as zero assets / zeroed summary cards.
      console.error('Error loading asset data:', error);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, [clientId, selectedType, currentPage, pageSize]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleAssetAdded = () => {
    void loadData();
  };

  const loadGroups = useCallback(async () => {
    const result = await listAssetGroups(clientId);
    if (Array.isArray(result)) setGroups(result);
  }, [clientId]);

  /**
   * A group write moves its members: a bundle owner assigns every member, a
   * workspace unassigns them, the location propagates. The Assets table holds
   * its rows in state loaded once per filter, so without this it kept showing
   * the previous assignee until a full page reload. Stable identity — the
   * drawer refetches the group whenever this callback changes.
   */
  const refreshAfterGroupChange = useCallback(() => {
    void loadData();
    void loadGroups();
  }, [loadData, loadGroups]);

  useEffect(() => {
    if (view === 'groups') void loadGroups();
  }, [view, loadGroups]);

  const groupColumns = [
    {
      title: t('clientTabs.assets.groups.columns.name', { defaultValue: 'Name' }),
      dataIndex: 'name',
      render: (value: string, row: AssetGroup) => (
        <span
          id={`client-asset-group-row-${row.group_id}`}
          className="font-medium text-gray-900 dark:text-[rgb(var(--color-text-900))]"
        >
          {value}
        </span>
      )
    },
    {
      title: t('clientTabs.assets.groups.columns.kind', { defaultValue: 'Kind' }),
      dataIndex: 'kind',
      render: (value: string) => (
        <span className="text-sm text-gray-600 dark:text-[rgb(var(--color-text-600))]">
          {t(`clientTabs.assets.groups.kinds.${value}`, { defaultValue: value })}
        </span>
      )
    },
    {
      title: t('clientTabs.assets.groups.columns.location', { defaultValue: 'Location' }),
      dataIndex: 'location_name',
      render: (value: string | null) => (
        <span className="text-sm text-gray-600 dark:text-[rgb(var(--color-text-600))]">{value || '—'}</span>
      )
    },
    {
      title: t('clientTabs.assets.groups.columns.members', { defaultValue: 'Members' }),
      dataIndex: 'member_count',
      render: (value: number | undefined) => (
        <span className="text-sm text-gray-600 dark:text-[rgb(var(--color-text-600))]">{value ?? 0}</span>
      )
    },
    {
      title: t('clientTabs.assets.groups.columns.people', { defaultValue: 'People' }),
      dataIndex: 'people_count',
      render: (value: number | undefined) => (
        <span className="text-sm text-gray-600 dark:text-[rgb(var(--color-text-600))]">{value ?? 0}</span>
      )
    }
  ];

  const columns = [
        {
      title: t('clientTabs.assets.columns.name', { defaultValue: 'Name' }),
      dataIndex: 'name',
      render: (value: string, record: Asset) => (
        <div className="min-w-0">
          <span className="font-medium text-gray-900 dark:text-[rgb(var(--color-text-900))]">{value}</span>
          <AssetIdentityMeta asset={record} />
        </div>
      )
    },
    {
      title: t('clientTabs.assets.columns.agent', { defaultValue: 'Agent' }),
      dataIndex: 'agent_status',
      render: (_: unknown, record: Asset) => <AssetAgentCell asset={record} now={Date.now()} />
    },
    {
      title: t('clientTabs.assets.columns.patching', { defaultValue: 'Patching' }),
      dataIndex: 'patching',
      render: (_: unknown, record: Asset) => <AssetPatchingCell asset={record} now={Date.now()} />
    },
        // Column order is admission priority at narrow widths (computeColumnFit):
    // Status and Warranty End — what a tech or refresh pitch opens this view
    // for — outrank Serial/Location/Purchase Date. The old "Details" column
    // rendered "No details available" for most rows and is gone; specs live in
    // the asset drawer.
        {
      title: t('clientTabs.assets.columns.coverage', { defaultValue: 'Coverage' }),
      dataIndex: 'warranty_end_date',
      render: (_: unknown, record: Asset) => (
        <AssetCoverageCell asset={record} now={Date.now()} statuses={assetStatuses} />
      )
    },
        {
      // FR-C6: who has the device is as much a part of "the client's assets"
      // as where it is.
      title: t('clientTabs.assets.columns.assignedTo', { defaultValue: 'Assigned to' }),
      dataIndex: 'contact_name',
      render: (value: string | null) => (
        <span className="text-sm text-gray-600 dark:text-[rgb(var(--color-text-600))]">{value || '—'}</span>
      )
    },
        {
      title: t('clientTabs.assets.columns.location', { defaultValue: 'Location' }),
      dataIndex: 'location',
      render: (value: string | null) => (
        <span className="text-sm text-gray-600 dark:text-[rgb(var(--color-text-600))]">{value || '—'}</span>
      )
    }
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <Spinner size="lg" />
          <div className="space-y-1">
            <p className="text-lg font-medium text-gray-900 dark:text-[rgb(var(--color-text-900))]">{t('clientTabs.assets.loading', { defaultValue: 'Loading assets...' })}</p>
            <p className="text-sm text-gray-500 dark:text-[rgb(var(--color-text-500))]">{t('clientTabs.assets.loadingHint', { defaultValue: 'Please wait while we fetch your data' })}</p>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <AlertTriangle className="h-8 w-8 text-red-500 mx-auto" />
          <p className="text-sm text-gray-700 dark:text-[rgb(var(--color-text-700))]">
            {t('clientTabs.assets.loadError', { defaultValue: 'Unable to load assets right now.' })}
          </p>
          <Button
            id="client-assets-retry"
            variant="outline"
            onClick={() => { setIsLoading(true); void loadData(); }}
          >
            {t('clientTabs.assets.retry', { defaultValue: 'Retry' })}
          </Button>
        </div>
      </div>
    );
  }

  const complianceTone: BentoTone =
    (summary?.compliance_rate ?? 0) >= 90 ? 'good'
      : (summary?.compliance_rate ?? 0) >= 70 ? 'warn'
        : 'bad';

  return (
    <div className="space-y-4">
      {/* One BentoTile with the shared stat treatment, matching the asset detail
          hero and the client command centre. The previous cards were bespoke —
          per-card gradients, decorative blur circles, ring shadows and hover
          scaling — and matched nothing else in the app. */}
      <BentoTile id="client-assets-summary">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <BentoStat
            value={summary?.total_assets ?? 0}
            label={t('clientTabs.assets.summary.totalAssets', { defaultValue: 'Total assets' })}
          />
          <BentoStat
            value={
              <span className={BENTO_TONE_TEXT[complianceTone]}>
                {Math.round(summary?.compliance_rate ?? 0)}%
              </span>
            }
            label={t('clientTabs.assets.summary.maintenanceRate', { defaultValue: 'Maintenance rate' })}
          />
          <BentoStat
            value={
              <span className={BENTO_TONE_TEXT[(summary?.overdue_maintenances ?? 0) > 0 ? 'bad' : 'good']}>
                {summary?.overdue_maintenances ?? 0}
              </span>
            }
            label={t('clientTabs.assets.summary.overdueMaintenance', { defaultValue: 'Overdue maintenance' })}
          />
          <BentoStat
            value={summary?.upcoming_maintenances ?? 0}
            label={t('clientTabs.assets.summary.upcomingMaintenance', { defaultValue: 'Upcoming maintenance' })}
          />
        </div>
      </BentoTile>

      {/* Actions and Filters - Improved layout */}
      <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex-1 max-w-xs">
            <label className="block text-sm font-medium text-gray-700 dark:text-[rgb(var(--color-text-700))] mb-2">
              {t('clientTabs.assets.filterByType', { defaultValue: 'Filter by Type' })}
            </label>
            <CustomSelect
              options={typeFilterOptions}
              value={selectedType}
              onValueChange={setSelectedType}
              placeholder={t('clientTabs.assets.typePlaceholder', { defaultValue: 'All asset types...' })}
            />
          </div>
          <div className="flex items-end">
            <QuickAddAsset
              clientId={clientId}
              onAssetAdded={handleAssetAdded}
            />
          </div>
        </div>
      </div>

      {/* Assets Table - Enhanced container */}
      <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-100 dark:border-[rgb(var(--color-border-200))]">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-[rgb(var(--color-text-900))]">{t('clientTabs.assets.inventory.title', { defaultValue: 'Assets' })}</h2>
          {/* F074: Assets | Groups. Groups are a different unit of the same
              inventory, not a filter over it, so they get their own view. */}
          <div id="client-assets-view-toggle" className="flex items-center gap-1">
            <Button
              id="client-assets-view-assets"
              variant={view === 'assets' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setView('assets')}
            >
              {t('clientTabs.assets.views.assets', { defaultValue: 'Assets' })}
            </Button>
            <Button
              id="client-assets-view-groups"
              variant={view === 'groups' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setView('groups')}
            >
              {t('clientTabs.assets.views.groups', { defaultValue: 'Groups' })}
            </Button>
            {view === 'groups' ? (
              <Button id="client-assets-new-group" size="sm" onClick={() => setIsNewGroupOpen(true)}>
                {t('clientTabs.assets.groups.newGroup', { defaultValue: 'New group' })}
              </Button>
            ) : null}
          </div>
        </div>
        {view === 'assets' ? (
          <DataTable
            id="client-assets-table"
            data={assets}
            columns={columns}
            pagination={true}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            onRowClick={(asset: Asset) => openDrawerForAsset(asset)}
            totalItems={totalItems}
            pageSize={pageSize}
            onItemsPerPageChange={handlePageSizeChange}
          />
        ) : (
          <DataTable
            id="client-asset-groups-table"
            data={groups}
            columns={groupColumns}
            pagination={false}
            onRowClick={(group: AssetGroup) => setOpenGroupId(group.group_id)}
          />
        )}
      </div>

      <Dialog
        id="client-assets-group-drawer"
        isOpen={Boolean(openGroupId)}
        onClose={() => { setOpenGroupId(null); refreshAfterGroupChange(); }}
        title={t('clientTabs.assets.groups.drawerTitle', { defaultValue: 'Asset group' })}
        className="max-w-2xl"
      >
        <DialogContent>
          {openGroupId ? (
            <AssetGroupDrawer
              groupId={openGroupId}
              onChanged={refreshAfterGroupChange}
              onDeleted={() => { setOpenGroupId(null); refreshAfterGroupChange(); }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        id="client-assets-new-group-dialog"
        isOpen={isNewGroupOpen}
        onClose={() => setIsNewGroupOpen(false)}
        title={t('clientTabs.assets.groups.newGroup', { defaultValue: 'New group' })}
        className="max-w-md"
        footer={(
          <div className="flex justify-end gap-2">
            <Button id="client-assets-new-group-cancel" variant="secondary" onClick={() => setIsNewGroupOpen(false)}>
              {t('common.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id="client-assets-new-group-save"
              disabled={!newGroupName.trim()}
              onClick={async () => {
                const created = await createAssetGroup({ clientId, name: newGroupName, kind: newGroupKind });
                if (created && 'group_id' in created) {
                  setIsNewGroupOpen(false);
                  setNewGroupName('');
                  await loadGroups();
                  setOpenGroupId(created.group_id);
                }
              }}
            >
              {t('common.actions.create', { defaultValue: 'Create' })}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <div className="space-y-3">
            <label className="block text-sm font-medium" htmlFor="client-assets-new-group-name">
              {t('clientTabs.assets.groups.name', { defaultValue: 'Name' })}
              <Input
                id="client-assets-new-group-name"
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
              />
            </label>
            <div>
              <label className="block text-sm font-medium" htmlFor="client-assets-new-group-kind">
                {t('clientTabs.assets.groups.kind', { defaultValue: 'Kind' })}
              </label>
              <CustomSelect
                id="client-assets-new-group-kind"
                value={newGroupKind}
                onValueChange={(value) => setNewGroupKind(value as AssetGroupKind)}
                options={[
                  { value: 'bundle', label: t('clientTabs.assets.groups.kinds.bundle', { defaultValue: 'Bundle' }) },
                  { value: 'shared_workspace', label: t('clientTabs.assets.groups.kinds.shared_workspace', { defaultValue: 'Shared workspace' }) },
                ]}
                className="mt-1"
              />
            </div>
          </div>
        </DialogContent>
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
      />
    </div>
  );
};

export default ClientAssets;
