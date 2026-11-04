'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import CustomTabs from '@alga-psa/ui/components/CustomTabs';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { usePageCreateShortcut, useDialogSubmitShortcut } from '@alga-psa/ui/keyboard-shortcuts';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { toast } from 'react-hot-toast';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { recordPath, type ColumnDefinition, type IRmaCase, type IStockLocation, type IVendor, type RmaType } from '@alga-psa/types';
import { RecordUnavailable } from './RecordUnavailable';
import { RmaWarrantyPanel } from './rma/RmaWarrantyPanel';
import { NewWarrantyClaimDialog } from './rma/NewWarrantyClaimDialog';
import { isAssetTracked } from '../lib/rma/stateMachine';
import {
  getRmaCase,
  listRmaCases,
  openRma,
  openAdvanceRma,
  receiveReturn,
  sendToVendor,
  deadUnitsOwedReport,
  listStockLocations,
  listVendors,
  type DeadUnitOwedRow,
} from '../actions';

const STATUS_VARIANT: Record<string, 'secondary' | 'info' | 'warning' | 'success' | 'error'> = {
  dead_unit_owed: 'warning',
  closed: 'success',
  replaced: 'success',
  credited: 'success',
  repaired: 'success',
  warranty_review: 'warning',
  charged: 'error',
};

const RMA_STATUS_FILTERS = new Set([
  'warranty_review',
  'open',
  'awaiting_return',
  'returned',
  'sent_to_vendor',
  'replacement_received',
  'replacement_deployed',
  'dead_unit_owed',
  'replaced',
  'repaired',
  'credited',
  'charged',
  'closed',
]);

