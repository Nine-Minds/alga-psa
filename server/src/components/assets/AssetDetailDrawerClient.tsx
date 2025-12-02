'use client';

import { useCallback, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Drawer from 'server/src/components/ui/Drawer';
import { Tabs, TabsList, TabsTrigger, TabsContent } from 'server/src/components/ui/Tabs';
import { Badge } from 'server/src/components/ui/Badge';
import { Button } from 'server/src/components/ui/Button';
import { Card } from 'server/src/components/ui/Card';
import type {
  Asset,
  AssetHistory,
  AssetMaintenanceHistory,
  AssetMaintenanceReport,
  AssetTicketSummary,
} from 'server/src/interfaces/asset.interfaces';
import {
  isMobileDeviceAsset as isMobileDeviceAssetGuard,
  isNetworkDeviceAsset as isNetworkDeviceAssetGuard,
  isPrinterAsset as isPrinterAssetGuard,
  isServerAsset as isServerAssetGuard,
  isWorkstationAsset as isWorkstationAssetGuard,
} from 'server/src/interfaces/asset.interfaces';
import type { IDocument } from 'server/src/interfaces/document.interface';
import { withDataAutomationId } from 'server/src/types/ui-reflection/withDataAutomationId';
import { useRegisterUIComponent } from 'server/src/types/ui-reflection/useRegisterUIComponent';
import type { ContainerComponent } from 'server/src/types/ui-reflection/types';
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
}

