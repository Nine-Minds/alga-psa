'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import { SearchInput } from '@alga-psa/ui/components/SearchInput';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { usePageCreateShortcut, useDialogSubmitShortcut } from '@alga-psa/ui/keyboard-shortcuts';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition, IStockLocation, IUser, StockLocationType } from '@alga-psa/types';
import {
  listStockLocations,
  createStockLocation,
  updateStockLocation,
  deactivateStockLocation,
  getStockAtLocation,
} from '../actions';
import type { LocationStockRow } from '../actions';
import { formatStock, formatStockSummary, isLocationOccupied } from '../lib/stockLocationDisplay';

/** Display name for a user id, resolved from the loaded engineer list. */
function userDisplayName(users: IUser[], userId: string | null | undefined): string | null {
  if (!userId) return null;
  const u = users.find((x) => x.user_id === userId);
  if (!u) return null;
  return `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.username || u.email;
}

const LOCATION_TYPES: StockLocationType[] = ['warehouse', 'van', 'office', 'other'];

type ReturnedActionError = ActionMessageError | ActionPermissionError;

const isReturnedActionError = (value: unknown): value is ReturnedActionError =>
  isActionMessageError(value) || isActionPermissionError(value);

interface FormState {
  name: string;
  location_type: StockLocationType;
  is_default: boolean;
  assigned_user_id: string | null;
  address_line1: string;
  address_line2: string;
  city: string;
  state_province: string;
  postal_code: string;
  country_code: string;
}

const emptyForm = (): FormState => ({
  name: '',
  location_type: 'warehouse',
  is_default: false,
  assigned_user_id: null,
  address_line1: '',
  address_line2: '',
  city: '',
  state_province: '',
  postal_code: '',
  country_code: '',
});

/** One-line address for the row, e.g. "123 Main St, Seattle, WA 98101". Empty when no address. */
function formatLocationAddress(loc: IStockLocation): string {
  const cityState = [loc.city, [loc.state_province, loc.postal_code].filter(Boolean).join(' ')]
    .filter((s) => s && s.trim())
    .join(', ');
  return [loc.address_line1, cityState].filter((s) => s && s.trim()).join(', ');
}

export function StockLocationsManager({
  initialLocations,
  loadError = false,
  users = [],
}: {
  initialLocations: IStockLocation[];
  loadError?: boolean;
  users?: IUser[];
}) {
  const { t } = useTranslation('features/inventory');

  const LOCATION_TYPE_LABELS: Record<StockLocationType, string> = {
    warehouse: t('locations.type.warehouse', 'Warehouse'),
    // "Vehicle", not "Van" — an engineer's car/truck is a rolling stockroom too; the parts belong to
    // a person (see the Assigned to field), not a specific kind of van.
    van: t('locations.type.van', 'Vehicle'),
    office: t('locations.type.office', 'Office'),
    other: t('locations.type.other', 'Other'),
  };

  const LOCATION_TYPE_OPTIONS = LOCATION_TYPES.map((tp) => ({
    value: tp,
    label: LOCATION_TYPE_LABELS[tp],
  }));

  const [locations, setLocations] = useState<IStockLocation[]>(initialLocations || []);
  // Seeded from the server: a failed SSR load must read as an error, not as "no locations".
  const [loadFailed, setLoadFailed] = useState(loadError);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IStockLocation | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [pendingDeactivate, setPendingDeactivate] = useState<IStockLocation | null>(null);
  // Per-location stock drill-in: the itemized contents (search + paginate so it survives many SKUs).
  const [stockTarget, setStockTarget] = useState<IStockLocation | null>(null);
  const [stockRows, setStockRows] = useState<LocationStockRow[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockSearch, setStockSearch] = useState('');

  useEffect(() => {
    if (!stockTarget) {
      setStockRows([]);
      setStockSearch('');
      return;
    }
    let cancelled = false;
    setStockLoading(true);
    getStockAtLocation(stockTarget.location_id)
      .then((rows) => {
        if (cancelled) return;
        if (isReturnedActionError(rows)) {
          setStockRows([]);
          toast.error(getErrorMessage(rows));
          return;
        }
        setStockRows(rows);
      })
      .catch(() => {
        if (!cancelled) toast.error(t('locations.stock.loadFailed', "Couldn't load the location's stock."));
      })
      .finally(() => {
        if (!cancelled) setStockLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stockTarget, t]);

  const reload = useCallback(async () => {
    try {
      const result = await listStockLocations({ includeInactive: true, includeStock: true });
      if (isReturnedActionError(result)) {
        setLocations([]);
        setLoadFailed(true);
        toast.error(getErrorMessage(result));
        return;
      }
      setLocations(result);
      setLoadFailed(false);
    } catch (e) {
      console.error(e);
      setLoadFailed(true);
      toast.error(t('locations.loadFailed', "Couldn't load locations."));
    }
  }, [t]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };
  usePageCreateShortcut(openCreate);

  const openEdit = (loc: IStockLocation) => {
    setEditing(loc);
    setForm({
      name: loc.name,
      location_type: loc.location_type,
      is_default: loc.is_default,
      assigned_user_id: loc.assigned_user_id ?? null,
      address_line1: loc.address_line1 ?? '',
      address_line2: loc.address_line2 ?? '',
      city: loc.city ?? '',
      state_province: loc.state_province ?? '',
      postal_code: loc.postal_code ?? '',
      country_code: loc.country_code ?? '',
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error(t('locations.nameRequired', 'Location name is required'));
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const result = await updateStockLocation(editing.location_id, form);
        if (isReturnedActionError(result)) {
          toast.error(getErrorMessage(result));
          return;
        }
        toast.success(t('locations.updated', 'Location updated.'));
      } else {
        const result = await createStockLocation(form);
        if (isReturnedActionError(result)) {
          toast.error(getErrorMessage(result));
          return;
        }
        toast.success(t('locations.created', 'Location created.'));
      }
      setDialogOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('locations.saveFailed', "Couldn't save the location."));
    } finally {
      setSaving(false);
    }
  };
  useDialogSubmitShortcut(
    () => { void save(); },
    { active: dialogOpen, enabled: dialogOpen && !saving },
  );

  const deactivate = async (loc: IStockLocation) => {
    try {
      const result = await deactivateStockLocation(loc.location_id);
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        await reload();
        return;
      }
      toast.success(t('locations.deactivated', 'Location deactivated.'));
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('locations.deactivateFailed', "Couldn't deactivate the location."));
    }
  };

  const reactivate = async (loc: IStockLocation) => {
    try {
      const result = await updateStockLocation(loc.location_id, { is_active: true });
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        await reload();
        return;
      }
      toast.success(t('locations.reactivated', 'Location reactivated.'));
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('locations.reactivateFailed', "Couldn't reactivate the location."));
    }
  };

  // One-click default. The server clears the prior default atomically (single default per tenant),
  // so this replaces it without a separate Edit → check → Save detour.
  const setDefault = async (loc: IStockLocation) => {
    try {
      const result = await updateStockLocation(loc.location_id, { is_default: true });
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        await reload();
        return;
      }
      toast.success(t('locations.setDefaultSuccess', '"{{name}}" is now the default location.', { name: loc.name }));
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('locations.setDefaultFailed', "Couldn't set the default location."));
    }
  };

  const columns: ColumnDefinition<IStockLocation>[] = [
    {
      title: t('common.name', 'Name'),
      dataIndex: 'name',
      // The row's identity — give it weight so it out-ranks the data beside it (matches siblings).
      // The single default is marked here as a badge rather than burning a near-empty column on it,
      // and the address (where to drive) sits beneath as a muted second line when present.
      render: (v: any, rec: IStockLocation) => {
        const address = formatLocationAddress(rec);
        return (
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900">{v}</span>
              {rec.is_default && (
                <Badge variant="primary" size="sm">
                  {t('locations.default', 'Default')}
                </Badge>
              )}
            </div>
            {address && <div className="text-xs text-gray-500">{address}</div>}
          </div>
        );
      },
    },
    {
      title: t('locations.columns.type', 'Type'),
      dataIndex: 'location_type',
      render: (v: any) => LOCATION_TYPE_LABELS[v as StockLocationType] ?? v,
    },
    {
      title: t('locations.columns.stock', 'Stock'),
      dataIndex: 'item_type_count',
      render: (_: any, rec: IStockLocation) =>
        isLocationOccupied(rec) ? (
          <button
            id={`view-stock-${rec.location_id}`}
            type="button"
            className="text-primary-600 hover:underline"
            onClick={() => setStockTarget(rec)}
          >
            {formatStock(rec)}
          </button>
        ) : (
          <span className="text-gray-400">{t('locations.stockEmpty', 'Empty')}</span>
        ),
    },
    {
      title: t('locations.columns.assignedTo', 'Assigned to'),
      dataIndex: 'assigned_user_id',
      render: (_: any, rec: IStockLocation) => {
        const name = userDisplayName(users, rec.assigned_user_id);
        return name ? <span>{name}</span> : <span className="text-gray-400">{t('common.emptyValue', '—')}</span>;
      },
    },
    {
      title: t('common.status', 'Status'),
      dataIndex: 'is_active',
      render: (v: any) => (
        <Badge variant={(v ? 'success' : 'secondary') as BadgeVariant} size="sm">
          {v ? t('common.active', 'Active') : t('common.inactive', 'Inactive')}
        </Badge>
      ),
    },
    {
      title: t('common.actions', 'Actions'),
      dataIndex: 'location_id',
      // Width matches the sibling managers (PO 230 / SO 260) so the action cluster aligns and labels
      // never clip — here sized for the three-verb active row (Edit · Set default · Deactivate).
      width: '260px',
      render: (_: any, rec: IStockLocation) => (
        <div className="flex gap-2">
          <Button id={`edit-location-${rec.location_id}`} variant="outline" size="sm" onClick={() => openEdit(rec)}>
            {t('common.edit', 'Edit')}
          </Button>
          {rec.is_active && !rec.is_default && (
            <Button id={`set-default-location-${rec.location_id}`} variant="ghost" size="sm" onClick={() => setDefault(rec)}>
              {t('locations.setDefault', 'Set default')}
            </Button>
          )}
          {rec.is_active ? (
            <span title={isLocationOccupied(rec) ? t('locations.holdsStockTooltip', 'Holds stock — move it out before deactivating') : undefined}>
              <Button
                id={`deactivate-location-${rec.location_id}`}
                variant="ghost"
                size="sm"
                disabled={isLocationOccupied(rec)}
                onClick={() => setPendingDeactivate(rec)}
              >
                {t('common.deactivate', 'Deactivate')}
              </Button>
            </span>
          ) : (
            <Button id={`reactivate-location-${rec.location_id}`} variant="soft" size="sm" onClick={() => reactivate(rec)}>
              {t('locations.reactivate', 'Reactivate')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const inactiveCount = locations.filter((l) => !l.is_active).length;
  const q = search.trim().toLowerCase();
  const byStatus = showInactive ? locations : locations.filter((l) => l.is_active);
  const visible = q ? byStatus.filter((l) => l.name.toLowerCase().includes(q)) : byStatus;

  // Drill-in: the itemized stock at the selected location, filtered by product / SKU.
  const stockColumns: ColumnDefinition<LocationStockRow>[] = [
    { title: t('locations.columns.product', 'Product'), dataIndex: 'service_name', render: (v: any) => v || <span className="text-gray-400">{t('common.emptyValue', '—')}</span> },
    { title: t('locations.columns.sku', 'SKU'), dataIndex: 'sku', render: (v: any) => v || <span className="text-gray-400">{t('common.emptyValue', '—')}</span> },
    { title: t('locations.columns.onHand', 'On hand'), dataIndex: 'quantity_on_hand' },
    { title: t('locations.columns.available', 'Available'), dataIndex: 'available' },
  ];
  const sq = stockSearch.trim().toLowerCase();
  const stockVisible = sq
    ? stockRows.filter(
        (r) =>
          (r.service_name ?? '').toLowerCase().includes(sq) || (r.sku ?? '').toLowerCase().includes(sq),
      )
    : stockRows;

  return (
    <div className="p-6 space-y-4" id="stock-locations-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('locations.title', 'Stock Locations')}</h1>
          {!loadFailed && visible.length > 0 && (
            <p className="text-sm text-gray-500 mt-0.5">
              {visible.length === 1
                ? t('locations.count', '{{n}} location', { n: visible.length })
                : t('locations.countPlural', '{{n}} locations', { n: visible.length })}
            </p>
          )}
        </div>
        <Button id="add-stock-location-button" onClick={openCreate}>
          {t('locations.addLocation', 'Add Location')}
        </Button>
      </div>

      {!loadFailed && locations.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="w-72">
            <SearchInput
              id="stock-locations-search"
              placeholder={t('locations.searchPlaceholder', 'Search locations')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClear={() => setSearch('')}
            />
          </div>
          {inactiveCount > 0 && (
            <SwitchWithLabel
              label={t('locations.showInactiveCount', 'Show inactive ({{n}})', { n: inactiveCount })}
              checked={showInactive}
              onCheckedChange={setShowInactive}
            />
          )}
          {q && (
            <span className="text-sm text-gray-500">
              {t('locations.filteredCount', '{{shown}} of {{total}}', { shown: visible.length, total: byStatus.length })}
            </span>
          )}
        </div>
      )}

      {loadFailed ? (
        <EmptyState
          title={t('locations.loadErrorTitle', "Couldn't load locations")}
          description={t('locations.loadErrorDescription', 'Something went wrong loading this page. Try again.')}
          action={
            <Button id="stock-locations-retry" onClick={reload}>
              {t('common.retry', 'Retry')}
            </Button>
          }
        />
      ) : locations.length === 0 ? (
        <EmptyState
          title={t('locations.emptyTitle', 'No stock locations yet')}
          description={t('locations.emptyDescription', 'Add a warehouse, van, or office to track where stock lives.')}
          action={
            <Button id="stock-locations-empty-add" onClick={openCreate}>
              {t('locations.addLocation', 'Add Location')}
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        q ? (
          <EmptyState
            title={t('locations.noMatchTitle', 'No locations match')}
            action={
              <Button id="stock-locations-clear-search" variant="link" onClick={() => setSearch('')}>
                {t('locations.clearSearch', 'Clear search')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            title={t('locations.noActiveTitle', 'No active locations')}
            description={t('locations.noActiveDescription', 'Every location is deactivated.')}
            action={
              <Button id="stock-locations-show-inactive" variant="link" onClick={() => setShowInactive(true)}>
                {t('locations.showInactive', 'Show inactive')}
              </Button>
            }
          />
        )
      ) : (
        <DataTable id="stock-locations-table" data={visible} columns={columns} />
      )}

      <Dialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? t('locations.editLocation', 'Edit Location') : t('locations.addLocation', 'Add Location')}
        id="stock-location-dialog"
      >
        <div className="space-y-4 p-1">
          <Input
            id="stock-location-name"
            label={t('common.name', 'Name')}
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <CustomSelect
            id="stock-location-type"
            label={t('locations.columns.type', 'Type')}
            value={form.location_type}
            placeholder={t('locations.selectType', 'Select a type…')}
            options={LOCATION_TYPE_OPTIONS}
            onValueChange={(val: string) => setForm({ ...form, location_type: val as StockLocationType })}
          />
          <UserPicker
            label={t('locations.columns.assignedTo', 'Assigned to')}
            value={form.assigned_user_id ?? ''}
            users={users}
            onValueChange={(val: string) => setForm({ ...form, assigned_user_id: val || null })}
            placeholder={t('locations.assignedPlaceholder', 'Whose location is this?')}
            unassignedLabel={t('locations.notAssigned', 'Not assigned')}
            buttonWidth="full"
          />
          {/* Optional address — blank for a Vehicle, filled for a warehouse/office so an engineer
              knows where to drive. */}
          <Input
            id="stock-location-address1"
            label={t('locations.addressLabel', 'Address (optional)')}
            placeholder={t('locations.streetPlaceholder', 'Street address')}
            value={form.address_line1}
            onChange={(e) => setForm({ ...form, address_line1: e.target.value })}
          />
          <Input
            id="stock-location-address2"
            placeholder={t('locations.suitePlaceholder', 'Suite, unit, floor (optional)')}
            value={form.address_line2}
            onChange={(e) => setForm({ ...form, address_line2: e.target.value })}
          />
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                id="stock-location-city"
                placeholder={t('locations.cityPlaceholder', 'City')}
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </div>
            <div className="w-20">
              <Input
                id="stock-location-state"
                placeholder={t('locations.statePlaceholder', 'State')}
                value={form.state_province}
                onChange={(e) => setForm({ ...form, state_province: e.target.value })}
              />
            </div>
            <div className="w-28">
              <Input
                id="stock-location-postal"
                placeholder={t('locations.zipPlaceholder', 'ZIP')}
                value={form.postal_code}
                onChange={(e) => setForm({ ...form, postal_code: e.target.value })}
              />
            </div>
          </div>
          <Checkbox
            id="stock-location-default"
            label={t('locations.makeDefault', 'Make this the default location')}
            checked={form.is_default}
            onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button id="stock-location-cancel" variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="stock-location-save" onClick={save} disabled={saving}>
              {saving ? t('common.saving', 'Saving…') : editing ? t('common.save', 'Save') : t('locations.create', 'Create')}
            </Button>
          </div>
        </div>
      </Dialog>

      <ConfirmationDialog
        id="deactivate-location-confirm"
        isOpen={!!pendingDeactivate}
        onClose={() => setPendingDeactivate(null)}
        title={t('locations.deactivateTitle', 'Deactivate location')}
        message={
          pendingDeactivate
            ? t('locations.deactivateConfirm', 'Deactivate "{{name}}"? It will stop appearing as a stock destination.', { name: pendingDeactivate.name })
            : ''
        }
        confirmLabel={t('common.deactivate', 'Deactivate')}
        cancelLabel={t('locations.keepActive', 'Keep active')}
        onConfirm={async () => {
          if (pendingDeactivate) {
            await deactivate(pendingDeactivate);
          }
          setPendingDeactivate(null);
        }}
      />

      <Dialog
        isOpen={stockTarget !== null}
        onClose={() => setStockTarget(null)}
        title={stockTarget ? t('locations.stockAt', 'Stock at {{name}}', { name: stockTarget.name }) : t('locations.stockTitle', 'Stock')}
        id="location-stock-dialog"
      >
        <div className="space-y-3 p-1" style={{ minWidth: 560 }}>
          {stockTarget && <p className="text-sm text-gray-500">{formatStockSummary(stockTarget)}</p>}
          {!stockLoading && stockRows.length > 0 && (
            <div className="w-72">
              <SearchInput
                id="location-stock-search"
                placeholder={t('locations.stockSearchPlaceholder', 'Search product or SKU')}
                value={stockSearch}
                onChange={(e) => setStockSearch(e.target.value)}
                onClear={() => setStockSearch('')}
              />
            </div>
          )}
          {stockLoading ? (
            <p className="py-8 text-center text-sm text-gray-500">{t('common.loading', 'Loading…')}</p>
          ) : stockRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">{t('locations.nothingOnHand', 'Nothing on hand at this location.')}</p>
          ) : (
            <DataTable id="location-stock-table" data={stockVisible} columns={stockColumns} pageSize={10} />
          )}
        </div>
      </Dialog>
    </div>
  );
}
