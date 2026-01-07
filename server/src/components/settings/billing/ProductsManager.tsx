'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { Card, CardContent, CardHeader } from 'server/src/components/ui/Card';
import { DataTable } from 'server/src/components/ui/DataTable';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import { MoreVertical, Pen, Archive, RotateCcw } from 'lucide-react';

import {
  getServiceTypesForSelection,
  getServices,
  updateService
} from 'server/src/lib/actions/serviceActions';
import { QuickAddProduct } from './QuickAddProduct';

import { getTaxRates } from 'server/src/lib/actions/taxSettingsActions';
import { ITaxRate } from 'server/src/interfaces/tax.interfaces';
import { IService, IServicePrice } from 'server/src/interfaces/billing.interfaces';
import { getCurrencySymbol } from 'server/src/constants/currency';
import { getServiceCategories } from 'server/src/lib/actions/categoryActions';
import { IServiceCategory } from 'server/src/interfaces/billing.interfaces';

const ProductsManager: React.FC = () => {
  const [products, setProducts] = useState<IService[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('active');
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

    const selectedTypeId = editingProduct?.custom_service_type_id || null;

    if (selectedTypeId && !perUnitTypes.some((t) => t.id === selectedTypeId)) {
      const selected = allServiceTypes.find((t) => t.id === selectedTypeId);
      if (selected) return [...perUnitTypes, selected];
    }

    return perUnitTypes;
  }, [allServiceTypes, editingProduct?.custom_service_type_id]);

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

  const handleProductAdded = () => {
    setIsCreateOpen(false);
    fetchProducts();
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
                variant="outline"
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

      <QuickAddProduct
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onProductAdded={handleProductAdded}
      />

      <QuickAddProduct
        isOpen={isEditOpen}
        onClose={() => {
          setIsEditOpen(false);
          setEditingProduct(null);
        }}
        onProductAdded={() => {
          setIsEditOpen(false);
          setEditingProduct(null);
          fetchProducts();
        }}
        product={editingProduct}
      />

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
