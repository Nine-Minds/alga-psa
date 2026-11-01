'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  Boxes,
  Building2,
  CalendarDays,
  Cpu,
  FileText,
  HardDrive,
  Lock,
  MapPin,
  Network,
  Pencil,
  Shield,
  X,
  type LucideIcon,
} from 'lucide-react';
import Drawer from '@alga-psa/ui/components/Drawer';
import { Button } from '@alga-psa/ui/components/Button';
import { ContentCardVariantProvider } from '@alga-psa/ui/components';
import {
  BentoChip,
  BentoGauge,
  BentoLabelValue,
  BentoRow,
  BentoRowList,
  BentoStat,
  BentoTile,
  BentoTileEmpty,
  BentoToneDot,
  BENTO_TONE_TEXT,
} from '@alga-psa/ui/components/bento';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import useSWR from 'swr';
import { getAssetLinkedTickets, getAssetMaintenanceReport } from '../actions/assetActions';
import { CustodyCard } from './custody/CustodyCard';
import { WarrantyCard } from './warranty/WarrantyCard';
import { getAssetSoftwareSummary } from '../actions/softwareActions';
import { getAssetGroup } from '../actions/assetGroupActions';
import { unwrapAssetActionResult } from '../actions/assetActionErrors';
import { useClientDrawer } from '@alga-psa/ui';
import type { Asset, AssetFact, AssetSummaryMetrics, RmmCachedData } from '@alga-psa/types';
import {
  AGENT_TONE,
  HEALTH_TONE,
  SECURITY_TONE,
  WARRANTY_TONE,
  formatAge,
  formatUptime,
  osLabel,
  warrantyPhrase,
  worstStorage,
} from '../lib/assetSignals';
import { formatMinorUnits } from '../lib/money';
import { useAssetStatusRegistry } from './shared/useAssetStatusOptions';
import { assetStatusLabel } from '../lib/assetStatus';
import { calendarDateToLocalDate } from '../lib/calendarDate';
import { AssetAssigneeRow } from './AssetAssigneeRow';
import { AssetSignedInUserRow } from './AssetSignedInUserRow';
import { AssetGroupDrawer } from './groups/AssetGroupDrawer';
import { AssetTimeline } from './AssetTimeline';
import AssetFormClient from './AssetFormClient';
import { AssetNotesPanel } from './panels/AssetNotesPanel';
import { CustomTypeDetailsPanel } from './panels/CustomTypeDetailsPanel';
import { HuduDocumentationCard } from './panels/HuduDocumentationCard';
import { SoftwareInventoryTab } from './tabs/SoftwareInventoryTab';
import { MaintenanceSchedulesTab } from './tabs/MaintenanceSchedulesTab';
import { RelatedAssetsTab } from './tabs/RelatedAssetsTab';
import { DocumentsPasswordsTab } from './tabs/DocumentsPasswordsTab';
import { ServiceHistoryTab } from './tabs/ServiceHistoryTab';
import { AssetInventoryProvenanceSection } from './AssetInventoryProvenance';


interface FocusView {
  id: string;
  label: string;
  icon: LucideIcon;
  content: React.ReactNode;
  /**
   * Rendered in the drawer's pinned footer. Every view supplies one: a footer
   * is also what stops the panel itself from being a second scroll container
   * on top of the content pane.
   */
  footer?: React.ReactNode;
}

/**
 * Bento layout for the asset detail screen, matching the ticket and client
 * surfaces: hero band, then a 3 / 6 / 3 mosaic with the timeline as the centre
 * spine. Heavy panels (software, maintenance, related, documents, service
 * history) move into a focus drawer so the tab strip disappears without
 * anything becoming unreachable.
 */
