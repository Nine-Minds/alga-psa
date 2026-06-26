'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition, IKitComponent } from '@alga-psa/types';
import {
  listInventoryProducts,
  listKitComponents,
  addKitComponent,
  removeKitComponent,
} from '../actions';

interface KitProduct {
  service_id: string;
  service_name?: string;
  sku?: string | null;
  is_kit?: boolean;
}

type ComponentRow = IKitComponent & { service_name?: string; sku?: string | null };

export function KitManager({ initialKits }: { initialKits: KitProduct[] }) {
  const [kits, setKits] = useState<KitProduct[]>((initialKits || []).filter((p) => p.is_kit));
  const [products, setProducts] = useState<KitProduct[]>([]);
  const [selectedKit, setSelectedKit] = useState<KitProduct | null>(null);
  const [components, setComponents] = useState<ComponentRow[]>([]);
  const [componentServiceId, setComponentServiceId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [saving, setSaving] = useState(false);

  const reloadKits = useCallback(async () => {
    try {
      const all = (await listInventoryProducts()) as KitProduct[];
      setProducts(all);
      setKits(all.filter((p) => p.is_kit));
    } catch (e) {
      console.error(e);
      toast.error('Failed to load kits');
    }
  }, []);

  useEffect(() => {
    void reloadKits();
  }, [reloadKits]);

  const loadComponents = useCallback(async (kitServiceId: string) => {
    try {
      setComponents((await listKitComponents(kitServiceId)) as ComponentRow[]);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load components');
    }
  }, []);

  const selectKit = useCallback(
    (kit: KitProduct) => {
      setSelectedKit(kit);
      setComponentServiceId('');
      setQuantity('1');
      void loadComponents(kit.service_id);
    },
    [loadComponents],
  );

  const productName = useCallback(
    (serviceId: string) => products.find((p) => p.service_id === serviceId)?.service_name || serviceId,
    [products],
  );

  // Candidate components: inventory products that are not kits and not the kit itself.
  const componentCandidates = products.filter(
    (p) => !p.is_kit && p.service_id !== selectedKit?.service_id,
  );

  const add = async () => {
    if (!selectedKit) return;
    if (!componentServiceId.trim()) {
      toast.error('Component is required');
      return;
    }
    const qty = Number(quantity);
    if (!(qty > 0)) {
      toast.error('Quantity must be greater than 0');
      return;
    }
    setSaving(true);
    try {
      await addKitComponent(selectedKit.service_id, componentServiceId.trim(), qty);
      toast.success('Component added');
      setComponentServiceId('');
      setQuantity('1');
      await loadComponents(selectedKit.service_id);
    } catch (e: any) {
      toast.error(e?.message || 'Add failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (rec: ComponentRow) => {
    if (!selectedKit) return;
    try {
      await removeKitComponent(selectedKit.service_id, rec.component_service_id);
      toast.success('Component removed');
      await loadComponents(selectedKit.service_id);
    } catch (e: any) {
      toast.error(e?.message || 'Remove failed');
    }
  };

  const kitColumns: ColumnDefinition<KitProduct>[] = [
    { title: 'Name', dataIndex: 'service_name' },
    { title: 'SKU', dataIndex: 'sku', render: (v: any) => v || '' },
    {
      title: 'Actions',
      dataIndex: 'service_id',
      render: (_: any, rec: KitProduct) => (
        <Button id={`select-kit-${rec.service_id}`} variant="outline" size="sm" onClick={() => selectKit(rec)}>
          Manage
        </Button>
      ),
    },
  ];

  const componentColumns: ColumnDefinition<ComponentRow>[] = [
    { title: 'Component', dataIndex: 'component_service_id', render: (v: any, rec: ComponentRow) => rec.service_name || productName(v) },
    { title: 'SKU', dataIndex: 'sku', render: (v: any) => v || '' },
    { title: 'Quantity', dataIndex: 'quantity' },
    {
      title: 'Actions',
      dataIndex: 'component_service_id',
      render: (_: any, rec: ComponentRow) => (
        <Button id={`remove-component-${rec.component_service_id}`} variant="ghost" size="sm" onClick={() => remove(rec)}>
          Remove
        </Button>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4" id="kits-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Kits</h1>
      </div>

      <DataTable id="kits-table" data={kits} columns={kitColumns} onRowClick={selectKit} />

      {selectedKit && (
        <div className="space-y-4 border-t pt-4" id="kit-components-section">
          <h2 className="text-xl font-semibold">
            Components — {selectedKit.service_name || selectedKit.service_id}
          </h2>

          <div className="flex gap-2 items-end" id="kit-add-component-row">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">Component</label>
              <select
                id="kit-component-service"
                className="border rounded px-2 py-2 w-full"
                value={componentServiceId}
                onChange={(e) => setComponentServiceId(e.target.value)}
              >
                <option value="">Select a product…</option>
                {componentCandidates.map((p) => (
                  <option key={p.service_id} value={p.service_id}>
                    {p.service_name || p.service_id}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-28">
              <label className="block text-sm font-medium mb-1">Quantity</label>
              <Input
                id="kit-component-quantity"
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <Button id="kit-add-component-button" onClick={add} disabled={saving}>
              {saving ? 'Saving…' : 'Add Component'}
            </Button>
          </div>

          <DataTable id="kit-components-table" data={components} columns={componentColumns} />
        </div>
      )}
    </div>
  );
}
