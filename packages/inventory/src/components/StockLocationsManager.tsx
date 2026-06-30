'use client';

import React, { useState, useCallback } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition, IStockLocation, StockLocationType } from '@alga-psa/types';
import {
  listStockLocations,
  createStockLocation,
  updateStockLocation,
  deactivateStockLocation,
} from '../actions';

const LOCATION_TYPE_LABELS: Record<StockLocationType, string> = {
  warehouse: 'Warehouse',
  van: 'Van',
  office: 'Office',
  other: 'Other',
};

const LOCATION_TYPES: StockLocationType[] = ['warehouse', 'van', 'office', 'other'];

const LOCATION_TYPE_OPTIONS = LOCATION_TYPES.map((t) => ({
  value: t,
  label: LOCATION_TYPE_LABELS[t],
}));

interface FormState {
  name: string;
  location_type: StockLocationType;
  is_default: boolean;
}

export function StockLocationsManager({
  initialLocations,
  loadError = false,
}: {
  initialLocations: IStockLocation[];
  loadError?: boolean;
}) {
  const [locations, setLocations] = useState<IStockLocation[]>(initialLocations || []);
  // Seeded from the server: a failed SSR load must read as an error, not as "no locations".
  const [loadFailed, setLoadFailed] = useState(loadError);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IStockLocation | null>(null);
  const [form, setForm] = useState<FormState>({ name: '', location_type: 'warehouse', is_default: false });
  const [saving, setSaving] = useState(false);
  const [pendingDeactivate, setPendingDeactivate] = useState<IStockLocation | null>(null);

  const reload = useCallback(async () => {
    try {
      setLocations(await listStockLocations({ includeInactive: false }));
      setLoadFailed(false);
    } catch (e) {
      console.error(e);
      setLoadFailed(true);
      toast.error("Couldn't load locations.");
    }
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', location_type: 'warehouse', is_default: false });
    setDialogOpen(true);
  };

  const openEdit = (loc: IStockLocation) => {
    setEditing(loc);
    setForm({ name: loc.name, location_type: loc.location_type, is_default: loc.is_default });
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
        toast.success('Location updated');
      } else {
        await createStockLocation(form);
        toast.success('Location created');
      }
      setDialogOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (loc: IStockLocation) => {
    try {
      await deactivateStockLocation(loc.location_id);
      toast.success('Location deactivated');
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Deactivate failed');
    }
  };

  const columns: ColumnDefinition<IStockLocation>[] = [
    { title: 'Name', dataIndex: 'name' },
    {
      title: 'Type',
      dataIndex: 'location_type',
      render: (v: any) => LOCATION_TYPE_LABELS[v as StockLocationType] ?? v,
    },
    { title: 'Default', dataIndex: 'is_default', render: (v: any) => (v ? 'Yes' : '') },
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
      render: (_: any, rec: IStockLocation) => (
        <div className="flex gap-2">
          <Button id={`edit-location-${rec.location_id}`} variant="outline" size="sm" onClick={() => openEdit(rec)}>
            Edit
          </Button>
          <Button id={`deactivate-location-${rec.location_id}`} variant="ghost" size="sm" onClick={() => setPendingDeactivate(rec)}>
            Deactivate
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4" id="stock-locations-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Stock Locations</h1>
          {!loadFailed && locations.length > 0 && (
            <p className="text-sm text-gray-500 mt-0.5">
              {locations.length} location{locations.length === 1 ? '' : 's'}
            </p>
          )}
        </div>
        <Button id="add-stock-location-button" onClick={openCreate}>
          Add Location
        </Button>
      </div>

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
      ) : (
        <DataTable id="stock-locations-table" data={locations} columns={columns} onRowClick={openEdit} />
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
            placeholder="Select type…"
            options={LOCATION_TYPE_OPTIONS}
            onValueChange={(val: string) => setForm({ ...form, location_type: val as StockLocationType })}
          />
          <Checkbox
            id="stock-location-default"
            label="Default location"
            checked={form.is_default}
            onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button id="stock-location-cancel" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button id="stock-location-save" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
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
            ? `Are you sure you want to deactivate "${pendingDeactivate.name}"?`
            : ''
        }
        confirmLabel="Deactivate"
        onConfirm={async () => {
          if (pendingDeactivate) {
            await deactivate(pendingDeactivate);
          }
          setPendingDeactivate(null);
        }}
      />
    </div>
  );
}
