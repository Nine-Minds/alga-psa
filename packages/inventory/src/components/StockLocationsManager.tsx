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

const LOCATION_TYPE_LABELS: Record<StockLocationType, string> = {
  warehouse: 'Warehouse',
  // "Vehicle", not "Van" — an engineer's car/truck is a rolling stockroom too; the parts belong to
  // a person (see the Assigned to field), not a specific kind of van.
  van: 'Vehicle',
  office: 'Office',
  other: 'Other',
};

/** Display name for a user id, resolved from the loaded engineer list. */
function userDisplayName(users: IUser[], userId: string | null | undefined): string | null {
  if (!userId) return null;
  const u = users.find((x) => x.user_id === userId);
  if (!u) return null;
  return `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.username || u.email;
}

const LOCATION_TYPES: StockLocationType[] = ['warehouse', 'van', 'office', 'other'];

const LOCATION_TYPE_OPTIONS = LOCATION_TYPES.map((t) => ({
  value: t,
  label: LOCATION_TYPE_LABELS[t],
}));

interface FormState {
  name: string;
  location_type: StockLocationType;
  is_default: boolean;
  assigned_user_id: string | null;
}

const emptyForm = (): FormState => ({
  name: '',
  location_type: 'warehouse',
  is_default: false,
  assigned_user_id: null,
});

export function StockLocationsManager({
  initialLocations,
  loadError = false,
  users = [],
}: {
  initialLocations: IStockLocation[];
  loadError?: boolean;
  users?: IUser[];
}) {
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
        if (!cancelled) setStockRows(rows);
      })
      .catch(() => {
        if (!cancelled) toast.error("Couldn't load the location's stock.");
      })
      .finally(() => {
        if (!cancelled) setStockLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stockTarget]);

  const reload = useCallback(async () => {
    try {
      setLocations(await listStockLocations({ includeInactive: true, includeStock: true }));
      setLoadFailed(false);
    } catch (e) {
      console.error(e);
      setLoadFailed(true);
      toast.error("Couldn't load locations.");
    }
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (loc: IStockLocation) => {
    setEditing(loc);
    setForm({
      name: loc.name,
      location_type: loc.location_type,
      is_default: loc.is_default,
      assigned_user_id: loc.assigned_user_id ?? null,
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error('Location name is required');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateStockLocation(editing.location_id, form);
        toast.success('Location updated.');
      } else {
        await createStockLocation(form);
        toast.success('Location created.');
      }
      setDialogOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't save the location.");
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (loc: IStockLocation) => {
    try {
      await deactivateStockLocation(loc.location_id);
      toast.success('Location deactivated.');
      await reload();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't deactivate the location.");
    }
  };

  const reactivate = async (loc: IStockLocation) => {
    try {
      await updateStockLocation(loc.location_id, { is_active: true });
      toast.success('Location reactivated.');
      await reload();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't reactivate the location.");
    }
  };

  // One-click default. The server clears the prior default atomically (single default per tenant),
  // so this replaces it without a separate Edit → check → Save detour.
  const setDefault = async (loc: IStockLocation) => {
    try {
      await updateStockLocation(loc.location_id, { is_default: true });
      toast.success(`"${loc.name}" is now the default location.`);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't set the default location.");
    }
  };

  const columns: ColumnDefinition<IStockLocation>[] = [
    {
      title: 'Name',
      dataIndex: 'name',
      // The row's identity — give it weight so it out-ranks the data beside it (matches siblings).
      // The single default is marked here as a badge rather than burning a near-empty column on it.
      render: (v: any, rec: IStockLocation) => (
        <span className="flex items-center gap-2">
          <span className="font-medium text-gray-900">{v}</span>
          {rec.is_default && (
            <Badge variant="primary" size="sm">
              Default
            </Badge>
          )}
        </span>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'location_type',
      render: (v: any) => LOCATION_TYPE_LABELS[v as StockLocationType] ?? v,
    },
    {
      title: 'Stock',
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
          <span className="text-gray-400">Empty</span>
        ),
    },
    {
      title: 'Assigned to',
      dataIndex: 'assigned_user_id',
      render: (_: any, rec: IStockLocation) => {
        const name = userDisplayName(users, rec.assigned_user_id);
        return name ? <span>{name}</span> : <span className="text-gray-400">—</span>;
      },
    },
    {
      title: 'Status',
      dataIndex: 'is_active',
      render: (v: any) => (
        <Badge variant={(v ? 'success' : 'secondary') as BadgeVariant} size="sm">
          {v ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      title: 'Actions',
      dataIndex: 'location_id',
      // Width matches the sibling managers (PO 230 / SO 260) so the action cluster aligns and labels
      // never clip — here sized for the three-verb active row (Edit · Set default · Deactivate).
      width: '260px',
      render: (_: any, rec: IStockLocation) => (
        <div className="flex gap-2">
          <Button id={`edit-location-${rec.location_id}`} variant="outline" size="sm" onClick={() => openEdit(rec)}>
            Edit
          </Button>
          {rec.is_active && !rec.is_default && (
            <Button id={`set-default-location-${rec.location_id}`} variant="ghost" size="sm" onClick={() => setDefault(rec)}>
              Set default
            </Button>
          )}
          {rec.is_active ? (
            <span title={isLocationOccupied(rec) ? 'Holds stock — move it out before deactivating' : undefined}>
              <Button
                id={`deactivate-location-${rec.location_id}`}
                variant="ghost"
                size="sm"
                disabled={isLocationOccupied(rec)}
                onClick={() => setPendingDeactivate(rec)}
              >
                Deactivate
              </Button>
            </span>
          ) : (
            <Button id={`reactivate-location-${rec.location_id}`} variant="soft" size="sm" onClick={() => reactivate(rec)}>
              Reactivate
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
    { title: 'Product', dataIndex: 'service_name', render: (v: any) => v || <span className="text-gray-400">—</span> },
    { title: 'SKU', dataIndex: 'sku', render: (v: any) => v || <span className="text-gray-400">—</span> },
    { title: 'On hand', dataIndex: 'quantity_on_hand' },
    { title: 'Available', dataIndex: 'available' },
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
          <h1 className="text-2xl font-semibold">Stock Locations</h1>
          {!loadFailed && visible.length > 0 && (
            <p className="text-sm text-gray-500 mt-0.5">
              {visible.length} location{visible.length === 1 ? '' : 's'}
            </p>
          )}
        </div>
        <Button id="add-stock-location-button" onClick={openCreate}>
          Add Location
        </Button>
      </div>

      {!loadFailed && locations.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="w-72">
            <SearchInput
              id="stock-locations-search"
              placeholder="Search locations"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClear={() => setSearch('')}
            />
          </div>
          {inactiveCount > 0 && (
            <SwitchWithLabel
              label={`Show inactive (${inactiveCount})`}
              checked={showInactive}
              onCheckedChange={setShowInactive}
            />
          )}
          {q && (
            <span className="text-sm text-gray-500">
              {visible.length} of {byStatus.length}
            </span>
          )}
        </div>
      )}

      {loadFailed ? (
        <EmptyState
          title="Couldn't load locations"
          description="Something went wrong loading this page. Try again."
          action={
            <Button id="stock-locations-retry" onClick={reload}>
              Retry
            </Button>
          }
        />
      ) : locations.length === 0 ? (
        <EmptyState
          title="No stock locations yet"
          description="Add a warehouse, van, or office to track where stock lives."
          action={
            <Button id="stock-locations-empty-add" onClick={openCreate}>
              Add Location
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        q ? (
          <EmptyState
            title="No locations match"
            action={
              <Button id="stock-locations-clear-search" variant="link" onClick={() => setSearch('')}>
                Clear search
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No active locations"
            description="Every location is deactivated."
            action={
              <Button id="stock-locations-show-inactive" variant="link" onClick={() => setShowInactive(true)}>
                Show inactive
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
        title={editing ? 'Edit Location' : 'Add Location'}
        id="stock-location-dialog"
      >
        <div className="space-y-4 p-1">
          <Input
            id="stock-location-name"
            label="Name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <CustomSelect
            id="stock-location-type"
            label="Type"
            value={form.location_type}
            placeholder="Select a type…"
            options={LOCATION_TYPE_OPTIONS}
            onValueChange={(val: string) => setForm({ ...form, location_type: val as StockLocationType })}
          />
          <UserPicker
            label="Assigned to"
            value={form.assigned_user_id ?? ''}
            users={users}
            onValueChange={(val: string) => setForm({ ...form, assigned_user_id: val || null })}
            placeholder="Whose location is this?"
            unassignedLabel="Not assigned"
            buttonWidth="full"
          />
          <Checkbox
            id="stock-location-default"
            label="Make this the default location"
            checked={form.is_default}
            onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button id="stock-location-cancel" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button id="stock-location-save" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save' : 'Create'}
            </Button>
          </div>
        </div>
      </Dialog>

      <ConfirmationDialog
        id="deactivate-location-confirm"
        isOpen={!!pendingDeactivate}
        onClose={() => setPendingDeactivate(null)}
        title="Deactivate location"
        message={
          pendingDeactivate
            ? `Deactivate "${pendingDeactivate.name}"? It will stop appearing as a stock destination.`
            : ''
        }
        confirmLabel="Deactivate"
        cancelLabel="Keep active"
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
        title={stockTarget ? `Stock at ${stockTarget.name}` : 'Stock'}
        id="location-stock-dialog"
      >
        <div className="space-y-3 p-1" style={{ minWidth: 560 }}>
          {stockTarget && <p className="text-sm text-gray-500">{formatStockSummary(stockTarget)}</p>}
          {!stockLoading && stockRows.length > 0 && (
            <div className="w-72">
              <SearchInput
                id="location-stock-search"
                placeholder="Search product or SKU"
                value={stockSearch}
                onChange={(e) => setStockSearch(e.target.value)}
                onClear={() => setStockSearch('')}
              />
            </div>
          )}
          {stockLoading ? (
            <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
          ) : stockRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">Nothing on hand at this location.</p>
          ) : (
            <DataTable id="location-stock-table" data={stockVisible} columns={stockColumns} pageSize={10} />
          )}
        </div>
      </Dialog>
    </div>
  );
}