type RmaTab = 'all' | 'review' | 'in_progress' | 'closed';
const TAB_STATUSES: Record<Exclude<RmaTab, 'all'>, ReadonlySet<string>> = {
  review: new Set(['warranty_review']),
  in_progress: new Set([
    'open', 'awaiting_return', 'returned', 'sent_to_vendor', 'replacement_received',
    'replacement_deployed', 'dead_unit_owed', 'replaced', 'repaired', 'credited',
  ]),
  closed: new Set(['closed', 'charged']),
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Tenant locale + currency come from CurrencyFormatProvider via the hook;
// components shadow this with a bound `money` (see below).
const formatMoney = (fmt: (minorUnits: number, currencyOverride?: string) => string) =>
  (cents?: number | string | null, currency?: string | null): string =>
    cents == null ? '—' : fmt(Number(cents), currency || undefined);

interface OpenFormState {
  rma_type: RmaType;
  returned_unit_id: string;
  reason: string;
}

export function RmaManager({
  initialCases,
  initialDeadOwed,
  mirrorRmaToTicket,
  vendorCaseSystems,
  getMirroredVendorCaseSystem,
}: {
  initialCases: IRmaCase[];
  initialDeadOwed: DeadUnitOwedRow[];
  /** Composition-root action (inventory cannot import the ticket package). Enables "Mirror vendor case to ticket". */
  mirrorRmaToTicket?: (rmaId: string, systemKey?: string) => Promise<unknown>;
  /** Tenant custom external systems a vendor case can be mirrored to (`custom:<slug>`); no picker when empty. */
  vendorCaseSystems?: Array<{ key: string; label: string }>;
  /** Composition-root action: the vendor-case system currently mirrored to this RMA's ticket, if any. */
  getMirroredVendorCaseSystem?: (rmaId: string) => Promise<unknown>;
}) {
  const { money: fmtMinorUnits } = useCurrencyFormat();
  const money = formatMoney(fmtMinorUnits);
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const rmaIdParam = searchParams?.get('rmaId') ?? null;
  const { t } = useTranslation('features/inventory');
  const statusParam = searchParams?.get('status') ?? '';
  const statusFilter = RMA_STATUS_FILTERS.has(statusParam) ? statusParam : '';
  const assetIdParam = searchParams?.get('assetId') ?? null;
  const [tab, setTab] = useState<RmaTab>('all');
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimAssetId, setClaimAssetId] = useState<string | null>(null);
  const [cases, setCases] = useState<IRmaCase[]>(initialCases || []);
  const [deadOwed, setDeadOwed] = useState<DeadUnitOwedRow[]>(initialDeadOwed || []);
  const [locations, setLocations] = useState<IStockLocation[]>([]);
  const [vendors, setVendors] = useState<IVendor[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<OpenFormState>({ rma_type: 'standard', returned_unit_id: '', reason: '' });
  const [saving, setSaving] = useState(false);

  const [receiveCase, setReceiveCase] = useState<IRmaCase | null>(null);
  const [receiveLocation, setReceiveLocation] = useState('');
  const [vendorCase, setVendorCase] = useState<IRmaCase | null>(null);
  const [vendorId, setVendorId] = useState('');
  const [vendorRef, setVendorRef] = useState('');
  const [actioning, setActioning] = useState(false);
  const [rmaDetail, setRmaDetail] = useState<IRmaCase | null>(null);
  const [rmaUnavailable, setRmaUnavailable] = useState(false);
  const [mirroredSystem, setMirroredSystem] = useState<string | undefined>(undefined);

  const RMA_TYPE_OPTIONS = [
    { value: 'standard', label: t('rma.types.standard', 'Standard') },
    { value: 'advance_replacement', label: t('rma.types.advanceReplacement', 'Advance replacement') },
  ];

  /** Humanize a snake_case enum for display. */
  const humanize = (s?: string | null): string =>
    s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : t('common.emptyValue', '—');

  // Localized display labels. Logic still keys off the raw enum values (STATUS_VARIANT,
  // status/type checks); only the badge/column text is translated. Unknown values fall
  // back to humanize() so behavior never regresses.
  const RMA_STATUS_LABELS: Record<string, string> = {
    warranty_review: t('rma.status.warrantyReview', 'Warranty review'),
    open: t('rma.status.open', 'Open'),
    awaiting_return: t('rma.status.awaitingReturn', 'Awaiting return'),
    returned: t('rma.status.returned', 'Returned'),
    sent_to_vendor: t('rma.status.sentToVendor', 'Sent to vendor'),
    replacement_received: t('rma.status.replacementReceived', 'Replacement received'),
    replacement_deployed: t('rma.status.replacementDeployed', 'Replacement deployed'),
    dead_unit_owed: t('rma.status.deadUnitOwed', 'Dead unit owed'),
    replaced: t('rma.status.replaced', 'Replaced'),
    repaired: t('rma.status.repaired', 'Repaired'),
    credited: t('rma.status.credited', 'Credited'),
    charged: t('rma.status.charged', 'Charged'),
    closed: t('rma.status.closed', 'Closed'),
  };
  const statusLabel = (v?: string | null): string => (v && RMA_STATUS_LABELS[v]) || humanize(v);
  const RMA_TYPE_LABELS: Record<string, string> = {
    standard: t('rma.types.standard', 'Standard'),
    advance_replacement: t('rma.types.advanceReplacement', 'Advance replacement'),
  };
  const typeLabel = (v?: string | null): string => (v && RMA_TYPE_LABELS[v]) || humanize(v);

  // The detail dialog is driven by `?rmaId=` so a scanned RMA label lands on a linkable view.
  const closeRmaDialog = useCallback(() => {
    setRmaDetail(null);
    setRmaUnavailable(false);
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    next.delete('rmaId');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!rmaIdParam) {
      setRmaDetail(null);
      setRmaUnavailable(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = UUID_RE.test(rmaIdParam) ? await getRmaCase(rmaIdParam) : null;
        if (cancelled) return;
        // Missing, cross-tenant and permission-denied are deliberately one state.
        if (!result || isActionMessageError(result) || isActionPermissionError(result)) {
          setRmaDetail(null);
          setRmaUnavailable(true);
          return;
        }
        setRmaUnavailable(false);
        setRmaDetail(result);
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        setRmaDetail(null);
        setRmaUnavailable(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rmaIdParam]);

  // Which vendor-case system is already mirrored to this RMA's ticket, so the picker reopens on it
  // instead of resetting to generic. Keyed on the id, not the whole object: a transition replaces
  // `rmaDetail` (onChanged below) without changing which link is mirrored.
  const rmaDetailId = rmaDetail?.rma_id ?? null;
  useEffect(() => {
    if (!rmaDetailId || !getMirroredVendorCaseSystem) {
      setMirroredSystem(undefined);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await getMirroredVendorCaseSystem(rmaDetailId);
        if (cancelled) return;
        setMirroredSystem(typeof result === 'string' ? result : undefined);
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        setMirroredSystem(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rmaDetailId, getMirroredVendorCaseSystem]);

  // `?assetId=` (from the asset's Warranty card) opens the claim dialog prefilled.
  useEffect(() => {
    if (assetIdParam && UUID_RE.test(assetIdParam)) {
      setClaimAssetId(assetIdParam);
      setClaimOpen(true);
    }
  }, [assetIdParam]);

  const closeClaimDialog = useCallback(() => {
    setClaimOpen(false);
    setClaimAssetId(null);
    if (searchParams?.get('assetId')) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete('assetId');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    }
  }, [pathname, router, searchParams]);

  const reload = useCallback(async () => {
    try {
      const [list, owed] = await Promise.all([listRmaCases({}), deadUnitsOwedReport()]);
      if (isActionMessageError(list) || isActionPermissionError(list)) {
        setCases([]);
        toast.error(getErrorMessage(list));
        return;
      }
      if (isActionMessageError(owed) || isActionPermissionError(owed)) {
        setDeadOwed([]);
        toast.error(getErrorMessage(owed));
        return;
      }
      setCases(list);
      setDeadOwed(owed);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || t('rma.loadCasesFailed', "Couldn't load RMA cases."));
    }
  }, [t]);

  useEffect(() => {
    (async () => {
      try {
        const [locs, vens] = await Promise.all([
          listStockLocations({ includeInactive: false }),
          listVendors({ includeInactive: false }),
        ]);
        if (isActionMessageError(locs) || isActionPermissionError(locs)) {
          setLocations([]);
          toast.error(getErrorMessage(locs));
          return;
        }
        if (isActionMessageError(vens) || isActionPermissionError(vens)) {
          setVendors([]);
          toast.error(getErrorMessage(vens));
          return;
        }
        setLocations(locs);
        setVendors(vens);
      } catch (e: any) {
        console.error(e);
        toast.error(e?.message || t('rma.loadLocationsVendorsFailed', "Couldn't load locations and vendors."));
      }
    })();
  }, [t]);

  const openCreate = () => {
    setForm({ rma_type: 'standard', returned_unit_id: '', reason: '' });
    setDialogOpen(true);
  };
  usePageCreateShortcut(openCreate);

  const save = async () => {
    if (!form.returned_unit_id.trim()) {
      toast.error(t('rma.returnedUnitRequired', 'Returned unit ID is required.'));
      return;
    }
    setSaving(true);
    try {
      const payload = { returned_unit_id: form.returned_unit_id.trim(), reason: form.reason.trim() || null };
      const result = form.rma_type === 'advance_replacement'
        ? await openAdvanceRma(payload)
        : await openRma(payload);
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('rma.caseOpened', 'RMA case opened.'));
      setDialogOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('rma.openFailed', "Couldn't open RMA."));
    } finally {
      setSaving(false);
    }
  };
  useDialogSubmitShortcut(
    () => { void save(); },
    { active: dialogOpen, enabled: dialogOpen && !saving },
  );

  const saveReceiveReturn = async () => {
    if (!receiveCase || !receiveLocation) {
      toast.error(t('rma.pickLocation', 'Pick a location.'));
      return;
    }
    setActioning(true);
    try {
      const result = await receiveReturn(receiveCase.rma_id, { location_id: receiveLocation });
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('rma.returnReceived', 'Return received.'));
      setReceiveCase(null);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('rma.receiveFailed', "Couldn't receive the return."));
    } finally {
      setActioning(false);
    }
  };
  useDialogSubmitShortcut(
    () => { void saveReceiveReturn(); },
    { active: receiveCase !== null, enabled: receiveCase !== null && !actioning },
  );

  const saveSendToVendor = async () => {
    if (!vendorCase || !vendorId) {
      toast.error(t('rma.pickVendor', 'Pick a vendor.'));
      return;
    }
    setActioning(true);
    try {
      const result = await sendToVendor(vendorCase.rma_id, { vendor_id: vendorId, rma_reference: vendorRef.trim() || null });
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('rma.sentToVendor', 'Sent to vendor.'));
      setVendorCase(null);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('rma.sendVendorFailed', "Couldn't send to vendor."));
    } finally {
      setActioning(false);
    }
  };
  useDialogSubmitShortcut(
    () => { void saveSendToVendor(); },
    { active: vendorCase !== null, enabled: vendorCase !== null && !actioning },
  );

  const openReceiveReturn = (rma: IRmaCase) => {
    setReceiveCase(rma);
    setReceiveLocation(locations.find((l) => l.is_default)?.location_id ?? '');
  };
  const openSendToVendor = (rma: IRmaCase) => {
    setVendorCase(rma);
    setVendorId('');
    setVendorRef('');
  };

  const unitLabel = (rma: IRmaCase): string => {
    if (isAssetTracked(rma) && (rma.asset_name || rma.asset_serial_number)) {
      return [rma.asset_name, rma.asset_serial_number ? `SN ${rma.asset_serial_number}` : null].filter(Boolean).join(' · ');
    }
    const product = rma.service_name || rma.service_sku || '';
    const serial = rma.returned_serial_number ? `SN ${rma.returned_serial_number}` : '';
    const mac = !serial && rma.returned_mac_address ? rma.returned_mac_address : '';
    const identifier = serial || mac || t('common.emptyValue', '—');
    return product ? `${product} · ${identifier}` : identifier;
  };

  const visibleCases = React.useMemo(
    () => cases.filter((rma) =>
      (!statusFilter || rma.status === statusFilter) &&
      (tab === 'all' || TAB_STATUSES[tab].has(rma.status))),
    [cases, statusFilter, tab],
  );

  const openRmaDetail = (rmaId: string) => {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    next.set('rmaId', rmaId);
    router.push(`${pathname}?${next.toString()}`);
  };

  const mirrorToTicket = async (rma: IRmaCase, systemKey?: string) => {
    if (!mirrorRmaToTicket) return;
    try {
      const result = await mirrorRmaToTicket(rma.rma_id, systemKey);
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('rma.warranty.mirrored', 'Vendor case added to the ticket.'));
    } catch (e: any) {
      toast.error(e?.message || t('rma.warranty.mirrorFailed', "Couldn't add the vendor case to the ticket."));
    }
  };

  const clearStatusFilter = () => {
    router.push('/msp/inventory/rma');
  };

  const caseColumns: ColumnDefinition<IRmaCase>[] = [
    {
      title: t('rma.columns.rmaNumber', 'RMA #'),
      dataIndex: 'rma_reference',
      render: (_: any, rec: IRmaCase) => rec.rma_number || rec.rma_reference || t('common.emptyValue', '—'),
    },
    { title: t('rma.columns.type', 'Type'), dataIndex: 'rma_type', render: (v: any) => typeLabel(v) },
    {
      title: t('common.status', 'Status'),
      dataIndex: 'status',
      render: (v: any) => <Badge variant={STATUS_VARIANT[v] ?? 'secondary'} size="sm">{statusLabel(v)}</Badge>,
    },
    { title: t('rma.columns.vendor', 'Vendor'), dataIndex: 'vendor_name', render: (_: any, rec: IRmaCase) => rec.vendor_name || t('common.emptyValue', '—') },
    { title: t('rma.columns.returnedUnit', 'Returned unit'), dataIndex: 'returned_unit_id', render: (_: any, rec: IRmaCase) => unitLabel(rec) },
    { title: t('rma.columns.client', 'Client'), dataIndex: 'client_name', render: (_: any, rec: IRmaCase) => rec.client_name || t('common.emptyValue', '—') },
    { title: t('rma.columns.ticket', 'Ticket'), dataIndex: 'ticket_number', render: (_: any, rec: IRmaCase) => rec.ticket_number || t('common.emptyValue', '—') },
    {
      title: t('rma.columns.returnBy', 'Return by'),
      dataIndex: 'return_by',
      render: (_: any, rec: IRmaCase) => {
        if (!rec.return_by) return t('common.emptyValue', '—');
        const [y, m, d] = rec.return_by.split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString();
      },
    },
    {
      title: t('rma.columns.creditAtStake', 'Credit at stake'),
      dataIndex: 'returned_unit_cost',
      headerClassName: 'text-right',
      cellClassName: 'text-right tabular-nums',
      render: (_: any, rec: IRmaCase) =>
        (
          <div className="space-y-0.5">
            <div className="font-medium text-gray-900">
              {money(rec.returned_unit_cost, rec.returned_unit_cost_currency)}
            </div>
            {rec.status === 'sent_to_vendor' && rec.age_days != null && (
              <div className="text-xs text-gray-500">
                {t('rma.ageAtVendor', '{{days}}d at vendor', { days: rec.age_days })}
              </div>
            )}
          </div>
        ),
    },
    {
      title: t('common.actions', 'Actions'),
      dataIndex: 'rma_id',
      width: '230px',
      render: (_: any, rec: IRmaCase) => isAssetTracked(rec) ? (
        <div className="flex gap-2">
          <Button
            id={`rma-open-detail-${rec.rma_id}`}
            variant="outline"
            size="sm"
            onClick={() => openRmaDetail(rec.rma_id)}
          >
            {t('rma.warranty.openDetail', 'Open')}
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            id={`receive-return-${rec.rma_id}`}
            variant="outline"
            size="sm"
            disabled={rec.status !== 'awaiting_return'}
            onClick={() => openReceiveReturn(rec)}
          >
            {t('rma.receiveReturn', 'Receive return')}
          </Button>
          <Button
            id={`send-to-vendor-${rec.rma_id}`}
            variant="ghost"
            size="sm"
            disabled={rec.status !== 'returned'}
            onClick={() => openSendToVendor(rec)}
          >
            {t('rma.sendToVendor', 'Send to vendor')}
          </Button>
        </div>
      ),
    },
  ];

  const deadColumns: ColumnDefinition<DeadUnitOwedRow>[] = [
    {
      title: t('rma.columns.rmaNumber', 'RMA #'),
      dataIndex: 'rma_reference',
      render: (_: any, rec: DeadUnitOwedRow) => rec.rma_number || rec.rma_reference || t('common.emptyValue', '—'),
    },
    { title: t('rma.columns.returnedUnit', 'Returned unit'), dataIndex: 'returned_unit_id', render: (_: any, rec: DeadUnitOwedRow) => unitLabel(rec) },
    { title: t('rma.columns.client', 'Client'), dataIndex: 'client_name', render: (_: any, rec: DeadUnitOwedRow) => rec.client_name || t('common.emptyValue', '—') },
    { title: t('rma.columns.vendor', 'Vendor'), dataIndex: 'vendor_name', render: (_: any, rec: DeadUnitOwedRow) => rec.vendor_name || t('common.emptyValue', '—') },
    {
      title: t('rma.columns.creditAtStake', 'Credit at stake'),
      dataIndex: 'returned_unit_cost',
      headerClassName: 'text-right',
      cellClassName: 'text-right tabular-nums',
      render: (_: any, rec: DeadUnitOwedRow) => money(rec.returned_unit_cost, rec.returned_unit_cost_currency),
    },
    {
      title: t('rma.columns.dueDate', 'Due date'),
      dataIndex: 'dead_unit_due_date',
      render: (v: any) => (v ? new Date(v).toLocaleDateString() : t('common.emptyValue', '—')),
    },
    {
      title: t('rma.columns.daysRemaining', 'Days remaining'),
      dataIndex: 'days_remaining',
      headerClassName: 'text-right',
      cellClassName: 'text-right tabular-nums',
      render: (v: any) => (v === null || v === undefined ? t('common.emptyValue', '—') : v),
    },
  ];

  return (
    <div className="p-6 space-y-4" id="rma-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('rma.title', 'RMA')}</h1>
        <div className="flex gap-2">
          <Button id="rma-new-warranty-claim-button" variant="outline" onClick={() => { setClaimAssetId(null); setClaimOpen(true); }}>
            {t('rma.warranty.claim.title', 'New warranty claim')}
          </Button>
          <Button id="rma-add-button" onClick={openCreate}>
            {t('rma.openRma', 'Open RMA')}
          </Button>
        </div>
      </div>

      <CustomTabs
        idPrefix="rma-tabs"
        value={tab}
        onTabChange={(v: string) => setTab(v as RmaTab)}
        tabs={[
          { id: 'all', label: t('rma.tabs.all', 'All'), content: null },
          { id: 'review', label: t('rma.tabs.review', 'Warranty review'), content: null },
          { id: 'in_progress', label: t('rma.tabs.inProgress', 'In progress'), content: null },
          { id: 'closed', label: t('rma.tabs.closed', 'Closed'), content: null },
        ]}
      />

      {statusFilter && (
        <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <span className="text-sm text-amber-900">
            {t('rma.filters.statusActive', 'Showing {{status}} RMA cases.', { status: statusLabel(statusFilter) })}
          </span>
          <Button id="rma-clear-status-filter" variant="link" size="sm" onClick={clearStatusFilter}>
            {t('common.clear', 'Clear')}
          </Button>
        </div>
      )}

      <DataTable id="rma-cases-table" data={visibleCases} columns={caseColumns} />

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">{t('rma.deadUnitsOwed', 'Dead units owed')}</h2>
        <DataTable id="rma-dead-owed-table" data={deadOwed} columns={deadColumns} />
      </div>

      <Dialog isOpen={dialogOpen} onClose={() => setDialogOpen(false)} title={t('rma.openRma', 'Open RMA')} id="rma-open-dialog">
        <div className="space-y-4 p-1">
          <CustomSelect
            id="rma-type"
            label={t('rma.fields.rmaType', 'RMA type')}
            value={form.rma_type}
            options={RMA_TYPE_OPTIONS}
            onValueChange={(v: string) => setForm({ ...form, rma_type: v as RmaType })}
          />
          <Input
            id="rma-returned-unit-id"
            label={t('rma.fields.returnedUnitId', 'Returned unit ID')}
            required
            value={form.returned_unit_id}
            onChange={(e) => setForm({ ...form, returned_unit_id: e.target.value })}
          />
          <Input
            id="rma-reason"
            label={t('rma.fields.reason', 'Reason')}
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button id="rma-cancel" variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="rma-save" onClick={save} disabled={saving}>
              {saving ? t('common.saving', 'Saving…') : t('rma.openRma', 'Open RMA')}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        isOpen={receiveCase !== null}
        onClose={() => setReceiveCase(null)}
        title={t('rma.receiveReturn', 'Receive return')}
        id="rma-receive-dialog"
      >
        <div className="space-y-4 p-1">
          <CustomSelect
            id="rma-receive-location"
            label={t('rma.fields.location', 'Location')}
            required
            value={receiveLocation}
            placeholder={t('rma.fields.locationPlaceholder', 'Select a location…')}
            options={locations.map((l) => ({ value: l.location_id, label: l.name }))}
            onValueChange={(v: string) => setReceiveLocation(v)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button id="rma-receive-cancel" variant="outline" onClick={() => setReceiveCase(null)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="rma-receive-save" onClick={saveReceiveReturn} disabled={actioning}>
              {actioning ? t('rma.receiving', 'Receiving…') : t('rma.receiveReturn', 'Receive return')}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        isOpen={vendorCase !== null}
        onClose={() => setVendorCase(null)}
        title={t('rma.sendToVendor', 'Send to vendor')}
        id="rma-vendor-dialog"
      >
        <div className="space-y-4 p-1">
          <CustomSelect
            id="rma-vendor"
            label={t('rma.fields.vendor', 'Vendor')}
            required
            value={vendorId}
            placeholder={t('rma.fields.vendorPlaceholder', 'Select a vendor…')}
            options={vendors.map((v) => ({ value: v.vendor_id, label: v.vendor_name }))}
            onValueChange={(v: string) => setVendorId(v)}
          />
          <Input
            id="rma-vendor-ref"
            label={t('rma.fields.vendorRef', 'Vendor RMA reference')}
            value={vendorRef}
            onChange={(e) => setVendorRef(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button id="rma-vendor-cancel" variant="outline" onClick={() => setVendorCase(null)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="rma-vendor-save" onClick={saveSendToVendor} disabled={actioning}>
              {actioning ? t('rma.sending', 'Sending…') : t('rma.sendToVendor', 'Send to vendor')}
            </Button>
          </div>
        </div>
      </Dialog>

      <NewWarrantyClaimDialog
        isOpen={claimOpen}
        onClose={closeClaimDialog}
        vendors={vendors}
        initialAssetId={claimAssetId}
        onCreated={async (created) => {
          closeClaimDialog();
          await reload();
          openRmaDetail(created.rma_id);
        }}
      />

      <Dialog
        id="rma-detail-dialog"
        isOpen={rmaDetail !== null || rmaUnavailable}
        onClose={closeRmaDialog}
        title={t('rma.detail.title', 'RMA {{id}}', { id: rmaDetail ? rmaDetail.rma_number || rmaDetail.rma_reference || '' : '' }).trim()}
        className="max-w-3xl"
      >
        {rmaUnavailable && <RecordUnavailable id="rma-dialog-unavailable" />}
        {!rmaUnavailable && rmaDetail && isAssetTracked(rmaDetail) && (
          <div className="space-y-4 p-1">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <div className="text-xs text-gray-500">{t('rma.columns.type', 'Type')}</div>
                <div>{typeLabel(rmaDetail.rma_type)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('common.status', 'Status')}</div>
                <Badge variant={STATUS_VARIANT[rmaDetail.status] ?? 'secondary'} size="sm">{statusLabel(rmaDetail.status)}</Badge>
              </div>
            </div>
            {rmaDetail.reason && (
              <div className="text-sm">
                <div className="text-xs text-gray-500">{t('rma.detail.reason', 'Reason')}</div>
                <div>{rmaDetail.reason}</div>
              </div>
            )}
            <RmaWarrantyPanel
              rma={rmaDetail}
              vendors={vendors}
              locations={locations}
              onMirrorToTicket={mirrorRmaToTicket ? mirrorToTicket : undefined}
              vendorCaseSystems={vendorCaseSystems}
              selectedVendorCaseSystem={mirroredSystem}
              onChanged={async (updated) => {
                setRmaDetail(updated);
                await reload();
              }}
            />
          </div>
        )}
        {!rmaUnavailable && rmaDetail && !isAssetTracked(rmaDetail) && (
          <div className="space-y-4 p-1">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              {([
                [t('rma.columns.type', 'Type'), typeLabel(rmaDetail.rma_type)],
                [t('common.status', 'Status'), statusLabel(rmaDetail.status)],
                [t('rma.columns.client', 'Client'), rmaDetail.client_name || t('common.emptyValue', '—')],
                [t('rma.columns.vendor', 'Vendor'), rmaDetail.vendor_name || t('common.emptyValue', '—')],
                [t('rma.detail.reference', 'RMA reference'), rmaDetail.rma_reference || t('common.emptyValue', '—')],
                [t('rma.detail.product', 'Product'), rmaDetail.service_name || t('common.emptyValue', '—')],
                [t('rma.detail.returnedSerial', 'Returned unit serial'), rmaDetail.returned_serial_number || t('common.emptyValue', '—')],
                [t('rma.detail.opened', 'Opened'), rmaDetail.opened_at ? new Date(rmaDetail.opened_at).toLocaleDateString() : t('common.emptyValue', '—')],
                [t('rma.detail.updated', 'Updated'), rmaDetail.updated_at ? new Date(rmaDetail.updated_at).toLocaleDateString() : t('common.emptyValue', '—')],
                ...(rmaDetail.age_days != null ? [[t('rma.detail.age', 'Age (days)'), String(rmaDetail.age_days)]] : []),
              ] as Array<[string, string]>).map(([label, value]) => (
                <div key={label}>
                  <div className="text-xs text-gray-500">{label}</div>
                  <div>{value}</div>
                </div>
              ))}
            </div>
            {rmaDetail.reason && (
              <div className="text-sm">
                <div className="text-xs text-gray-500">{t('rma.detail.reason', 'Reason')}</div>
                <div>{rmaDetail.reason}</div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {rmaDetail.returned_unit_id && (
                <Button id="rma-detail-view-unit" variant="outline" size="sm" onClick={() => router.push(recordPath('stock_unit', rmaDetail.returned_unit_id as string))}>
                  {t('rma.detail.viewUnit', 'View unit')}
                </Button>
              )}
              {rmaDetail.asset_id && (
                <Button id="rma-detail-view-asset" variant="outline" size="sm" onClick={() => router.push(recordPath('asset', rmaDetail.asset_id as string))}>
                  {t('rma.detail.viewAsset', 'View asset')}
                </Button>
              )}
              {rmaDetail.status === 'awaiting_return' && (
                <Button id="rma-detail-receive-return" size="sm" onClick={() => { const c = rmaDetail; closeRmaDialog(); openReceiveReturn(c); }}>
                  {t('rma.receiveReturn', 'Receive return')}
                </Button>
              )}
              {rmaDetail.status === 'returned' && (
                <Button id="rma-detail-send-to-vendor" size="sm" onClick={() => { const c = rmaDetail; closeRmaDialog(); openSendToVendor(c); }}>
                  {t('rma.sendToVendor', 'Send to vendor')}
                </Button>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