export function AssetBentoLayout({
  asset,
  metrics,
  rmmData,
  assetFacts,
  focusView,
  onFocusChange,
}: {
  asset: Asset;
  metrics: AssetSummaryMetrics | undefined;
  rmmData: RmmCachedData | null | undefined;
  /** Integration-reported key/values. Previously surfaced by RmmVitalsPanel. */
  assetFacts: AssetFact[] | undefined;
  /**
   * Controlled by AssetDetailView so the header's Edit action opens this same
   * drawer rather than a second, competing one.
   */
  focusView: string | null;
  onFocusChange: (viewId: string | null) => void;
}) {
  const { t } = useTranslation('msp/assets');
  // Provided by MspClientDrawerProvider in WorkspaceProviders, so it is present
  // on every /msp route. Optional by design — fall back to a link if absent.
  const clientDrawer = useClientDrawer();
  const now = Date.now();
  // F021: the Status row reads the registry's label, not the stored slug.
  const { statuses: assetStatuses } = useAssetStatusRegistry();

  const ext = asset.workstation ?? asset.server;
  const networkDevice = asset.network_device;
  const isRmmManaged = Boolean(asset.rmm_provider || rmmData?.provider);
  const agentTone = AGENT_TONE[asset.agent_status ?? 'unknown'] ?? 'neutral';
  const disk = worstStorage(rmmData?.storage);

  // Shared SWR keys with AssetTimeline — cache hit, not a second fetch.
  const { data: linkedTickets } = useSWR(
    asset.asset_id ? ['asset', asset.asset_id, 'tickets'] : null,
    ([, aid]) => unwrapAssetActionResult(getAssetLinkedTickets(aid))
  );
  const { data: maintenanceReport } = useSWR(
    asset.asset_id ? ['asset', asset.asset_id, 'maintenance'] : null,
    ([, aid]) => unwrapAssetActionResult(getAssetMaintenanceReport(aid))
  );
  /**
   * F071: the tile names the siblings and the people; `asset.group` only counts
   * them. Keyed under this asset so the group drawer's member revalidation
   * (matchAssetCacheKeys) drops it after an owner or membership change.
   */
  const { data: groupDetail } = useSWR(
    asset.group?.group_id ? ['asset', asset.asset_id, 'group', asset.group.group_id] : null,
    ([, , , groupId]) => unwrapAssetActionResult(getAssetGroup(groupId as string))
  );
  // Counts asset_software (is_current), the same source as the Software tab.
  // undefined while loading or on error, so the tile shows nothing until known.
  const { data: softwareSummary } = useSWR(
    asset.asset_id ? ['asset', asset.asset_id, 'software-summary'] : null,
    ([, aid]) => unwrapAssetActionResult(getAssetSoftwareSummary(aid))
  );
  const softwareCount = softwareSummary?.total_installed;
  const groupSiblings = (groupDetail?.members ?? []).filter(
    (member) => member.asset_id !== asset.asset_id
  );
  const groupPeople = asset.group?.kind === 'bundle'
    ? (groupDetail?.contacts ?? []).filter((contact) => contact.role === 'owner')
    : (groupDetail?.contacts ?? []).filter((contact) => contact.role === 'user');
  // Owned here because the drawer footer holds the edit form's Save button.
  const [editSaving, setEditSaving] = useState(false);
  const purchaseCostLabel = formatMinorUnits(asset.purchase_cost, asset.purchase_cost_currency);

  const pendingPatches =
    (ext?.pending_os_patches ?? 0) + (ext?.pending_software_patches ?? 0) || ext?.pending_patches;

  const closeFooter = (
    <Button id="asset-bento-focus-done" variant="outline" onClick={() => onFocusChange(null)}>
      {t('assetBento.close', { defaultValue: 'Close' })}
    </Button>
  );

  const views: FocusView[] = useMemo(() => [
    // Edit leads: it is the action people reach for most, and hosting it here
    // means one drawer with one rail instead of two competing overlays.
    {
      id: 'edit',
      label: t('assetBento.editAsset', { defaultValue: 'Edit asset' }),
      icon: Pencil,
      // Save and Cancel live in the pinned footer below, so the form drops its
      // own trailing row: at full length they sat ~700px below the fold.
      content: (
        <AssetFormClient
          assetId={asset.asset_id}
          onSaved={() => onFocusChange(null)}
          onCancel={() => onFocusChange(null)}
          hideActions
          onSavingChange={setEditSaving}
        />
      ),
      footer: (
        <>
          <Button
            id="asset-bento-focus-cancel"
            variant="outline"
            disabled={editSaving}
            onClick={() => onFocusChange(null)}
          >
            {t('common.actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          {/* Submits the form it names, from outside it. */}
          <Button id="asset-bento-focus-save" type="submit" form="asset-edit-form" disabled={editSaving}>
            {editSaving
              ? t('common.actions.saving', { defaultValue: 'Saving...' })
              : t('assetForm.actions.saveChanges', { defaultValue: 'Save Changes' })}
          </Button>
        </>
      ),
    },
    { id: 'service-history', label: t('assetDetailTabs.tabs.serviceHistory', { defaultValue: 'Service history' }), icon: Activity, content: <ServiceHistoryTab asset={asset} /> },
    { id: 'software', label: t('assetDetailTabs.tabs.software', { defaultValue: 'Software' }), icon: Boxes, content: <SoftwareInventoryTab asset={asset} /> },
    { id: 'maintenance', label: t('assetDetailTabs.tabs.maintenance', { defaultValue: 'Maintenance' }), icon: CalendarDays, content: <MaintenanceSchedulesTab assetId={asset.asset_id} /> },
    { id: 'related-assets', label: t('assetDetailTabs.tabs.relatedAssets', { defaultValue: 'Related assets' }), icon: Network, content: <RelatedAssetsTab asset={asset} /> },
    ...(asset.group
      ? [{
          id: 'group',
          label: t('assetGroups.drawerTitle', { defaultValue: 'Group' }),
          icon: Boxes,
          // Deleting the group takes this tab with it, so the focus view has
          // to step back instead of sitting on a group that no longer exists.
          content: <AssetGroupDrawer groupId={asset.group.group_id} onDeleted={() => onFocusChange(null)} />,
        }]
      : []),
    { id: 'documents-passwords', label: t('assetDetailTabs.tabs.documentsPasswords', { defaultValue: 'Documents & passwords' }), icon: Lock, content: <DocumentsPasswordsTab asset={asset} /> },
  ], [asset, t, onFocusChange, editSaving]);

  const activeView = focusView ? views.find((view) => view.id === focusView) ?? null : null;

  return (
    <ContentCardVariantProvider variant="bento">
      <div id="asset-bento" className="min-w-0">
        {/* Hero */}
        <BentoTile id="asset-bento-hero" className="mb-4">
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2 min-w-0">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <BentoToneDot tone={agentTone} />
                <h1 className="text-lg font-bold text-[rgb(var(--color-text-900))] truncate">{asset.name}</h1>
                {isRmmManaged ? <BentoChip tone={agentTone === 'good' ? 'success' : agentTone === 'bad' ? 'danger' : agentTone === 'warn' ? 'warning' : 'neutral'}>{asset.agent_status ?? 'unknown'}</BentoChip> : null}
                <BentoChip>{asset.asset_type}</BentoChip>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[rgb(var(--color-text-500))] min-w-0">
                <span className="font-mono">{asset.asset_tag}</span>
                {asset.serial_number ? <span className="font-mono">SN {asset.serial_number}</span> : null}
                {asset.client ? (() => {
                  const clientInfo = asset.client;
                  return clientDrawer ? (
                    <button
                      id="asset-bento-client"
                      type="button"
                      onClick={() => void clientDrawer.openClientDrawer(clientInfo.client_id)}
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      <Building2 className="h-3.5 w-3.5" />
                      {clientInfo.client_name}
                    </button>
                  ) : (
                    <Link id="asset-bento-client" href={`/msp/clients/${clientInfo.client_id}`} className="inline-flex items-center gap-1 hover:underline">
                      <Building2 className="h-3.5 w-3.5" />
                      {clientInfo.client_name}
                    </Link>
                  );
                })() : null}
                {asset.location ? (
                  <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{asset.location}</span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 border-t border-[rgb(var(--color-border-100))] pt-3">
            <BentoStat
              value={<span className={BENTO_TONE_TEXT[metrics ? HEALTH_TONE[metrics.health_status] : 'neutral']}>{metrics?.health_status ?? '—'}</span>}
              label={t('assetBento.health', { defaultValue: 'Health' })}
            />
            <BentoStat
              value={<span className={BENTO_TONE_TEXT[metrics ? SECURITY_TONE[metrics.security_status] : 'neutral']}>{metrics?.security_status.replace('_', ' ') ?? '—'}</span>}
              label={t('assetBento.security', { defaultValue: 'Security' })}
            />
            <BentoStat value={metrics?.open_tickets_count ?? 0} label={t('assetBento.openTickets', { defaultValue: 'Open tickets' })} />
            <BentoStat
              value={<span className={BENTO_TONE_TEXT[metrics ? WARRANTY_TONE[metrics.warranty_status] : 'neutral']}>{warrantyPhrase(metrics?.warranty_days_remaining, t) ?? '—'}</span>}
              label={t('assetBento.warranty', { defaultValue: 'Warranty' })}
            />
          </div>
        </BentoTile>

        {/* Mosaic: 3 / 6 / 3, timeline in the centre. */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left rail — what it is */}
          <div className="order-3 lg:order-1 lg:col-span-4 xl:col-span-3 space-y-4 min-w-0">
            <BentoTile id="asset-bento-identity" title={t('assetBento.identity', { defaultValue: 'Identity' })} icon={<FileText className="h-4 w-4" />}>
              <div className="space-y-1.5 text-sm">
                <BentoLabelValue label={t('assetBento.tag', { defaultValue: 'Tag' })} value={asset.asset_tag} mono />
                <BentoLabelValue label={t('assetBento.serial', { defaultValue: 'Serial' })} value={asset.serial_number} mono />
                <BentoLabelValue label={t('assetBento.status', { defaultValue: 'Status' })} value={assetStatusLabel(t, asset.status, assetStatuses)} />
                {/* FR-C6: the assignee is always shown, even when empty. */}
                <AssetAssigneeRow
                  assetId={asset.asset_id}
                  clientId={asset.client_id}
                  contactNameId={asset.contact_name_id ?? null}
                  contactName={asset.contact_name ?? null}
                  sharedWorkspace={asset.group?.kind === 'shared_workspace'
                    ? {
                        group_id: asset.group.group_id,
                        name: asset.group.name,
                        user_count: asset.group.user_count ?? 0,
                      }
                    : null}
                />
                <BentoLabelValue label={t('assetBento.location', { defaultValue: 'Location' })} value={asset.location} />
                {/* FR-A1 rows are hidden when empty rather than showing a dash. */}
                {asset.manufacturer ? (
                  <BentoLabelValue id="asset-bento-manufacturer" label={t('assetBento.manufacturer', { defaultValue: 'Manufacturer' })} value={asset.manufacturer} />
                ) : null}
                {asset.model ? (
                  <BentoLabelValue id="asset-bento-model" label={t('assetBento.model', { defaultValue: 'Model' })} value={asset.model} />
                ) : null}
                {asset.vendor_name ? (
                  <BentoLabelValue id="asset-bento-vendor" label={t('assetBento.vendor', { defaultValue: 'Vendor' })} value={asset.vendor_name} />
                ) : null}
                {purchaseCostLabel ? (
                  <BentoLabelValue id="asset-bento-purchase-cost" label={t('assetBento.purchaseCost', { defaultValue: 'Purchase cost' })} value={purchaseCostLabel} />
                ) : null}
                {asset.order_number ? (
                  <BentoLabelValue id="asset-bento-order-number" label={t('assetBento.orderNumber', { defaultValue: 'Order no.' })} value={asset.order_number} mono />
                ) : null}
                {/* FR-F4: shown only when the device overrides the client default. */}
                {asset.billing_profile_id ? (
                  <BentoLabelValue
                    id="asset-bento-billing-profile"
                    label={t('assetBento.billingProfile', { defaultValue: 'Billing profile' })}
                    value={asset.billing_profile_name ?? asset.billing_profile_id}
                  />
                ) : null}
                {/* Both columns hold UTC midnight for a calendar day, so they are
                    read as calendar parts — `new Date(...).toLocaleDateString()`
                    renders the previous day west of UTC and disagreed with the
                    edit form's picker. */}
                <BentoLabelValue label={t('assetBento.purchased', { defaultValue: 'Purchased' })} value={calendarDateToLocalDate(asset.purchase_date)?.toLocaleDateString()} />
                <BentoLabelValue label={t('assetBento.warrantyEnds', { defaultValue: 'Warranty ends' })} value={calendarDateToLocalDate(asset.warranty_end_date)?.toLocaleDateString()} />
              </div>
            </BentoTile>

            <BentoTile id="asset-bento-hardware" title={t('assetBento.hardware', { defaultValue: 'Hardware' })} icon={<Cpu className="h-4 w-4" />}>
              {ext ? (
                <div className="space-y-1.5 text-sm">
                  <BentoLabelValue label={t('assetBento.os', { defaultValue: 'OS' })} value={osLabel(ext.os_type, ext.os_version)} />
                  <BentoLabelValue label={t('assetBento.cpu', { defaultValue: 'CPU' })} value={ext.cpu_model} />
                  <BentoLabelValue label={t('assetBento.cores', { defaultValue: 'Cores' })} value={ext.cpu_cores} />
                  <BentoLabelValue label={t('assetBento.ram', { defaultValue: 'RAM' })} value={ext.ram_gb != null ? `${ext.ram_gb} GB` : undefined} />
                  <BentoLabelValue label={t('assetBento.ip', { defaultValue: 'IP' })} value={rmmData?.lan_ip ?? asset.workstation?.lan_ip} mono />
                </div>
              ) : networkDevice ? (
                <div id="asset-bento-network-device" className="space-y-1.5 text-sm">
                  <BentoLabelValue
                    id="asset-bento-network-device-type"
                    label={t('assetForm.fields.deviceType', { defaultValue: 'Device Type' })}
                    value={networkDevice.device_type
                      ? t(`assetDetails.deviceTypes.${networkDevice.device_type}`, { defaultValue: networkDevice.device_type })
                      : undefined}
                  />
                  <BentoLabelValue label={t('assetDetails.fields.managementIp', { defaultValue: 'Management IP' })} value={networkDevice.management_ip || undefined} mono />
                  <BentoLabelValue label={t('assetDetails.fields.portCount', { defaultValue: 'Port Count' })} value={networkDevice.port_count ?? undefined} />
                  <BentoLabelValue label={t('assetDetails.fields.firmwareVersion', { defaultValue: 'Firmware Version' })} value={networkDevice.firmware_version || undefined} />
                  <BentoLabelValue
                    label={t('assetDetails.fields.powerDraw', { defaultValue: 'Power Draw' })}
                    value={networkDevice.power_draw_watts != null ? `${networkDevice.power_draw_watts} W` : undefined}
                  />
                  <BentoLabelValue
                    label={t('assetDetails.fields.poeSupport', { defaultValue: 'PoE Support' })}
                    value={networkDevice.supports_poe ? t('common.yes', { defaultValue: 'Yes' }) : t('common.no', { defaultValue: 'No' })}
                  />
                </div>
              ) : (
                <BentoTileEmpty id="asset-bento-hardware-empty">
                  {t('assetBento.noHardware', { defaultValue: 'No hardware details recorded.' })}
                </BentoTileEmpty>
              )}
            </BentoTile>

            <BentoTile
              id="asset-bento-software"
              title={t('assetDetailTabs.tabs.software', { defaultValue: 'Software' })}
              icon={<Boxes className="h-4 w-4" />}
              action={
                softwareCount ? (
                  <button id="asset-bento-software-open" type="button" onClick={() => onFocusChange('software')} className="text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline">
                    {t('assetBento.viewAll', { defaultValue: 'View all' })}
                  </button>
                ) : undefined
              }
            >
              {softwareCount ? (
                <p className="text-sm text-[rgb(var(--color-text-700))]">
                  {t('assetBento.packagesReported', { defaultValue: '{{count}} packages reported', count: softwareCount })}
                </p>
              ) : softwareCount === 0 ? (
                <BentoTileEmpty id="asset-bento-software-empty">
                  {t('assetBento.noSoftware', { defaultValue: 'No software inventory reported.' })}
                </BentoTileEmpty>
              ) : null}
            </BentoTile>

            {/* F071: the group the asset belongs to, with its siblings and people. */}
            {asset.group ? (
              <BentoTile
                id="asset-bento-group"
                title={asset.group.kind === 'bundle'
                  ? t('assetGroups.kinds.bundle', { defaultValue: 'Bundle' })
                  : t('assetGroups.kinds.shared_workspace', { defaultValue: 'Shared workspace' })}
                icon={<Boxes className="h-4 w-4" />}
                action={
                  <button
                    id="asset-bento-group-open"
                    type="button"
                    onClick={() => onFocusChange('group')}
                    className="text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline"
                  >
                    {t('assetGroups.actions.manage', { defaultValue: 'Manage' })}
                  </button>
                }
              >
                <div className="space-y-1.5 text-sm">
                  <BentoLabelValue label={t('assetGroups.fields.name', { defaultValue: 'Name' })} value={asset.group.name} />
                  {asset.group.location_name ? (
                    <BentoLabelValue label={t('assetBento.location', { defaultValue: 'Location' })} value={asset.group.location_name} />
                  ) : null}
                  {/* The people who go with the group: a bundle's owner, a workspace's users. */}
                  {groupPeople.length > 0 ? (
                    <BentoLabelValue
                      label={asset.group.kind === 'bundle'
                        ? t('assetGroups.fields.owner', { defaultValue: 'Owner' })
                        : t('assetGroups.fields.users', { defaultValue: 'Users' })}
                      value={groupPeople
                        .slice(0, 4)
                        .map((contact) => contact.contact_name ?? '')
                        .filter(Boolean)
                        .join(', ')}
                    />
                  ) : asset.group.kind === 'shared_workspace' ? (
                    <BentoLabelValue
                      label={t('assetGroups.fields.users', { defaultValue: 'Users' })}
                      value={asset.group.user_count ?? 0}
                    />
                  ) : null}
                </div>
                {/* The siblings, linked: "what else is on this desk". */}
                {groupSiblings.length > 0 ? (
                  <BentoRowList>
                    {groupSiblings.slice(0, 5).map((member) => (
                      <BentoRow key={member.asset_id} align="center" meta={member.asset_tag ?? undefined}>
                        <HardDrive className="h-3.5 w-3.5 flex-shrink-0 text-[rgb(var(--color-text-400))]" />
                        <Link
                          id={`asset-bento-group-sibling-${member.asset_id}`}
                          href={`/msp/assets/${member.asset_id}`}
                          className="truncate text-sm text-[rgb(var(--color-text-700))] hover:underline min-w-0"
                        >
                          {member.asset_name}
                        </Link>
                      </BentoRow>
                    ))}
                  </BentoRowList>
                ) : (
                  <BentoLabelValue
                    label={t('assetGroups.fields.members', { defaultValue: 'Members' })}
                    value={asset.group.member_count ?? 0}
                  />
                )}
              </BentoTile>
            ) : null}

            <CustomTypeDetailsPanel asset={asset} />

            <AssetNotesPanel assetId={asset.asset_id} />
          </div>

          {/* Centre — the spine */}
          <div className="order-1 lg:order-2 lg:col-span-8 xl:col-span-6 min-w-0">
            <AssetTimeline id="asset-bento-timeline" asset={asset} />
          </div>

          {/* Right rail — how it's doing */}
          <div className="order-2 lg:order-3 lg:col-span-12 xl:col-span-3 min-w-0 space-y-4 xl:space-y-4 lg:grid lg:grid-cols-3 lg:gap-4 lg:space-y-0 xl:block">
            {isRmmManaged ? (
              <BentoTile
                id="asset-bento-vitals"
                title={t('assetBento.liveVitals', { defaultValue: 'Live vitals' })}
                icon={<Activity className="h-4 w-4" />}
                subtitle={rmmData?.last_check_in ? `${t('assetBento.checkedIn', { defaultValue: 'Checked in' })} ${formatAge(rmmData.last_check_in, now, t)}` : t('assetBento.neverCheckedIn', { defaultValue: 'Never checked in' })}
              >
                <div className="space-y-3">
                  <BentoGauge percent={rmmData?.cpu_utilization_percent} label={t('assetBento.cpu', { defaultValue: 'CPU' })} />
                  <BentoGauge
                    percent={rmmData?.memory_utilization_percent}
                    label={t('assetBento.memory', { defaultValue: 'Memory' })}
                    caption={rmmData?.memory_used_gb != null && rmmData?.memory_total_gb != null ? `${rmmData.memory_used_gb} / ${rmmData.memory_total_gb} GB` : undefined}
                  />
                  <BentoGauge
                    percent={disk?.utilization_percent}
                    label={disk ? `${t('assetBento.disk', { defaultValue: 'Disk' })} ${disk.name}` : t('assetBento.disk', { defaultValue: 'Disk' })}
                    caption={disk ? (disk.free_gb != null ? `${disk.free_gb} GB free of ${disk.total_gb} GB` : `${disk.total_gb} GB`) : undefined}
                  />
                </div>
                <div className="mt-3 space-y-1.5 border-t border-[rgb(var(--color-border-100))] pt-3 text-sm">
                  <BentoLabelValue label={t('assetBento.uptime', { defaultValue: 'Uptime' })} value={formatUptime(rmmData?.uptime_seconds, t) ?? undefined} mono />
                  {/* FR-D5: the row offers the matched contact, or a one-off mapping. */}
                  <AssetSignedInUserRow
                    assetId={asset.asset_id}
                    clientId={asset.client_id}
                    signedInUser={rmmData?.current_user ?? ext?.current_user ?? null}
                  />
                </div>
              </BentoTile>
            ) : null}

            <BentoTile id="asset-bento-security" title={t('assetBento.securityTitle', { defaultValue: 'Security' })} icon={<Shield className="h-4 w-4" />}>
              <div className="space-y-1.5 text-sm">
                <BentoLabelValue label={t('assetBento.antivirus', { defaultValue: 'Antivirus' })} value={ext?.antivirus_product ?? ext?.antivirus_status} />
                <BentoLabelValue
                  label={t('assetBento.pendingPatches', { defaultValue: 'Pending patches' })}
                  value={pendingPatches != null ? <span className={BENTO_TONE_TEXT[pendingPatches > 0 ? 'warn' : 'good']}>{pendingPatches}</span> : undefined}
                />
                <BentoLabelValue
                  label={t('assetBento.failedPatches', { defaultValue: 'Failed patches' })}
                  value={ext?.failed_patches != null ? <span className={BENTO_TONE_TEXT[ext.failed_patches > 0 ? 'bad' : 'good']}>{ext.failed_patches}</span> : undefined}
                />
                <BentoLabelValue label={t('assetBento.lastScan', { defaultValue: 'Last scan' })} value={formatAge(ext?.last_patch_scan_at, now, t) ?? undefined} />
                <BentoLabelValue label={t('assetBento.agentVersion', { defaultValue: 'Agent' })} value={ext?.agent_version} mono />
              </div>
              {metrics?.security_issues?.length ? (
                <ul className="mt-3 space-y-1 border-t border-[rgb(var(--color-border-100))] pt-3 text-sm text-[rgb(var(--color-text-700))]">
                  {metrics.security_issues.map((issue) => <li key={issue} className="truncate">{issue}</li>)}
                </ul>
              ) : null}
            </BentoTile>

            <CustodyCard id="asset-bento-custody" assetId={asset.asset_id} />

            <WarrantyCard id="asset-bento-warranty" assetId={asset.asset_id} />

            <BentoTile
              id="asset-bento-related"
              title={t('assetDetailTabs.tabs.relatedAssets', { defaultValue: 'Related assets' })}
              icon={<Network className="h-4 w-4" />}
              action={
                <button id="asset-bento-related-manage" type="button" onClick={() => onFocusChange('related-assets')} className="text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline">
                  {t('assetBento.manage', { defaultValue: 'Manage' })}
                </button>
              }
            >
              {asset.relationships?.length ? (
                <BentoRowList>
                  {asset.relationships.slice(0, 5).map((rel) => (
                    <BentoRow key={`${rel.parent_asset_id}-${rel.child_asset_id}`} align="center" meta={rel.relationship_type}>
                      <HardDrive className="h-3.5 w-3.5 flex-shrink-0 text-[rgb(var(--color-text-400))]" />
                      <Link
                        href={`/msp/assets/${rel.parent_asset_id === asset.asset_id ? rel.child_asset_id : rel.parent_asset_id}`}
                        className="truncate text-sm text-[rgb(var(--color-text-700))] hover:underline min-w-0"
                      >
                        {rel.name}
                      </Link>
                    </BentoRow>
                  ))}
                </BentoRowList>
              ) : (
                <BentoTileEmpty id="asset-bento-related-empty">
                  {t('assetBento.noRelated', { defaultValue: 'Not linked to any other asset.' })}
                </BentoTileEmpty>
              )}
              {/* F071: an ungrouped asset gets the way into a group from here. */}
              {!asset.group ? (
                <Link
                  id="asset-bento-add-to-group"
                  href={`/msp/clients/${asset.client_id}?tab=assets&view=groups`}
                  className="mt-3 inline-block text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline"
                >
                  {t('assetGroups.actions.addToGroup', { defaultValue: 'Add to group' })}
                </Link>
              ) : null}
            </BentoTile>

            {assetFacts && assetFacts.length > 0 ? (
              <BentoTile
                id="asset-bento-facts"
                title={t('assetBento.reportedFacts', { defaultValue: 'Reported facts' })}
                icon={<Activity className="h-4 w-4" />}
              >
                <div className="space-y-1.5 text-sm">
                  {assetFacts.filter((fact) => fact.is_available).slice(0, 10).map((fact) => (
                    <BentoLabelValue
                      key={fact.asset_fact_id}
                      label={fact.label}
                      value={
                        fact.value_text
                        ?? (fact.value_number != null ? String(fact.value_number) : undefined)
                        ?? (fact.value_bool != null ? String(fact.value_bool) : undefined)
                      }
                    />
                  ))}
                </div>
              </BentoTile>
            ) : null}

            <HuduDocumentationCard asset={asset} />

            {/* Each drawer view gets a tile that says something, rather than a
                bare list of links — previously only Related assets had one. */}
            <BentoTile
              id="asset-bento-service"
              title={t('assetDetailTabs.tabs.serviceHistory', { defaultValue: 'Service history' })}
              icon={<Activity className="h-4 w-4" />}
              action={
                <button id="asset-bento-service-open" type="button" onClick={() => onFocusChange('service-history')} className="text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline">
                  {t('assetBento.viewAll', { defaultValue: 'View all' })}
                </button>
              }
            >
              {linkedTickets?.length ? (
                <BentoRowList>
                  {linkedTickets.slice(0, 3).map((ticket) => (
                    <BentoRow key={ticket.ticket_id} align="center" meta={ticket.status_name}>
                      <span className="truncate text-sm text-[rgb(var(--color-text-700))] min-w-0">{ticket.title}</span>
                    </BentoRow>
                  ))}
                </BentoRowList>
              ) : (
                <BentoTileEmpty id="asset-bento-service-empty">
                  {t('assetBento.noService', { defaultValue: 'No tickets reference this asset.' })}
                </BentoTileEmpty>
              )}
            </BentoTile>

            <BentoTile
              id="asset-bento-maintenance"
              title={t('assetDetailTabs.tabs.maintenance', { defaultValue: 'Maintenance' })}
              icon={<CalendarDays className="h-4 w-4" />}
              action={
                <button id="asset-bento-maintenance-open" type="button" onClick={() => onFocusChange('maintenance')} className="text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline">
                  {t('assetBento.manage', { defaultValue: 'Manage' })}
                </button>
              }
            >
              {maintenanceReport && maintenanceReport.total_schedules > 0 ? (
                <div className="space-y-1.5 text-sm">
                  <BentoLabelValue label={t('assetBento.activeSchedules', { defaultValue: 'Active schedules' })} value={maintenanceReport.active_schedules} />
                  <BentoLabelValue
                    label={t('assetBento.compliance', { defaultValue: 'Compliance' })}
                    value={
                      <span className={BENTO_TONE_TEXT[maintenanceReport.compliance_rate >= 90 ? 'good' : maintenanceReport.compliance_rate >= 70 ? 'warn' : 'bad']}>
                        {Math.round(maintenanceReport.compliance_rate)}%
                      </span>
                    }
                  />
                  <BentoLabelValue label={t('assetBento.lastDone', { defaultValue: 'Last done' })} value={formatAge(maintenanceReport.last_maintenance, now, t) ?? undefined} />
                </div>
              ) : (
                <BentoTileEmpty id="asset-bento-maintenance-empty">
                  {t('assetBento.noMaintenance', { defaultValue: 'Nothing scheduled.' })}
                </BentoTileEmpty>
              )}
            </BentoTile>

            <BentoTile
              id="asset-bento-docs"
              title={t('assetDetailTabs.tabs.documentsPasswords', { defaultValue: 'Documents & passwords' })}
              icon={<Lock className="h-4 w-4" />}
              action={
                <button id="asset-bento-docs-open" type="button" onClick={() => onFocusChange('documents-passwords')} className="text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline">
                  {t('assetBento.open', { defaultValue: 'Open' })}
                </button>
              }
            >
              <BentoTileEmpty id="asset-bento-docs-hint">
                {t('assetBento.docsHint', { defaultValue: 'Attachments and credentials for this asset.' })}
              </BentoTileEmpty>
            </BentoTile>
          </div>
        </div>

        <div className="mt-4">
          <AssetInventoryProvenanceSection assetId={asset.asset_id} />
        </div>

        {/* The footer is pinned outside the scrollable body, which is also what
            keeps the panel from scrolling behind the content pane — two nested
            scrollbars for one drawer. */}
        <Drawer
          id="asset-bento-focus"
          isOpen={Boolean(activeView)}
          onClose={() => onFocusChange(null)}
          width="min(1200px, 88vw)"
          hideCloseButton
          footer={activeView?.footer ?? closeFooter}
        >
          {activeView ? (
            <div className="flex flex-col h-full min-w-0">
              <div className="flex items-center justify-between border-b border-[rgb(var(--color-border-200))] pb-3">
                <h2 className="text-lg font-bold text-[rgb(var(--color-text-900))] truncate">{activeView.label}</h2>
                <button
                  id="asset-bento-focus-close"
                  type="button"
                  onClick={() => onFocusChange(null)}
                  aria-label={t('assetBento.close', { defaultValue: 'Close' })}
                  className="rounded p-1 text-[rgb(var(--color-text-500))] hover:bg-[rgb(var(--color-border-100))]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-1 min-h-0 min-w-0">
                <nav id="asset-bento-focus-rail" aria-label={t('assetBento.views', { defaultValue: 'Asset views' })} className="w-48 shrink-0 overflow-y-auto border-r border-[rgb(var(--color-border-200))] py-3 pr-2">
                  {views.map((view) => {
                    const isActive = view.id === activeView.id;
                    return (
                      <button
                        key={view.id}
                        id={`asset-bento-focus-rail-${view.id}`}
                        type="button"
                        onClick={() => { if (!isActive) onFocusChange(view.id); }}
                        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm min-w-0 ${
                          isActive
                            ? 'bg-[rgb(var(--color-primary-50))] font-semibold text-[rgb(var(--color-primary-800))]'
                            : 'text-[rgb(var(--color-text-600))] hover:bg-[rgb(var(--color-border-100))]'
                        }`}
                      >
                        <view.icon className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate">{view.label}</span>
                      </button>
                    );
                  })}
                </nav>
                <div className="flex-1 overflow-y-auto min-w-0 pl-4 pr-1 pt-4">{activeView.content}</div>
              </div>
            </div>
          ) : null}
        </Drawer>
      </div>
    </ContentCardVariantProvider>
  );
}

export default AssetBentoLayout;
