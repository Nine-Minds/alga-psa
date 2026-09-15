'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { BulkActionBar } from '@alga-psa/ui/components/BulkActionBar';
import { Card, CardContent, CardHeader } from '@alga-psa/ui/components/Card';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { useRangeSelection } from '@alga-psa/ui/hooks';
import { ColumnDefinition } from '@alga-psa/types';
import toast from 'react-hot-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { MoreVertical, Pen, Archive, RotateCcw, Trash2 } from 'lucide-react';

import {
  getServiceTypesForSelection,
  getServices,
  updateService,
  checkProductCanBeDeleted,
  deleteProductPermanently,
  ProductAssociationCheck
} from '../../../actions/serviceActions';
import { QuickAddProduct } from './QuickAddProduct';

import { getTaxRates } from '../../../actions/taxRateActions';
import { ITaxRate } from '@alga-psa/types';
import { IService, IServicePrice } from '@alga-psa/types';
import { getCurrencySymbol } from '@alga-psa/core';
import { getServiceCategories } from '../../../actions/categoryActions';
import { IServiceCategory } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

// Bulk archive/restore composes the single-item action, so the selection is
// issued in small batches instead of one request per row all at once.
const BULK_CHUNK_SIZE = 10;

const ProductsManager: React.FC = () => {
  const { t } = useTranslation('msp/billing-settings');
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
    { id: string; name: string; is_standard: boolean }[]
  >([]);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<IService | null>(null);

  const [isPermanentDeleteOpen, setIsPermanentDeleteOpen] = useState(false);
  const [productToPermanentDelete, setProductToPermanentDelete] = useState<IService | null>(null);
  const [permanentDeleteCheck, setPermanentDeleteCheck] = useState<ProductAssociationCheck | null>(null);
  const [isCheckingDelete, setIsCheckingDelete] = useState(false);

  const [editingProduct, setEditingProduct] = useState<IService | null>(null);

  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);


  const categoryNameById = useMemo(() => {
    return categories.reduce<Record<string, string>>((acc, c) => {
      if (c.category_id) {
        acc[c.category_id] = c.category_name;
      }
      return acc;
    }, {});
  }, [categories]);

  // Products and Services draw from one shared Type taxonomy (service_types),
  // managed on the dedicated Service Types settings tab. The full list is
  // exposed to both forms — no billing_method filtering.
  const productServiceTypes = allServiceTypes;

  const fetchServiceTypes = async () => {
    const types = await getServiceTypesForSelection();
    if (isActionMessageError(types) || isActionPermissionError(types)) {
      setError(getErrorMessage(types));
      setAllServiceTypes([]);
      return;
    }
    setAllServiceTypes(types);
  };

  const fetchTaxRates = async () => {
    setIsLoadingTaxRates(true);
    try {
      const rates = await getTaxRates();
      if (isActionMessageError(rates) || isActionPermissionError(rates)) {
        setError(getErrorMessage(rates));
        setTaxRates([]);
        return;
      }
      setTaxRates(rates);
    } finally {
      setIsLoadingTaxRates(false);
    }
  };

  const fetchCategories = async () => {
    setIsLoadingCategories(true);
    try {
      const cats = await getServiceCategories();
      if (isActionMessageError(cats) || isActionPermissionError(cats)) {
        setError(getErrorMessage(cats));
        setCategories([]);
        return;
      }
      setCategories(cats);
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
      if (isActionMessageError(response) || isActionPermissionError(response)) {
        setProducts([]);
        setTotalCount(0);
        setError(getErrorMessage(response));
        return;
      }

      setProducts(response.services);
      setTotalCount(response.totalCount);
      setError(null);
    } catch (e) {
      console.error('[ProductsManager] Failed to fetch products:', e);
      setError(t('products.errors.fetch', { defaultValue: 'Failed to fetch products' }));
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
    // The rows behind the selection are about to change, so the selection is no
    // longer something the operator can see or verify.
    setSelectedProductIds(new Set());
    fetchProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  useEffect(() => {
    setPage(1);
    setSelectedProductIds(new Set());
    fetchProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter, selectedServiceType, selectedCategoryId]);

  const memoizedProducts = useMemo(() => products, [JSON.stringify(products)]);
  const rangeSelect = useRangeSelection<IService>({
    items: memoizedProducts,
    getId: (product) => product.service_id,
    selectedIds: selectedProductIds,
    onSelectedIdsChange: setSelectedProductIds,
  });
  const visibleProductIds = useMemo(
    () =>
      memoizedProducts
        .map((product) => product.service_id)
        .filter((serviceId): serviceId is string => Boolean(serviceId)),
    [memoizedProducts]
  );
  const selectedVisibleCount = useMemo(
    () => visibleProductIds.filter((serviceId) => selectedProductIds.has(serviceId)).length,
    [visibleProductIds, selectedProductIds]
  );
  const allVisibleSelected =
    visibleProductIds.length > 0 && selectedVisibleCount === visibleProductIds.length;
  const clearSelection = () => setSelectedProductIds(new Set());

  const handleSelectAllVisible = (checked: boolean) => {
    setSelectedProductIds(checked ? new Set(visibleProductIds) : new Set());
    rangeSelect.resetAnchor();
  };

  const openEdit = (product: IService) => {
    setEditingProduct(product);
    setIsEditOpen(true);
  };

  const formatTaxRateLabel = (rate: ITaxRate) => {
    const descriptionPart = rate.description || rate.region_code || t('common.notAvailable', { defaultValue: 'N/A' });
    const percentageValue = typeof rate.tax_percentage === 'string' ? parseFloat(rate.tax_percentage) : Number(rate.tax_percentage);
    const percentagePart = !Number.isNaN(percentageValue) ? percentageValue.toFixed(2) : '0.00';
    return `${descriptionPart} - ${percentagePart}%`;
  };

  const columns: ColumnDefinition<IService>[] = [
    // The selection cell must swallow its own clicks: the row click opens the
    // edit dialog, which is not what ticking a checkbox asks for.
    {
      title: (
        <div className="flex items-center" onClick={(event) => event.stopPropagation()}>
          <Checkbox
            id="products-select-all"
            checked={allVisibleSelected}
            indeterminate={selectedVisibleCount > 0 && !allVisibleSelected}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              event.stopPropagation();
              handleSelectAllVisible(event.target.checked);
            }}
            aria-label={t('products.bulk.selectAll', { defaultValue: 'Select all products' })}
            className="m-0"
            skipRegistration
          />
        </div>
      ),
      dataIndex: 'selection',
      width: '4%',
      sortable: false,
      render: (_value, record) => {
        const serviceId = record.service_id;
        if (!serviceId) return null;
        const isChecked = rangeSelect.isSelected(serviceId);
        return (
          <div className="flex items-center" onClick={(event) => event.stopPropagation()}>
            <Checkbox
              id={`products-select-${serviceId}`}
              checked={isChecked}
              onClick={(event: React.MouseEvent<HTMLInputElement>) => {
                event.stopPropagation();
                rangeSelect.handleSelect(serviceId, {
                  shiftKey: event.shiftKey,
                  selected: !isChecked,
                });
              }}
              onChange={() => { /* controlled via onClick for shift-range support */ }}
              className="m-0"
              skipRegistration
            />
          </div>
        );
      },
    },
    { title: t('products.table.product', { defaultValue: 'Product' }), dataIndex: 'service_name' },
    {
      title: t('products.table.sku', { defaultValue: 'SKU' }),
      dataIndex: 'sku',
      render: (value) => value || '—'
    },
    {
      title: t('products.table.type', { defaultValue: 'Type' }),
      dataIndex: 'service_type_name',
      render: (value, record) => {
        const type = allServiceTypes.find((t) => t.id === record.custom_service_type_id);
        return type?.name || value || '—';
      }
    },
    {
      title: t('products.table.category', { defaultValue: 'Category' }),
      dataIndex: 'category_id',
      render: (value) => (value ? categoryNameById[value] || '—' : '—')
    },
    {
      title: t('products.table.label', { defaultValue: 'Label' }),
      dataIndex: 'product_category',
      render: (value) => value || '—'
    },
    {
      title: t('products.table.pricing', { defaultValue: 'Pricing' }),
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
              {primaryDisplay} <span className="text-xs text-muted-foreground">+{prices.length - 1}</span>
            </span>
          );
        }
        return primaryDisplay;
      }
    },
    {
      title: t('products.table.taxRate', { defaultValue: 'Tax Rate' }),
      dataIndex: 'tax_rate_id',
      render: (taxRateId) => {
        if (!taxRateId) return t('products.table.nonTaxable', { defaultValue: 'Non-Taxable' });
        const rate = taxRates.find((r) => r.tax_rate_id === taxRateId);
        return rate ? formatTaxRateLabel(rate) : taxRateId;
      }
    },
    {
      title: t('products.table.active', { defaultValue: 'Active' }),
      dataIndex: 'is_active',
      render: (value) =>
        value === false
          ? t('common.statuses.no', { defaultValue: 'No' })
          : t('common.statuses.yes', { defaultValue: 'Yes' })
    },
    {
      title: t('common.columns.actions', { defaultValue: 'Actions' }),
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
              <span className="sr-only">{t('common.a11y.openMenu', { defaultValue: 'Open menu' })}</span>
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
              {t('products.actions.edit', { defaultValue: 'Edit' })}
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
                      setError(t('products.errors.restore', { defaultValue: 'Failed to restore product' }));
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
                  {t('products.actions.restore', { defaultValue: 'Restore' })}
                </>
              ) : (
                <>
                  <Archive size={14} className="mr-2" />
                  {t('products.actions.archive', { defaultValue: 'Archive' })}
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`products-delete-${record.service_id}`}
              className="flex items-center text-red-600 focus:text-red-600"
              onClick={(e) => {
                e.stopPropagation();
                handlePermanentDeleteClick(record);
              }}
            >
              <Trash2 size={14} className="mr-2" />
              {t('products.actions.delete', { defaultValue: 'Delete' })}
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
      setError(t('products.errors.archive', { defaultValue: 'Failed to archive product' }));
      setIsDeleteOpen(false);
      setProductToDelete(null);
    }
  };

  const handlePermanentDeleteClick = async (product: IService) => {
    setProductToPermanentDelete(product);
    setIsCheckingDelete(true);
    setPermanentDeleteCheck(null);
    setIsPermanentDeleteOpen(true);

    try {
      const check = await checkProductCanBeDeleted(product.service_id);
      if (isActionMessageError(check) || isActionPermissionError(check)) {
        setPermanentDeleteCheck({
          canDelete: false,
          associations: [{
            type: 'error',
            count: 0,
            description: getErrorMessage(check)
          }]
        });
        return;
      }
      setPermanentDeleteCheck(check);
    } catch (e) {
      console.error('[ProductsManager] Failed to check product associations:', e);
      setPermanentDeleteCheck({
        canDelete: false,
        associations: [{
          type: 'error',
          count: 0,
          description: t('products.errors.checkAssociations', {
            defaultValue: 'Failed to check associations'
          })
        }]
      });
    } finally {
      setIsCheckingDelete(false);
    }
  };

  const confirmPermanentDelete = async () => {
    if (!productToPermanentDelete || !permanentDeleteCheck?.canDelete) return;

    try {
      const result = await deleteProductPermanently(productToPermanentDelete.service_id);
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      setIsPermanentDeleteOpen(false);
      setProductToPermanentDelete(null);
      setPermanentDeleteCheck(null);
      await fetchProducts();
    } catch (e) {
      console.error('[ProductsManager] Failed to permanently delete product:', e);
      setError(
        e instanceof Error
          ? e.message
          : t('products.errors.delete', { defaultValue: 'Failed to delete product' })
      );
      setIsPermanentDeleteOpen(false);
      setProductToPermanentDelete(null);
      setPermanentDeleteCheck(null);
    }
  };

  const runBulkActiveUpdate = async (isActive: boolean) => {
    const ids = Array.from(selectedProductIds);
    if (ids.length === 0) return;

    setIsBulkProcessing(true);
    let updated = 0;
    let failed = 0;
    try {
      for (let index = 0; index < ids.length; index += BULK_CHUNK_SIZE) {
        const chunk = ids.slice(index, index + BULK_CHUNK_SIZE);
        // Each id is its own request, so one refusal must not hide the rest of
        // the chunk's outcomes.
        const results = await Promise.all(
          chunk.map(async (serviceId) => {
            try {
              const result = await updateService(serviceId, { is_active: isActive } as any);
              return !(isActionMessageError(result) || isActionPermissionError(result));
            } catch (e) {
              console.error(`[ProductsManager] Failed to update product ${serviceId}:`, e);
              return false;
            }
          })
        );
        for (const ok of results) {
          if (ok) updated += 1;
          else failed += 1;
        }
      }

      const feedback = isActive
        ? {
            success: t('products.bulk.feedback.restoreSuccess', {
              defaultValue: '{{count}} product(s) restored',
              count: updated,
            }),
            partial: t('products.bulk.feedback.restorePartial', {
              defaultValue: 'Restored {{count}} product(s); {{failed}} could not be restored',
              count: updated,
              failed,
            }),
            error: t('products.bulk.feedback.restoreError', {
              defaultValue: 'Failed to restore {{count}} product(s)',
              count: failed,
            }),
          }
        : {
            success: t('products.bulk.feedback.archiveSuccess', {
              defaultValue: '{{count}} product(s) archived',
              count: updated,
            }),
            partial: t('products.bulk.feedback.archivePartial', {
              defaultValue: 'Archived {{count}} product(s); {{failed}} could not be archived',
              count: updated,
              failed,
            }),
            error: t('products.bulk.feedback.archiveError', {
              defaultValue: 'Failed to archive {{count}} product(s)',
              count: failed,
            }),
          };

      if (failed === 0) {
        toast.success(feedback.success);
      } else if (updated > 0) {
        toast.error(feedback.partial);
      } else {
        toast.error(feedback.error);
      }
    } finally {
      clearSelection();
      setIsBulkProcessing(false);
      await fetchProducts();
    }
  };

  const runBulkPermanentDelete = async () => {
    const ids = Array.from(selectedProductIds);
    if (ids.length === 0) return;

    setIsBulkProcessing(true);
    let deleted = 0;
    let failed = 0;
    // Association checks refuse individual products; naming them with their
    // reason is the only way the operator learns what survived and why.
    const blocked: string[] = [];
    try {
      for (const serviceId of ids) {
        const name =
          products.find((product) => product.service_id === serviceId)?.service_name ?? serviceId;
        try {
          const check = await checkProductCanBeDeleted(serviceId);
          if (isActionMessageError(check) || isActionPermissionError(check)) {
            blocked.push(`${name} (${getErrorMessage(check)})`);
            continue;
          }
          if (!check.canDelete) {
            blocked.push(`${name} (${check.associations.map((a) => a.description).join(', ')})`);
            continue;
          }

          const result = await deleteProductPermanently(serviceId);
          if (isActionMessageError(result) || isActionPermissionError(result)) {
            blocked.push(`${name} (${getErrorMessage(result)})`);
            continue;
          }
          deleted += 1;
        } catch (e) {
          console.error(`[ProductsManager] Failed to delete product ${serviceId}:`, e);
          failed += 1;
        }
      }

      const names = blocked.join('; ');
      const unresolved = blocked.length + failed;
      if (unresolved === 0) {
        toast.success(t('products.bulk.feedback.deleteSuccess', {
          defaultValue: '{{count}} product(s) deleted permanently',
          count: deleted,
        }));
      } else if (deleted > 0) {
        toast.error(names
          ? t('products.bulk.feedback.deletePartialBlocked', {
              defaultValue: 'Deleted {{count}} product(s); {{failed}} could not be deleted: {{names}}',
              count: deleted,
              failed: unresolved,
              names,
            })
          : t('products.bulk.feedback.deletePartial', {
              defaultValue: 'Deleted {{count}} product(s); {{failed}} could not be deleted',
              count: deleted,
              failed: unresolved,
            }));
      } else {
        toast.error(names
          ? t('products.bulk.feedback.deleteBlocked', {
              defaultValue: 'Could not delete {{count}} product(s) — still in use: {{names}}',
              count: unresolved,
              names,
            })
          : t('products.bulk.feedback.deleteError', {
              defaultValue: 'Failed to delete {{count}} product(s)',
              count: unresolved,
            }));
      }
    } finally {
      clearSelection();
      setIsBulkProcessing(false);
      setIsBulkDeleteOpen(false);
      await fetchProducts();
    }
  };

  const closePermanentDeleteDialog = () => {
    setIsPermanentDeleteOpen(false);
    setProductToPermanentDelete(null);
    setPermanentDeleteCheck(null);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">
              {t('products.title', { defaultValue: 'Products' })}
            </h3>
            <div className="flex items-center gap-2">
              <Button id="products-add-button" onClick={() => setIsCreateOpen(true)}>
                {t('products.actions.add', { defaultValue: 'Add Product' })}
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
                placeholder={t('products.filters.searchPlaceholder', {
                  defaultValue: 'Search by name, SKU, description...'
                })}
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
                {t('products.actions.search', { defaultValue: 'Search' })}
              </Button>
              <CustomSelect
                options={[
                  { value: 'all', label: t('products.filters.allStatuses', { defaultValue: 'All Statuses' }) },
                  { value: 'active', label: t('products.filters.active', { defaultValue: 'Active' }) },
                  { value: 'inactive', label: t('products.filters.inactive', { defaultValue: 'Inactive' }) }
                ]}
                value={activeFilter}
                onValueChange={(v) => setActiveFilter(v as any)}
                className="w-[160px]"
              />
              <CustomSelect
                options={[
                  { value: 'all', label: t('products.filters.allCategories', { defaultValue: 'All Categories' }) },
                  ...categories
                    .filter((c) => Boolean(c.category_id))
                    .map((c) => ({ value: c.category_id as string, label: c.category_name }))
                ]}
                value={selectedCategoryId}
                onValueChange={(v) => setSelectedCategoryId(v)}
                className="w-[220px]"
                placeholder={
                  isLoadingCategories
                    ? t('products.filters.loading', { defaultValue: 'Loading...' })
                    : t('products.filters.allCategories', { defaultValue: 'All Categories' })
                }
                disabled={isLoadingCategories}
              />
              <CustomSelect
                options={[
                  { value: 'all', label: t('products.filters.allTypes', { defaultValue: 'All Types' }) },
                  ...productServiceTypes.map((t) => ({ value: t.id, label: t.name }))
                ]}
                value={selectedServiceType}
                onValueChange={(v) => setSelectedServiceType(v)}
                className="w-[220px]"
                placeholder={t('products.filters.allTypes', { defaultValue: 'All Types' })}
              />
            </div>

            {isLoading ? (
              <LoadingIndicator
                layout="stacked"
                className="py-10 text-muted-foreground"
                spinnerProps={{ size: 'md' }}
                text={t('products.loading', { defaultValue: 'Loading products' })}
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
                rowClassName={(record) =>
                  record.service_id && selectedProductIds.has(record.service_id)
                    ? 'bg-table-selected'
                    : ''
                }
                onRowClick={(record) => openEdit(record)}
                key={`products-table-${page}`}
              />
            )}
          </div>
        </CardContent>
      </Card>

      <BulkActionBar
        idPrefix="products-bulk-action-bar"
        count={selectedProductIds.size}
        selectedLabel={t('products.bulk.selectedCount', {
          defaultValue: '{{count}} selected',
          count: selectedProductIds.size,
        })}
        actions={[
          {
            id: 'archive',
            label: t('products.bulk.actions.archive', { defaultValue: 'Archive' }),
            icon: <Archive className="h-4 w-4" />,
            disabled: isBulkProcessing,
            onClick: () => { void runBulkActiveUpdate(false); },
          },
          {
            id: 'restore',
            label: t('products.bulk.actions.restore', { defaultValue: 'Restore' }),
            icon: <RotateCcw className="h-4 w-4" />,
            disabled: isBulkProcessing,
            onClick: () => { void runBulkActiveUpdate(true); },
          },
          {
            id: 'delete',
            label: t('products.bulk.actions.delete', { defaultValue: 'Delete' }),
            icon: <Trash2 className="h-4 w-4" />,
            destructive: true,
            disabled: isBulkProcessing,
            onClick: () => setIsBulkDeleteOpen(true),
          },
        ]}
        onClear={clearSelection}
        clearLabel={t('products.bulk.clear', { defaultValue: 'Clear' })}
      />

      <ConfirmationDialog
        id="products-bulk-delete-dialog"
        isOpen={isBulkDeleteOpen}
        onClose={() => setIsBulkDeleteOpen(false)}
        onConfirm={runBulkPermanentDelete}
        title={t('products.bulk.deleteDialog.title', { defaultValue: 'Delete Products Permanently' })}
        message={t('products.bulk.deleteDialog.message', {
          defaultValue:
            'Permanently delete {{count}} selected product(s)? Products associated with existing data are skipped. This action cannot be undone.',
          count: selectedProductIds.size,
        })}
        confirmLabel={t('products.bulk.actions.delete', { defaultValue: 'Delete' })}
        cancelLabel={t('common.actions.cancel', { defaultValue: 'Cancel' })}
        isConfirming={isBulkProcessing}
      />

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
        title={t('products.archive.title', { defaultValue: 'Archive Product' })}
        message={t('products.archive.message', {
          name: productToDelete?.service_name || t('products.thisProduct', { defaultValue: 'this product' }),
          defaultValue:
            'Archive {{name}}? It will be hidden from pickers by default and cannot be attached to new contracts/invoices until restored.'
        })}
      />

      <ConfirmationDialog
        isOpen={isPermanentDeleteOpen}
        onClose={closePermanentDeleteDialog}
        onConfirm={confirmPermanentDelete}
        title={t('products.permanentDelete.title', { defaultValue: 'Delete Product Permanently' })}
        confirmLabel={t('products.actions.delete', { defaultValue: 'Delete' })}
        isConfirming={!permanentDeleteCheck?.canDelete || isCheckingDelete}
        cancelLabel={t('common.actions.cancel', { defaultValue: 'Cancel' })}
        message={
          isCheckingDelete ? (
            <span>
              {t('products.permanentDelete.checking', {
                defaultValue: 'Checking if product can be deleted...'
              })}
            </span>
          ) : permanentDeleteCheck?.canDelete ? (
            <span>
              {t('products.permanentDelete.confirm', {
                name:
                  productToPermanentDelete?.service_name ||
                  t('products.thisProduct', { defaultValue: 'this product' }),
                defaultValue:
                  'Are you sure you want to permanently delete "{{name}}"? This action cannot be undone.'
              })}
            </span>
          ) : (
            <div className="space-y-2">
              <p>
                {t('products.permanentDelete.blocked', {
                  name:
                    productToPermanentDelete?.service_name ||
                    t('products.thisProduct', { defaultValue: 'this product' }),
                  defaultValue:
                    'Cannot delete "{{name}}" because it is associated with existing data:'
                })}
              </p>
              <ul className="list-disc list-inside text-sm">
                {permanentDeleteCheck?.associations.map((a, i) => (
                  <li key={i}>{a.description}</li>
                ))}
              </ul>
              <p className="text-sm mt-2">
                {t('products.permanentDelete.archiveInstead', {
                  defaultValue:
                    'To remove this product, first remove it from all associated records, or use Archive instead.'
                })}
              </p>
            </div>
          )
        }
      />
    </>
  );
};

export default ProductsManager;