const TAB_ORDER: AssetDrawerTab[] = [
  ASSET_DRAWER_TABS.OVERVIEW,
  ASSET_DRAWER_TABS.MAINTENANCE,
  ASSET_DRAWER_TABS.TICKETS,
  ASSET_DRAWER_TABS.CONFIGURATION,
  ASSET_DRAWER_TABS.DOCUMENTS,
];

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-600/20',
  inactive: 'bg-gray-100 text-gray-700 ring-1 ring-gray-600/20',
  maintenance: 'bg-amber-100 text-amber-700 ring-1 ring-amber-600/20',
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
}: AssetDetailDrawerClientProps) {
  const router = useRouter();
  const desiredTab = activeTab;

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
    label: 'Asset Detail Drawer',
  });

  useEffect(() => {
    if (!visibleAssetId) {
      registerDrawer?.({ helperText: 'Awaiting asset selection' });
    } else if (asset) {
      registerDrawer?.({ helperText: `${asset.name} • ${desiredTab}` });
    }
  }, [asset, desiredTab, registerDrawer, visibleAssetId]);

  const isHydratingAsset = Boolean(visibleAssetId && asset?.asset_id !== visibleAssetId);
  const shouldShowSkeleton = isLoading || isHydratingAsset;

  const statusBadge = useMemo(() => {
    if (!asset) {
      return null;
    }
    const statusClass = STATUS_STYLES[asset.status] || 'bg-blue-100 text-blue-700 ring-1 ring-blue-600/20';
    return (
      <Badge
        id="asset-drawer-status"
        variant="outline"
        className={`px-2 py-1 text-xs font-semibold ${statusClass}`}
      >
        {asset.status.charAt(0).toUpperCase() + asset.status.slice(1)}
      </Badge>
    );
  }, [asset]);

  const renderActiveTabContent = useCallback(() => {
    if (!visibleAssetId) {
      return renderEmptyState('Select an asset to view details');
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
        });
      case ASSET_DRAWER_TABS.MAINTENANCE:
        return renderMaintenanceTab({
          maintenanceReport: maintenanceReport ?? null,
          maintenanceHistory: maintenanceHistory ?? [],
        });
      case ASSET_DRAWER_TABS.TICKETS:
        return renderTicketsTab({ tickets: tickets ?? [] });
      case ASSET_DRAWER_TABS.CONFIGURATION:
        return renderConfigurationTab({ asset });
      case ASSET_DRAWER_TABS.DOCUMENTS:
        return renderDocumentsTab({ asset, documents: documents ?? [] });
      default:
        return renderEmptyState('Nothing to display');
    }
  }, [
    activeTab,
    asset,
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
    visibleAssetId,
  ]);

  return (
    <Drawer id="asset-detail-drawer" isOpen={isOpen} onClose={onClose}>
      <div className="w-[560px] max-w-full space-y-6">
        <header className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold text-gray-900">Asset details</h1>
            <p className="text-sm text-gray-500">Stay in context while reviewing lifecycle and configuration</p>
          </div>
        </header>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : (
          <Tabs value={desiredTab} onValueChange={handleTabChange} className="space-y-4">
            <TabsList className="w-full gap-2 border-b border-gray-200 text-sm font-medium text-gray-500">
              {TAB_ORDER.map(tab => (
                <TabsTrigger key={tab} value={tab} className="text-sm">
                  {tab}
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
};

function renderOverviewTab({ asset, maintenanceReport, history, router, statusBadge, onClose }: OverviewTabProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold text-gray-900">{asset.name}</h2>
            {statusBadge}
          </div>
          <p className="text-sm text-gray-500">
            Asset tag {asset.asset_tag} • {asset.asset_type.replace('_', ' ')}
          </p>
          {asset.client?.client_name && <p className="text-sm text-gray-500">Client: {asset.client.client_name}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button id="asset-drawer-open-record" variant="secondary" size="sm" className="gap-2" onClick={() => router.push(`/msp/assets/${asset.asset_id}`)}>
            <FileText className="h-4 w-4" /> Open asset record
          </Button>
          <RemoteAccessButton asset={asset} variant="secondary" size="sm" />
          <CreateTicketFromAssetButton asset={asset} />
          <DeleteAssetButton
            assetId={asset.asset_id}
            assetName={asset.name}
            variant="ghost"
            size="sm"
            label="Delete"
            onDeleted={onClose}
          />
        </div>
      </div>

      {maintenanceReport ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" {...withDataAutomationId({ id: 'asset-drawer-overview-metrics' })}>
          <MetricCard id="metric-maintenance-total" icon={<ListChecks className="h-4 w-4 text-blue-500" />} label="Active Schedules" value={maintenanceReport.active_schedules} />
          <MetricCard
            id="metric-maintenance-upcoming"
            icon={<Clock3 className="h-4 w-4 text-amber-500" />}
            label="Upcoming Maintenance"
            value={maintenanceReport.upcoming_maintenances}
            helper={maintenanceReport.next_maintenance ? `Next on ${formatDate(maintenanceReport.next_maintenance)}` : undefined}
          />
          <MetricCard
            id="metric-maintenance-completed"
            icon={<ShieldCheck className="h-4 w-4 text-emerald-500" />}
            label="Completed Maintenance"
            value={maintenanceReport.completed_maintenances}
            helper={`Compliance ${Math.round(maintenanceReport.compliance_rate)}%`}
          />
          <MetricCard
            id="metric-maintenance-last"
            icon={<Layers className="h-4 w-4 text-violet-500" />}
            label="Last Maintenance"
            value={maintenanceReport.last_maintenance ? formatRelative(maintenanceReport.last_maintenance) : 'No history'}
          />
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-500">
          <Clock3 className="h-4 w-4 text-gray-400" />
          Maintenance data will appear once schedules are configured.
        </div>
      )}

      <Card className="space-y-4 p-4" {...withDataAutomationId({ id: 'asset-drawer-overview-info' })}>
        <SectionTitle icon={<Settings2 className="h-4 w-4" />} title="Asset summary" />
        <InfoGrid asset={asset} />
      </Card>

      {/* RMM Alerts Section - Shows active alerts for RMM-managed assets */}
      <AssetAlertsSection asset={asset} />

      {/* RMM Patch Status Section - Shows patch compliance for workstations/servers */}
      <AssetPatchStatusSection asset={asset} />

      {/* RMM Software Inventory - Shows installed software for workstations/servers */}
      <AssetSoftwareInventory asset={asset} />

      {history && history.length > 0 && (
        <Card className="space-y-4 p-4" {...withDataAutomationId({ id: 'asset-drawer-overview-history' })}>
          <SectionTitle icon={<Copy className="h-4 w-4" />} title="Recent lifecycle events" />
          <ul className="space-y-3">
            {history.slice(0, 5).map(event => (
              <li key={event.history_id} className="flex items-start gap-3">
                <div className="h-2 w-2 translate-y-2 rounded-full bg-primary-500" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-gray-900 capitalize">{event.change_type.replace('_', ' ')}</p>
                  <p className="text-xs text-gray-500">{formatRelative(event.changed_at)}</p>
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
};

function renderMaintenanceTab({ maintenanceReport, maintenanceHistory }: MaintenanceTabProps) {
  if (!maintenanceReport) {
    return renderEmptyState('No maintenance schedules found for this asset yet.');
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard id="metric-schedules-total" icon={<ListChecks className="h-4 w-4 text-blue-500" />} label="Total Schedules" value={maintenanceReport.total_schedules} />
        <MetricCard id="metric-schedules-active" icon={<ShieldCheck className="h-4 w-4 text-emerald-500" />} label="Active" value={maintenanceReport.active_schedules} />
        <MetricCard id="metric-schedules-compliance" icon={<Layers className="h-4 w-4 text-violet-500" />} label="Compliance Rate" value={`${Math.round(maintenanceReport.compliance_rate)}%`} />
      </div>

      {maintenanceHistory && maintenanceHistory.length > 0 ? (
        <Card className="space-y-4 p-4" {...withDataAutomationId({ id: 'asset-drawer-maintenance-history' })}>
          <SectionTitle icon={<Clock3 className="h-4 w-4" />} title="Maintenance history" />
          <ul className="space-y-4">
            {maintenanceHistory.map(entry => (
              <li key={entry.history_id} className="flex items-start gap-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-primary-500" />
                <div>
                  <p className="text-sm font-medium text-gray-900">{formatDate(entry.performed_at)}</p>
                  <p className="text-xs text-gray-500">Logged by {entry.performed_by || 'system'}</p>
                  {entry.notes && <p className="mt-1 text-sm text-gray-600">{entry.notes}</p>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-500">
          <Clock3 className="h-4 w-4 text-gray-400" />
          Maintenance logs will appear here after the first service entry.
        </div>
      )}
    </div>
  );
}

type TicketsTabProps = { tickets: AssetTicketSummary[] };

function renderTicketsTab({ tickets }: TicketsTabProps) {
  if (!tickets || tickets.length === 0) {
    return renderEmptyState('No tickets linked to this asset yet. Use the quick action to create one.');
  }

  return (
    <div className="space-y-3">
      {tickets.map(ticket => (
        <Card key={`${ticket.ticket_id}-${ticket.linked_at}`} className="p-4" {...withDataAutomationId({ id: `asset-linked-ticket-${ticket.ticket_id}` })}>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
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
                <span className="text-xs text-gray-500">Linked {formatRelative(ticket.linked_at)}</span>
              </div>
              <div className="text-xs text-gray-500">
                {ticket.client_name && <span>Client: {ticket.client_name}</span>}
                {ticket.assigned_to_name && <span className="ml-2">Assignee: {ticket.assigned_to_name}</span>}
              </div>
            </div>
            <Button id={`asset-ticket-open-${ticket.ticket_id}`} variant="ghost" size="sm" className="gap-2 self-start" onClick={() => window.open(`/msp/tickets/${ticket.ticket_id}`, '_blank', 'noopener,noreferrer')}>
              <LinkIcon className="h-4 w-4" /> Open ticket
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

type ConfigurationTabProps = { asset: Asset };

function renderConfigurationTab({ asset }: ConfigurationTabProps) {
  return (
    <div className="space-y-6">
      <Card className="space-y-3 p-4" {...withDataAutomationId({ id: 'asset-drawer-configuration-basics' })}>
        <SectionTitle icon={<Settings2 className="h-4 w-4" />} title="Core attributes" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
          <ConfigurationRow label="Serial number" value={asset.serial_number || 'Not provided'} />
          <ConfigurationRow label="Location" value={asset.location || 'Not provided'} />
          <ConfigurationRow label="Purchase date" value={asset.purchase_date ? formatDate(asset.purchase_date) : 'Not provided'} />
          <ConfigurationRow label="Warranty end" value={asset.warranty_end_date ? formatDate(asset.warranty_end_date) : 'Not provided'} />
        </div>
      </Card>

      {renderTypeSpecificConfiguration(asset)}
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

function InfoGrid({ asset }: { asset: Asset }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
      <InfoRow label="Client" value={asset.client?.client_name || 'Unassigned'} />
      <InfoRow label="Asset tag" value={asset.asset_tag} />
      <InfoRow label="Status" value={asset.status} />
      <InfoRow label="Created" value={formatDate(asset.created_at)} />
      <InfoRow label="Updated" value={formatRelative(asset.updated_at)} />
      <InfoRow label="Tenant" value={asset.tenant} />
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

function renderTypeSpecificConfiguration(asset: Asset) {
  switch (asset.asset_type) {
    case 'workstation':
      if (asset.workstation && isWorkstationAssetGuard(asset.workstation)) {
        return (
          <Card className="space-y-3 p-4" {...withDataAutomationId({ id: 'asset-drawer-config-workstation' })}>
            <SectionTitle icon={<Settings2 className="h-4 w-4" />} title="Workstation details" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
              <ConfigurationRow label="Operating system" value={`${asset.workstation.os_type} ${asset.workstation.os_version}`} />
              <ConfigurationRow label="CPU" value={`${asset.workstation.cpu_model} (${asset.workstation.cpu_cores} cores)`} />
              <ConfigurationRow label="RAM" value={`${asset.workstation.ram_gb} GB`} />
              <ConfigurationRow label="Storage" value={`${asset.workstation.storage_type} • ${asset.workstation.storage_capacity_gb} GB`} />
              <ConfigurationRow label="GPU" value={asset.workstation.gpu_model || 'Not provided'} />
              <ConfigurationRow label="Last login" value={asset.workstation.last_login ? formatRelative(asset.workstation.last_login) : 'Never'} />
            </div>
          </Card>
        );
      }
      break;
    case 'network_device':
      if (asset.network_device && isNetworkDeviceAssetGuard(asset.network_device)) {
        return (
          <Card className="space-y-3 p-4" {...withDataAutomationId({ id: 'asset-drawer-config-network' })}>
            <SectionTitle icon={<Settings2 className="h-4 w-4" />} title="Network device details" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
              <ConfigurationRow label="Device type" value={asset.network_device.device_type} />
              <ConfigurationRow label="Management IP" value={asset.network_device.management_ip || 'Not provided'} />
              <ConfigurationRow label="Port count" value={asset.network_device.port_count} />
              <ConfigurationRow label="Firmware version" value={asset.network_device.firmware_version} />
              <ConfigurationRow label="PoE support" value={asset.network_device.supports_poe ? 'Yes' : 'No'} />
              <ConfigurationRow label="Power draw" value={`${asset.network_device.power_draw_watts} W`} />
            </div>
          </Card>
        );
      }
      break;
    case 'server':
      if (asset.server && isServerAssetGuard(asset.server)) {
        return (
          <Card className="space-y-3 p-4" {...withDataAutomationId({ id: 'asset-drawer-config-server' })}>
            <SectionTitle icon={<Settings2 className="h-4 w-4" />} title="Server details" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
              <ConfigurationRow label="Operating system" value={`${asset.server.os_type} ${asset.server.os_version}`} />
              <ConfigurationRow label="CPU" value={`${asset.server.cpu_model} (${asset.server.cpu_cores} cores)`} />
              <ConfigurationRow label="RAM" value={`${asset.server.ram_gb} GB`} />
              <ConfigurationRow label="Virtualized" value={asset.server.is_virtual ? 'Yes' : 'No'} />
              <ConfigurationRow label="Primary IP" value={asset.server.primary_ip || 'Not provided'} />
              <ConfigurationRow label="Hypervisor" value={asset.server.hypervisor || 'Not provided'} />
            </div>
          </Card>
        );
      }
      break;
    case 'mobile_device':
      if (asset.mobile_device && isMobileDeviceAssetGuard(asset.mobile_device)) {
        return (
          <Card className="space-y-3 p-4" {...withDataAutomationId({ id: 'asset-drawer-config-mobile' })}>
            <SectionTitle icon={<Settings2 className="h-4 w-4" />} title="Mobile device details" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
              <ConfigurationRow label="OS" value={`${asset.mobile_device.os_type} ${asset.mobile_device.os_version}`} />
              <ConfigurationRow label="Model" value={asset.mobile_device.model} />
              <ConfigurationRow label="IMEI" value={asset.mobile_device.imei || 'Not provided'} />
              <ConfigurationRow label="Phone number" value={asset.mobile_device.phone_number || 'Not provided'} />
              <ConfigurationRow label="Carrier" value={asset.mobile_device.carrier || 'Not provided'} />
              <ConfigurationRow label="Last check-in" value={asset.mobile_device.last_check_in ? formatRelative(asset.mobile_device.last_check_in) : 'Not reported'} />
            </div>
          </Card>
        );
      }
      break;
    case 'printer':
      if (asset.printer && isPrinterAssetGuard(asset.printer)) {
        return (
          <Card className="space-y-3 p-4" {...withDataAutomationId({ id: 'asset-drawer-config-printer' })}>
            <SectionTitle icon={<Settings2 className="h-4 w-4" />} title="Printer details" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
              <ConfigurationRow label="Model" value={asset.printer.model} />
              <ConfigurationRow label="Network printer" value={asset.printer.is_network_printer ? 'Yes' : 'No'} />
              <ConfigurationRow label="IP address" value={asset.printer.ip_address || 'Not provided'} />
              <ConfigurationRow label="Supports color" value={asset.printer.supports_color ? 'Yes' : 'No'} />
              <ConfigurationRow label="Supports duplex" value={asset.printer.supports_duplex ? 'Yes' : 'No'} />
              <ConfigurationRow label="Monthly duty cycle" value={asset.printer.monthly_duty_cycle ? `${asset.printer.monthly_duty_cycle} pages` : 'Not provided'} />
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

function formatRelative(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / (1000 * 60));
  if (minutes < 1) {
    return 'moments ago';
  }
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }
  return date.toLocaleDateString();
}
