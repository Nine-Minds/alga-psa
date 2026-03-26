'use client';

import { useCallback, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import Drawer from '@alga-psa/ui/components/Drawer';
import { useClientDrawer } from '@alga-psa/ui';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@alga-psa/ui/components/Tabs';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import type {
  Asset,
  AssetHistory,
  AssetMaintenanceHistory,
  AssetMaintenanceReport,
  AssetTicketSummary,
  IDocument,
} from '@alga-psa/types';
import {
  isMobileDeviceAsset as isMobileDeviceAssetGuard,
  isNetworkDeviceAsset as isNetworkDeviceAssetGuard,
  isPrinterAsset as isPrinterAssetGuard,
  isServerAsset as isServerAssetGuard,
  isWorkstationAsset as isWorkstationAssetGuard,
} from '@alga-psa/types';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { useRegisterUIComponent } from '@alga-psa/ui/ui-reflection/useRegisterUIComponent';
import type { ContainerComponent } from '@alga-psa/ui/ui-reflection/types';
import { Clock3, Copy, FileText, Layers, Link as LinkIcon, ListChecks, Settings2, ShieldCheck } from 'lucide-react';
import AssetDocuments from './AssetDocuments';
import CreateTicketFromAssetButton from './CreateTicketFromAssetButton';
import DeleteAssetButton from './DeleteAssetButton';
import { RemoteAccessButton } from './RemoteAccessButton';
import { AssetAlertsSection } from './AssetAlertsSection';
import { AssetPatchStatusSection } from './AssetPatchStatusSection';
import { AssetSoftwareInventory } from './AssetSoftwareInventory';
import { ASSET_DRAWER_TABS, type AssetDrawerTab } from './AssetDetailDrawer.types';

interface AssetDetailDrawerClientProps {
  isOpen: boolean;
  selectedAssetId: string | null;
  activeTab: AssetDrawerTab;
  asset: Asset | null;
  maintenanceReport?: AssetMaintenanceReport | null;
  maintenanceHistory?: AssetMaintenanceHistory[] | null;
  history?: AssetHistory[] | null;
  tickets?: AssetTicketSummary[] | null;
  documents?: IDocument[] | null;
  error?: string | null;
  isLoading?: boolean;
  onClose: () => void;
  onTabChange: (tab: AssetDrawerTab) => void;
  defaultBoardId?: string;
}

type TranslationFn = (key: string, options?: Record<string, unknown>) => string;

function formatTitleCase(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, match => match.toUpperCase());
}

const TAB_ORDER: AssetDrawerTab[] = [
  ASSET_DRAWER_TABS.OVERVIEW,
  ASSET_DRAWER_TABS.MAINTENANCE,
  ASSET_DRAWER_TABS.TICKETS,
  ASSET_DRAWER_TABS.CONFIGURATION,
  ASSET_DRAWER_TABS.DOCUMENTS,
];

const STATUS_VARIANT: Record<string, 'success' | 'default-muted' | 'warning'> = {
  active: 'success',
  inactive: 'default-muted',
  maintenance: 'warning',
};

