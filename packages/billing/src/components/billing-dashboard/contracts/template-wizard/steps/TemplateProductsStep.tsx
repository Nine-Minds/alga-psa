'use client';

import React, { useMemo } from 'react';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { ServiceCatalogPicker, ServiceCatalogPickerItem } from '../../ServiceCatalogPicker';
import { Plus, X, Package } from 'lucide-react';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { TemplateWizardData } from '../TemplateWizard';
import { TemplateServicePreviewSection } from '../TemplateServicePreviewSection';

interface TemplateProductsStepProps {
  data: TemplateWizardData;
  updateData: (data: Partial<TemplateWizardData>) => void;
}

export function TemplateProductsStep({ data, updateData }: TemplateProductsStepProps) {
  const handleAddProduct = () => {
    updateData({
      product_services: [
        ...data.product_services,
        { service_id: '', service_name: '', quantity: 1 },
      ],
    });
  };

  const handleRemoveProduct = (index: number) => {
    const next = data.product_services.filter((_, i) => i !== index);
    updateData({ product_services: next });
  };

  const handleProductChange = (index: number, item: ServiceCatalogPickerItem) => {
    const next = [...data.product_services];
    next[index] = {
      ...next[index],
      service_id: item.service_id,
      service_name: item.service_name,
    };
    updateData({ product_services: next });
  };

  const handleQuantityChange = (index: number, quantity: number) => {
    const next = [...data.product_services];
    next[index] = { ...next[index], quantity };
    updateData({ product_services: next });
  };

  const previewProducts = useMemo(() => {
    return (data.product_services || [])
      .filter((line) => line.service_id)
      .map((line) => ({
        id: `product-${line.service_id}`,
        name: line.service_name || 'Unknown Product',
        quantity: line.quantity ?? 1,
        serviceId: line.service_id,
      }));
  }, [data.product_services]);

  const handlePreviewQuantityChange = (itemId: string, quantity: number) => {
    if (!itemId.startsWith('product-')) return;
    const serviceId = itemId.replace('product-', '');
    const idx = data.product_services.findIndex((s) => s.service_id === serviceId);
    if (idx !== -1) {
      handleQuantityChange(idx, quantity);
    }
  };

  const handlePreviewRemove = (itemId: string) => {
    if (!itemId.startsWith('product-')) return;
    const serviceId = itemId.replace('product-', '');
    const idx = data.product_services.findIndex((s) => s.service_id === serviceId);
    if (idx !== -1) {
      handleRemoveProduct(idx);
    }
  };

  return (
    <ReflectionContainer id="template-products-step">
      <div className="space-y-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Products</h3>
          <p className="text-sm text-gray-600">
            Attach products to the template. When a contract is created from this template, products
            will be billed each cycle using the product catalog price for the contract currency.
          </p>
        </div>

        <TemplateServicePreviewSection
          services={previewProducts}
          serviceType="products"
          onQuantityChange={handlePreviewQuantityChange}
          onRemoveService={handlePreviewRemove}
        />

        <div className="space-y-4">
          <Label className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Products
          </Label>

          {data.product_services.map((product, index) => (
            <div
              key={index}
              className="flex items-start gap-3 p-4 border border-gray-200 rounded-md bg-gray-50"
            >
              <div className="flex-1 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`template-product-${index}`} className="text-sm">
                    Product {index + 1}
                  </Label>
                  <ServiceCatalogPicker
                    id={`template-product-${index}`}
                    value={product.service_id}
                    selectedLabel={product.service_name}
                    onSelect={(item) => handleProductChange(index, item)}
                    itemKinds={['product']}
                    placeholder="Select a product"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`template-product-quantity-${index}`} className="text-sm">
                    Quantity (Optional)
                  </Label>
                  <Input
                    id={`template-product-quantity-${index}`}
                    type="number"
                    min="1"
                    value={product.quantity ?? 1}
                    onChange={(event) =>
                      handleQuantityChange(index, Math.max(1, Number(event.target.value) || 1))
                    }
                    className="w-24"
                  />
                  <p className="text-xs text-gray-500">Suggested quantity when creating contracts</p>
                </div>
              </div>

              <Button
                id={`template-products-remove-${index}`}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveProduct(index)}
                className="mt-8 text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <Button
            id="template-products-add"
            type="button"
            variant="secondary"
            onClick={handleAddProduct}
            className="inline-flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Product
          </Button>
        </div>
      </div>
    </ReflectionContainer>
  );
}

