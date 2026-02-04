'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Label } from '@alga-psa/ui/components/Label';
import SearchableSelect from '@alga-psa/ui/components/SearchableSelect';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { Package, Plus, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { IProjectMaterial, IServicePrice } from '@alga-psa/types';
import {
  listProjectMaterials,
  searchServiceCatalogForPicker,
  getServicePrices,
  type CatalogPickerItem,
} from '@alga-psa/billing/actions';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';

interface ProjectMaterialsDrawerProps {
  projectId: string;
  clientId?: string | null;
}

export default function ProjectMaterialsDrawer({ projectId }: ProjectMaterialsDrawerProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [materials, setMaterials] = useState<IProjectMaterial[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [products, setProducts] = useState<CatalogPickerItem[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [productPrices, setProductPrices] = useState<IServicePrice[]>([]);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('');
  const [isLoadingPrices, setIsLoadingPrices] = useState(false);
  const [quantity, setQuantity] = useState<number>(1);
  const [description, setDescription] = useState<string>('');

  const loadMaterials = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const data = await listProjectMaterials(projectId);
      setMaterials(data);
    } catch (error) {
      console.error('Error loading materials:', error);
      toast.error('Failed to load materials');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadMaterials();
  }, [loadMaterials]);

  const loadProducts = useCallback(async () => {
    setIsLoadingProducts(true);
    try {
      const result = await searchServiceCatalogForPicker({
        item_kinds: ['product'],
        is_active: true,
        limit: 100,
      });
      setProducts(result.items);
    } catch (error) {
      console.error('Error loading products:', error);
      toast.error('Failed to load products');
    } finally {
      setIsLoadingProducts(false);
    }
  }, []);

  useEffect(() => {
    if (showAddForm && products.length === 0) {
      loadProducts();
    }
  }, [showAddForm, products.length, loadProducts]);

  useEffect(() => {
    if (!selectedProductId) {
      setProductPrices([]);
      setSelectedCurrency('');
      return;
    }

    const loadPrices = async () => {
      setIsLoadingPrices(true);
      try {
        const prices = await getServicePrices(selectedProductId);
        setProductPrices(prices);
        if (prices.length > 0) {
          setSelectedCurrency(prices[0].currency_code);
        } else {
          setSelectedCurrency('');
        }
      } catch (error) {
        console.error('Error loading product prices:', error);
        setProductPrices([]);
        setSelectedCurrency('');
      } finally {
        setIsLoadingPrices(false);
      }
    };

    loadPrices();
  }, [selectedProductId]);

  const calculateTotal = (material: IProjectMaterial) => material.quantity * material.rate;

  const unbilledByCurrency = materials
    .filter((material) => !material.is_billed)
    .reduce((acc, material) => {
      const currency = material.currency_code || 'USD';
      if (!acc[currency]) acc[currency] = 0;
      acc[currency] += calculateTotal(material);
      return acc;
    }, {} as Record<string, number>);

  const selectedPrice = productPrices.find((price) => price.currency_code === selectedCurrency);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Package className="w-5 h-5" />
          Materials
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAddForm(true)}
        >
          <Plus className="w-4 h-4 mr-1" />
          Add
        </Button>
      </div>

      {showAddForm && (
        <div className="border rounded-md p-4 space-y-4 bg-gray-50">
          <div className="space-y-2">
            <Label htmlFor="project-materials-product-select">Product</Label>
            <SearchableSelect
              id="project-materials-product-select"
              options={products.map((product) => ({
                value: product.service_id,
                label: product.sku ? `${product.service_name} (${product.sku})` : product.service_name,
              }))}
              value={selectedProductId}
              onChange={(value) => {
                setSelectedProductId(value);
                setSelectedCurrency('');
              }}
              placeholder="Select a product..."
              searchPlaceholder="Search products..."
              emptyMessage={isLoadingProducts ? 'Loading products...' : 'No products found'}
              dropdownMode="overlay"
              maxListHeight="200px"
              disabled={isLoadingProducts}
            />
          </div>

          {selectedProductId && (
            <div className="space-y-2">
              <Label htmlFor="project-materials-currency-select">Price</Label>
              {isLoadingPrices ? (
                <div className="flex items-center text-sm text-gray-500">
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Loading prices...
                </div>
              ) : productPrices.length === 0 ? (
                <div className="text-sm text-amber-600">
                  No prices configured for this product
                </div>
              ) : productPrices.length === 1 ? (
                <div className="h-10 px-3 py-2 bg-white border rounded-md text-gray-700 flex items-center">
                  {formatCurrencyFromMinorUnits(
                    productPrices[0].rate,
                    'en-US',
                    productPrices[0].currency_code
                  )}
                </div>
              ) : (
                <CustomSelect
                  id="project-materials-currency-select"
                  options={productPrices.map((price) => ({
                    value: price.currency_code,
                    label: `${price.currency_code} - ${formatCurrencyFromMinorUnits(price.rate, 'en-US', price.currency_code)}`,
                  }))}
                  value={selectedCurrency}
                  onValueChange={setSelectedCurrency}
                  placeholder="Select currency..."
                />
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="project-materials-quantity">Quantity</Label>
              <Input
                id="project-materials-quantity"
                type="number"
                min={1}
                value={quantity}
                onChange={(event) => setQuantity(Math.max(1, parseInt(event.target.value) || 1))}
              />
            </div>
            <div className="space-y-2">
              <Label>Total</Label>
              <div className="h-10 px-3 py-2 bg-white border rounded-md text-gray-700 flex items-center">
                {selectedPrice
                  ? formatCurrencyFromMinorUnits(
                      selectedPrice.rate * quantity,
                      'en-US',
                      selectedPrice.currency_code
                    )
                  : '-'}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="project-materials-description">Description (optional)</Label>
            <Input
              id="project-materials-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Additional notes..."
            />
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-6 text-gray-500">
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          Loading materials...
        </div>
      ) : materials.length === 0 ? (
        <div className="text-center py-6 text-gray-500">
          No materials added to this project.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 font-medium">Product</th>
                  <th className="pb-2 font-medium text-right">Qty</th>
                  <th className="pb-2 font-medium text-right">Rate</th>
                  <th className="pb-2 font-medium text-right">Total</th>
                  <th className="pb-2 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((material) => (
                  <tr key={material.project_material_id} className="border-b last:border-0">
                    <td className="py-2">
                      <div>
                        <span className="font-medium">{material.service_name || 'Unknown Product'}</span>
                        {material.sku && (
                          <span className="text-gray-500 ml-1">({material.sku})</span>
                        )}
                      </div>
                      {material.description && (
                        <div className="text-xs text-gray-500">{material.description}</div>
                      )}
                    </td>
                    <td className="py-2 text-right">{material.quantity}</td>
                    <td className="py-2 text-right">
                      {formatCurrencyFromMinorUnits(material.rate, 'en-US', material.currency_code)}
                    </td>
                    <td className="py-2 text-right font-medium">
                      {formatCurrencyFromMinorUnits(calculateTotal(material), 'en-US', material.currency_code)}
                    </td>
                    <td className="py-2 text-center">
                      {material.is_billed ? (
                        <Badge variant="default">Billed</Badge>
                      ) : (
                        <Badge variant="outline">Pending</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {Object.keys(unbilledByCurrency).length > 0 && (
            <div className="flex justify-end pt-2 border-t">
              <div className="text-sm space-y-1">
                {Object.entries(unbilledByCurrency).map(([currency, total]) => (
                  <div key={currency} className="text-right">
                    <span className="text-gray-500">Unbilled ({currency}): </span>
                    <span className="font-semibold">
                      {formatCurrencyFromMinorUnits(total, 'en-US', currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
