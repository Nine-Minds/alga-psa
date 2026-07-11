'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { SearchInput } from '@alga-psa/ui/components/SearchInput';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { ClientNameCell } from '@alga-psa/ui/components/ClientNameCell';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
import { AsyncSearchableSelect, type SelectOption } from '@alga-psa/ui/components/AsyncSearchableSelect';
import { PackageOpen } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { usePageCreateShortcut, useDialogSubmitShortcut } from '@alga-psa/ui/keyboard-shortcuts';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition, IClient, IStockLocation } from '@alga-psa/types';
import {
  getUnitDetail,
  listStockLocations,
  loanOut,
  loanReturn,
  loanersOutReport,
  searchInStockUnits,
  updateLoanDueDate,
  type LoanerOutRow,
} from '../actions';
import { UnitHistoryDialog, type UnitDetail } from './UnitHistoryDialog';

const isReturnedActionError = (value: unknown) => isActionMessageError(value) || isActionPermissionError(value);
const DAY_MS = 24 * 60 * 60 * 1000;

function fmtDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
}

/** Midnight-aligned calendar-day delta from today (negative = in the past). */
function dayDelta(value: string | Date): number | null {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / DAY_MS);
}

/**
 * `loan_due_at` is a calendar date pinned to UTC midnight (see normalizeDueDate),
 * NOT an instant like `loaned_at` — render and compare its UTC date parts, or every
 * viewer west of UTC sees the previous day and overdue flips a day early.
 */
function fmtDueDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { timeZone: 'UTC' });
}

/** Calendar-day delta between the due date (UTC parts) and today (local calendar). */
function dueDayDelta(value: string | Date): number | null {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const target = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / DAY_MS);
}

type DueState = 'overdue' | 'soon' | 'ok' | 'nodate' | 'invalid';

function dueStatus(value: string | Date | null | undefined): { state: DueState; days: number } {
  if (!value) return { state: 'nodate', days: 0 };
  const delta = dueDayDelta(value);
  if (delta === null) return { state: 'invalid', days: 0 };
  if (delta < 0) return { state: 'overdue', days: -delta };
  if (delta <= 7) return { state: 'soon', days: delta };
  return { state: 'ok', days: delta };
}

