'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Badge } from '@alga-psa/ui/components/Badge';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Plus, Trash2, Package, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import SearchableSelect from '@alga-psa/ui/components/SearchableSelect';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import type { ITicketMaterial, IServicePrice } from '@alga-psa/types';
import {
  listTicketMaterials,
  addTicketMaterial,
  deleteTicketMaterial,
  searchServiceCatalogForPicker,
  getServicePrices,
  type CatalogPickerItem,
} from '@alga-psa/billing/actions';
import styles from './TicketDetails.module.css';

interface TicketMaterialsCardProps {
  id?: string;
  ticketId: string;
  clientId?: string | null;
}

export default function TicketMaterialsCard({
  id = 'ticket-materials-card',
  ticketId,
  clientId,
}: TicketMaterialsCardProps) {
  const [materials, setMaterials] = useState<ITicketMaterial[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Add form state
  const [products, setProducts] = useState<CatalogPickerItem[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [productPrices, setProductPrices] = useState<IServicePrice[]>([]);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [description, setDescription] = useState<string>('');
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [isLoadingPrices, setIsLoadingPrices] = useState(false);

  // Load materials
  const loadMaterials = useCallback(async () => {
    if (!ticketId) return;

    setIsLoading(true);
    try {
      const data = await listTicketMaterials(ticketId);
      setMaterials(data);
    } catch (error) {
      console.error('Error loading materials:', error);
      toast.error('Failed to load materials');
    } finally {
      setIsLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    loadMaterials();
  }, [loadMaterials]);

  // Load products when form opens
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

  // Load products when form opens
  useEffect(() => {
    if (showAddForm && products.length === 0) {
      loadProducts();
    }
  }, [showAddForm, products.length, loadProducts]);

  // Load product prices when product is selected
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
        // Auto-select first currency if available
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

  // Get selected price details
  const selectedPrice = productPrices.find(p => p.currency_code === selectedCurrency);

  // Handle add material
  const handleAddMaterial = async () => {
    if (!selectedProductId || !clientId) {
      toast.error('Please select a product');
      return;
    }

    if (!selectedPrice) {
      toast.error('Please select a currency');
      return;
    }

    if (quantity < 1) {
      toast.error('Quantity must be at least 1');
      return;
    }

    setIsAdding(true);
    try {
      await addTicketMaterial({
        ticket_id: ticketId,
        client_id: clientId,
        service_id: selectedProductId,
        quantity,
        rate: selectedPrice.rate,
        currency_code: selectedPrice.currency_code,
        description: description.trim() || null,
      });

      toast.success('Material added');
      setShowAddForm(false);
      setSelectedProductId('');
      setProductPrices([]);
      setSelectedCurrency('');
      setQuantity(1);
      setDescription('');
      await loadMaterials();
    } catch (error) {
      console.error('Error adding material:', error);
      toast.error('Failed to add material');
    } finally {
      setIsAdding(false);
    }
  };

  // Handle delete material
  const handleDeleteMaterial = async (materialId: string) => {
    setDeletingId(materialId);
    try {
      await deleteTicketMaterial(materialId);
      toast.success('Material removed');
      await loadMaterials();
    } catch (error) {
      console.error('Error deleting material:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to remove material');
    } finally {
      setDeletingId(null);
    }
  };

  // Calculate total for a material
  const calculateTotal = (mat: ITicketMaterial) => mat.quantity * mat.rate;

  // Group unbilled materials by currency for proper totals
  const unbilledByCurrency = materials
    .filter(m => !m.is_billed)
    .reduce((acc, m) => {
      const curr = m.currency_code || 'USD';
      if (!acc[curr]) acc[curr] = 0;
      acc[curr] += calculateTotal(m);
      return acc;
    }, {} as Record<string, number>);

  const productOptions = products.map(p => ({
    value: p.service_id,
    label: p.sku ? `${p.service_name} (${p.sku})` : p.service_name,
  }));

  const currencyOptions = productPrices.map(p => ({
    value: p.currency_code,
    label: `${p.currency_code} - ${formatCurrencyFromMinorUnits(p.rate, 'en-US', p.currency_code)}`,
  }));

  return (
    <ReflectionContainer id={id} label="Ticket Materials">
      <div {...withDataAutomationId({ id })} className={`${styles['card']} p-6 space-y-4`}>
        <div className="flex items-center justify-between">
          <h2 className={`${styles['panel-header']}`}>
            <Package className="inline-block w-5 h-5 mr-2" />
            Materials
          </h2>
          {clientId && !showAddForm && (
            <Button
              {...withDataAutomationId({ id: `${id}-add-btn` })}
              variant="outline"
              size="sm"
              onClick={() => setShowAddForm(true)}
            >
              <Plus className="w-4 h-4 mr-1" />
              Add
            </Button>
          )}
        </div>

        {/* Add Form */}
        {showAddForm && clientId && (
          <div className="border rounded-md p-4 space-y-4 bg-gray-50">
            <div className="space-y-2">
              <Label htmlFor={`${id}-product-select`}>Product</Label>
              <SearchableSelect
                id={`${id}-product-select`}
                options={productOptions}
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

            {/* Price/Currency selection */}
            {selectedProductId && (
              <div className="space-y-2">
                <Label htmlFor={`${id}-currency-select`}>Price</Label>
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
                    {formatCurrencyFromMinorUnits(productPrices[0].rate, 'en-US', productPrices[0].currency_code)}
                  </div>
                ) : (
                  <CustomSelect
                    id={`${id}-currency-select`}
                    options={currencyOptions}
                    value={selectedCurrency}
                    onValueChange={setSelectedCurrency}
                    placeholder="Select currency..."
                  />
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor={`${id}-quantity`}>Quantity</Label>
                <Input
                  {...withDataAutomationId({ id: `${id}-quantity` })}
                  id={`${id}-quantity`}
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                />
              </div>
              <div className="space-y-2">
                <Label>Total</Label>
                <div className="h-10 px-3 py-2 bg-white border rounded-md text-gray-700 flex items-center">
                  {selectedPrice
                    ? formatCurrencyFromMinorUnits(selectedPrice.rate * quantity, 'en-US', selectedPrice.currency_code)
                    : '-'}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${id}-description`}>Description (optional)</Label>
              <Input
                {...withDataAutomationId({ id: `${id}-description` })}
                id={`${id}-description`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Additional notes..."
              />
            </div>

            <div className="flex justify-end space-x-2">
              <Button
                {...withDataAutomationId({ id: `${id}-cancel-add-btn` })}
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowAddForm(false);
                  setSelectedProductId('');
                  setProductPrices([]);
                  setSelectedCurrency('');
                  setQuantity(1);
                  setDescription('');
                }}
              >
                Cancel
              </Button>
              <Button
                {...withDataAutomationId({ id: `${id}-save-add-btn` })}
                size="sm"
                onClick={handleAddMaterial}
                disabled={isAdding || !selectedProductId || !selectedPrice}
              >
                {isAdding ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    Adding...
                  </>
                ) : (
                  'Add Material'
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Materials List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-gray-500">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Loading materials...
          </div>
        ) : materials.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No materials added to this ticket.
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
                    <th className="pb-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {materials.map((material) => (
                    <tr key={material.ticket_material_id} className="border-b last:border-0">
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
                      <td className="py-2 text-right">
                        {!material.is_billed && (
                          <Button
                            {...withDataAutomationId({ id: `${id}-delete-${material.ticket_material_id}` })}
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteMaterial(material.ticket_material_id)}
                            disabled={deletingId === material.ticket_material_id}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 h-auto"
                          >
                            {deletingId === material.ticket_material_id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Summary - show totals per currency */}
            {Object.keys(unbilledByCurrency).length > 0 && (
              <div className="flex justify-end pt-2 border-t">
                <div className="text-sm space-y-1">
                  {Object.entries(unbilledByCurrency).map(([curr, total]) => (
                    <div key={curr} className="text-right">
                      <span className="text-gray-500">Unbilled ({curr}): </span>
                      <span className="font-semibold">
                        {formatCurrencyFromMinorUnits(total, 'en-US', curr)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!clientId && (
          <div className="text-center py-4 text-amber-600 text-sm">
            A client must be assigned to this ticket before materials can be added.
          </div>
        )}
      </div>
    </ReflectionContainer>
  );
}
