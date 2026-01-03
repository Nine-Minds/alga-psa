'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Card, CardContent, CardHeader } from 'server/src/components/ui/Card';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { getCurrencySymbol } from 'server/src/constants/currency';
import { addTicketMaterial, deleteTicketMaterial, listTicketMaterials } from 'server/src/lib/actions/materialActions';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { resolveClientBillingCurrency } from 'server/src/lib/actions/billingCurrencyActions';
import { IService } from 'server/src/interfaces/billing.interfaces';
import { ITicketMaterial } from 'server/src/interfaces/material.interfaces';

interface TicketMaterialsCardProps {
  ticketId: string;
  clientId: string;
  currencyCode: string;
}

const TicketMaterialsCard: React.FC<TicketMaterialsCardProps> = ({ ticketId, clientId, currencyCode }) => {
  const [resolvedCurrencyCode, setResolvedCurrencyCode] = useState(currencyCode || 'USD');
  const [materials, setMaterials] = useState<ITicketMaterial[]>([]);
  const [products, setProducts] = useState<IService[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [rateInput, setRateInput] = useState<string>('');
  const [description, setDescription] = useState<string>('');

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [materialToDelete, setMaterialToDelete] = useState<ITicketMaterial | null>(null);

  const currencySymbol = getCurrencySymbol(resolvedCurrencyCode || 'USD');

  const fetchMaterials = async () => {
    try {
      const rows = await listTicketMaterials(ticketId);
      setMaterials(rows);
    } catch (e) {
      console.error('[TicketMaterialsCard] Failed to fetch materials:', e);
      setError('Failed to load ticket materials');
    }
  };

  const fetchProducts = async () => {
    try {
      const response = await getServices(1, 1000, { item_kind: 'product', is_active: true });
      setProducts(response.services);
    } catch (e) {
      console.error('[TicketMaterialsCard] Failed to fetch products:', e);
      setError('Failed to load products');
    }
  };

  useEffect(() => {
    if (!ticketId || !clientId) return;
    fetchMaterials();
    fetchProducts();
    resolveClientBillingCurrency(clientId)
      .then((code) => setResolvedCurrencyCode(code || 'USD'))
      .catch((e) => {
        console.warn('[TicketMaterialsCard] Failed to resolve billing currency, using fallback:', e);
        setResolvedCurrencyCode(currencyCode || 'USD');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, clientId]);

  const productOptions = useMemo(() => {
    return [
      { value: '', label: 'Select product...' },
      ...products.map((p) => ({
        value: p.service_id,
        label: p.sku ? `${p.service_name} (${p.sku})` : p.service_name
      }))
    ];
  }, [products]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.service_id === selectedProductId) || null,
    [products, selectedProductId]
  );

  useEffect(() => {
    if (!selectedProduct) return;
    const currencyPrice = selectedProduct.prices?.find((p) => p.currency_code === resolvedCurrencyCode)?.rate;
    const cents = currencyPrice ?? selectedProduct.default_rate ?? 0;
    setRateInput((cents / 100).toFixed(2));
  }, [selectedProduct, resolvedCurrencyCode]);

  const resetAddForm = () => {
    setSelectedProductId('');
    setQuantity(1);
    setRateInput('');
    setDescription('');
  };

  const handleAdd = async () => {
    if (!selectedProductId) {
      setError('Select a product');
      return;
    }
    const dollars = parseFloat(rateInput) || 0;
    const rateCents = Math.round(dollars * 100);
    if (rateCents <= 0) {
      setError('Rate must be greater than 0');
      return;
    }
    if (quantity <= 0) {
      setError('Quantity must be greater than 0');
      return;
    }

    try {
      await addTicketMaterial({
        ticket_id: ticketId,
        client_id: clientId,
        service_id: selectedProductId,
        quantity,
        rate: rateCents,
        currency_code: resolvedCurrencyCode || 'USD',
        description: description.trim() ? description.trim() : null
      });
      setIsAddOpen(false);
      resetAddForm();
      await fetchMaterials();
      setError(null);
    } catch (e) {
      console.error('[TicketMaterialsCard] Failed to add material:', e);
      setError(e instanceof Error ? e.message : 'Failed to add material');
    }
  };

  const confirmDelete = async () => {
    if (!materialToDelete) return;
    try {
      await deleteTicketMaterial(materialToDelete.ticket_material_id);
      setIsDeleteOpen(false);
      setMaterialToDelete(null);
      await fetchMaterials();
    } catch (e) {
      console.error('[TicketMaterialsCard] Failed to delete material:', e);
      setError(e instanceof Error ? e.message : 'Failed to delete material');
      setIsDeleteOpen(false);
      setMaterialToDelete(null);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">Materials</h3>
            <Button id="ticket-materials-open-add-button" size="sm" onClick={() => setIsAddOpen(true)}>Add</Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && <div className="text-red-500 text-sm mb-2">{error}</div>}
          {materials.length === 0 ? (
            <div className="text-sm text-gray-500">No materials recorded.</div>
          ) : (
            <div className="space-y-2">
              {materials.map((m) => {
                const lineTotal = (m.rate || 0) * (m.quantity || 0);
                return (
                  <div key={m.ticket_material_id} className="flex items-start justify-between gap-3 border rounded-md p-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {m.description || m.service_name || m.service_id}
                      </div>
                      <div className="text-xs text-gray-600">
                        Qty {m.quantity} · {currencySymbol}{(m.rate / 100).toFixed(2)} · Total {currencySymbol}{(lineTotal / 100).toFixed(2)}
                      </div>
                      <div className="text-xs text-gray-500">
                        {m.is_billed ? 'Billed' : 'Unbilled'}
                      </div>
                    </div>
                    {!m.is_billed && (
                      <Button
                        id={`ticket-materials-delete-${m.ticket_material_id}`}
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => {
                          setMaterialToDelete(m);
                          setIsDeleteOpen(true);
                        }}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        isOpen={isAddOpen}
        onClose={() => {
          setIsAddOpen(false);
          resetAddForm();
        }}
        title="Add Material"
      >
        <DialogContent>
          <div className="space-y-3">
            <CustomSelect
              label="Product"
              options={productOptions}
              value={selectedProductId}
              onValueChange={setSelectedProductId}
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                <Input
                  type="number"
                  value={quantity}
                  min={1}
                  onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rate ({resolvedCurrencyCode})</label>
                <Input
                  value={rateInput}
                  onChange={(e) => setRateInput(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button id="ticket-materials-add-cancel-button" variant="secondary" onClick={() => setIsAddOpen(false)}>Cancel</Button>
          <Button id="ticket-materials-add-submit-button" onClick={handleAdd}>Add</Button>
        </DialogFooter>
      </Dialog>

      <ConfirmationDialog
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={confirmDelete}
        title="Delete Material"
        message="Delete this material entry?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </>
  );
};

export default TicketMaterialsCard;