export function LoanersManager({
  initialLoaners,
  clients,
}: {
  initialLoaners: LoanerOutRow[];
  clients: IClient[];
}) {
  const { t } = useTranslation('features/inventory');
  const [rows, setRows] = useState<LoanerOutRow[]>(initialLoaners || []);
  const [locations, setLocations] = useState<IStockLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);

  // Loan out dialog
  const [loanOpen, setLoanOpen] = useState(false);
  const [loanUnitId, setLoanUnitId] = useState('');
  const [loanUnitLabel, setLoanUnitLabel] = useState('');
  const [loanClientId, setLoanClientId] = useState<string | null>(null);
  const [loanDueAt, setLoanDueAt] = useState('');
  const [loanClientFilter, setLoanClientFilter] = useState<'all' | 'active' | 'inactive'>('active');
  const [loanClientType, setLoanClientType] = useState<'all' | 'company' | 'individual'>('all');
  const [loanSaving, setLoanSaving] = useState(false);

  // Return dialog
  const [returnUnit, setReturnUnit] = useState<LoanerOutRow | null>(null);
  const [returnLocationId, setReturnLocationId] = useState('');
  const [returnSaving, setReturnSaving] = useState(false);

  // Extend dialog
  const [extendUnit, setExtendUnit] = useState<LoanerOutRow | null>(null);
  const [extendDueAt, setExtendDueAt] = useState('');
  const [extendSaving, setExtendSaving] = useState(false);

  // History dialog
  const [historyDetail, setHistoryDetail] = useState<UnitDetail | null>(null);
  const [historyLoadingUnitId, setHistoryLoadingUnitId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loanersOutReport();
      if (isReturnedActionError(result)) {
        setRows([]);
        toast.error(getErrorMessage(result));
        return;
      }
      setRows(result);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || t('loaners.loadFailed', "Couldn't load loaners. Try again."));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadLocations = useCallback(async () => {
    try {
      const result = await listStockLocations({ includeInactive: false });
      if (isReturnedActionError(result)) {
        setLocations([]);
        toast.error(getErrorMessage(result));
        return;
      }
      setLocations(result);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || t('loaners.loadLocationsFailed', "Couldn't load stock locations. Try again."));
    }
  }, [t]);

  useEffect(() => {
    loadLocations();
  }, [loadLocations]);

  const overdueCount = useMemo(
    () => rows.filter((r) => dueStatus(r.loan_due_at).state === 'overdue').length,
    [rows],
  );

  const visibleRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (overdueOnly && dueStatus(r.loan_due_at).state !== 'overdue') return false;
      if (!term) return true;
      return [r.serial_number, r.mac_address, r.client_name, r.service_name, r.sku]
        .some((v) => (v || '').toLowerCase().includes(term));
    });
  }, [rows, query, overdueOnly]);

  const isFiltered = query.trim() !== '' || overdueOnly;

  // --- Loan out ---
  // Empty term = browse the in-stock pool (an empty dropdown reads as "no stock");
  // the returned total lets the select show "N of M" when there's more to narrow.
  const loadUnitOptions = useCallback(
    async ({ search, page, limit }: { search: string; page: number; limit: number }): Promise<{ options: SelectOption[]; total: number }> => {
      const result = await searchInStockUnits({ search, page, limit });
      if (isReturnedActionError(result)) return { options: [], total: 0 };
      const options: SelectOption[] = result.units.map((u) => {
        const parts = [u.product_name, u.location_name].filter(Boolean).join(' · ');
        return {
          value: u.unit_id,
          label: parts ? `${u.serial_number} — ${parts}` : u.serial_number,
        };
      });
      return { options, total: result.total };
    },
    [],
  );

  const openLoan = () => {
    setLoanUnitId('');
    setLoanUnitLabel('');
    setLoanClientId(null);
    setLoanDueAt('');
    setLoanClientFilter('active');
    setLoanClientType('all');
    setLoanOpen(true);
  };
  usePageCreateShortcut(openLoan);

  const submitLoan = async () => {
    if (!loanUnitId) {
      toast.error(t('loaners.chooseUnit', 'Choose a unit.'));
      return;
    }
    if (!loanClientId) {
      toast.error(t('loaners.chooseClient', 'Choose a client.'));
      return;
    }
    setLoanSaving(true);
    try {
      const result = await loanOut(loanUnitId, {
        client_id: loanClientId,
        loan_due_at: loanDueAt ? loanDueAt : null,
      });
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      const serial = loanUnitLabel.split(' — ')[0] || t('loaners.theUnit', 'The unit');
      toast.success(t('loaners.loanedOut', '{{serial}} loaned out.', { serial }));
      setLoanOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('loaners.loanFailed', "Couldn't loan the unit out."));
    } finally {
      setLoanSaving(false);
    }
  };
  useDialogSubmitShortcut(
    () => { void submitLoan(); },
    { active: loanOpen, enabled: loanOpen && !saving },
  );

  // --- Return ---
  const openReturn = (rec: LoanerOutRow) => {
    setReturnUnit(rec);
    setReturnLocationId(''); // start empty — the tech picks where it physically lands
    setReturnSaving(false);
  };

  const submitReturn = async () => {
    if (!returnUnit) return;
    if (!returnLocationId) {
      toast.error(t('loaners.returnLocationRequired', 'Choose a return location.'));
      return;
    }
    setReturnSaving(true);
    try {
      const result = await loanReturn(returnUnit.unit_id, { location_id: returnLocationId });
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('loaners.returned', '{{serial}} returned to stock.', { serial: returnUnit.serial_number }));
      setReturnUnit(null);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('loaners.returnFailed', "Couldn't return the loaner."));
    } finally {
      setReturnSaving(false);
    }
  };
  useDialogSubmitShortcut(
    () => { void submitReturn(); },
    { active: returnOpen, enabled: returnOpen && !saving },
  );

  // --- Extend ---
  const openExtend = (rec: LoanerOutRow) => {
    setExtendUnit(rec);
    const current = rec.loan_due_at ? new Date(rec.loan_due_at) : null;
    setExtendDueAt(current && !Number.isNaN(current.getTime()) ? current.toISOString().slice(0, 10) : '');
    setExtendSaving(false);
  };

  const submitExtend = async () => {
    if (!extendUnit) return;
    setExtendSaving(true);
    try {
      const result = await updateLoanDueDate(extendUnit.unit_id, { loan_due_at: extendDueAt ? extendDueAt : null });
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('loaners.dueDateUpdated', 'Due date updated for {{serial}}.', { serial: extendUnit.serial_number }));
      setExtendUnit(null);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('loaners.extendFailed', "Couldn't update the due date."));
    } finally {
      setExtendSaving(false);
    }
  };
  useDialogSubmitShortcut(
    () => { void submitRestock(); },
    { active: restockOpen, enabled: restockOpen && !saving },
  );

  // --- History ---
  const openHistory = useCallback(
    async (unitId: string) => {
      setHistoryLoadingUnitId(unitId);
      try {
        const detail = await getUnitDetail(unitId);
        if (isReturnedActionError(detail)) {
          toast.error(getErrorMessage(detail));
          return;
        }
        if (!detail) {
          toast.error(t('loaners.historyNotFound', 'No history recorded for this unit yet.'));
          return;
        }
        setHistoryDetail(detail);
      } catch (e: any) {
        console.error(e);
        toast.error(e?.message || t('loaners.historyLoadFailed', "Couldn't load this unit's history. Try again."));
      } finally {
        setHistoryLoadingUnitId(null);
      }
    },
    [t],
  );

  const emptyCell = <span className="text-[rgb(var(--color-text-400))]">{t('common.emptyValue', '—')}</span>;

  const columns: ColumnDefinition<LoanerOutRow>[] = [
    {
      title: t('loaners.columns.serial', 'Serial'),
      dataIndex: 'serial_number',
      render: (_: any, rec: LoanerOutRow) => (
        <div className="leading-tight">
          <div>
            <span className="font-mono">{rec.serial_number}</span>
            {rec.sku ? <span className="text-gray-500"> · {rec.sku}</span> : null}
          </div>
          {rec.mac_address ? <div className="font-mono text-xs text-gray-500">{rec.mac_address}</div> : null}
        </div>
      ),
    },
    {
      title: t('loaners.columns.product', 'Product'),
      dataIndex: 'service_name',
      render: (v: any) => (v ? <span>{v}</span> : emptyCell),
    },
    {
      title: t('loaners.columns.client', 'Client'),
      dataIndex: 'client_name',
      render: (_: any, rec: LoanerOutRow) => <ClientNameCell clientId={rec.client_id} clientName={rec.client_name} />,
    },
    {
      title: t('loaners.columns.loaned', 'Loaned'),
      dataIndex: 'loaned_at',
      render: (_: any, rec: LoanerOutRow) => {
        const date = fmtDate(rec.loaned_at);
        if (!date) return emptyCell;
        const delta = dayDelta(rec.loaned_at!);
        const daysOut = delta === null ? null : Math.max(0, -delta);
        return (
          <div className="leading-tight">
            <div>{date}</div>
            {daysOut !== null && (
              <div className="text-xs text-gray-500">{t('loaners.daysOut', '{{n}}d out', { n: daysOut })}</div>
            )}
          </div>
        );
      },
    },
    {
      title: t('loaners.columns.due', 'Due'),
      dataIndex: 'loan_due_at',
      render: (_: any, rec: LoanerOutRow) => {
        const status = dueStatus(rec.loan_due_at);
        if (status.state === 'nodate' || status.state === 'invalid') {
          return <span className="text-gray-500">{t('loaners.noDueDate', 'No due date')}</span>;
        }
        const date = fmtDueDate(rec.loan_due_at);
        if (status.state === 'overdue') {
          return (
            <div className="leading-tight text-red-600 font-medium">
              <div>{date}</div>
              <div className="text-xs">{t('loaners.daysOverdue', '{{n}}d overdue', { n: status.days })}</div>
            </div>
          );
        }
        if (status.state === 'soon') {
          return (
            <div className="leading-tight text-amber-600">
              <div>{date}</div>
              <div className="text-xs">
                {status.days === 0
                  ? t('loaners.dueToday', 'Due today')
                  : t('loaners.dueInDays', 'Due in {{n}}d', { n: status.days })}
              </div>
            </div>
          );
        }
        return <span>{date}</span>;
      },
    },
    {
      title: t('common.actions', 'Actions'),
      dataIndex: 'unit_id',
      width: '260px',
      headerClassName: 'text-right',
      sortable: false,
      render: (_: any, rec: LoanerOutRow) => (
        <div className="flex justify-end gap-1">
          <Button id={`return-loaner-${rec.unit_id}`} variant="outline" size="sm" onClick={() => openReturn(rec)}>
            {t('loaners.return', 'Return')}
          </Button>
          <Button id={`extend-loaner-${rec.unit_id}`} variant="outline" size="sm" onClick={() => openExtend(rec)}>
            {t('loaners.extend', 'Extend')}
          </Button>
          <Button
            id={`history-loaner-${rec.unit_id}`}
            variant="ghost"
            size="sm"
            onClick={() => openHistory(rec.unit_id)}
            disabled={historyLoadingUnitId !== null}
          >
            {historyLoadingUnitId === rec.unit_id ? t('common.loading', 'Loading…') : t('loaners.history', 'History')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4" id="loaners-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('loaners.title', 'Loaners')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {t('loaners.summary.out', '{{n}} out', { n: rows.length })}
            {overdueCount > 0 && (
              <span className="text-red-600">
                {t('loaners.summary.overdueSuffix', ' · {{n}} overdue', { n: overdueCount })}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button id="loaners-refresh-button" variant="outline" onClick={reload} disabled={loading}>
            {t('common.refresh', 'Refresh')}
          </Button>
          <Button id="loaners-add-button" onClick={openLoan}>
            {t('loaners.loanOut', 'Loan out')}
          </Button>
        </div>
      </div>

      <div className="flex items-end gap-2">
        <div>
          <CustomSelect
            id="loaners-overdue-filter"
            label={t('loaners.filter.label', 'Show')}
            options={[
              { value: 'all', label: t('loaners.filter.all', 'All loaners') },
              { value: 'overdue', label: t('loaners.filter.overdue', 'Overdue only') },
            ]}
            value={overdueOnly ? 'overdue' : 'all'}
            onValueChange={(v) => setOverdueOnly(v === 'overdue')}
          />
        </div>
        <div className="flex-1">
          <SearchInput
            id="loaners-search-input"
            className="w-full"
            value={query}
            loading={loading}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery('')}
            placeholder={t('loaners.searchPlaceholder', 'Search serial, MAC, client, or product')}
          />
        </div>
      </div>

      {!loading && visibleRows.length === 0 ? (
        isFiltered ? (
          <EmptyState
            icon={<PackageOpen size={20} />}
            title={t('loaners.empty.noMatchTitle', 'No loaners match')}
            description={t('loaners.empty.noMatchDescription', 'Clear the search and filter to see everything on loan.')}
            action={
              <Button
                id="loaners-empty-clear"
                variant="link"
                onClick={() => {
                  setQuery('');
                  setOverdueOnly(false);
                }}
              >
                {t('loaners.empty.clearFilters', 'Clear filters')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<PackageOpen size={20} />}
            title={t('loaners.empty.noLoansTitle', 'Nothing out on loan')}
            description={t('loaners.empty.noLoansDescription', 'Units you loan to clients appear here until they come back.')}
            action={
              <Button id="loaners-empty-add" variant="link" onClick={openLoan}>
                {t('loaners.loanOut', 'Loan out')}
              </Button>
            }
          />
        )
      ) : (
        <DataTable id="loaners-table" data={visibleRows} columns={columns} />
      )}

      {/* Loan out */}
      <Dialog isOpen={loanOpen} onClose={() => setLoanOpen(false)} title={t('loaners.loanDialogTitle', 'Loan out a unit')} id="loaner-loan-dialog">
        <div className="space-y-4 p-1">
          <AsyncSearchableSelect
            id="loaner-loan-unit"
            label={t('loaners.fields.unit', 'Unit')}
            required
            value={loanUnitId}
            selectedLabel={loanUnitLabel || undefined}
            loadOptions={loadUnitOptions}
            dropdownMode="overlay"
            placeholder={t('loaners.fields.unitPlaceholder', 'Search by serial or MAC…')}
            searchPlaceholder={t('loaners.fields.unitSearchPlaceholder', 'e.g. SSD990-0007')}
            emptyMessage={t('loaners.fields.noInStockUnits', 'No in-stock units found')}
            onChange={(value, option) => {
              setLoanUnitId(value);
              setLoanUnitLabel(option?.label ?? '');
            }}
          />
          <div className="space-y-1">
            <label className="block text-sm font-medium">{t('loaners.fields.client', 'Client')}</label>
            <ClientPicker
              id="loaner-loan-client"
              clients={clients}
              selectedClientId={loanClientId}
              onSelect={(id) => setLoanClientId(id)}
              filterState={loanClientFilter}
              onFilterStateChange={setLoanClientFilter}
              clientTypeFilter={loanClientType}
              onClientTypeFilterChange={setLoanClientType}
            />
          </div>
          <Input
            id="loaner-loan-due-at"
            label={t('loaners.fields.dueDate', 'Due date')}
            type="date"
            value={loanDueAt}
            onChange={(e) => setLoanDueAt(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button id="loaner-loan-cancel" variant="outline" onClick={() => setLoanOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="loaner-loan-save" onClick={submitLoan} disabled={loanSaving}>
              {loanSaving ? t('loaners.loaningOut', 'Loaning out…') : t('loaners.loanOut', 'Loan out')}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Return */}
      <Dialog isOpen={returnUnit !== null} onClose={() => setReturnUnit(null)} title={t('loaners.returnDialogTitle', 'Return loaner')} id="loaner-return-dialog">
        <div className="space-y-4 p-1">
          <p className="text-sm text-gray-600">
            {t('loaners.returningTo', 'Returning {{serial}} to stock.', { serial: returnUnit?.serial_number ?? '' })}
          </p>
          <CustomSelect
            id="loaner-return-location"
            label={t('loaners.fields.returnLocation', 'Return to location')}
            required
            value={returnLocationId}
            placeholder={t('loaners.fields.locationPlaceholder', 'Select a location…')}
            options={locations.map((loc) => ({ value: loc.location_id, label: loc.name }))}
            onValueChange={(v: string) => setReturnLocationId(v)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button id="loaner-return-cancel" variant="outline" onClick={() => setReturnUnit(null)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="loaner-return-save" onClick={submitReturn} disabled={returnSaving}>
              {returnSaving ? t('loaners.returning', 'Returning…') : t('loaners.return', 'Return')}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Extend */}
      <Dialog isOpen={extendUnit !== null} onClose={() => setExtendUnit(null)} title={t('loaners.extendDialogTitle', 'Extend loan')} id="loaner-extend-dialog">
        <div className="space-y-4 p-1">
          <p className="text-sm text-gray-600">
            {t('loaners.currentlyDue', 'Currently due: {{due}}', {
              due: fmtDueDate(extendUnit?.loan_due_at) ?? t('loaners.noDueDate', 'No due date'),
            })}
          </p>
          <Input
            id="loaner-extend-due-at"
            label={t('loaners.fields.dueDate', 'Due date')}
            type="date"
            value={extendDueAt}
            onChange={(e) => setExtendDueAt(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button id="loaner-extend-cancel" variant="outline" onClick={() => setExtendUnit(null)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="loaner-extend-save" onClick={submitExtend} disabled={extendSaving}>
              {extendSaving ? t('loaners.updatingDueDate', 'Updating…') : t('loaners.updateDueDate', 'Update due date')}
            </Button>
          </div>
        </div>
      </Dialog>

      <UnitHistoryDialog detail={historyDetail} onClose={() => setHistoryDetail(null)} locations={locations} />
    </div>
  );
}
