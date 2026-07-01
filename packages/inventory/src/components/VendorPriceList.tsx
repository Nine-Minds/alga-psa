'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { toast } from 'react-hot-toast';
import type { IVendor, IVendorProduct } from '@alga-psa/types';
import { listVendorProducts, upsertVendorProduct, deleteVendorProduct, listInventoryProducts } from '../actions';

type OfferRow = IVendorProduct & { service_name: string | null; sku: string | null; vendor_name: string | null };

interface OfferForm {
  service_id: string;
  vendor_sku: string;
  unit_cost: string; // dollars
  cost_currency: string;
  lead_time_days: string;
  is_preferred: boolean;
}

const emptyOffer = (): OfferForm => ({
  service_id: '',
  vendor_sku: '',
  unit_cost: '',
  cost_currency: 'USD',
  lead_time_days: '',
  is_preferred: false,
});

/**
 * Per-vendor price list (F054): the distributor's part numbers and contract costs.
 * PO lines and reorder suggestions price from these rows; the preferred offer also
 * drives which vendor auto-suggested POs group under.
 */
export function VendorPriceList({ vendor, onClose }: { vendor: IVendor | null; onClose: () => void }) {
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [products, setProducts] = useState<Array<{ service_id: string; service_name: string | null; sku: string | null }>>([]);
  const [form, setForm] = useState<OfferForm>(emptyOffer());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!vendor) return;
    try {
      setOffers(await listVendorProducts({ vendor_id: vendor.vendor_id }));
    } catch (e: any) {
      toast.error(e?.message || "Couldn't load the price list.");
    }
  }, [vendor]);

  useEffect(() => {
    setForm(emptyOffer());
    setOffers([]);
    load();
    if (vendor) {
      listInventoryProducts()
        .then((rows: any[]) => setProducts(rows.map((r) => ({ service_id: r.service_id, service_name: r.service_name, sku: r.sku }))))
        .catch(() => setProducts([]));
    }
  }, [vendor, load]);

  const save = async () => {
    if (!vendor) return;
    if (!form.service_id) {
      toast.error('Pick a product.');
      return;
    }
    const dollars = form.unit_cost.trim() === '' ? null : Number(form.unit_cost);
    if (dollars != null && (!Number.isFinite(dollars) || dollars < 0)) {
      toast.error("Cost can't be negative.");
      return;
    }
    const leadDays = form.lead_time_days.trim() === '' ? null : Number(form.lead_time_days);
    setSaving(true);
    try {
      await upsertVendorProduct({
        vendor_id: vendor.vendor_id,
        service_id: form.service_id,
        vendor_sku: form.vendor_sku.trim() || null,
        unit_cost: dollars == null ? null : Math.round(dollars * 100),
        cost_currency: form.cost_currency.trim() || 'USD',
        lead_time_days: leadDays,
        is_preferred: form.is_preferred,
      });
      toast.success('Offer saved.');
      setForm(emptyOffer());
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't save the offer.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (offer: OfferRow) => {
    if (!vendor) return;
    try {
      await deleteVendorProduct(vendor.vendor_id, offer.service_id);
      toast.success('Offer removed.');
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't remove the offer.");
    }
  };

  const startEdit = (offer: OfferRow) => {
    setForm({
      service_id: offer.service_id,
      vendor_sku: offer.vendor_sku ?? '',
      unit_cost: offer.unit_cost != null ? (Number(offer.unit_cost) / 100).toFixed(2) : '',
      cost_currency: offer.cost_currency ?? 'USD',
      lead_time_days: offer.lead_time_days != null ? String(offer.lead_time_days) : '',
      is_preferred: Boolean(offer.is_preferred),
    });
  };

  return (
    <Dialog
      isOpen={vendor !== null}
      onClose={onClose}
      title={vendor ? `Price list — ${vendor.vendor_name}` : 'Price list'}
      id="vendor-price-list-dialog"
      className="max-w-3xl"
    >
      <div className="space-y-4 p-1">
        {offers.length === 0 ? (
          <p className="text-sm text-gray-500">No offers yet — add the vendor's part numbers and contract costs below.</p>
        ) : (
          <table className="w-full text-sm" id="vendor-price-list-table">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="py-2 pr-2 font-medium">Product</th>
                <th className="py-2 px-2 font-medium">Vendor SKU</th>
                <th className="py-2 px-2 font-medium text-right">Cost</th>
                <th className="py-2 px-2 font-medium text-right">Lead time</th>
                <th className="py-2 px-2" />
                <th className="py-2 pl-2" />
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.service_id} className="border-b last:border-0">
                  <td className="py-2 pr-2">
                    <span className="font-medium">{o.service_name || o.service_id}</span>
                    {o.sku && <span className="ml-2 text-xs text-gray-500">{o.sku}</span>}
                  </td>
                  <td className="py-2 px-2 font-mono text-xs">{o.vendor_sku || '—'}</td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {o.unit_cost != null ? `$${(Number(o.unit_cost) / 100).toFixed(2)} ${o.cost_currency}` : '—'}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {o.lead_time_days != null ? `${o.lead_time_days}d` : '—'}
                  </td>
                  <td className="py-2 px-2">
                    {o.is_preferred && (
                      <Badge variant="success" size="sm">
                        Preferred
                      </Badge>
                    )}
                  </td>
                  <td className="py-2 pl-2 text-right whitespace-nowrap">
                    <Button
                      id={`vendor-offer-edit-${o.service_id}`}
                      variant="ghost"
                      size="sm"
                      onClick={() => startEdit(o)}
                    >
                      Edit
                    </Button>
                    <Button
                      id={`vendor-offer-remove-${o.service_id}`}
                      variant="ghost"
                      size="sm"
                      onClick={() => remove(o)}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="border rounded p-3 space-y-3">
          <CustomSelect
            id="vendor-offer-product"
            label="Product"
            placeholder="Select a product…"
            value={form.service_id}
            onValueChange={(value) => setForm({ ...form, service_id: value })}
            options={products.map((p) => ({
              value: p.service_id,
              label: `${p.service_name || 'Unnamed product'}${p.sku ? ` — ${p.sku}` : ''}`,
            }))}
          />
          <div className="grid grid-cols-4 gap-2">
            <Input
              id="vendor-offer-sku"
              label="Vendor SKU"
              value={form.vendor_sku}
              onChange={(e) => setForm({ ...form, vendor_sku: e.target.value })}
            />
            <Input
              id="vendor-offer-cost"
              label="Cost ($)"
              type="number"
              value={form.unit_cost}
              onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
            />
            <Input
              id="vendor-offer-currency"
              label="Currency"
              value={form.cost_currency}
              onChange={(e) => setForm({ ...form, cost_currency: e.target.value.toUpperCase() })}
            />
            <Input
              id="vendor-offer-lead-time"
              label="Lead time (days)"
              type="number"
              value={form.lead_time_days}
              onChange={(e) => setForm({ ...form, lead_time_days: e.target.value })}
            />
          </div>
          <Checkbox
            id="vendor-offer-preferred"
            label="Preferred vendor for this product (drives reorder suggestions)"
            checked={form.is_preferred}
            onChange={(e: any) => setForm({ ...form, is_preferred: Boolean(e?.target?.checked ?? !form.is_preferred) })}
          />
          <div className="flex justify-end">
            <Button id="vendor-offer-save" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save offer'}
            </Button>
          </div>
        </div>

        <div className="flex justify-end">
          <Button id="vendor-price-list-close" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
