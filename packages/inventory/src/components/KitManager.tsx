'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
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
  const { t } = useTranslation('features/inventory');
  const [kits, setKits] = useState<KitProduct[]>((initialKits || []).filter((p) => p.is_kit));
  const [products, setProducts] = useState<KitProduct[]>([]);
  const [selectedKit, setSelectedKit] = useState<KitProduct | null>(null);
  const [components, setComponents] = useState<ComponentRow[]>([]);
  const [componentServiceId, setComponentServiceId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [saving, setSaving] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<ComponentRow | null>(null);

  const reloadKits = useCallback(async () => {
    try {
      const all = (await listInventoryProducts()) as KitProduct[];
      setProducts(all);
      setKits(all.filter((p) => p.is_kit));
    } catch (e) {
      console.error(e);
      toast.error(t('kits.loadKitsFailed', 'Failed to load kits'));
    }
  }, [t]);

  useEffect(() => {
    void reloadKits();
  }, [reloadKits]);

  const loadComponents = useCallback(async (kitServiceId: string) => {
    try {
      setComponents((await listKitComponents(kitServiceId)) as ComponentRow[]);
    } catch (e) {
      console.error(e);
      toast.error(t('kits.loadComponentsFailed', 'Failed to load components'));
    }
  }, [t]);

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
      toast.error(t('kits.componentRequired', 'Component is required'));
      return;
    }
    const qty = Number(quantity);
    if (!(qty > 0)) {
      toast.error(t('kits.quantityInvalid', 'Quantity must be greater than 0'));
      return;
    }
    setSaving(true);
    try {
      await addKitComponent(selectedKit.service_id, componentServiceId.trim(), qty);
      toast.success(t('kits.componentAdded', 'Component added'));
      setComponentServiceId('');
      setQuantity('1');
      await loadComponents(selectedKit.service_id);
    } catch (e: any) {
      toast.error(e?.message || t('kits.addFailed', 'Add failed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (rec: ComponentRow) => {
    if (!selectedKit) return;
    try {
      await removeKitComponent(selectedKit.service_id, rec.component_service_id);
      toast.success(t('kits.componentRemoved', 'Component removed'));
      await loadComponents(selectedKit.service_id);
    } catch (e: any) {
      toast.error(e?.message || t('kits.removeFailed', 'Remove failed'));
    } finally {
      setPendingRemove(null);
    }
  };

  const kitColumns: ColumnDefinition<KitProduct>[] = [
    { title: t('common.name', 'Name'), dataIndex: 'service_name' },
    { title: t('kits.columns.sku', 'SKU'), dataIndex: 'sku', render: (v: any) => v || '' },
    {
      title: t('common.actions', 'Actions'),
      dataIndex: 'service_id',
      render: (_: any, rec: KitProduct) => (
        <Button id={`select-kit-${rec.service_id}`} variant="outline" size="sm" onClick={() => selectKit(rec)}>
          {t('kits.manage', 'Manage')}
        </Button>
      ),
    },
  ];

  const componentColumns: ColumnDefinition<ComponentRow>[] = [
    { title: t('kits.columns.component', 'Component'), dataIndex: 'component_service_id', render: (v: any, rec: ComponentRow) => rec.service_name || productName(v) },
    { title: t('kits.columns.sku', 'SKU'), dataIndex: 'sku', render: (v: any) => v || '' },
    { title: t('common.quantity', 'Quantity'), dataIndex: 'quantity' },
    {
      title: t('common.actions', 'Actions'),
      dataIndex: 'component_service_id',
      render: (_: any, rec: ComponentRow) => (
        <Button id={`remove-component-${rec.component_service_id}`} variant="ghost" size="sm" onClick={() => setPendingRemove(rec)}>
          {t('common.remove', 'Remove')}
        </Button>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4" id="kits-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('kits.title', 'Kits')}</h1>
      </div>

      <DataTable id="kits-table" data={kits} columns={kitColumns} onRowClick={selectKit} />

      {selectedKit && (
        <div className="space-y-4 border-t pt-4" id="kit-components-section">
          <h2 className="text-xl font-semibold">
            {t('kits.componentsHeading', 'Components — {{name}}', { name: selectedKit.service_name || selectedKit.service_id })}
          </h2>

          <div className="flex gap-2 items-end" id="kit-add-component-row">
            <div className="flex-1">
              <CustomSelect
                id="kit-component-service"
                label={t('kits.fields.component', 'Component')}
                required
                value={componentServiceId}
                placeholder={t('kits.fields.componentPlaceholder', 'Select a product…')}
                options={componentCandidates.map((p) => ({
                  value: p.service_id,
                  label: p.service_name || p.service_id,
                }))}
                onValueChange={(v: string) => setComponentServiceId(v)}
              />
            </div>
            <Input
              id="kit-component-quantity"
              label={t('common.quantity', 'Quantity')}
              required
              containerClassName="w-28"
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <Button id="kit-add-component-button" onClick={add} disabled={saving}>
              {saving ? t('common.saving', 'Saving…') : t('kits.addComponent', 'Add Component')}
            </Button>
          </div>

          <DataTable id="kit-components-table" data={components} columns={componentColumns} />
        </div>
      )}

      <ConfirmationDialog
        id="kit-remove-component-confirm"
        isOpen={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        onConfirm={() => {
          if (pendingRemove) {
            return remove(pendingRemove);
          }
        }}
        title={t('kits.removeTitle', 'Remove component')}
        message={
          pendingRemove
            ? t('kits.removeConfirm', 'Remove {{name}} from this kit?', { name: pendingRemove.service_name || productName(pendingRemove.component_service_id) })
            : ''
        }
        confirmLabel={t('common.remove', 'Remove')}
      />
    </div>
  );
}
