'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { useLabelPrint } from '@alga-psa/ui/components/labels';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IStockLocation, IStockMovement, IStockUnit } from '@alga-psa/types';
import { RecordUnavailable } from './RecordUnavailable';

export type UnitDetail = { unit: IStockUnit; movements: IStockMovement[] };

function fmtDate(v?: string | Date | null): string {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

function fmtDateTime(v?: string | Date | null): string {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toLocaleString();
}

/** Normalize a MAC to canonical upper-case, colon-grouped form for display. */
function fmtMac(v?: string | null): string {
  if (!v) return '';
  const hex = v.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (hex.length !== 12) return v.toUpperCase();
  return hex.match(/.{2}/g)!.join(':');
}

const UNIT_STATUS_KEYS: Record<string, [string, string]> = {
  in_stock: ['stockUnits.status.inStock', 'In stock'],
  allocated: ['stockUnits.status.allocated', 'Allocated'],
  in_transit: ['stockUnits.status.inTransit', 'In transit'],
  on_loan: ['stockUnits.status.onLoan', 'On loan'],
  delivered: ['stockUnits.status.delivered', 'Delivered'],
  returned: ['stockUnits.status.returned', 'Returned'],
  in_rma: ['stockUnits.status.inRma', 'In RMA'],
  retired: ['stockUnits.status.retired', 'Retired'],
};

/**
 * A stock unit's identity summary plus its full movement timeline. Shared by the
 * Stock Units and Loaners screens — both open the same unit-history view (extraction,
 * not copy). Self-contained: resolves its own location names from `locations`.
 */
export function UnitHistoryDialog({
  detail,
  onClose,
  locations,
  unavailable = false,
}: {
  detail: UnitDetail | null;
  onClose: () => void;
  locations: IStockLocation[];
  /** Missing, cross-tenant or denied unit: render only the unavailable state, no unit fields. */
  unavailable?: boolean;
}) {
  const { t } = useTranslation('features/inventory');
  const router = useRouter();
  const { money } = useCurrencyFormat();
  const { print, isPrinting: printing } = useLabelPrint();
  const [printError, setPrintError] = useState<{ message: string; suggestedTemplateCode?: string } | null>(null);

  const printLabel = useCallback(
    async (templateCode?: string) => {
      if (!detail) return;
      setPrintError(null);
      const outcome = await print({
        labelClass: 'stock-unit-identity',
        labels: [{ recordId: detail.unit.unit_id }],
        ...(templateCode ? { templateId: templateCode } : {}),
      });
      if (outcome.status === 'printed') {
        if (outcome.popupBlocked) {
          setPrintError({ message: t('stockUnits.printPopupBlocked', 'Allow pop-ups to open the label.') });
        } else {
          setTimeout(() => URL.revokeObjectURL(outcome.blobUrl), 60_000);
        }
        return;
      }
      const suggested = outcome.failures.find((f) => f.suggestedTemplateCode)?.suggestedTemplateCode;
      setPrintError({
        message: outcome.message || t('stockUnits.printFailed', 'Could not print this label.'),
        // Offer the server's suggested template once; a second 422 shows the message only.
        ...(outcome.httpStatus === 422 && !templateCode && suggested ? { suggestedTemplateCode: suggested } : {}),
      });
    },
    [detail, print, t],
  );

  const locationMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const loc of locations || []) map.set(loc.location_id, loc.name);
    return map;
  }, [locations]);

  const locationName = useCallback(
    (locationId?: string | null) => {
      if (!locationId) return t('common.emptyValue', '—');
      return locationMap.get(locationId) || locationId;
    },
    [locationMap, t],
  );

  const humanizeStatus = useCallback(
    (v?: string | null): string => {
      if (!v) return t('common.emptyValue', '—');
      const entry = UNIT_STATUS_KEYS[v];
      return entry ? t(entry[0], entry[1]) : v.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
    },
    [t],
  );

  return (
    <Dialog
      isOpen={detail !== null || unavailable}
      onClose={onClose}
      title={
        unavailable
          ? t('stockUnits.unitHistoryTitle', 'Unit history')
          : detail
          ? t('stockUnits.unitTitle', 'Unit {{id}}', { id: detail.unit.serial_number || detail.unit.unit_id })
          : t('stockUnits.unitHistoryTitle', 'Unit history')
      }
      id="unit-history-dialog"
      className="max-w-3xl"
    >
      {unavailable && <RecordUnavailable id="unit-dialog-unavailable" />}
      {!unavailable && detail && (
        <div className="space-y-4 p-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button id="unit-detail-print-label" variant="outline" size="sm" onClick={() => printLabel()} disabled={printing}>
              {printing ? t('common.loading', 'Loading…') : t('stockUnits.printLabel', 'Print label')}
            </Button>
            {printError && (
              <span id="unit-detail-print-error" role="alert" className="text-sm text-red-600">
                {printError.message}
                {printError.suggestedTemplateCode && (
                  <Button
                    id="unit-detail-print-suggested"
                    variant="link"
                    size="sm"
                    className="ml-2 h-auto p-0"
                    onClick={() => printLabel(printError.suggestedTemplateCode)}
                  >
                    {t('stockUnits.printWithTemplate', 'Print with {{code}}', { code: printError.suggestedTemplateCode })}
                  </Button>
                )}
              </span>
            )}
          </div>
          <div className="rounded border bg-gray-50 p-3">
            <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <div className="text-xs text-gray-500">{t('stockUnits.detail.serial', 'Serial')}</div>
                <div className="font-mono">{detail.unit.serial_number || t('common.emptyValue', '—')}</div>
              </div>
              {detail.unit.mac_address && (
                <div>
                  <div className="text-xs text-gray-500">{t('stockUnits.detail.mac', 'MAC')}</div>
                  <div className="font-mono">{fmtMac(detail.unit.mac_address)}</div>
                </div>
              )}
              <div>
                <div className="text-xs text-gray-500">{t('common.status', 'Status')}</div>
                <div>{humanizeStatus(detail.unit.status)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('stockUnits.detail.location', 'Location')}</div>
                <div>{locationName(detail.unit.location_id)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('stockUnits.detail.unitCost', 'Unit cost')}</div>
                <div className="font-mono">
                  {detail.unit.unit_cost == null
                    ? t('common.emptyValue', '—')
                    : money(Number(detail.unit.unit_cost), detail.unit.cost_currency ?? undefined)}
                </div>
              </div>
              {detail.unit.received_at && (
                <div>
                  <div className="text-xs text-gray-500">{t('stockUnits.detail.received', 'Received')}</div>
                  <div className="font-mono">{fmtDate(detail.unit.received_at)}</div>
                </div>
              )}
              {detail.unit.delivered_at && (
                <div>
                  <div className="text-xs text-gray-500">{t('stockUnits.detail.delivered', 'Delivered')}</div>
                  <div className="font-mono">{fmtDate(detail.unit.delivered_at)}</div>
                </div>
              )}
              {detail.unit.asset_id && (
                <div>
                  <div className="text-xs text-gray-500">{t('stockUnits.detail.asset', 'Asset')}</div>
                  <Button
                    id="unit-detail-view-asset"
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    onClick={() => router.push(`/msp/assets/${detail.unit.asset_id}`)}
                  >
                    {t('stockUnits.viewAsset', 'View asset')}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {detail.movements.length === 0 ? (
            <p className="text-sm text-gray-500">{t('stockUnits.noMovements', 'No movements yet')}</p>
          ) : (
            <div className="space-y-3 border-l border-gray-200 pl-4">
              {detail.movements.map((movement) => (
                <div key={movement.movement_id} className="relative">
                  <div className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-gray-400" />
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-sm font-medium">{movement.movement_type}</div>
                    <div className="font-mono text-xs text-gray-500">
                      {fmtDateTime(movement.created_at) || t('common.emptyValue', '—')}
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-gray-600">
                    <span>
                      {t('stockUnits.qty', 'Qty')} <span className="font-mono">{movement.quantity}</span>
                    </span>
                    <span className="font-mono text-gray-500">
                      {locationName(movement.from_location_id)} → {locationName(movement.to_location_id)}
                    </span>
                  </div>
                  {movement.reason && <div className="mt-1 text-xs text-gray-500">{movement.reason}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

export default UnitHistoryDialog;
