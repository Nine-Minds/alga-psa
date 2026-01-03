'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { Card, CardContent, CardHeader } from 'server/src/components/ui/Card';
import { DataTable } from 'server/src/components/ui/DataTable';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { EditableServiceTypeSelect } from 'server/src/components/ui/EditableServiceTypeSelect';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import { MoreVertical, Pen, Archive, RotateCcw } from 'lucide-react';

import {
  createService,
  getServiceTypesForSelection,
  getServices,
  setServicePrices,
  updateService,
  createServiceTypeInline,
  updateServiceTypeInline,
  deleteServiceTypeInline
} from 'server/src/lib/actions/serviceActions';

import { getTaxRates } from 'server/src/lib/actions/taxSettingsActions';
import { ITaxRate } from 'server/src/interfaces/tax.interfaces';
import { IService, IServicePrice } from 'server/src/interfaces/billing.interfaces';
import { CURRENCY_OPTIONS, getCurrencySymbol } from 'server/src/constants/currency';
import { getServiceCategories } from 'server/src/lib/actions/categoryActions';
import { IServiceCategory } from 'server/src/interfaces/billing.interfaces';

const LICENSE_TERM_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
  { value: 'perpetual', label: 'Perpetual' }
];

const BILLING_METHOD_OPTIONS = [
  // V1 products are sold as quantity-based (per-unit) catalog items.
  { value: 'per_unit', label: 'Per Unit' },
];

type PriceDraft = { currency_code: string; rate: number };

