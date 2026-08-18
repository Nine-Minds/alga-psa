'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Label } from '@alga-psa/ui/components/Label';
import AsyncSearchableSelect, { type SelectOption } from '@alga-psa/ui/components/AsyncSearchableSelect';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { Package, Plus, Loader2, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import {
  getErrorMessage,
  handleError,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import type { IProjectMaterial, IServicePrice, IStockUnit, ProjectMaterialBillingDestination } from '@alga-psa/types';
import {
  listProjectMaterials,
  searchServiceCatalogForPicker,
  addProjectMaterial,
  getServicePrices,
  deleteProjectMaterial,
  getProjectMaterialBillingOptions,
  listAvailableStockUnitsForMaterial,
  updateProjectMaterial,
} from '../actions/materialCatalogActions';
import {
  useProjectBillingIntegration,
  type SeparateProjectProductInvoiceReview,
} from '../context/ProjectBillingIntegrationContext';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import {
  getProductAvailability,
  type ProductAvailability,
} from '@alga-psa/inventory/actions/availabilityActions';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { useTranslation } from 'react-i18next';

interface ProjectMaterialsDrawerProps {
  id?: string;
  projectId: string;
  clientId?: string | null;
}

const isReturnedActionError = (result: unknown) => (
  isActionMessageError(result) || isActionPermissionError(result)
);

// On-hand badge for tracked products in the picker (F016): red at zero, amber at/below
// reorder point, plain otherwise. Untracked products and rows whose stock fields haven't
// loaded yet (undefined) get no badge.
function onHandBadge(fields: {
  track_stock?: boolean;
  on_hand_total?: number | null;
  reorder_point?: number | null;
}): SelectOption['badge'] | undefined {
  if (!fields.track_stock || fields.on_hand_total == null) return undefined;
  const onHand = fields.on_hand_total;
  const variant =
    onHand <= 0 ? 'danger' : fields.reorder_point != null && onHand <= fields.reorder_point ? 'warning' : 'secondary';
  return { text: `On hand: ${onHand}`, variant };
}

export default function ProjectMaterialsDrawer({
  id = 'project-materials-drawer',
  projectId,
  clientId,
}: ProjectMaterialsDrawerProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const { money } = useCurrencyFormat();
  const billingIntegration = useProjectBillingIntegration();
  const materialsT = useCallback((key: string, fallback: string, options?: Record<string, unknown>) =>
    t(`materials.${key}`, { defaultValue: fallback, ...(options ?? {}) }), [t]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [materials, setMaterials] = useState<IProjectMaterial[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [selectedProductLabel, setSelectedProductLabel] = useState<string>('');
  const [productPrices, setProductPrices] = useState<IServicePrice[]>([]);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('');
  const [saleRate, setSaleRate] = useState<number>(0);
  const [selectedCatalogCost, setSelectedCatalogCost] = useState<{ cost: number; currency: string } | null>(null);
  const catalogCostByProductId = useRef(new Map<string, { cost: number; currency: string } | null>());
  const [projectCurrency, setProjectCurrency] = useState<string | null>(null);
  const [billingOptions, setBillingOptions] = useState<Array<{ schedule_entry_id: string; description: string; phase_name: string | null }>>([]);
  const [billingDestination, setBillingDestination] = useState<ProjectMaterialBillingDestination>('next_project_invoice');
  const [billingScheduleEntryId, setBillingScheduleEntryId] = useState<string | null>(null);
  const [isLoadingPrices, setIsLoadingPrices] = useState(false);
  const [quantity, setQuantity] = useState<number>(1);
  const [description, setDescription] = useState<string>('');
  const [isAdding, setIsAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [availableUnits, setAvailableUnits] = useState<IStockUnit[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  // Per-location on-hand for the selected tracked product (F016), advisory only.
  const [availability, setAvailability] = useState<ProductAvailability | null>(null);
  // Inline add error (F018) — e.g. insufficient stock — shown in the form so the user's inputs survive.
  const [addError, setAddError] = useState<string | null>(null);
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState<number>(0);
  const [editDestination, setEditDestination] = useState<ProjectMaterialBillingDestination>('next_project_invoice');
  const [editScheduleEntryId, setEditScheduleEntryId] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [invoiceReview, setInvoiceReview] = useState<SeparateProjectProductInvoiceReview | null>(null);
  const [selectedInvoiceRows, setSelectedInvoiceRows] = useState<Set<string>>(new Set());
  const [isLoadingInvoiceReview, setIsLoadingInvoiceReview] = useState(false);
  const [isCreatingProductInvoices, setIsCreatingProductInvoices] = useState(false);
  const [createdProductInvoices, setCreatedProductInvoices] = useState<Array<{ invoice_id: string; currency_code: string; product_count: number }> | null>(null);

  const loadMaterials = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const data = await listProjectMaterials(projectId);
      if (isReturnedActionError(data)) {
        handleError(data, materialsT('loadFailed', 'Failed to load materials'));
        setMaterials([]);
        return;
      }
      setMaterials(data);
    } catch (error) {
      handleError(error, materialsT('loadFailed', 'Failed to load materials'));
    } finally {
      setIsLoading(false);
    }
  }, [projectId, materialsT]);

  useEffect(() => {
    loadMaterials();
  }, [loadMaterials]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getProjectMaterialBillingOptions(projectId);
      if (cancelled || isReturnedActionError(result)) return;
      setProjectCurrency(result.project_currency);
      setBillingOptions(result.entries);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  // Server-side search for products via AsyncSearchableSelect
  const loadProductOptions = useCallback(
    async ({ search, page, limit }: { search: string; page: number; limit: number }) => {
      const result = await searchServiceCatalogForPicker({
        search,
        page,
        limit,
        item_kinds: ['product'],
        is_active: true,
      });

      const options: SelectOption[] = result.items.map((item) => {
        catalogCostByProductId.current.set(item.service_id, item.cost == null || !item.cost_currency
          ? null
          : { cost: item.cost, currency: item.cost_currency });
        return {
          value: item.service_id,
          label: item.sku ? `${item.service_name} (${item.sku})` : item.service_name,
          badge: onHandBadge(item),
        };
      });

      return { options, total: result.totalCount };
    },
    []
  );

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
          setSaleRate(prices[0].rate);
        } else {
          setSelectedCurrency('');
          setSaleRate(0);
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

  // Load available serialized stock units when a product is selected
  useEffect(() => {
    if (!selectedProductId) {
      setAvailableUnits([]);
      setSelectedUnitId('');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const units = await listAvailableStockUnitsForMaterial(selectedProductId);
        if (!cancelled) { setAvailableUnits(units); setSelectedUnitId(''); }
      } catch {
        if (!cancelled) setAvailableUnits([]);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedProductId]);

  // Per-location on-hand for the selected product (F016). Advisory only — a failure
  // (e.g. the availability action unavailable) leaves the form fully usable.
  useEffect(() => {
    if (!selectedProductId) {
      setAvailability(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [result] = await getProductAvailability([selectedProductId]);
        if (!cancelled) setAvailability(result ?? null);
      } catch {
        if (!cancelled) setAvailability(null);
      }
    })();
    return () => { cancelled = true; };
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
  const editingMaterial = materials.find((material) => material.project_material_id === editingMaterialId) ?? null;
  const invoiceReviewByCurrency = (invoiceReview?.rows ?? []).reduce((groups, row) => {
    if (!selectedInvoiceRows.has(row.project_material_id)) return groups;
    const group = groups.get(row.currency_code) ?? [];
    group.push(row);
    groups.set(row.currency_code, group);
    return groups;
  }, new Map<string, SeparateProjectProductInvoiceReview['rows']>());

  useEffect(() => {
    if (!selectedPrice) return;
    setSaleRate(selectedPrice.rate);
    const mustBeSeparate = Boolean(projectCurrency && selectedPrice.currency_code !== projectCurrency);
    setBillingDestination(mustBeSeparate ? 'separate' : 'next_project_invoice');
    setBillingScheduleEntryId(null);
  }, [projectCurrency, selectedPrice]);

  const resetAddForm = () => {
    setShowAddForm(false);
    setSelectedProductId('');
    setSelectedProductLabel('');
    setProductPrices([]);
    setSelectedCurrency('');
    setSaleRate(0);
    setSelectedCatalogCost(null);
    setBillingDestination('next_project_invoice');
    setBillingScheduleEntryId(null);
    setQuantity(1);
    setDescription('');
    setAvailableUnits([]);
    setSelectedUnitId('');
    setAddError(null);
  };

  const handleAddMaterial = async () => {
    if (!clientId || !selectedProductId) {
      toast.error(materialsT('selectProductError', 'Please select a product'));
      return;
    }

    if (!selectedPrice) {
      toast.error(materialsT('selectCurrencyError', 'Please select a currency'));
      return;
    }

    if (quantity < 1) {
      toast.error(materialsT('quantityMinError', 'Quantity must be at least 1'));
      return;
    }

    if (availableUnits.length > 0 && !selectedUnitId) {
      toast.error(materialsT('unitRequiredError', 'Please select a serial/unit to deliver'));
      return;
    }

    setIsAdding(true);
    setAddError(null);
    try {
      const result = await addProjectMaterial({
        project_id: projectId,
        client_id: clientId,
        service_id: selectedProductId,
        quantity,
        rate: saleRate,
        currency_code: selectedPrice.currency_code,
        description: description.trim() || null,
        unit_id: selectedUnitId || null,
        billing_destination: billingDestination,
        billing_schedule_entry_id: billingDestination === 'schedule_entry' ? billingScheduleEntryId : null,
      });
      if (isReturnedActionError(result)) {
        setAddError(getErrorMessage(result));
        return;
      }

      toast.success(materialsT('addedSuccess', 'Material added'));
      resetAddForm();
      await loadMaterials();
    } catch (error) {
      // Inline so the user keeps their inputs and sees the exact reason (e.g. the
      // available quantity the backend reports for insufficient stock) (F018).
      setAddError(error instanceof Error ? error.message : materialsT('addFailed', 'Failed to add material'));
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteMaterial = async (materialId: string) => {
    setDeletingId(materialId);
    // Optimistically remove from UI
    const previousMaterials = materials;
    setMaterials(prev => prev.filter(m => m.project_material_id !== materialId));
    try {
      const result = await deleteProjectMaterial(materialId);
      if (isReturnedActionError(result)) {
        setMaterials(previousMaterials);
        handleError(result, materialsT('removeFailed', 'Failed to remove material'));
        return;
      }
      toast.success(materialsT('removedSuccess', 'Material removed'));
    } catch (error) {
      // Revert on failure
      setMaterials(previousMaterials);
      handleError(error, materialsT('removeFailed', 'Failed to remove material'));
    } finally {
      setDeletingId(null);
    }
  };

  const billingDestinationOptions = [
    { value: 'next_project_invoice', label: materialsT('invoiceNextProject', 'Next project invoice') },
    ...billingOptions.map((entry) => ({
      value: `schedule:${entry.schedule_entry_id}`,
      label: entry.phase_name
        ? `${entry.phase_name} — ${entry.description}`
        : entry.description,
    })),
    { value: 'separate', label: materialsT('invoiceSeparate', 'Separate product invoice') },
    { value: 'project_completion', label: materialsT('invoiceProjectCompletion', 'When project is completed') },
    { value: 'on_hold', label: materialsT('invoiceOnHold', 'On hold') },
  ];

  const billingSelectValue = (
    destination: ProjectMaterialBillingDestination,
    scheduleEntryId: string | null,
  ) => destination === 'schedule_entry' && scheduleEntryId
    ? `schedule:${scheduleEntryId}`
    : destination;

  const applyBillingSelectValue = (
    value: string,
    setDestination: (destination: ProjectMaterialBillingDestination) => void,
    setScheduleEntryId: (entryId: string | null) => void,
  ) => {
    if (value.startsWith('schedule:')) {
      setDestination('schedule_entry');
      setScheduleEntryId(value.slice('schedule:'.length));
      return;
    }
    setDestination(value as ProjectMaterialBillingDestination);
    setScheduleEntryId(null);
  };

  const beginEditingMaterial = (material: IProjectMaterial) => {
    setEditingMaterialId(material.project_material_id);
    setEditRate(material.rate);
    setEditDestination(material.billing_destination);
    setEditScheduleEntryId(material.billing_schedule_entry_id ?? null);
  };

  const handleSaveMaterial = async () => {
    if (!editingMaterialId) return;
    setIsSavingEdit(true);
    try {
      const result = await updateProjectMaterial(editingMaterialId, {
        rate: editRate,
        billing_destination: editDestination,
        billing_schedule_entry_id: editDestination === 'schedule_entry' ? editScheduleEntryId : null,
      });
      if (isReturnedActionError(result)) {
        handleError(result, materialsT('updateFailed', 'Failed to update product'));
        return;
      }
      toast.success(materialsT('updatedSuccess', 'Product updated'));
      setEditingMaterialId(null);
      await loadMaterials();
    } catch (error) {
      handleError(error, materialsT('updateFailed', 'Failed to update product'));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const openInvoiceReview = async () => {
    if (!billingIntegration) return;
    setIsLoadingInvoiceReview(true);
    try {
      const result = await billingIntegration.getSeparateProjectProductInvoiceReview(projectId);
      if (isReturnedActionError(result)) {
        handleError(result, materialsT('invoiceReviewFailed', 'Failed to load invoice review'));
        return;
      }
      setInvoiceReview(result);
      setCreatedProductInvoices(null);
      setSelectedInvoiceRows(new Set(result.rows.map((row) => row.project_material_id)));
    } catch (error) {
      handleError(error, materialsT('invoiceReviewFailed', 'Failed to load invoice review'));
    } finally {
      setIsLoadingInvoiceReview(false);
    }
  };

  const handleCreateProductInvoices = async () => {
    if (!billingIntegration) return;
    setIsCreatingProductInvoices(true);
    try {
      const result = await billingIntegration.createSeparateProjectProductInvoices(projectId, [...selectedInvoiceRows]);
      if (isReturnedActionError(result)) {
        handleError(result, materialsT('invoiceCreateFailed', 'Failed to create product invoices'));
        return;
      }
      toast.success(materialsT('invoiceCreatedSuccess', '{{count}} draft product invoice(s) created', {
        count: result.invoices.length,
      }));
      await loadMaterials();
      if (result.invoices.length === 1) {
        window.location.assign(`/msp/billing?tab=invoicing&subtab=drafts&invoiceId=${result.invoices[0].invoice_id}`);
        return;
      }
      setCreatedProductInvoices(result.invoices);
    } catch (error) {
      handleError(error, materialsT('invoiceCreateFailed', 'Failed to create product invoices'));
    } finally {
      setIsCreatingProductInvoices(false);
    }
  };

  return (
    <ReflectionContainer id={id} label={materialsT('title', 'Project Materials')}>
      <div {...withDataAutomationId({ id })} className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Package className="w-5 h-5" />
            {materialsT('title', 'Project Materials')}
          </h2>
          <div className="flex items-center gap-2">
            {billingIntegration && materials.some((material) => !material.is_billed && material.billing_destination === 'separate') && (
              <Button
                {...withDataAutomationId({ id: `${id}-create-product-invoices-btn` })}
                variant="outline"
                size="sm"
                onClick={openInvoiceReview}
                disabled={isLoadingInvoiceReview}
              >
                {isLoadingInvoiceReview && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                {materialsT('createProductInvoices', 'Create product invoices')}
              </Button>
            )}
            {clientId && !showAddForm && (
              <Button
                {...withDataAutomationId({ id: `${id}-add-btn` })}
                variant="outline"
                size="sm"
                onClick={() => setShowAddForm(true)}
              >
                <Plus className="w-4 h-4 mr-1" />
                {t('common:actions.add', 'Add')}
              </Button>
            )}
          </div>
        </div>

        {showAddForm && clientId && (
          <div className="border rounded-md p-4 space-y-4 bg-gray-50">
            <div className="space-y-2">
              <Label htmlFor="project-materials-product-select">{materialsT('product', 'Product')}</Label>
              <AsyncSearchableSelect
                id="project-materials-product-select"
                value={selectedProductId}
                selectedLabel={selectedProductLabel}
                onChange={(value, option) => {
                  setSelectedProductId(value);
                  setSelectedProductLabel(option?.label ?? '');
                  setSelectedCatalogCost(catalogCostByProductId.current.get(value) ?? null);
                  setSelectedCurrency('');
                  setAddError(null);
                }}
                loadOptions={loadProductOptions}
                limit={10}
                debounceMs={300}
                placeholder={materialsT('selectProductPlaceholder', 'Select a product...')}
                searchPlaceholder={materialsT('searchProductsPlaceholder', 'Search products...')}
                emptyMessage={materialsT('noProductsFound', 'No products found')}
                dropdownMode="overlay"
                maxListHeight="200px"
                showMoreIndicator
              />
            </div>

            {selectedProductId && (
              <div className="space-y-2">
                <Label htmlFor="project-materials-currency-select">{materialsT('priceCurrency', 'Price currency')}</Label>
                {isLoadingPrices ? (
                  <div className="flex items-center text-sm text-gray-500">
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {materialsT('loadingPrices', 'Loading prices...')}
                  </div>
                ) : productPrices.length === 0 ? (
                  <div className="text-sm text-amber-600">
                    {materialsT('noPricesConfigured', 'No prices configured for this product')}
                  </div>
                ) : productPrices.length === 1 ? (
                  <div className="h-10 px-3 py-2 bg-white border rounded-md text-gray-700 flex items-center">
                    {productPrices[0].currency_code}
                  </div>
                ) : (
                  <CustomSelect
                    id="project-materials-currency-select"
                    options={productPrices.map((price) => ({
                      value: price.currency_code,
                      label: `${price.currency_code} - ${money(price.rate, price.currency_code)}`,
                    }))}
                    value={selectedCurrency}
                    onValueChange={setSelectedCurrency}
                    placeholder={materialsT('selectCurrencyPlaceholder', 'Select currency...')}
                  />
                )}
              </div>
            )}

            {selectedPrice && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="project-materials-sale-price">{materialsT('salePrice', 'Sale price')}</Label>
                  <Input
                    id="project-materials-sale-price"
                    type="number"
                    min={0}
                    step={0.01}
                    value={(saleRate / 100).toFixed(2)}
                    onChange={(event) => setSaleRate(Math.max(0, Math.round((Number(event.target.value) || 0) * 100)))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{materialsT('catalogUnitCost', 'Catalog unit cost')}</Label>
                  <div className="h-10 px-3 py-2 bg-gray-100 border rounded-md text-gray-700 flex items-center">
                    {selectedCatalogCost
                      ? money(selectedCatalogCost.cost, selectedCatalogCost.currency)
                      : materialsT('costNotConfigured', 'Not configured')}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="project-materials-quantity">{materialsT('quantity', 'Quantity')}</Label>
                <Input
                  {...withDataAutomationId({ id: `${id}-quantity` })}
                  id="project-materials-quantity"
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(event) => setQuantity(Math.max(1, parseInt(event.target.value) || 1))}
                />
              </div>
              <div className="space-y-2">
                <Label>{materialsT('total', 'Total')}</Label>
                <div className="h-10 px-3 py-2 bg-white border rounded-md text-gray-700 flex items-center">
                  {selectedPrice
                    ? money(saleRate * quantity, selectedPrice.currency_code)
                    : '-'}
                </div>
              </div>
            </div>

            {selectedPrice && (
              <div className="space-y-2">
                <Label htmlFor="project-materials-invoice-destination">{materialsT('invoiceDestination', 'Invoice')}</Label>
                <CustomSelect
                  id="project-materials-invoice-destination"
                  options={billingDestinationOptions}
                  value={billingSelectValue(billingDestination, billingScheduleEntryId)}
                  onValueChange={(value) => applyBillingSelectValue(value, setBillingDestination, setBillingScheduleEntryId)}
                  disabled={Boolean(projectCurrency && selectedCurrency !== projectCurrency)}
                />
                {projectCurrency && selectedCurrency !== projectCurrency && (
                  <div className="text-xs text-amber-700">
                    {materialsT('currencySeparateHelp', 'Products in a different currency use a separate product invoice.')}
                  </div>
                )}
              </div>
            )}

            {availableUnits.length > 0 && (
              <div className="space-y-2">
                <Label>{materialsT('serialUnit', 'Serial / MAC (serialized product)')}</Label>
                <CustomSelect
                  id={`${id}-unit-select`}
                  options={availableUnits.map((u) => ({
                    value: u.unit_id,
                    label: u.mac_address ? `${u.serial_number} — ${u.mac_address}` : u.serial_number,
                  }))}
                  value={selectedUnitId}
                  onValueChange={setSelectedUnitId}
                  placeholder={materialsT('selectUnit', 'Select a unit to deliver...')}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="project-materials-description">{materialsT('descriptionOptional', 'Description (optional)')}</Label>
              <Input
                {...withDataAutomationId({ id: `${id}-description` })}
                id="project-materials-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={materialsT('notesPlaceholder', 'Additional notes...')}
              />
            </div>

            {availability?.track_stock && availability.locations.length > 0 && (
              <div id={`${id}-availability`} className="text-xs text-gray-500 space-y-0.5">
                <div className="font-medium text-gray-600">{materialsT('onHandByLocation', 'On hand by location')}</div>
                {availability.locations.map((loc) => (
                  <div key={loc.location_id} className="flex justify-between">
                    <span>{loc.location_name}</span>
                    <span className="tabular-nums">{loc.on_hand}</span>
                  </div>
                ))}
              </div>
            )}

            {addError && (
              <div id={`${id}-add-error`} className="text-sm text-red-600">
                {addError}
              </div>
            )}

            <div className="flex justify-end space-x-2">
              <Button
                {...withDataAutomationId({ id: `${id}-cancel-add-btn` })}
                variant="outline"
                size="sm"
                onClick={resetAddForm}
              >
                {t('common:actions.cancel', 'Cancel')}
              </Button>
              <Button
                {...withDataAutomationId({ id: `${id}-save-add-btn` })}
                size="sm"
                onClick={handleAddMaterial}
                disabled={isAdding}
              >
                {isAdding ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    {materialsT('adding', 'Adding...')}
                  </>
                ) : (
                  materialsT('addMaterial', 'Add Material')
                )}
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-gray-500">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            {materialsT('loadingMaterials', 'Loading materials...')}
          </div>
        ) : materials.length === 0 ? (
          <div className="text-center py-6 text-gray-500">
            {materialsT('noMaterials', 'No materials added to this project.')}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 font-medium">{materialsT('productColumn', 'Product')}</th>
                    <th className="pb-2 font-medium text-right">{materialsT('qtyColumn', 'Qty')}</th>
                    <th className="pb-2 font-medium text-right">{materialsT('rateColumn', 'Rate')}</th>
                    <th className="pb-2 font-medium text-right">{materialsT('totalColumn', 'Total')}</th>
                    <th className="pb-2 font-medium">{materialsT('invoiceColumn', 'Invoice')}</th>
                    <th className="pb-2 font-medium text-center">{materialsT('statusColumn', 'Status')}</th>
                    <th className="pb-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {materials.map((material) => (
                    <tr key={material.project_material_id} className="border-b last:border-0">
                      <td className="py-2">
                        <div>
                          <span className="font-medium">{material.service_name || materialsT('unknownProduct', 'Unknown Product')}</span>
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
                        {money(material.rate, material.currency_code)}
                      </td>
                      <td className="py-2 text-right font-medium">
                        {money(calculateTotal(material), material.currency_code)}
                      </td>
                      <td className="py-2 text-xs">
                        {billingDestinationOptions.find((option) => option.value === billingSelectValue(
                          material.billing_destination,
                          material.billing_schedule_entry_id ?? null,
                        ))?.label ?? material.billing_destination}
                      </td>
                      <td className="py-2 text-center">
                        {material.is_billed ? (
                          <Badge variant="default">{materialsT('billed', 'Billed')}</Badge>
                        ) : (
                          <Badge variant="outline">{materialsT('pending', 'Pending')}</Badge>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {!material.is_billed && (
                          <div className="flex justify-end gap-1">
                            <Button
                              {...withDataAutomationId({ id: `${id}-edit-${material.project_material_id}` })}
                              variant="ghost"
                              size="sm"
                              onClick={() => beginEditingMaterial(material)}
                              className="p-1 h-auto"
                              aria-label={materialsT('editProduct', 'Edit product')}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              {...withDataAutomationId({ id: `${id}-delete-${material.project_material_id}` })}
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteMaterial(material.project_material_id)}
                              disabled={deletingId === material.project_material_id}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10 p-1 h-auto"
                              aria-label={materialsT('removeProduct', 'Remove product')}
                            >
                              {deletingId === material.project_material_id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </Button>
                          </div>
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
                      <span className="text-gray-500">{materialsT('unbilledTotal', 'Unbilled ({{currency}}): ', { currency })}</span>
                      <span className="font-semibold">
                        {money(total, currency)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <Dialog
          id={`${id}-edit-dialog`}
          isOpen={Boolean(editingMaterial)}
          onClose={() => setEditingMaterialId(null)}
          title={materialsT('editProduct', 'Edit product')}
          footer={(
            <div className="flex justify-end gap-2">
              <Button id={`${id}-cancel-product-edit`} variant="outline" onClick={() => setEditingMaterialId(null)}>
                {t('common:actions.cancel', 'Cancel')}
              </Button>
              <Button
                id={`${id}-save-product-edit`}
                onClick={handleSaveMaterial}
                disabled={isSavingEdit || (editDestination === 'schedule_entry' && !editScheduleEntryId)}
              >
                {isSavingEdit && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                {t('common:actions.save', 'Save')}
              </Button>
            </div>
          )}
        >
          {editingMaterial && (
            <div className="space-y-4">
              <div>
                <div className="font-medium">{editingMaterial.service_name}</div>
                <div className="text-sm text-gray-500">
                  {materialsT('catalogUnitCost', 'Catalog unit cost')}: {' '}
                  {editingMaterial.catalog_unit_cost != null && editingMaterial.catalog_cost_currency
                    ? money(editingMaterial.catalog_unit_cost, editingMaterial.catalog_cost_currency)
                    : materialsT('costNotConfigured', 'Not configured')}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${id}-edit-sale-price`}>{materialsT('salePrice', 'Sale price')}</Label>
                <Input
                  id={`${id}-edit-sale-price`}
                  type="number"
                  min={0}
                  step={0.01}
                  value={(editRate / 100).toFixed(2)}
                  onChange={(event) => setEditRate(Math.max(0, Math.round((Number(event.target.value) || 0) * 100)))}
                />
                <div className="text-xs text-gray-500">
                  {materialsT('salePriceOverrideHelp', 'This price applies only to this project product row.')}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${id}-edit-invoice-destination`}>{materialsT('invoiceDestination', 'Invoice')}</Label>
                <CustomSelect
                  id={`${id}-edit-invoice-destination`}
                  options={billingDestinationOptions}
                  value={billingSelectValue(editDestination, editScheduleEntryId)}
                  onValueChange={(value) => applyBillingSelectValue(value, setEditDestination, setEditScheduleEntryId)}
                  disabled={Boolean(projectCurrency && editingMaterial.currency_code !== projectCurrency)}
                />
                {projectCurrency && editingMaterial.currency_code !== projectCurrency && (
                  <div className="text-xs text-amber-700">
                    {materialsT('currencySeparateHelp', 'Products in a different currency use a separate product invoice.')}
                  </div>
                )}
              </div>
            </div>
          )}
        </Dialog>

        <Dialog
          id={`${id}-invoice-review-dialog`}
          isOpen={Boolean(invoiceReview)}
          onClose={() => setInvoiceReview(null)}
          title={materialsT('invoiceReviewTitle', 'Review product invoices')}
          footer={(
            <div className="flex justify-end gap-2">
              {createdProductInvoices ? (
                <Button id={`${id}-close-product-invoices`} onClick={() => setInvoiceReview(null)}>
                  {t('common:actions.close', 'Close')}
                </Button>
              ) : (
                <>
                  <Button id={`${id}-cancel-product-invoices`} variant="outline" onClick={() => setInvoiceReview(null)}>
                    {t('common:actions.cancel', 'Cancel')}
                  </Button>
                  <Button
                    id={`${id}-confirm-product-invoices`}
                    onClick={handleCreateProductInvoices}
                    disabled={isCreatingProductInvoices || selectedInvoiceRows.size === 0}
                  >
                    {isCreatingProductInvoices && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                    {materialsT('createDrafts', 'Create drafts')}
                  </Button>
                </>
              )}
            </div>
          )}
        >
          {createdProductInvoices ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                {materialsT('invoiceLinksHelp', 'Draft invoices were created. Open each currency group to review it.')}
              </p>
              {createdProductInvoices.map((invoice) => (
                <a
                  id={`${id}-created-invoice-${invoice.currency_code}`}
                  key={invoice.invoice_id}
                  href={`/msp/billing?tab=invoicing&subtab=drafts&invoiceId=${invoice.invoice_id}`}
                  className="flex items-center justify-between rounded border p-3 text-primary-600 hover:bg-gray-50"
                >
                  <span>{materialsT('currencyDraftLink', '{{currency}} draft invoice', { currency: invoice.currency_code })}</span>
                  <span className="text-xs text-gray-500">{materialsT('productCount', '{{count}} products', { count: invoice.product_count })}</span>
                </a>
              ))}
            </div>
          ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {materialsT('invoiceReviewHelp', 'Eligible products are preselected. One draft invoice will be created per currency.')}
            </p>
            <div className="space-y-2">
              {(invoiceReview?.rows ?? []).map((row) => (
                <label key={row.project_material_id} className="flex items-center gap-3 rounded border p-3">
                  <input
                    id={`${id}-invoice-row-${row.project_material_id}`}
                    type="checkbox"
                    checked={selectedInvoiceRows.has(row.project_material_id)}
                    onChange={(event) => setSelectedInvoiceRows((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(row.project_material_id);
                      else next.delete(row.project_material_id);
                      return next;
                    })}
                  />
                  <span className="flex-1">
                    <span className="block font-medium">{row.service_name}</span>
                    <span className="block text-xs text-gray-500">{row.description}</span>
                  </span>
                  <span className="tabular-nums">
                    {money(row.total, row.currency_code)}
                  </span>
                </label>
              ))}
            </div>
            {invoiceReviewByCurrency.size > 0 && (
              <div className="rounded bg-gray-50 p-3 space-y-1 text-sm">
                {[...invoiceReviewByCurrency.entries()].map(([currency, rows]) => (
                  <div key={currency} className="flex justify-between">
                    <span>{materialsT('draftPreview', '{{currency}} draft ({{count}} products)', { currency, count: rows.length })}</span>
                    <span className="font-medium">
                      {money(rows.reduce((sum, row) => sum + row.total, 0), currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          )}
        </Dialog>

        {!clientId && (
          <div className="text-center py-4 text-amber-600 text-sm">
            {materialsT('noClientAssigned', 'A client must be assigned to this project before materials can be added.')}
          </div>
        )}
      </div>
    </ReflectionContainer>
  );
}