export function AssetDetailDrawerClient({
  isOpen,
  selectedAssetId,
  activeTab,
  asset,
  maintenanceReport,
  maintenanceHistory,
  history,
  tickets,
  documents,
  error,
  isLoading = false,
  onClose,
  onTabChange,
  defaultBoardId,
}: AssetDetailDrawerClientProps) {
  const { t } = useTranslation('msp/assets');
  const router = useRouter();
  const clientDrawer = useClientDrawer();
  const desiredTab = activeTab;

  const tabLabels = useMemo(() => ({
    [ASSET_DRAWER_TABS.OVERVIEW]: t('assetDetailDrawer.tabs.overview', { defaultValue: 'Overview' }),
    [ASSET_DRAWER_TABS.MAINTENANCE]: t('assetDetailDrawer.tabs.maintenance', { defaultValue: 'Maintenance' }),
    [ASSET_DRAWER_TABS.TICKETS]: t('assetDetailDrawer.tabs.tickets', { defaultValue: 'Tickets' }),
    [ASSET_DRAWER_TABS.CONFIGURATION]: t('assetDetailDrawer.tabs.configuration', { defaultValue: 'Configuration' }),
    [ASSET_DRAWER_TABS.DOCUMENTS]: t('assetDetailDrawer.tabs.documents', { defaultValue: 'Documents' }),
  } satisfies Record<AssetDrawerTab, string>), [t]);

  const translateStatus = useCallback(
    (status: string) => t(`assetDetailDrawer.statuses.${status}`, { defaultValue: formatTitleCase(status) }),
    [t]
  );

  const handleTabChange = useCallback(
    (value: string) => {
      const nextTab = value as AssetDrawerTab;
      if (TAB_ORDER.includes(nextTab)) {
        onTabChange(nextTab);
      }
    },
    [onTabChange]
  );

  const visibleAssetId = selectedAssetId;

  const registerDrawer = useRegisterUIComponent<ContainerComponent>({
    id: 'asset-detail-drawer',
    type: 'container',
    label: t('assetDetailDrawer.label', { defaultValue: 'Asset Detail Drawer' }),
  });

  useEffect(() => {
    if (!visibleAssetId) {
      registerDrawer?.({
        helperText: t('assetDetailDrawer.helper.awaitingSelection', {
          defaultValue: 'Awaiting asset selection'
        })
      });
    } else if (asset) {
      registerDrawer?.({
        helperText: t('assetDetailDrawer.helper.selectedAsset', {
          defaultValue: '{{name}} • {{tab}}',
          name: asset.name,
          tab: tabLabels[desiredTab]
        })
      });
    }
  }, [asset, desiredTab, registerDrawer, tabLabels, t, visibleAssetId]);

  const isHydratingAsset = Boolean(visibleAssetId && asset?.asset_id !== visibleAssetId);
  const shouldShowSkeleton = isLoading || isHydratingAsset;

  const statusBadge = useMemo(() => {
    if (!asset) {
      return null;
    }
    const statusVariant = STATUS_VARIANT[asset.status] || 'info';
    return (
      <Badge
        id="asset-drawer-status"
        variant={statusVariant}
        className="px-2 py-1 text-xs font-semibold"
      >
        {translateStatus(asset.status)}
      </Badge>
    );
  }, [asset, translateStatus]);

  const renderActiveTabContent = useCallback(() => {
    if (!visibleAssetId) {
      return renderEmptyState(t('assetDetailDrawer.empty.selectAsset', {
        defaultValue: 'Select an asset to view details'
      }));
    }

    if (shouldShowSkeleton) {
      return renderTabSkeleton(desiredTab);
    }

    if (!asset) {
      return renderTabSkeleton(desiredTab);
    }

    switch (activeTab) {
      case ASSET_DRAWER_TABS.OVERVIEW:
        return renderOverviewTab({
          asset,
          history: history ?? [],
          maintenanceReport: maintenanceReport ?? null,
          router,
          statusBadge,
          onClose,
          defaultBoardId,
          t,
          onClientClick: asset.client_id && clientDrawer
            ? () => clientDrawer.openClientDrawer(asset.client_id)
            : undefined,
        });
      case ASSET_DRAWER_TABS.MAINTENANCE:
        return renderMaintenanceTab({
          maintenanceReport: maintenanceReport ?? null,
          maintenanceHistory: maintenanceHistory ?? [],
          t,
        });
      case ASSET_DRAWER_TABS.TICKETS:
        return renderTicketsTab({ tickets: tickets ?? [], t });
      case ASSET_DRAWER_TABS.CONFIGURATION:
        return renderConfigurationTab({ asset, t });
      case ASSET_DRAWER_TABS.DOCUMENTS:
        return renderDocumentsTab({ asset, documents: documents ?? [] });
      default:
        return renderEmptyState(t('assetDetailDrawer.empty.nothingToDisplay', {
          defaultValue: 'Nothing to display'
        }));
    }
  }, [
    activeTab,
    asset,
    clientDrawer,
    defaultBoardId,
    desiredTab,
    documents,
    onClose,
    history,
    maintenanceHistory,
    maintenanceReport,
    router,
    shouldShowSkeleton,
    statusBadge,
    tickets,
    t,
    visibleAssetId,
  ]);

  return (
    <Drawer id="asset-detail-drawer" isOpen={isOpen} onClose={onClose}>
      <div className="w-[560px] max-w-full space-y-6">
        <header className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold text-gray-900">
              {t('assetDetailDrawer.header.title', { defaultValue: 'Asset details' })}
            </h1>
            <p className="text-sm text-gray-500">
              {t('assetDetailDrawer.header.subtitle', {
                defaultValue: 'Stay in context while reviewing lifecycle and configuration'
              })}
            </p>
          </div>
        </header>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <Tabs value={desiredTab} onValueChange={handleTabChange} className="space-y-4">
            <TabsList className="w-full gap-2 border-b border-gray-200 text-sm font-medium text-gray-500">
              {TAB_ORDER.map(tab => (
                <TabsTrigger key={tab} value={tab} className="text-sm">
                  {tabLabels[tab]}
                </TabsTrigger>
              ))}
            </TabsList>
            {TAB_ORDER.map(tab => (
              <TabsContent key={tab} value={tab} className="focus:outline-none">
                {tab === desiredTab ? renderActiveTabContent() : null}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </Drawer>
  );
}

type OverviewTabProps = {
  asset: Asset;
  maintenanceReport: AssetMaintenanceReport | null;
  history: AssetHistory[];
  router: ReturnType<typeof useRouter>;
  statusBadge: ReactNode;
  onClose: () => void;
  defaultBoardId?: string;
  t: TranslationFn;
  onClientClick?: () => void;
};

function renderOverviewTab({ asset, maintenanceReport, history, router, statusBadge, onClose, defaultBoardId, t, onClientClick }: OverviewTabProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold text-gray-900">{asset.name}</h2>
            {statusBadge}
          </div>
          <p className="text-sm text-gray-500">
            {t('assetDetailDrawer.overview.assetTag', {
              defaultValue: 'Asset tag {{tag}} • {{type}}',
              tag: asset.asset_tag,
              type: formatTitleCase(asset.asset_type)
            })}
          </p>
          {asset.client?.client_name && (
            onClientClick ? (
              <button type="button" onClick={onClientClick} className="text-sm text-primary-600 hover:text-primary-700 hover:underline text-left">
                {t('assetDetailDrawer.overview.client', {
                  defaultValue: 'Client: {{name}}',
                  name: asset.client.client_name
                })}
              </button>
            ) : (
              <p className="text-sm text-gray-500">
                {t('assetDetailDrawer.overview.client', {
                  defaultValue: 'Client: {{name}}',
                  name: asset.client.client_name
                })}
              </p>
            )
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button id="asset-drawer-open-record" variant="default" size="sm" className="gap-2" onClick={() => router.push(`/msp/assets/${asset.asset_id}`)}>
            <FileText className="h-4 w-4" />
            {t('assetDetailDrawer.actions.openAssetRecord', { defaultValue: 'Open asset record' })}
          </Button>
          {asset.rmm_provider && asset.rmm_device_id && (
            <RemoteAccessButton asset={asset} variant="default" size="sm" />
          )}
          <CreateTicketFromAssetButton asset={asset} defaultBoardId={defaultBoardId} variant="default" size="sm" />
          <DeleteAssetButton
            assetId={asset.asset_id}
            assetName={asset.name}
            variant="accent"
            size="sm"
            label={t('assetDetailDrawer.actions.delete', { defaultValue: 'Delete' })}
            onDeleted={onClose}
          />
        </div>
      </div>

      {maintenanceReport ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" {...withDataAutomationId({ id: 'asset-drawer-overview-metrics' })}>
          <MetricCard id="metric-maintenance-total" icon={<ListChecks className="h-4 w-4 text-blue-500" />} label={t('assetDetailDrawer.overview.activeSchedules', { defaultValue: 'Active Schedules' })} value={maintenanceReport.active_schedules} />
          <MetricCard
            id="metric-maintenance-upcoming"
            icon={<Clock3 className="h-4 w-4 text-amber-500" />}
            label={t('assetDetailDrawer.overview.upcomingMaintenance', { defaultValue: 'Upcoming Maintenance' })}
            value={maintenanceReport.upcoming_maintenances}
            helper={maintenanceReport.next_maintenance
              ? t('assetDetailDrawer.overview.nextOn', {
                defaultValue: 'Next on {{date}}',
                date: formatDate(maintenanceReport.next_maintenance)
              })
              : undefined}
          />
          <MetricCard
            id="metric-maintenance-completed"
            icon={<ShieldCheck className="h-4 w-4 text-emerald-500" />}
            label={t('assetDetailDrawer.overview.completedMaintenance', {
              defaultValue: 'Completed Maintenance'
            })}
            value={maintenanceReport.completed_maintenances}
            helper={t('assetDetailDrawer.overview.compliance', {
              defaultValue: 'Compliance {{percent}}%',
              percent: Math.round(maintenanceReport.compliance_rate)
            })}
          />
          <MetricCard
            id="metric-maintenance-last"
            icon={<Layers className="h-4 w-4 text-violet-500" />}
            label={t('assetDetailDrawer.overview.lastMaintenance', { defaultValue: 'Last Maintenance' })}
            value={maintenanceReport.last_maintenance
              ? formatRelative(maintenanceReport.last_maintenance, t)
              : t('assetDetailDrawer.overview.noHistory', { defaultValue: 'No history' })}
          />
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-500">
          <Clock3 className="h-4 w-4 text-gray-400" />
          {t('assetDetailDrawer.overview.maintenanceDataPending', {
            defaultValue: 'Maintenance data will appear once schedules are configured.'
          })}
        </div>
      )}

      <Card className="space-y-4 p-4" {...withDataAutomationId({ id: 'asset-drawer-overview-info' })}>
        <SectionTitle icon={<Settings2 className="h-4 w-4" />} title={t('assetDetailDrawer.overview.assetSummary', { defaultValue: 'Asset summary' })} />
        <InfoGrid asset={asset} onClientClick={onClientClick} statusLabel={t(`assetDetailDrawer.statuses.${asset.status}`, { defaultValue: formatTitleCase(asset.status) })} t={t} />
      </Card>

      {/* RMM Alerts Section - Shows active alerts for RMM-managed assets */}
      <AssetAlertsSection asset={asset} />

      {/* RMM Patch Status Section - Shows patch compliance for workstations/servers */}
      <AssetPatchStatusSection asset={asset} />

      {/* RMM Software Inventory - Shows installed software for workstations/servers */}
      <AssetSoftwareInventory asset={asset} />

      {history && history.length > 0 && (
        <Card className="space-y-4 p-4" {...withDataAutomationId({ id: 'asset-drawer-overview-history' })}>
          <SectionTitle icon={<Copy className="h-4 w-4" />} title={t('assetDetailDrawer.overview.recentLifecycleEvents', { defaultValue: 'Recent lifecycle events' })} />
          <ul className="space-y-3">
            {history.slice(0, 5).map(event => (
              <li key={event.history_id} className="flex items-start gap-3">
                <div className="h-2 w-2 translate-y-2 rounded-full bg-primary-500" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-gray-900 capitalize">{formatTitleCase(event.change_type)}</p>
                  <p className="text-xs text-gray-500">{formatRelative(event.changed_at, t)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

type MaintenanceTabProps = {
  maintenanceReport: AssetMaintenanceReport | null;
  maintenanceHistory: AssetMaintenanceHistory[];
  t: TranslationFn;
};

function renderMaintenanceTab({ maintenanceReport, maintenanceHistory, t }: MaintenanceTabProps) {
  if (!maintenanceReport) {
    return renderEmptyState(t('assetDetailDrawer.maintenance.noSchedules', {
      defaultValue: 'No maintenance schedules found for this asset yet.'
    }));
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard id="metric-schedules-total" icon={<ListChecks className="h-4 w-4 text-blue-500" />} label={t('assetDetailDrawer.maintenance.totalSchedules', { defaultValue: 'Total Schedules' })} value={maintenanceReport.total_schedules} />
        <MetricCard id="metric-schedules-active" icon={<ShieldCheck className="h-4 w-4 text-emerald-500" />} label={t('assetDetailDrawer.maintenance.active', { defaultValue: 'Active' })} value={maintenanceReport.active_schedules} />
        <MetricCard id="metric-schedules-compliance" icon={<Layers className="h-4 w-4 text-violet-500" />} label={t('assetDetailDrawer.maintenance.complianceRate', { defaultValue: 'Compliance Rate' })} value={`${Math.round(maintenanceReport.compliance_rate)}%`} />
      </div>

      {maintenanceHistory && maintenanceHistory.length > 0 ? (
        <Card className="space-y-4 p-4" {...withDataAutomationId({ id: 'asset-drawer-maintenance-history' })}>
          <SectionTitle icon={<Clock3 className="h-4 w-4" />} title={t('assetDetailDrawer.maintenance.history', { defaultValue: 'Maintenance history' })} />
          <ul className="space-y-4">
            {maintenanceHistory.map(entry => (
              <li key={entry.history_id} className="flex items-start gap-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-primary-500" />
                <div>
                  <p className="text-sm font-medium text-gray-900">{formatDate(entry.performed_at)}</p>
                  <p className="text-xs text-gray-500">
                    {t('assetDetailDrawer.maintenance.loggedBy', {
                      defaultValue: 'Logged by {{name}}',
                      name: entry.performed_by || t('assetDetailDrawer.maintenance.system', { defaultValue: 'system' })
                    })}
                  </p>
                  {entry.notes && <p className="mt-1 text-sm text-gray-600">{entry.notes}</p>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-500">
          <Clock3 className="h-4 w-4 text-gray-400" />
          {t('assetDetailDrawer.maintenance.noLogs', {
            defaultValue: 'Maintenance logs will appear here after the first service entry.'
          })}
        </div>
      )}
    </div>
  );
}

type TicketsTabProps = { tickets: AssetTicketSummary[]; t: TranslationFn };

function renderTicketsTab({ tickets, t }: TicketsTabProps) {
  if (!tickets || tickets.length === 0) {
    return renderEmptyState(t('assetDetailDrawer.tickets.empty', {
      defaultValue: 'No tickets linked to this asset yet. Use the quick action to create one.'
    }));
  }

  return (
    <div className="space-y-3">
      {tickets.map(ticket => (
        <Card key={`${ticket.ticket_id}-${ticket.linked_at}`} className="p-4" {...withDataAutomationId({ id: `asset-linked-ticket-${ticket.ticket_id}` })}>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1 flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">{ticket.title}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge id={`ticket-status-${ticket.ticket_id}`} variant="outline" className="text-xs">
                  {ticket.status_name}
                </Badge>
                {ticket.priority_name && (
                  <Badge id={`ticket-priority-${ticket.ticket_id}`} variant="secondary" className="text-xs">
                    {ticket.priority_name}
                  </Badge>
                )}
              </div>
              <span className="text-xs text-gray-500">
                {t('assetDetailDrawer.tickets.linked', {
                  defaultValue: 'Linked {{date}}',
                  date: formatRelative(ticket.linked_at, t)
                })}
              </span>
              <div className="text-xs text-gray-500">
                {ticket.client_name && (
                  <span>
                    {t('assetDetailDrawer.tickets.client', {
                      defaultValue: 'Client: {{name}}',
                      name: ticket.client_name
                    })}
                  </span>
                )}
                {ticket.assigned_to_name && (
                  <span className="ml-2">
                    {t('assetDetailDrawer.tickets.assignee', {
                      defaultValue: 'Assignee: {{name}}',
                      name: ticket.assigned_to_name
                    })}
                  </span>
                )}
              </div>
            </div>
            <Button id={`asset-ticket-open-${ticket.ticket_id}`} variant="ghost" size="sm" className="gap-2 self-start flex-shrink-0 whitespace-nowrap" onClick={() => window.open(`/msp/tickets/${ticket.ticket_id}`, '_blank', 'noopener,noreferrer')}>
              <LinkIcon className="h-4 w-4" />
              {t('assetDetailDrawer.tickets.openTicket', { defaultValue: 'Open ticket' })}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

type ConfigurationTabProps = { asset: Asset; t: TranslationFn };

function renderConfigurationTab({ asset, t }: ConfigurationTabProps) {
  return (
    <div className="space-y-6">
      <Card className="space-y-3 p-4" {...withDataAutomationId({ id: 'asset-drawer-configuration-basics' })}>
        <SectionTitle icon={<Settings2 className="h-4 w-4" />} title={t('assetDetailDrawer.configuration.coreAttributes', { defaultValue: 'Core attributes' })} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
          <ConfigurationRow label={t('assetDetailDrawer.configuration.serialNumber', { defaultValue: 'Serial number' })} value={asset.serial_number || t('assetDetailDrawer.configuration.notProvided', { defaultValue: 'Not provided' })} />
          <ConfigurationRow label={t('assetDetailDrawer.configuration.location', { defaultValue: 'Location' })} value={asset.location || t('assetDetailDrawer.configuration.notProvided', { defaultValue: 'Not provided' })} />
          <ConfigurationRow label={t('assetDetailDrawer.configuration.purchaseDate', { defaultValue: 'Purchase date' })} value={asset.purchase_date ? formatDate(asset.purchase_date) : t('assetDetailDrawer.configuration.notProvided', { defaultValue: 'Not provided' })} />
          <ConfigurationRow label={t('assetDetailDrawer.configuration.warrantyEnd', { defaultValue: 'Warranty end' })} value={asset.warranty_end_date ? formatDate(asset.warranty_end_date) : t('assetDetailDrawer.configuration.notProvided', { defaultValue: 'Not provided' })} />
        </div>
      </Card>

      {renderTypeSpecificConfiguration(asset, t)}
    </div>
  );
}

type DocumentsTabProps = { asset: Asset; documents: IDocument[] };

function renderDocumentsTab({ asset, documents }: DocumentsTabProps) {
  return (
    <AssetDocuments assetId={asset.asset_id} tenant={asset.tenant} initialDocuments={documents} />
  );
}

function renderEmptyState(message: string) {
  return (
    <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
      {message}
    </div>
  );
}

function renderTabSkeleton(tab: AssetDrawerTab) {
  const rows = Array.from({ length: tab === ASSET_DRAWER_TABS.DOCUMENTS ? 6 : 4 });
  return (
    <div className="space-y-4">
      {rows.map((_, index) => (
        <div key={`${tab}-skeleton-${index}`} className="h-16 rounded-lg bg-gray-100 animate-pulse" />
      ))}
    </div>
  );
}

type SectionTitleProps = {
  icon: ReactNode;
  title: string;
};

function SectionTitle({ icon, title }: SectionTitleProps) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
      <span className="rounded-md bg-gray-100 p-1 text-gray-600">{icon}</span>
      {title}
    </div>
  );
}

type MetricCardProps = {
  id: string;
  icon: ReactNode;
  label: string;
  value: string | number;
  helper?: string;
};

function MetricCard({ id, icon, label, value, helper }: MetricCardProps) {
  return (
    <Card className="p-4" {...withDataAutomationId({ id })}>
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-gray-100 p-2 text-gray-600">{icon}</div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
          <p className="text-lg font-semibold text-gray-900">{value}</p>
          {helper && <p className="text-xs text-gray-500">{helper}</p>}
        </div>
      </div>
    </Card>
  );
}

function InfoGrid({
  asset,
  onClientClick,
  statusLabel,
  t,
}: {
  asset: Asset;
  onClientClick?: () => void;
  statusLabel: string;
  t: TranslationFn;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
      {onClientClick ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {t('assetDetailDrawer.info.client', { defaultValue: 'Client' })}
          </span>
          <button type="button" onClick={onClientClick} className="text-sm text-primary-600 hover:text-primary-700 hover:underline text-left">
            {asset.client?.client_name || t('assetDetailDrawer.info.unassigned', { defaultValue: 'Unassigned' })}
          </button>
        </div>
      ) : (
        <InfoRow label={t('assetDetailDrawer.info.client', { defaultValue: 'Client' })} value={asset.client?.client_name || t('assetDetailDrawer.info.unassigned', { defaultValue: 'Unassigned' })} />
      )}
      <InfoRow label={t('assetDetailDrawer.info.assetTag', { defaultValue: 'Asset tag' })} value={asset.asset_tag} />
      <InfoRow label={t('assetDetailDrawer.info.status', { defaultValue: 'Status' })} value={statusLabel} />
      <InfoRow label={t('assetDetailDrawer.info.created', { defaultValue: 'Created' })} value={formatDate(asset.created_at)} />
      <InfoRow label={t('assetDetailDrawer.info.updated', { defaultValue: 'Updated' })} value={formatRelative(asset.updated_at, t)} />
      <InfoRow label={t('assetDetailDrawer.info.tenant', { defaultValue: 'Tenant' })} value={asset.tenant} />
    </div>
  );
}

type InfoRowProps = {
  label: string;
  value: string | number;
};

function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <span className="text-sm text-gray-900">{value}</span>
    </div>
  );
}

function ConfigurationRow({ label, value }: InfoRowProps) {
  return (
    <div className="flex flex-col">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <span className="text-sm text-gray-900">{value}</span>
    </div>
  );
}

function renderTypeSpecificConfiguration(asset: Asset, t: TranslationFn) {
  switch (asset.asset_type) {
    case 'workstation':
      if (asset.workstation && isWorkstationAssetGuard(asset.workstation)) {
        return (
          <Card className="space-y-3 p-4" {...withDataAutomationId({ id: 'asset-drawer-config-workstation' })}>
            <SectionTitle icon={<Settings2 className="h-4 w-4" />} title={t('assetDetailDrawer.typeDetails.workstation', { defaultValue: 'Workstation details' })} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.operatingSystem', { defaultValue: 'Operating system' })} value={`${asset.workstation.os_type} ${asset.workstation.os_version}`} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.cpu', { defaultValue: 'CPU' })} value={`${asset.workstation.cpu_model} (${asset.workstation.cpu_cores} cores)`} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.ram', { defaultValue: 'RAM' })} value={`${asset.workstation.ram_gb} GB`} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.storage', { defaultValue: 'Storage' })} value={`${asset.workstation.storage_type} • ${asset.workstation.storage_capacity_gb} GB`} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.gpu', { defaultValue: 'GPU' })} value={asset.workstation.gpu_model || t('assetDetailDrawer.typeDetails.notProvided', { defaultValue: 'Not provided' })} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.lastLogin', { defaultValue: 'Last login' })} value={asset.workstation.last_login ? formatRelative(asset.workstation.last_login, t) : t('assetDetailDrawer.typeDetails.never', { defaultValue: 'Never' })} />
            </div>
          </Card>
        );
      }
      break;
    case 'network_device':
      if (asset.network_device && isNetworkDeviceAssetGuard(asset.network_device)) {
        return (
          <Card className="space-y-3 p-4" {...withDataAutomationId({ id: 'asset-drawer-config-network' })}>
            <SectionTitle icon={<Settings2 className="h-4 w-4" />} title={t('assetDetailDrawer.typeDetails.networkDevice', { defaultValue: 'Network device details' })} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.deviceType', { defaultValue: 'Device type' })} value={asset.network_device.device_type} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.managementIp', { defaultValue: 'Management IP' })} value={asset.network_device.management_ip || t('assetDetailDrawer.typeDetails.notProvided', { defaultValue: 'Not provided' })} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.portCount', { defaultValue: 'Port count' })} value={asset.network_device.port_count} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.firmwareVersion', { defaultValue: 'Firmware version' })} value={asset.network_device.firmware_version} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.poeSupport', { defaultValue: 'PoE support' })} value={asset.network_device.supports_poe ? t('common.yes', { defaultValue: 'Yes' }) : t('common.no', { defaultValue: 'No' })} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.powerDraw', { defaultValue: 'Power draw' })} value={`${asset.network_device.power_draw_watts} W`} />
            </div>
          </Card>
        );
      }
      break;
    case 'server':
      if (asset.server && isServerAssetGuard(asset.server)) {
        return (
          <Card className="space-y-3 p-4" {...withDataAutomationId({ id: 'asset-drawer-config-server' })}>
            <SectionTitle icon={<Settings2 className="h-4 w-4" />} title={t('assetDetailDrawer.typeDetails.server', { defaultValue: 'Server details' })} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.operatingSystem', { defaultValue: 'Operating system' })} value={`${asset.server.os_type} ${asset.server.os_version}`} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.cpu', { defaultValue: 'CPU' })} value={`${asset.server.cpu_model} (${asset.server.cpu_cores} cores)`} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.ram', { defaultValue: 'RAM' })} value={`${asset.server.ram_gb} GB`} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.virtualized', { defaultValue: 'Virtualized' })} value={asset.server.is_virtual ? t('common.yes', { defaultValue: 'Yes' }) : t('common.no', { defaultValue: 'No' })} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.primaryIp', { defaultValue: 'Primary IP' })} value={asset.server.primary_ip || t('assetDetailDrawer.typeDetails.notProvided', { defaultValue: 'Not provided' })} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.hypervisor', { defaultValue: 'Hypervisor' })} value={asset.server.hypervisor || t('assetDetailDrawer.typeDetails.notProvided', { defaultValue: 'Not provided' })} />
            </div>
          </Card>
        );
      }
      break;
    case 'mobile_device':
      if (asset.mobile_device && isMobileDeviceAssetGuard(asset.mobile_device)) {
        return (
          <Card className="space-y-3 p-4" {...withDataAutomationId({ id: 'asset-drawer-config-mobile' })}>
            <SectionTitle icon={<Settings2 className="h-4 w-4" />} title={t('assetDetailDrawer.typeDetails.mobileDevice', { defaultValue: 'Mobile device details' })} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.os', { defaultValue: 'OS' })} value={`${asset.mobile_device.os_type} ${asset.mobile_device.os_version}`} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.model', { defaultValue: 'Model' })} value={asset.mobile_device.model} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.imei', { defaultValue: 'IMEI' })} value={asset.mobile_device.imei || t('assetDetailDrawer.typeDetails.notProvided', { defaultValue: 'Not provided' })} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.phoneNumber', { defaultValue: 'Phone number' })} value={asset.mobile_device.phone_number || t('assetDetailDrawer.typeDetails.notProvided', { defaultValue: 'Not provided' })} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.carrier', { defaultValue: 'Carrier' })} value={asset.mobile_device.carrier || t('assetDetailDrawer.typeDetails.notProvided', { defaultValue: 'Not provided' })} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.lastCheckIn', { defaultValue: 'Last check-in' })} value={asset.mobile_device.last_check_in ? formatRelative(asset.mobile_device.last_check_in, t) : t('assetDetailDrawer.typeDetails.notReported', { defaultValue: 'Not reported' })} />
            </div>
          </Card>
        );
      }
      break;
    case 'printer':
      if (asset.printer && isPrinterAssetGuard(asset.printer)) {
        return (
          <Card className="space-y-3 p-4" {...withDataAutomationId({ id: 'asset-drawer-config-printer' })}>
            <SectionTitle icon={<Settings2 className="h-4 w-4" />} title={t('assetDetailDrawer.typeDetails.printer', { defaultValue: 'Printer details' })} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.model', { defaultValue: 'Model' })} value={asset.printer.model} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.networkPrinter', { defaultValue: 'Network printer' })} value={asset.printer.is_network_printer ? t('common.yes', { defaultValue: 'Yes' }) : t('common.no', { defaultValue: 'No' })} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.ipAddress', { defaultValue: 'IP address' })} value={asset.printer.ip_address || t('assetDetailDrawer.typeDetails.notProvided', { defaultValue: 'Not provided' })} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.supportsColor', { defaultValue: 'Supports color' })} value={asset.printer.supports_color ? t('common.yes', { defaultValue: 'Yes' }) : t('common.no', { defaultValue: 'No' })} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.supportsDuplex', { defaultValue: 'Supports duplex' })} value={asset.printer.supports_duplex ? t('common.yes', { defaultValue: 'Yes' }) : t('common.no', { defaultValue: 'No' })} />
              <ConfigurationRow label={t('assetDetailDrawer.typeDetails.monthlyDutyCycle', { defaultValue: 'Monthly duty cycle' })} value={asset.printer.monthly_duty_cycle ? t('assetDetailDrawer.typeDetails.monthlyDutyCycleValue', { defaultValue: '{{count}} pages', count: asset.printer.monthly_duty_cycle }) : t('assetDetailDrawer.typeDetails.notProvided', { defaultValue: 'Not provided' })} />
            </div>
          </Card>
        );
      }
      break;
    default:
      break;
  }

  return null;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatRelative(value: string, t: TranslationFn) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / (1000 * 60));
  if (minutes < 1) {
    return t('assetDetailDrawer.relative.momentsAgo', { defaultValue: 'moments ago' });
  }
  if (minutes < 60) {
    return t('assetDetailDrawer.relative.minutesAgo', {
      defaultValue: '{{count}} minute{{suffix}} ago',
      count: minutes,
      suffix: minutes === 1 ? '' : 's'
    });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t('assetDetailDrawer.relative.hoursAgo', {
      defaultValue: '{{count}} hour{{suffix}} ago',
      count: hours,
      suffix: hours === 1 ? '' : 's'
    });
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return t('assetDetailDrawer.relative.daysAgo', {
      defaultValue: '{{count}} day{{suffix}} ago',
      count: days,
      suffix: days === 1 ? '' : 's'
    });
  }
  return date.toLocaleDateString();
}
