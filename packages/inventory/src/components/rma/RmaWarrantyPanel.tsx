'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useLabelPrint } from '@alga-psa/ui/components/labels/useLabelPrint';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { recordPath, type IRmaCase, type IStockLocation, type IVendor, type LabelClass } from '@alga-psa/types';
import {
  approveWarrantyClaim,
  cancelWarrantyClaim,
  closeWarrantyRma,
  denyWarrantyClaim,
  listRmaCaseEvents,
  markDeviceReceived,
  receiveVendorReplacement,
  recordVendorCredit,
  recordVendorRepair,
  returnDeviceToClient,
  shipToVendor,
  type IRmaEventView,
} from '../../actions';
import { allowedWarrantyActions, type WarrantyAction } from '../../lib/rma/stateMachine';

const RMA_TAG_CLASS: LabelClass = 'rma-work-tag';

/** Calendar-date helpers: the server wants YYYY-MM-DD, the DatePicker wants a local Date. */
export const toYmd = (d?: Date): string =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
export const fromYmd = (s?: string | null): Date | undefined => {
  if (!s) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : undefined;
};

interface ActionForm {
  vendor_id: string;
  rma_reference: string;
  return_by: string;
  return_ship_to: string;
  reason: string;
  carrier: string;
  tracking_number: string;
  replacement_serial_number: string;
  model: string;
  manufacturer: string;
  warranty_end_date: string;
  inbound_carrier: string;
  inbound_tracking_number: string;
  location_id: string;
  counterparty: string;
  note: string;
}

const emptyForm = (rma: IRmaCase, locations: IStockLocation[]): ActionForm => ({
  vendor_id: rma.vendor_id ?? '',
  rma_reference: rma.rma_reference ?? '',
  return_by: rma.return_by ?? '',
  return_ship_to: rma.return_ship_to ?? rma.vendor_name ?? '',
  reason: '',
  carrier: '',
  tracking_number: '',
  replacement_serial_number: '',
  model: '',
  manufacturer: '',
  warranty_end_date: '',
  inbound_carrier: '',
  inbound_tracking_number: '',
  location_id: locations.find((l) => l.is_default)?.location_id ?? '',
  counterparty: '',
  note: '',
});

export interface RmaWarrantyPanelProps {
  rma: IRmaCase;
  vendors: IVendor[];
  locations: IStockLocation[];
  /** Called with the reloaded case after any transition. */
  onChanged: (rma: IRmaCase) => void | Promise<void>;
  /** Supplied by the composition root (inventory cannot import the ticket package). Hidden when absent. */
  onMirrorToTicket?: (rma: IRmaCase, systemKey?: string) => Promise<void>;
  /** Tenant custom external systems (`custom:<slug>`) the vendor case can be mirrored to. No picker when absent or empty. */
  vendorCaseSystems?: Array<{ key: string; label: string }>;
  /** Initially selected `custom:<slug>`; empty/absent means the generic link. */
  selectedVendorCaseSystem?: string;
}

