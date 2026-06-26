'use client';

import React, { useState, useCallback } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition, IStockLocation, StockLocationType } from '@alga-psa/types';
import {
  listStockLocations,
  createStockLocation,
  updateStockLocation,
  deactivateStockLocation,
} from '../actions';

const LOCATION_TYPES: StockLocationType[] = ['warehouse', 'van', 'office', 'other'];

interface FormState {
  name: string;
  location_type: StockLocationType;
  is_default: boolean;
}

export function StockLocationsManager({ initialLocations }: { initialLocations: IStockLocation[] }) {
  const [locations, setLocations] = useState<IStockLocation[]>(initialLocations || []);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IStockLocation | null>(null);
  const [form, setForm] = useState<FormState>({ name: '', location_type: 'warehouse', is_default: false });
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      setLocations(await listStockLocations({ includeInactive: false }));
    } catch (e) {
      console.error(e);
      toast.error('Failed to load locations');
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
    { title: 'Type', dataIndex: 'location_type' },
    { title: 'Default', dataIndex: 'is_default', render: (v: any) => (v ? 'Yes' : '') },
    { title: 'Status', dataIndex: 'is_active', render: (v: any) => (v ? 'Active' : 'Inactive') },
    {
      title: 'Actions',
      dataIndex: 'location_id',
      render: (_: any, rec: IStockLocation) => (
        <div className="flex gap-2">
          <Button id={`edit-location-${rec.location_id}`} variant="outline" size="sm" onClick={() => openEdit(rec)}>
            Edit
          </Button>
          <Button id={`deactivate-location-${rec.location_id}`} variant="ghost" size="sm" onClick={() => deactivate(rec)}>
            Deactivate
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4" id="stock-locations-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Stock Locations</h1>
        <Button id="add-stock-location-button" onClick={openCreate}>
          Add Location
        </Button>
      </div>

      <DataTable id="stock-locations-table" data={locations} columns={columns} onRowClick={openEdit} />

      <Dialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? 'Edit Location' : 'Add Location'}
        id="stock-location-dialog"
      >
        <div className="space-y-4 p-1">
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <Input
              id="stock-location-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Type</label>
            <select
              id="stock-location-type"
              className="border rounded px-2 py-2 w-full"
              value={form.location_type}
              onChange={(e) => setForm({ ...form, location_type: e.target.value as StockLocationType })}
            >
              {LOCATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2">
            <input
              id="stock-location-default"
              type="checkbox"
              checked={form.is_default}
              onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
            />
            <span className="text-sm">Default location</span>
          </label>
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
    </div>
  );
}
