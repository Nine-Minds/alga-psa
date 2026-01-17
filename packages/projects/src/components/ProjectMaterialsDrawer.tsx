'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { getCurrencySymbol } from 'server/src/constants/currency';
import { addProjectMaterial, deleteProjectMaterial, listProjectMaterials } from 'server/src/lib/actions/materialActions';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { resolveClientBillingCurrency } from 'server/src/lib/actions/billingCurrencyActions';
import { IService } from 'server/src/interfaces/billing.interfaces';
import { IProjectMaterial } from 'server/src/interfaces/material.interfaces';

interface ProjectMaterialsDrawerProps {
  projectId: string;
  clientId: string;
  currencyCode: string;
  onClose: () => void;
}

const ProjectMaterialsDrawer: React.FC<ProjectMaterialsDrawerProps> = ({ projectId, clientId, currencyCode, onClose }) => {
  const [resolvedCurrencyCode, setResolvedCurrencyCode] = useState(currencyCode || 'USD');
  const [materials, setMaterials] = useState<IProjectMaterial[]>([]);
  const [products, setProducts] = useState<IService[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [rateInput, setRateInput] = useState<string>('');
  const [description, setDescription] = useState<string>('');

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [materialToDelete, setMaterialToDelete] = useState<IProjectMaterial | null>(null);

  const currencySymbol = getCurrencySymbol(resolvedCurrencyCode || 'USD');

  const fetchMaterials = async () => {
    try {
      const rows = await listProjectMaterials(projectId);
      setMaterials(rows);
    } catch (e) {
      console.error('[ProjectMaterialsDrawer] Failed to fetch materials:', e);
      setError('Failed to load project materials');
    }
  };

  const fetchProducts = async () => {
    try {
      const response = await getServices(1, 1000, { item_kind: 'product', is_active: true });
      setProducts(response.services);
    } catch (e) {
      console.error('[ProjectMaterialsDrawer] Failed to fetch products:', e);
      setError('Failed to load products');
    }
  };

  useEffect(() => {
    fetchMaterials();
    fetchProducts();
    resolveClientBillingCurrency(clientId)
      .then((code) => setResolvedCurrencyCode(code || 'USD'))
      .catch((e) => {
        console.warn('[ProjectMaterialsDrawer] Failed to resolve billing currency, using fallback:', e);
        setResolvedCurrencyCode(currencyCode || 'USD');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

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

  const resetForm = () => {
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
      await addProjectMaterial({
        project_id: projectId,
        client_id: clientId,
        service_id: selectedProductId,
        quantity,
        rate: rateCents,
        currency_code: resolvedCurrencyCode || 'USD',
        description: description.trim() ? description.trim() : null
      });
      resetForm();
      await fetchMaterials();
      setError(null);
    } catch (e) {
      console.error('[ProjectMaterialsDrawer] Failed to add material:', e);
      setError(e instanceof Error ? e.message : 'Failed to add material');
    }
  };

  const confirmDelete = async () => {
    if (!materialToDelete) return;
    try {
      await deleteProjectMaterial(materialToDelete.project_material_id);
      setIsDeleteOpen(false);
      setMaterialToDelete(null);
      await fetchMaterials();
    } catch (e) {
      console.error('[ProjectMaterialsDrawer] Failed to delete material:', e);
      setError(e instanceof Error ? e.message : 'Failed to delete material');
      setIsDeleteOpen(false);
      setMaterialToDelete(null);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Project Materials</h2>
        <Button id="project-materials-close-button" variant="secondary" onClick={onClose}>Close</Button>
      </div>

      {error && <div className="text-red-500 text-sm">{error}</div>}

      <div className="border rounded-md p-3 space-y-3">
        <h3 className="text-sm font-medium text-gray-800">Add material</h3>
        <CustomSelect label="Product" options={productOptions} value={selectedProductId} onValueChange={setSelectedProductId} />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
            <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rate ({resolvedCurrencyCode})</label>
            <Input value={rateInput} onChange={(e) => setRateInput(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button id="project-materials-clear-button" variant="secondary" onClick={resetForm}>Clear</Button>
          <Button id="project-materials-add-button" onClick={handleAdd}>Add</Button>
        </div>
      </div>

      <div className="space-y-2">
        {materials.length === 0 ? (
          <div className="text-sm text-gray-500">No materials recorded.</div>
        ) : (
          materials.map((m) => {
            const lineTotal = (m.rate || 0) * (m.quantity || 0);
            return (
              <div key={m.project_material_id} className="flex items-start justify-between gap-3 border rounded-md p-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{m.description || m.service_name || m.service_id}</div>
                  <div className="text-xs text-gray-600">
                    Qty {m.quantity} · {currencySymbol}{(m.rate / 100).toFixed(2)} · Total {currencySymbol}{(lineTotal / 100).toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-500">{m.is_billed ? 'Billed' : 'Unbilled'}</div>
                </div>
                {!m.is_billed && (
                  <Button
                    id={`project-materials-delete-${m.project_material_id}`}
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
          })
        )}
      </div>

      <ConfirmationDialog
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={confirmDelete}
        title="Delete Material"
        message="Delete this material entry?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </div>
  );
};

export default ProjectMaterialsDrawer;