export function RmaWarrantyPanel({ rma, vendors, locations, onChanged, onMirrorToTicket, vendorCaseSystems, selectedVendorCaseSystem }: RmaWarrantyPanelProps) {
  const { t } = useTranslation('features/inventory');
  const { print, isPrinting } = useLabelPrint();
  const dash = t('common.emptyValue', '—');
  const [events, setEvents] = useState<IRmaEventView[]>([]);
  const [action, setAction] = useState<WarrantyAction | null>(null);
  const [form, setForm] = useState<ActionForm>(() => emptyForm(rma, locations));
  const [busy, setBusy] = useState(false);
  const [mirroring, setMirroring] = useState(false);
  const [systemKey, setSystemKey] = useState<string>(selectedVendorCaseSystem ?? '');

  // `selectedVendorCaseSystem` arrives asynchronously (the composition root looks up the ticket's
  // existing link after this panel mounts), so the initial useState value above is rarely enough:
  // sync whenever the caller resolves it for *this* case, without stomping a choice the user already
  // made in this session.
  const rmaId = rma.rma_id;
  useEffect(() => {
    setSystemKey(selectedVendorCaseSystem ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sync on a new case, not on every keystroke in the picker
  }, [rmaId, selectedVendorCaseSystem]);

  const loadEvents = useCallback(async () => {
    try {
      const result = await listRmaCaseEvents(rma.rma_id);
      setEvents(isActionMessageError(result) || isActionPermissionError(result) ? [] : result);
    } catch (e) {
      console.error(e);
      setEvents([]);
    }
  }, [rma.rma_id, rma.status]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const ACTION_LABELS: Record<WarrantyAction, string> = {
    approve_standard: t('rma.warranty.actions.approveStandard', 'Approve (standard)'),
    approve_advance: t('rma.warranty.actions.approveAdvance', 'Approve (advance replacement)'),
    deny: t('rma.warranty.actions.deny', 'Deny claim'),
    cancel: t('rma.warranty.actions.cancel', 'Cancel claim'),
    mark_device_received: t('rma.warranty.actions.markDeviceReceived', 'Mark device received'),
    ship_to_vendor: t('rma.warranty.actions.shipToVendor', 'Ship to vendor'),
    receive_replacement: t('rma.warranty.actions.receiveReplacement', 'Receive replacement'),
    record_repair: t('rma.warranty.actions.recordRepair', 'Record repair'),
    record_credit: t('rma.warranty.actions.recordCredit', 'Record vendor credit'),
    return_to_client: t('rma.warranty.actions.returnToClient', 'Return to client'),
    close: t('rma.warranty.actions.close', 'Close RMA'),
  };

  const EVENT_LABELS: Record<string, string> = {
    opened: t('rma.warranty.events.opened', 'Claim opened'),
    warranty_approved: t('rma.warranty.events.warrantyApproved', 'Warranty approved'),
    warranty_denied: t('rma.warranty.events.warrantyDenied', 'Warranty denied'),
    device_received: t('rma.warranty.events.deviceReceived', 'Device received'),
    shipped_outbound: t('rma.warranty.events.shippedOutbound', 'Shipped to vendor'),
    vendor_case_recorded: t('rma.warranty.events.vendorCaseRecorded', 'Vendor case recorded'),
    replacement_received: t('rma.warranty.events.replacementReceived', 'Replacement received'),
    repair_received: t('rma.warranty.events.repairReceived', 'Repair received'),
    vendor_credited: t('rma.warranty.events.vendorCredited', 'Vendor credited'),
    returned_to_client: t('rma.warranty.events.returnedToClient', 'Returned to client'),
    closed: t('rma.warranty.events.closed', 'Closed'),
    note: t('rma.warranty.events.note', 'Note'),
  };

  const OUTCOME_LABELS: Record<string, string> = {
    covered: t('rma.warranty.outcome.covered', 'Covered'),
    not_covered: t('rma.warranty.outcome.notCovered', 'Not covered'),
    unknown: t('rma.warranty.outcome.unknown', 'Unknown'),
  };

  const CLOSE_REASON_LABELS: Record<string, string> = {
    resolved: t('rma.warranty.closeReason.resolved', 'Resolved'),
    warranty_denied: t('rma.warranty.closeReason.warrantyDenied', 'Warranty denied'),
    cancelled: t('rma.warranty.closeReason.cancelled', 'Cancelled'),
    duplicate: t('rma.warranty.closeReason.duplicate', 'Duplicate'),
    vendor_credited: t('rma.warranty.closeReason.vendorCredited', 'Vendor credited'),
  };

  const allowed = useMemo(() => allowedWarrantyActions(rma.status), [rma.status]);
  const fmtDate = (v?: string | Date | null): string => {
    if (!v) return dash;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fromYmd(v)!.toLocaleDateString();
    return new Date(v).toLocaleDateString();
  };
  const shipping = (carrier?: string | null, tracking?: string | null): string =>
    [carrier, tracking].filter(Boolean).join(' · ') || dash;

  const set = <K extends keyof ActionForm>(key: K, value: ActionForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const openAction = (a: WarrantyAction) => {
    setForm(emptyForm(rma, locations));
    if (a === 'cancel') setForm((f) => ({ ...f, reason: 'cancelled' }));
    if (a === 'close') setForm((f) => ({ ...f, reason: rma.status === 'credited' ? 'vendor_credited' : 'resolved' }));
    setAction(a);
  };

  const submit = async () => {
    if (!action) return;
    const note = form.note.trim() || null;
    const inbound = {
      inbound_carrier: form.inbound_carrier.trim() || null,
      inbound_tracking_number: form.inbound_tracking_number.trim() || null,
      location_id: form.location_id || null,
    };
    setBusy(true);
    try {
      let result;
      const id = rma.rma_id;
      switch (action) {
        case 'approve_standard':
        case 'approve_advance':
          if (!form.vendor_id) {
            toast.error(t('rma.pickVendor', 'Pick a vendor.'));
            return;
          }
          result = await approveWarrantyClaim(id, {
            track: action === 'approve_advance' ? 'advance_replacement' : 'standard',
            vendor_id: form.vendor_id,
            rma_reference: form.rma_reference,
            return_by: form.return_by || null,
            return_ship_to: form.return_ship_to,
            note,
          });
          break;
        case 'deny':
          result = await denyWarrantyClaim(id, { denial_reason: form.reason, note });
          break;
        case 'cancel':
          result = await cancelWarrantyClaim(id, { reason: form.reason || 'cancelled', note });
          break;
        case 'mark_device_received':
          result = await markDeviceReceived(id, { note });
          break;
        case 'ship_to_vendor':
          result = await shipToVendor(id, {
            vendor_id: form.vendor_id || null,
            carrier: form.carrier,
            tracking_number: form.tracking_number,
            return_by: form.return_by,
            rma_reference: form.rma_reference,
            return_ship_to: form.return_ship_to,
            note,
          });
          break;
        case 'receive_replacement':
          result = await receiveVendorReplacement(id, {
            replacement_serial_number: form.replacement_serial_number,
            model: form.model,
            manufacturer: form.manufacturer,
            warranty_end_date: form.warranty_end_date || null,
            ...inbound,
            note,
          });
          break;
        case 'record_repair':
          result = await recordVendorRepair(id, { ...inbound, note });
          break;
        case 'record_credit':
          result = await recordVendorCredit(id, { note });
          break;
        case 'return_to_client':
          result = await returnDeviceToClient(id, { counterparty: form.counterparty, note });
          break;
        case 'close':
          result = await closeWarrantyRma(id, { reason: (form.reason || undefined) as any, note });
          break;
      }
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('rma.warranty.updated', 'RMA updated.'));
      setAction(null);
      await onChanged(result as IRmaCase);
    } catch (e: any) {
      // Refusals (including invalid input) come back as values above; this catches unexpected failures only.
      toast.error(e?.message || t('rma.warranty.updateFailed', "Couldn't update the RMA."));
    } finally {
      setBusy(false);
    }
  };

  const printTag = async () => {
    const outcome = await print({ labelClass: RMA_TAG_CLASS, labels: [{ recordId: rma.rma_id }] });
    if (outcome.status === 'failed') {
      toast.error(outcome.message || t('rma.warranty.printTagFailed', "Couldn't print the RMA tag."));
    } else if (outcome.popupBlocked) {
      toast.error(t('rma.warranty.popupBlocked', 'Allow pop-ups to see the label.'));
    }
  };

  const mirror = async () => {
    if (!onMirrorToTicket) return;
    setMirroring(true);
    try {
      await onMirrorToTicket(rma, systemKey || undefined);
    } finally {
      setMirroring(false);
    }
  };

  const assetLabel = [rma.asset_name, rma.asset_serial_number ? `SN ${rma.asset_serial_number}` : null].filter(Boolean).join(' · ');
  const vendorOptions = vendors.map((v) => ({ value: v.vendor_id, label: v.vendor_name }));
  const locationOptions = locations.map((l) => ({ value: l.location_id, label: l.name }));

  const rows: Array<[string, React.ReactNode]> = [
    [t('rma.warranty.fields.outcome', 'Warranty decision'), rma.warranty_outcome ? OUTCOME_LABELS[rma.warranty_outcome] ?? rma.warranty_outcome : dash],
    [t('rma.warranty.fields.decidedAt', 'Decided'), fmtDate(rma.warranty_decided_at)],
    ...(rma.denial_reason ? [[t('rma.warranty.fields.denialReason', 'Denial reason'), rma.denial_reason] as [string, React.ReactNode]] : []),
    [t('rma.columns.vendor', 'Vendor'), rma.vendor_name || dash],
    [t('rma.warranty.fields.vendorRef', 'Vendor RMA reference'), rma.rma_reference || dash],
    [t('rma.warranty.fields.returnBy', 'Return by'), fmtDate(rma.return_by)],
    [t('rma.warranty.fields.outbound', 'Outbound shipment'), shipping(rma.outbound_carrier, rma.outbound_tracking_number)],
    [t('rma.warranty.fields.inbound', 'Inbound shipment'), shipping(rma.inbound_carrier, rma.inbound_tracking_number)],
    [t('rma.warranty.fields.replacementSerial', 'Replacement serial'), rma.replacement_serial_number || dash],
    [t('rma.warranty.fields.returnShipTo', 'Return ship-to'), rma.return_ship_to ? <span className="whitespace-pre-line">{rma.return_ship_to}</span> : dash],
    [t('rma.columns.client', 'Client'), rma.client_name || dash],
    [t('rma.warranty.fields.closedReason', 'Closed reason'), rma.closed_reason ? CLOSE_REASON_LABELS[rma.closed_reason] ?? rma.closed_reason : dash],
  ];

  const dateField = (id: string, label: string, key: 'return_by' | 'warranty_end_date', required = false) => (
    <DatePicker
      id={id}
      label={label}
      required={required}
      clearable
      value={fromYmd(form[key])}
      onChange={(d: Date | undefined) => set(key, toYmd(d))}
    />
  );

  const vendorField = (required: boolean) => (
    <CustomSelect
      id="rma-warranty-vendor"
      label={t('rma.fields.vendor', 'Vendor')}
      required={required}
      value={form.vendor_id}
      placeholder={t('rma.fields.vendorPlaceholder', 'Select a vendor…')}
      options={vendorOptions}
      onValueChange={(v: string) => set('vendor_id', v)}
    />
  );
  const locationField = (
    <CustomSelect
      id="rma-warranty-location"
      label={t('rma.fields.location', 'Location')}
      value={form.location_id}
      placeholder={t('rma.fields.locationPlaceholder', 'Select a location…')}
      options={locationOptions}
      onValueChange={(v: string) => set('location_id', v)}
    />
  );
  const inboundFields = (
    <>
      <Input id="rma-warranty-inbound-carrier" label={t('rma.warranty.fields.inboundCarrier', 'Inbound carrier')} value={form.inbound_carrier} onChange={(e) => set('inbound_carrier', e.target.value)} />
      <Input id="rma-warranty-inbound-tracking" label={t('rma.warranty.fields.inboundTracking', 'Inbound tracking number')} value={form.inbound_tracking_number} onChange={(e) => set('inbound_tracking_number', e.target.value)} />
    </>
  );

  const renderFields = (a: WarrantyAction): React.ReactNode => {
    switch (a) {
      case 'approve_standard':
      case 'approve_advance':
        return (
          <>
            {vendorField(true)}
            <Input id="rma-warranty-reference" label={t('rma.warranty.fields.vendorRef', 'Vendor RMA reference')} value={form.rma_reference} onChange={(e) => set('rma_reference', e.target.value)} />
            {dateField('rma-warranty-return-by', t('rma.warranty.fields.returnBy', 'Return by'), 'return_by')}
            <TextArea id="rma-warranty-ship-to" label={t('rma.warranty.fields.returnShipTo', 'Return ship-to')} value={form.return_ship_to} onChange={(e) => set('return_ship_to', e.target.value)} />
          </>
        );
      case 'deny':
        return <TextArea id="rma-warranty-denial-reason" label={t('rma.warranty.fields.denialReason', 'Denial reason')} required value={form.reason} onChange={(e) => set('reason', e.target.value)} />;
      case 'cancel':
        return (
          <CustomSelect
            id="rma-warranty-cancel-reason"
            label={t('rma.warranty.fields.cancelReason', 'Reason')}
            value={form.reason}
            options={['cancelled', 'duplicate'].map((v) => ({ value: v, label: CLOSE_REASON_LABELS[v] }))}
            onValueChange={(v: string) => set('reason', v)}
          />
        );
      case 'mark_device_received':
        return <p className="text-sm text-gray-600">{t('rma.warranty.confirmReceived', 'Confirm the device is in the office. Its custody must be in the office.')}</p>;
      case 'ship_to_vendor':
        return (
          <>
            {vendorField(!rma.vendor_id)}
            <Input id="rma-warranty-carrier" label={t('rma.warranty.fields.carrier', 'Carrier')} required value={form.carrier} onChange={(e) => set('carrier', e.target.value)} />
            <Input id="rma-warranty-tracking" label={t('rma.warranty.fields.tracking', 'Tracking number')} required value={form.tracking_number} onChange={(e) => set('tracking_number', e.target.value)} />
            {dateField('rma-warranty-return-by', t('rma.warranty.fields.returnBy', 'Return by'), 'return_by', true)}
            <Input id="rma-warranty-reference" label={t('rma.warranty.fields.vendorRef', 'Vendor RMA reference')} value={form.rma_reference} onChange={(e) => set('rma_reference', e.target.value)} />
            <TextArea id="rma-warranty-ship-to" label={t('rma.warranty.fields.returnShipTo', 'Return ship-to')} value={form.return_ship_to} onChange={(e) => set('return_ship_to', e.target.value)} />
          </>
        );
      case 'receive_replacement':
        return (
          <>
            <Input id="rma-warranty-replacement-serial" label={t('rma.warranty.fields.replacementSerial', 'Replacement serial')} required value={form.replacement_serial_number} onChange={(e) => set('replacement_serial_number', e.target.value)} />
            <Input id="rma-warranty-model" label={t('rma.warranty.fields.model', 'Model')} value={form.model} onChange={(e) => set('model', e.target.value)} />
            <Input id="rma-warranty-manufacturer" label={t('rma.warranty.fields.manufacturer', 'Manufacturer')} value={form.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} />
            {dateField('rma-warranty-warranty-end', t('rma.warranty.fields.warrantyEnd', 'Warranty end date'), 'warranty_end_date')}
            {inboundFields}
            {locationField}
          </>
        );
      case 'record_repair':
        return (
          <>
            {inboundFields}
            {locationField}
          </>
        );
      case 'record_credit':
        return <p className="text-sm text-gray-600">{t('rma.warranty.confirmCredit', 'Record that the vendor credited this device. The custody episode is closed as disposed.')}</p>;
      case 'return_to_client':
        return <Input id="rma-warranty-counterparty" label={t('rma.warranty.fields.counterparty', 'Returned to')} value={form.counterparty} onChange={(e) => set('counterparty', e.target.value)} />;
      case 'close':
        return (
          <CustomSelect
            id="rma-warranty-close-reason"
            label={t('rma.warranty.fields.closeReason', 'Closed reason')}
            value={form.reason}
            options={['resolved', 'vendor_credited', 'cancelled', 'duplicate'].map((v) => ({ value: v, label: CLOSE_REASON_LABELS[v] }))}
            onValueChange={(v: string) => set('reason', v)}
          />
        );
    }
  };

  return (
    <div className="space-y-4" id="rma-warranty-panel">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {rma.asset_id && (
          <Link id="rma-warranty-asset-link" className="text-primary-600 hover:underline" href={recordPath('asset', rma.asset_id)}>
            {t('rma.warranty.assetLink', 'Asset: {{name}}', { name: assetLabel || rma.asset_tag || dash })}
          </Link>
        )}
        {rma.ticket_id && (
          <Link id="rma-warranty-ticket-link" className="text-primary-600 hover:underline" href={recordPath('ticket', rma.ticket_id)}>
            {t('rma.warranty.ticketLink', 'Ticket: {{number}}', { number: rma.ticket_number || dash })}
          </Link>
        )}
      </div>

      <div className="grid gap-3 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <div className="text-xs text-gray-500">{label}</div>
            <div>{value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2" id="rma-warranty-actions">
        {allowed.map((a) => (
          <Button key={a} id={`rma-warranty-action-${a}`} size="sm" variant={a === 'deny' || a === 'cancel' ? 'outline' : 'default'} onClick={() => openAction(a)}>
            {ACTION_LABELS[a]}
          </Button>
        ))}
        <Button id="rma-warranty-print-tag" size="sm" variant="outline" disabled={isPrinting} onClick={() => void printTag()}>
          {t('rma.warranty.printTag', 'Print RMA tag')}
        </Button>
        <Button
          id="rma-warranty-print-slip"
          size="sm"
          variant="outline"
          onClick={() => window.open(`/api/inventory/rma/${rma.rma_id}/document?type=return-slip`, '_blank')}
        >
          {t('rma.warranty.printSlip', 'Print return slip')}
        </Button>
        {onMirrorToTicket && rma.ticket_id && vendorCaseSystems && vendorCaseSystems.length > 0 && (
          <CustomSelect
            id="rma-warranty-mirror-system"
            label={t('rma.warranty.mirrorSystem', 'Vendor case system')}
            value={systemKey}
            placeholder={t('rma.warranty.mirrorSystemGeneric', 'Generic link')}
            // The placeholder above already renders "Generic link" as the dropdown's empty-state row;
            // an explicit `{ value: '', label: ... }` option here would show it a second time. `allowClear`
            // gives the real affordance for going back to generic once a system has been chosen.
            options={vendorCaseSystems.map((s) => ({ value: s.key, label: s.label }))}
            allowClear
            onValueChange={(v: string) => setSystemKey(v)}
          />
        )}
        {onMirrorToTicket && rma.ticket_id && (
          <Button id="rma-warranty-mirror-ticket" size="sm" variant="outline" disabled={mirroring || !rma.rma_reference} onClick={() => void mirror()}>
            {t('rma.warranty.mirrorToTicket', 'Mirror vendor case to ticket')}
          </Button>
        )}
      </div>

      <div id="rma-warranty-timeline">
        <div className="mb-1 text-sm font-medium">{t('rma.warranty.timeline', 'History')}</div>
        {events.length === 0 ? (
          <div className="text-sm text-gray-500">{t('rma.warranty.noEvents', 'No history yet.')}</div>
        ) : (
          <ul className="space-y-2 text-sm">
            {events.map((e) => (
              <li key={e.event_id} className="flex flex-wrap items-baseline gap-2" id={`rma-event-${e.event_id}`}>
                <Badge variant="secondary" size="sm">{EVENT_LABELS[e.event_type] ?? e.event_type.replace(/_/g, ' ')}</Badge>
                <span className="text-gray-600">{new Date(e.occurred_at).toLocaleString()}</span>
                {e.actor_name && <span className="text-gray-600">{e.actor_name}</span>}
                {(e.carrier || e.tracking_number) && <span>{shipping(e.carrier, e.tracking_number)}</span>}
                {e.note && <span className="text-gray-800">{e.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog
        id="rma-warranty-action-dialog"
        isOpen={action !== null}
        onClose={() => setAction(null)}
        title={action ? ACTION_LABELS[action] : ''}
      >
        <div className="space-y-4 p-1">
          {action && renderFields(action)}
          <TextArea id="rma-warranty-note" label={t('rma.warranty.fields.note', 'Note')} value={form.note} onChange={(e) => set('note', e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Button id="rma-warranty-action-dialog-cancel" variant="outline" onClick={() => setAction(null)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="rma-warranty-action-submit" onClick={() => void submit()} disabled={busy}>
              {busy ? t('common.saving', 'Saving…') : action ? ACTION_LABELS[action] : ''}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