const ProductsManager: React.FC = () => {
  const [products, setProducts] = useState<IService[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [selectedServiceType, setSelectedServiceType] = useState<string>('all');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');

  const [taxRates, setTaxRates] = useState<ITaxRate[]>([]);
  const [isLoadingTaxRates, setIsLoadingTaxRates] = useState(true);

  const [categories, setCategories] = useState<IServiceCategory[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);

  const [allServiceTypes, setAllServiceTypes] = useState<
    { id: string; name: string; billing_method: 'fixed' | 'hourly' | 'per_unit' | 'usage'; is_standard: boolean }[]
  >([]);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<IService | null>(null);

  const [editingProduct, setEditingProduct] = useState<IService | null>(null);
  const [editingPrices, setEditingPrices] = useState<PriceDraft[]>([]);
  const [rateInput, setRateInput] = useState<string>('');

  const [creatingProduct, setCreatingProduct] = useState<Partial<IService>>({
    item_kind: 'product',
    is_active: true,
    billing_method: 'per_unit',
    unit_of_measure: 'each',
    is_license: false,
    license_term: 'monthly',
    license_billing_cadence: 'monthly'
  });
  const [creatingPrices, setCreatingPrices] = useState<PriceDraft[]>([{ currency_code: 'USD', rate: 0 }]);
  const [createRateInput, setCreateRateInput] = useState<string>('');

  const categoryNameById = useMemo(() => {
    return categories.reduce<Record<string, string>>((acc, c) => {
      if (c.category_id) {
        acc[c.category_id] = c.category_name;
      }
      return acc;
    }, {});
  }, [categories]);

  const productServiceTypes = useMemo(() => {
    const perUnitTypes = allServiceTypes.filter((t) => t.billing_method === 'per_unit');

    const selectedTypeId =
      editingProduct?.custom_service_type_id || creatingProduct.custom_service_type_id || null;

    if (selectedTypeId && !perUnitTypes.some((t) => t.id === selectedTypeId)) {
      const selected = allServiceTypes.find((t) => t.id === selectedTypeId);
      if (selected) return [...perUnitTypes, selected];
    }

    return perUnitTypes;
  }, [allServiceTypes, creatingProduct.custom_service_type_id, editingProduct?.custom_service_type_id]);

  const fetchServiceTypes = async () => {
    const types = await getServiceTypesForSelection();
    setAllServiceTypes(types);
  };

  const fetchTaxRates = async () => {
    setIsLoadingTaxRates(true);
    try {
      const rates = await getTaxRates();
      setTaxRates(rates);
    } finally {
      setIsLoadingTaxRates(false);
    }
  };

  const fetchCategories = async () => {
    setIsLoadingCategories(true);
    try {
      const cats = await getServiceCategories();
      setCategories(Array.isArray(cats) ? cats : []);
    } finally {
      setIsLoadingCategories(false);
    }
  };

  const formatMoneyCents = (cents: number, currencyCode: string) => {
    const symbol = getCurrencySymbol(currencyCode);
    return `${symbol}${((cents ?? 0) / 100).toFixed(2)} (${currencyCode})`;
  };

  const fetchProducts = async () => {
    setIsLoading(true);
    try {
      const is_active =
        activeFilter === 'all' ? undefined : activeFilter === 'active' ? true : false;

      const response = await getServices(page, pageSize, {
        item_kind: 'product',
        is_active,
        custom_service_type_id: selectedServiceType === 'all' ? undefined : selectedServiceType,
        category_id: selectedCategoryId === 'all' ? undefined : selectedCategoryId,
        search: search.trim() ? search.trim() : undefined,
        sort: 'service_name',
        order: 'asc'
      });

      setProducts(response.services);
      setTotalCount(response.totalCount);
      setError(null);
    } catch (e) {
      console.error('[ProductsManager] Failed to fetch products:', e);
      setError('Failed to fetch products');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
    fetchServiceTypes().catch((e) => console.error('[ProductsManager] Failed to fetch service types:', e));
    fetchTaxRates().catch((e) => console.error('[ProductsManager] Failed to fetch tax rates:', e));
    fetchCategories().catch((e) => console.error('[ProductsManager] Failed to fetch categories:', e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  useEffect(() => {
    setPage(1);
    fetchProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter, selectedServiceType, selectedCategoryId]);

  const memoizedProducts = useMemo(() => products, [JSON.stringify(products)]);

  const openEdit = (product: IService) => {
    setEditingProduct(product);
    const prices =
      product.prices && product.prices.length > 0
        ? product.prices.map((p) => ({ currency_code: p.currency_code, rate: p.rate }))
        : [{ currency_code: 'USD', rate: product.default_rate ?? 0 }];
    setEditingPrices(prices);
    const primaryRate = prices.length > 0 ? prices[0].rate : product.default_rate ?? 0;
    setRateInput((primaryRate / 100).toFixed(2));
    setIsEditOpen(true);
  };

  const formatTaxRateLabel = (rate: ITaxRate) => {
    const descriptionPart = rate.description || rate.region_code || 'N/A';
    const percentageValue = typeof rate.tax_percentage === 'string' ? parseFloat(rate.tax_percentage) : Number(rate.tax_percentage);
    const percentagePart = !Number.isNaN(percentageValue) ? percentageValue.toFixed(2) : '0.00';
    return `${descriptionPart} - ${percentagePart}%`;
  };

  const columns: ColumnDefinition<IService>[] = [
    { title: 'Product', dataIndex: 'service_name' },
    {
      title: 'SKU',
      dataIndex: 'sku',
      render: (value) => value || '—'
    },
    {
      title: 'Type',
      dataIndex: 'service_type_name',
      render: (value, record) => {
        const type = allServiceTypes.find((t) => t.id === record.custom_service_type_id);
        return type?.name || value || '—';
      }
    },
    {
      title: 'Category',
      dataIndex: 'category_id',
      render: (value) => (value ? categoryNameById[value] || '—' : '—')
    },
    {
      title: 'Label',
      dataIndex: 'product_category',
      render: (value) => value || '—'
    },
    {
      title: 'Pricing',
      dataIndex: 'prices',
      render: (prices: IServicePrice[] | undefined, record) => {
        if (!prices || prices.length === 0) {
          return formatMoneyCents(Number(record.default_rate ?? 0), 'USD');
        }
        const primary = prices[0];
        const primaryDisplay = formatMoneyCents(Number(primary.rate ?? 0), primary.currency_code);
        if (prices.length > 1) {
          return (
            <span
              title={prices
                .map((p) => `${p.currency_code}: ${formatMoneyCents(Number(p.rate ?? 0), p.currency_code)}`)
                .join('\n')}
            >
              {primaryDisplay} <span className="text-xs text-gray-500">+{prices.length - 1}</span>
            </span>
          );
        }
        return primaryDisplay;
      }
    },
    {
      title: 'Tax Rate',
      dataIndex: 'tax_rate_id',
      render: (taxRateId) => {
        if (!taxRateId) return 'Non-Taxable';
        const rate = taxRates.find((r) => r.tax_rate_id === taxRateId);
        return rate ? formatTaxRateLabel(rate) : taxRateId;
      }
    },
    {
      title: 'Active',
      dataIndex: 'is_active',
      render: (value) => (value === false ? 'No' : 'Yes')
    },
    {
      title: 'Actions',
      dataIndex: 'service_id',
      width: '5%',
      render: (_, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 w-8 p-0"
              id={`products-actions-menu-${record.service_id}`}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={`products-edit-${record.service_id}`}
              onClick={(e) => {
                e.stopPropagation();
                openEdit(record);
              }}
              className="flex items-center"
            >
              <Pen size={14} className="mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`products-archive-${record.service_id}`}
              className={`flex items-center ${record.is_active === false ? '' : 'text-red-600 focus:text-red-600'}`}
              onClick={(e) => {
                e.stopPropagation();
                if (record.is_active === false) {
                  updateService(record.service_id, { is_active: true } as any)
                    .then(() => fetchProducts())
                    .catch((err) => {
                      console.error('[ProductsManager] Failed to restore product:', err);
                      setError('Failed to restore product');
                    });
                  return;
                }
                setProductToDelete(record);
                setIsDeleteOpen(true);
              }}
            >
              {record.is_active === false ? (
                <>
                  <RotateCcw size={14} className="mr-2" />
                  Restore
                </>
              ) : (
                <>
                  <Archive size={14} className="mr-2" />
                  Archive
                </>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
  ];

  const validatePrices = (prices: PriceDraft[]): string | null => {
    if (prices.length === 0) return 'At least one price is required';

    const seen = new Set<string>();
    for (const price of prices) {
      const currency = (price.currency_code || '').trim().toUpperCase();
      if (!currency) return 'Currency is required for each price';
      if (seen.has(currency)) return 'Each currency can only be used once';
      seen.add(currency);

      if (!Number.isFinite(price.rate) || price.rate < 0) {
        return 'Prices must be non-negative';
      }
    }

    if (!prices.some((p) => p.rate > 0)) {
      return 'At least one non-zero price is required';
    }

    return null;
  };

  const handleCreate = async () => {
    if (!creatingProduct.service_name?.trim()) {
      setError('Product name is required');
      return;
    }
    if (!creatingProduct.custom_service_type_id) {
      setError('Service type is required');
      return;
    }
    const priceError = validatePrices(creatingPrices);
    if (priceError) {
      setError(priceError);
      return;
    }

    try {
      const primary = creatingPrices[0];
      const created = await createService({
        service_name: creatingProduct.service_name!.trim(),
        custom_service_type_id: creatingProduct.custom_service_type_id!,
        billing_method: (creatingProduct.billing_method || 'per_unit') as any,
        default_rate: primary.rate,
        unit_of_measure: creatingProduct.unit_of_measure || 'each',
        description: creatingProduct.description ?? null,
        category_id: creatingProduct.category_id ?? null,
        tax_rate_id: creatingProduct.tax_rate_id ?? null,
        item_kind: 'product',
        is_active: creatingProduct.is_active ?? true,
        sku: creatingProduct.sku ?? null,
        cost: creatingProduct.cost ?? null,
        vendor: creatingProduct.vendor ?? null,
        manufacturer: creatingProduct.manufacturer ?? null,
        product_category: creatingProduct.product_category ?? null,
        is_license: creatingProduct.is_license ?? false,
        license_term: creatingProduct.license_term ?? null,
        license_billing_cadence: creatingProduct.license_billing_cadence ?? null
      } as any);

      await setServicePrices(created.service_id, creatingPrices);

      setIsCreateOpen(false);
      setCreatingProduct({
        item_kind: 'product',
        is_active: true,
        billing_method: 'per_unit',
        unit_of_measure: 'each',
        is_license: false,
        license_term: 'monthly',
        license_billing_cadence: 'monthly'
      });
      setCreatingPrices([{ currency_code: 'USD', rate: 0 }]);
      setCreateRateInput('');
      await fetchProducts();
    } catch (e) {
      console.error('[ProductsManager] Failed to create product:', e);
      setError('Failed to create product');
    }
  };

  const handleUpdate = async () => {
    if (!editingProduct) return;
    if (!editingProduct.custom_service_type_id) {
      setError('Service type is required');
      return;
    }
    const priceError = validatePrices(editingPrices);
    if (priceError) {
      setError(priceError);
      return;
    }

    try {
      await updateService(editingProduct.service_id, {
        ...editingProduct,
        item_kind: 'product'
      } as any);
      await setServicePrices(editingProduct.service_id, editingPrices);
      setIsEditOpen(false);
      setEditingProduct(null);
      setEditingPrices([]);
      await fetchProducts();
    } catch (e) {
      console.error('[ProductsManager] Failed to update product:', e);
      setError('Failed to update product');
    }
  };

  const confirmArchive = async () => {
    if (!productToDelete) return;
    try {
      await updateService(productToDelete.service_id, { is_active: false } as any);
      setIsDeleteOpen(false);
      setProductToDelete(null);
      await fetchProducts();
    } catch (e) {
      console.error('[ProductsManager] Failed to archive product:', e);
      setError('Failed to archive product');
      setIsDeleteOpen(false);
      setProductToDelete(null);
    }
  };

  const renderPricesEditor = (
    prices: PriceDraft[],
    setPrices: (p: PriceDraft[]) => void,
    primaryInput: string,
    setPrimaryInput: (v: string) => void
  ) => {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-700">Prices</label>
          <Button
            id="products-price-add-currency"
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setPrices([...prices, { currency_code: 'USD', rate: 0 }])}
          >
            Add currency
          </Button>
        </div>
        <div className="space-y-2">
          {prices.map((price, index) => (
            <div key={`${price.currency_code}-${index}`} className="flex gap-2 items-center">
              <CustomSelect
                options={CURRENCY_OPTIONS.filter((opt) => {
                  if (opt.value === price.currency_code) return true;
                  return !prices.some((p) => p.currency_code === opt.value);
                })}
                value={price.currency_code}
                onValueChange={(value) => {
                  const next = [...prices];
                  next[index] = { ...next[index], currency_code: value };
                  setPrices(next);
                }}
                className="w-[140px]"
              />
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">
                  {getCurrencySymbol(price.currency_code)}
                </span>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={index === 0 ? primaryInput : (price.rate / 100).toFixed(2)}
                  onChange={(e) => {
                    const value = e.target.value.replace(/[^0-9.]/g, '');
                    const decimalCount = (value.match(/\./g) || []).length;
                    if (decimalCount > 1) return;

                    if (index === 0) {
                      setPrimaryInput(value);
                      return;
                    }

                    const dollars = parseFloat(value) || 0;
                    const cents = Math.round(dollars * 100);
                    const next = [...prices];
                    next[index] = { ...next[index], rate: cents };
                    setPrices(next);
                  }}
                  onBlur={() => {
                    if (index !== 0) return;
                    const dollars = parseFloat(primaryInput) || 0;
                    const cents = Math.round(dollars * 100);
                    const next = [...prices];
                    next[0] = { ...next[0], rate: cents };
                    setPrices(next);
                    setPrimaryInput((cents / 100).toFixed(2));
                  }}
                  placeholder="0.00"
                  className="pl-10"
                />
              </div>
              {prices.length > 1 && (
                <Button
                  id={`products-price-remove-${price.currency_code}-${index}`}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-red-500 hover:text-red-700 hover:bg-red-50 px-2"
                  onClick={() => {
                    const next = prices.filter((_, i) => i !== index);
                    setPrices(next);
                    if (index === 0 && next.length > 0) {
                      setPrimaryInput((next[0].rate / 100).toFixed(2));
                    }
                  }}
                >
                  Remove
                </Button>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500">First currency is treated as the primary rate.</p>
      </div>
    );
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Products</h3>
            <div className="flex items-center gap-2">
              <Button id="products-add-button" onClick={() => setIsCreateOpen(true)}>
                Add Product
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && <div className="text-red-500 mb-4">{error}</div>}
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 items-center">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, SKU, description..."
                className="w-[280px]"
              />
              <Button
                id="products-search-button"
                variant="secondary"
                onClick={() => {
                  setPage(1);
                  fetchProducts();
                }}
              >
                Search
              </Button>
              <CustomSelect
                options={[
                  { value: 'all', label: 'All Statuses' },
                  { value: 'active', label: 'Active' },
                  { value: 'inactive', label: 'Inactive' }
                ]}
                value={activeFilter}
                onValueChange={(v) => setActiveFilter(v as any)}
                className="w-[160px]"
              />
              <CustomSelect
                options={[
                  { value: 'all', label: 'All Categories' },
                  ...categories
                    .filter((c) => Boolean(c.category_id))
                    .map((c) => ({ value: c.category_id as string, label: c.category_name }))
                ]}
                value={selectedCategoryId}
                onValueChange={(v) => setSelectedCategoryId(v)}
                className="w-[220px]"
                placeholder={isLoadingCategories ? 'Loading…' : 'All Categories'}
                disabled={isLoadingCategories}
              />
              <CustomSelect
                options={[
                  { value: 'all', label: 'All Types' },
                  ...productServiceTypes.map((t) => ({ value: t.id, label: t.name }))
                ]}
                value={selectedServiceType}
                onValueChange={(v) => setSelectedServiceType(v)}
                className="w-[220px]"
              />
            </div>

            {isLoading ? (
              <LoadingIndicator
                layout="stacked"
                className="py-10 text-gray-600"
                spinnerProps={{ size: 'md' }}
                text="Loading products"
              />
            ) : (
              <DataTable
                id="products-manager-table"
                data={memoizedProducts}
                columns={columns}
                pagination={true}
                currentPage={page}
                pageSize={pageSize}
                totalItems={totalCount}
                onPageChange={setPage}
                onItemsPerPageChange={(n) => {
                  setPageSize(n);
                  setPage(1);
                }}
                onRowClick={(record) => openEdit(record)}
                key={`products-table-${page}`}
              />
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Add Product">
        <DialogContent>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Product Name *</label>
              <Input
                value={creatingProduct.service_name || ''}
                onChange={(e) => setCreatingProduct({ ...creatingProduct, service_name: e.target.value })}
              />
            </div>

            <div>
              <EditableServiceTypeSelect
                label="Type *"
                value={creatingProduct.custom_service_type_id || ''}
                onChange={(value) => setCreatingProduct({ ...creatingProduct, custom_service_type_id: value })}
                serviceTypes={productServiceTypes}
                onCreateType={async (name) => {
                  await createServiceTypeInline(name);
                  await fetchServiceTypes();
                }}
                onUpdateType={async (id, name) => {
                  await updateServiceTypeInline(id, name);
                  await fetchServiceTypes();
                }}
                onDeleteType={async (id) => {
                  await deleteServiceTypeInline(id);
                  await fetchServiceTypes();
                }}
                placeholder="Select type..."
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">SKU</label>
                <Input
                  value={creatingProduct.sku || ''}
                  onChange={(e) => setCreatingProduct({ ...creatingProduct, sku: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <CustomSelect
                  value={creatingProduct.category_id || ''}
                  placeholder={isLoadingCategories ? 'Loading…' : 'Uncategorized'}
                  onValueChange={(v) => setCreatingProduct({ ...creatingProduct, category_id: v || null })}
                  options={categories
                    .filter((c) => Boolean(c.category_id))
                    .map((c) => ({ value: c.category_id as string, label: c.category_name }))}
                  disabled={isLoadingCategories}
                  allowClear={true}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
              <Input
                value={creatingProduct.product_category || ''}
                onChange={(e) => setCreatingProduct({ ...creatingProduct, product_category: e.target.value })}
                placeholder="Optional freeform label"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
                <Input
                  value={creatingProduct.vendor || ''}
                  onChange={(e) => setCreatingProduct({ ...creatingProduct, vendor: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Manufacturer</label>
                <Input
                  value={creatingProduct.manufacturer || ''}
                  onChange={(e) => setCreatingProduct({ ...creatingProduct, manufacturer: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cost (cents)</label>
                <Input
                  type="number"
                  value={creatingProduct.cost ?? ''}
                  onChange={(e) => setCreatingProduct({ ...creatingProduct, cost: e.target.value === '' ? null : Number(e.target.value) })}
                  placeholder="Optional"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Billing Method</label>
                <CustomSelect
                  options={BILLING_METHOD_OPTIONS}
                  value={(creatingProduct.billing_method as string) || 'per_unit'}
                  onValueChange={(v) => setCreatingProduct({ ...creatingProduct, billing_method: v as any })}
                />
              </div>
            </div>

            {renderPricesEditor(creatingPrices, setCreatingPrices, createRateInput, setCreateRateInput)}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tax Rate</label>
              <CustomSelect
                value={creatingProduct.tax_rate_id || ''}
                placeholder={isLoadingTaxRates ? 'Loading...' : 'Non-Taxable'}
                onValueChange={(v) => setCreatingProduct({ ...creatingProduct, tax_rate_id: v || null })}
                options={taxRates.map((r) => ({ value: r.tax_rate_id, label: formatTaxRateLabel(r) }))}
                disabled={isLoadingTaxRates}
                allowClear={true}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 items-end">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Active</label>
                <CustomSelect
                  options={[
                    { value: 'true', label: 'Active' },
                    { value: 'false', label: 'Inactive' }
                  ]}
                  value={(creatingProduct.is_active ?? true) ? 'true' : 'false'}
                  onValueChange={(v) => setCreatingProduct({ ...creatingProduct, is_active: v === 'true' })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit of Measure</label>
                <Input
                  value={creatingProduct.unit_of_measure || 'each'}
                  onChange={(e) => setCreatingProduct({ ...creatingProduct, unit_of_measure: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">License?</label>
                <CustomSelect
                  options={[
                    { value: 'false', label: 'No' },
                    { value: 'true', label: 'Yes' }
                  ]}
                  value={(creatingProduct.is_license ?? false) ? 'true' : 'false'}
                  onValueChange={(v) => setCreatingProduct({ ...creatingProduct, is_license: v === 'true' })}
                />
              </div>
              <div>
                <CustomSelect
                  label="License Term"
                  options={LICENSE_TERM_OPTIONS}
                  value={(creatingProduct.license_term as string) || 'monthly'}
                  onValueChange={(v) => setCreatingProduct({ ...creatingProduct, license_term: v })}
                  disabled={!(creatingProduct.is_license ?? false)}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <Input
                value={creatingProduct.description || ''}
                onChange={(e) => setCreatingProduct({ ...creatingProduct, description: e.target.value })}
              />
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button id="products-create-cancel-button" variant="secondary" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
          <Button id="products-create-submit-button" onClick={handleCreate}>Create</Button>
        </DialogFooter>
      </Dialog>

      <Dialog isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} title="Edit Product">
        <DialogContent>
          {editingProduct && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Product Name *</label>
                <Input
                  value={editingProduct.service_name || ''}
                  onChange={(e) => setEditingProduct({ ...editingProduct, service_name: e.target.value })}
                />
              </div>

              <div>
                <EditableServiceTypeSelect
                  label="Type *"
                  value={editingProduct.custom_service_type_id || ''}
                  onChange={(value) => setEditingProduct({ ...editingProduct, custom_service_type_id: value })}
                  serviceTypes={productServiceTypes}
                  onCreateType={async (name) => {
                    await createServiceTypeInline(name);
                    await fetchServiceTypes();
                  }}
                  onUpdateType={async (id, name) => {
                    await updateServiceTypeInline(id, name);
                    await fetchServiceTypes();
                  }}
                  onDeleteType={async (id) => {
                    await deleteServiceTypeInline(id);
                    await fetchServiceTypes();
                  }}
                  placeholder="Select type..."
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">SKU</label>
                  <Input
                    value={editingProduct.sku || ''}
                    onChange={(e) => setEditingProduct({ ...editingProduct, sku: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <CustomSelect
                    value={editingProduct.category_id || ''}
                    placeholder={isLoadingCategories ? 'Loading…' : 'Uncategorized'}
                    onValueChange={(v) => setEditingProduct({ ...editingProduct, category_id: v || null })}
                    options={categories
                      .filter((c) => Boolean(c.category_id))
                      .map((c) => ({ value: c.category_id as string, label: c.category_name }))}
                    disabled={isLoadingCategories}
                    allowClear={true}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
                <Input
                  value={editingProduct.product_category || ''}
                  onChange={(e) => setEditingProduct({ ...editingProduct, product_category: e.target.value })}
                  placeholder="Optional freeform label"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
                  <Input
                    value={editingProduct.vendor || ''}
                    onChange={(e) => setEditingProduct({ ...editingProduct, vendor: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Manufacturer</label>
                  <Input
                    value={editingProduct.manufacturer || ''}
                    onChange={(e) => setEditingProduct({ ...editingProduct, manufacturer: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cost (cents)</label>
                  <Input
                    type="number"
                    value={editingProduct.cost ?? ''}
                    onChange={(e) => setEditingProduct({ ...editingProduct, cost: e.target.value === '' ? null : Number(e.target.value) })}
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Billing Method</label>
                  <CustomSelect
                    options={BILLING_METHOD_OPTIONS}
                    value={editingProduct.billing_method}
                    onValueChange={(v) => setEditingProduct({ ...editingProduct, billing_method: v as any })}
                  />
                </div>
              </div>

              {renderPricesEditor(editingPrices, setEditingPrices, rateInput, setRateInput)}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tax Rate</label>
                <CustomSelect
                  value={editingProduct.tax_rate_id || ''}
                  placeholder={isLoadingTaxRates ? 'Loading...' : 'Non-Taxable'}
                  onValueChange={(v) => setEditingProduct({ ...editingProduct, tax_rate_id: v || null })}
                  options={taxRates.map((r) => ({ value: r.tax_rate_id, label: formatTaxRateLabel(r) }))}
                  disabled={isLoadingTaxRates}
                  allowClear={true}
                />
              </div>

              <div className="grid grid-cols-2 gap-3 items-end">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Active</label>
                  <CustomSelect
                    options={[
                      { value: 'true', label: 'Active' },
                      { value: 'false', label: 'Inactive' }
                    ]}
                    value={(editingProduct.is_active ?? true) ? 'true' : 'false'}
                    onValueChange={(v) => setEditingProduct({ ...editingProduct, is_active: v === 'true' })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unit of Measure</label>
                  <Input
                    value={editingProduct.unit_of_measure || ''}
                    onChange={(e) => setEditingProduct({ ...editingProduct, unit_of_measure: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">License?</label>
                  <CustomSelect
                    options={[
                      { value: 'false', label: 'No' },
                      { value: 'true', label: 'Yes' }
                    ]}
                    value={(editingProduct.is_license ?? false) ? 'true' : 'false'}
                    onValueChange={(v) => setEditingProduct({ ...editingProduct, is_license: v === 'true' })}
                  />
                </div>
                <div>
                  <CustomSelect
                    label="License Term"
                    options={LICENSE_TERM_OPTIONS}
                    value={(editingProduct.license_term as string) || 'monthly'}
                    onValueChange={(v) => setEditingProduct({ ...editingProduct, license_term: v })}
                    disabled={!(editingProduct.is_license ?? false)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <Input
                  value={editingProduct.description || ''}
                  onChange={(e) => setEditingProduct({ ...editingProduct, description: e.target.value })}
                />
              </div>
            </div>
          )}
        </DialogContent>
        <DialogFooter>
          <Button id="products-edit-cancel-button" variant="secondary" onClick={() => setIsEditOpen(false)}>Cancel</Button>
          <Button id="products-edit-save-button" onClick={handleUpdate}>Save</Button>
        </DialogFooter>
      </Dialog>

      <ConfirmationDialog
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={confirmArchive}
        title="Archive Product"
        message={`Archive ${productToDelete?.service_name || 'this product'}? It will be hidden from pickers by default and cannot be attached to new contracts/invoices until restored.`}
      />
    </>
  );
};

export default ProductsManager;
