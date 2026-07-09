'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  DollarSign,
  ExternalLink,
  PackagePlus,
  RefreshCw,
  Search,
  ShoppingCart,
} from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { toast } from 'react-hot-toast';
import type {
  KitComponentCandidate,
  KitComponentDetail,
  KitDetail,
  KitServiceTypeOption,
  KitStatus,
  KitSummary,
} from '../actions';
import {
  addKitComponent,
  createKitProduct,
  getKitDetail,
  listKitComponentCandidates,
  listKitSummaries,
  removeKitComponent,
  updateKitProduct,
} from '../actions';

interface KitManagerProps {
  initialKits: KitSummary[];
  serviceTypes: KitServiceTypeOption[];
  componentCandidates: KitComponentCandidate[];
}

type StatusFilter = 'all' | KitStatus;

interface CreateKitDraft {
  service_name: string;
  sku: string;
  custom_service_type_id: string;
  unit_of_measure: string;
  price: string;
  cost: string;
  currency_code: string;
  kit_pricing_mode: 'sum' | 'fixed';
}

const DEFAULT_CREATE_DRAFT: CreateKitDraft = {
  service_name: '',
  sku: '',
  custom_service_type_id: '',
  unit_of_measure: 'kit',
  price: '',
  cost: '',
  currency_code: 'USD',
  kit_pricing_mode: 'sum',
};

function toCents(value: string, opts?: { requiredPositive?: boolean; field?: string }): number {
  const cleaned = value.trim();
  const n = cleaned === '' ? 0 : Number(cleaned);
  if (!Number.isFinite(n) || n < 0 || (opts?.requiredPositive && n <= 0)) {
    throw new Error(opts?.field || 'Enter a valid amount.');
  }
  return Math.round(n * 100);
}

function centsToInput(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return (Number(value) / 100).toFixed(2);
}

function isPositiveIntegerText(value: string): boolean {
  return /^[1-9]\d*$/.test(value.trim());
}

function mapKitError(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as any)?.message || error || '');
  if (message.includes('Kit has no components defined')) {
    return 'Add at least one BOM component before using this kit on a sales order.';
  }
  if (message.includes('A kit cannot contain another kit')) {
    return 'Nested kits are not supported. Choose a non-kit product.';
  }
  if (message.includes('Component quantity must be a positive integer')) {
    return 'Qty per kit must be a positive whole number.';
  }
  if (message.includes('service_catalog_product_sku_unique') || message.includes('already exists')) {
    return 'A product with this SKU already exists. Use a different SKU or edit the existing product.';
  }
  return message || 'Something went wrong.';
}

export function KitManager({ initialKits, serviceTypes, componentCandidates: initialCandidates }: KitManagerProps) {
  const { t } = useTranslation('features/inventory');
  const [kits, setKits] = useState<KitSummary[]>(initialKits || []);
  const [candidates, setCandidates] = useState<KitComponentCandidate[]>(initialCandidates || []);
  const [selectedKitId, setSelectedKitId] = useState<string | null>(initialKits?.[0]?.service_id ?? null);
  const [detail, setDetail] = useState<KitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [componentServiceId, setComponentServiceId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [savingComponent, setSavingComponent] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<KitComponentDetail | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateKitDraft>({
    ...DEFAULT_CREATE_DRAFT,
    custom_service_type_id: serviceTypes[0]?.id ?? '',
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pricingMode, setPricingMode] = useState<'sum' | 'fixed'>('sum');
  const [kitPriceInput, setKitPriceInput] = useState('');
  const [fixedPriceInput, setFixedPriceInput] = useState('');
  const [savingPricing, setSavingPricing] = useState(false);

  const selectedSummary = useMemo(
    () => kits.find((kit) => kit.service_id === selectedKitId) ?? null,
    [kits, selectedKitId],
  );

  const currency = detail?.cost_currency || selectedSummary?.cost_currency || createDraft.currency_code || 'USD';

  const money = useCallback(
    (cents: number | null | undefined) =>
      new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
      }).format(Number(cents ?? 0) / 100),
    [currency],
  );

  const statusCopy = useCallback(
    (status: KitStatus): { label: string; variant: BadgeVariant } => {
      switch (status) {
        case 'ready':
          return { label: t('kits.status.ready', { defaultValue: 'Ready' }), variant: 'success' };
        case 'low_stock':
          return { label: t('kits.status.lowStock', { defaultValue: 'Low stock' }), variant: 'warning' };
        case 'incomplete':
          return { label: t('kits.status.incomplete', { defaultValue: 'Incomplete' }), variant: 'error' };
        case 'no_bom':
        default:
          return { label: t('kits.status.noBom', { defaultValue: 'No BOM' }), variant: 'info' };
      }
    },
    [t],
  );

  const refreshKits = useCallback(async () => {
    const [nextKits, nextCandidates] = await Promise.all([
      listKitSummaries(),
      listKitComponentCandidates(),
    ]);
    setKits(nextKits);
    setCandidates(nextCandidates);
    if (!selectedKitId && nextKits[0]) setSelectedKitId(nextKits[0].service_id);
  }, [selectedKitId]);

  const loadDetail = useCallback(async (kitId: string) => {
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setComponentServiceId('');
    setQuantity('1');
    try {
      const loaded = await getKitDetail(kitId);
      if (!loaded) {
        setDetailError(t('kits.detail.notFound', { defaultValue: 'This kit could not be found.' }));
        return;
      }
      setDetail(loaded);
      setPricingMode(loaded.kit_pricing_mode);
      setKitPriceInput(centsToInput(loaded.default_rate));
      setFixedPriceInput(centsToInput(loaded.kit_fixed_price ?? loaded.default_rate));
    } catch (error) {
      setDetailError(mapKitError(error));
    } finally {
      setDetailLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (selectedKitId) {
      void loadDetail(selectedKitId);
    } else {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
    }
  }, [selectedKitId, loadDetail]);

  const visibleKits = useMemo(() => {
    const q = search.trim().toLowerCase();
    return kits.filter((kit) => {
      const matchesStatus = statusFilter === 'all' || kit.status === statusFilter;
      const matchesSearch =
        !q ||
        kit.service_name.toLowerCase().includes(q) ||
        (kit.sku || '').toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [kits, search, statusFilter]);

  const readyCount = kits.filter((kit) => kit.status === 'ready').length;
  const attentionCount = kits.filter((kit) => kit.status !== 'ready').length;
  const selectedComponentAlreadyExists = detail?.components.some((component) => component.component_service_id === componentServiceId) ?? false;

  const handleCreate = async () => {
    setCreateError(null);
    if (!createDraft.service_name.trim()) {
      setCreateError(t('kits.create.validation.nameRequired', { defaultValue: 'Kit name is required.' }));
      return;
    }
    if (!createDraft.custom_service_type_id) {
      setCreateError(t('kits.create.validation.typeRequired', { defaultValue: 'Product type is required.' }));
      return;
    }
    setCreating(true);
    try {
      const price = toCents(createDraft.price, {
        requiredPositive: true,
        field: t('kits.create.validation.priceRequired', { defaultValue: 'Kit price must be greater than 0.' }),
      });
      const cost = createDraft.cost.trim() ? toCents(createDraft.cost, { field: t('kits.create.validation.costInvalid', { defaultValue: 'Kit cost must be a valid amount.' }) }) : null;
      const created = await createKitProduct({
        service_name: createDraft.service_name,
        sku: createDraft.sku || null,
        custom_service_type_id: createDraft.custom_service_type_id,
        unit_of_measure: createDraft.unit_of_measure || 'kit',
        price,
        cost,
        currency_code: createDraft.currency_code || 'USD',
        kit_pricing_mode: createDraft.kit_pricing_mode,
      });
      setCreateOpen(false);
      setCreateDraft({ ...DEFAULT_CREATE_DRAFT, custom_service_type_id: serviceTypes[0]?.id ?? '' });
      await refreshKits();
      setSelectedKitId(created.service_id);
      setDetail(created);
      toast.success(t('kits.create.created', { defaultValue: 'Kit created.' }));
    } catch (error) {
      setCreateError(mapKitError(error));
    } finally {
      setCreating(false);
    }
  };

  const handleSavePricing = async () => {
    if (!detail) return;
    setSavingPricing(true);
    try {
      const price = toCents(kitPriceInput, {
        requiredPositive: true,
        field: t('kits.pricing.validation.priceRequired', { defaultValue: 'Kit price must be greater than 0.' }),
      });
      const fixedPrice = pricingMode === 'fixed'
        ? toCents(fixedPriceInput || kitPriceInput, {
            requiredPositive: true,
            field: t('kits.pricing.validation.fixedRequired', { defaultValue: 'Fixed kit price must be greater than 0.' }),
          })
        : null;
      const updated = await updateKitProduct(detail.service_id, {
        price,
        currency_code: detail.cost_currency || 'USD',
        kit_pricing_mode: pricingMode,
        kit_fixed_price: fixedPrice,
      });
      setDetail(updated);
      await refreshKits();
      toast.success(t('kits.pricing.saved', { defaultValue: 'Pricing saved.' }));
    } catch (error) {
      toast.error(mapKitError(error));
    } finally {
      setSavingPricing(false);
    }
  };

  const handleAddComponent = async () => {
    if (!detail) return;
    if (!componentServiceId) {
      toast.error(t('kits.componentRequired', { defaultValue: 'Component is required.' }));
      return;
    }
    if (!isPositiveIntegerText(quantity)) {
      toast.error(t('kits.quantityInvalid', { defaultValue: 'Qty per kit must be a positive whole number.' }));
      return;
    }
    setSavingComponent(true);
    try {
      await addKitComponent(detail.service_id, componentServiceId, Number(quantity));
      await Promise.all([loadDetail(detail.service_id), refreshKits()]);
      setComponentServiceId('');
      setQuantity('1');
      toast.success(
        selectedComponentAlreadyExists
          ? t('kits.componentUpdated', { defaultValue: 'Component quantity updated.' })
          : t('kits.componentAdded', { defaultValue: 'Component added.' }),
      );
    } catch (error) {
      toast.error(mapKitError(error));
    } finally {
      setSavingComponent(false);
    }
  };

  const handleRemoveComponent = async (component: KitComponentDetail) => {
    if (!detail) return;
    try {
      await removeKitComponent(detail.service_id, component.component_service_id);
      await Promise.all([loadDetail(detail.service_id), refreshKits()]);
      toast.success(t('kits.componentRemoved', { defaultValue: 'Component removed.' }));
    } catch (error) {
      toast.error(mapKitError(error));
    } finally {
      setPendingRemove(null);
    }
  };

  const renderBuildable = (kit: Pick<KitSummary, 'buildable_quantity' | 'stocked_component_count'>) => {
    if (kit.stocked_component_count === 0 || kit.buildable_quantity === null) {
      return t('kits.stock.noStockLimit', { defaultValue: 'No stock limit' });
    }
    return String(kit.buildable_quantity);
  };

  const StatusBadge = ({ status }: { status: KitStatus }) => {
    const config = statusCopy(status);
    return <Badge variant={config.variant} size="sm">{config.label}</Badge>;
  };

  return (
    <div className="space-y-5 p-6" id="kits-page">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-[rgb(var(--color-text-900))]">
            {t('kits.title', { defaultValue: 'Inventory kits' })}
          </h1>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-[rgb(var(--color-text-500))]">
            <span>{t('kits.summary.total', { defaultValue: '{{count}} kits', count: kits.length })}</span>
            <span>{t('kits.summary.ready', { defaultValue: '{{count}} ready', count: readyCount })}</span>
            <span>{t('kits.summary.attention', { defaultValue: '{{count}} need attention', count: attentionCount })}</span>
          </div>
        </div>
        <Button id="kits-create-kit-button" onClick={() => setCreateOpen(true)}>
          <PackagePlus className="mr-2 h-4 w-4" />
          {t('kits.actions.createKit', { defaultValue: 'Create kit' })}
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.5fr)]">
        <section className="min-w-0 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]" aria-label={t('kits.list.label', { defaultValue: 'Kit list' })}>
          <div className="border-b border-[rgb(var(--color-border-100))] p-4">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgb(var(--color-text-400))]" />
                <Input
                  id="kits-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('kits.searchPlaceholder', { defaultValue: 'Search kits or SKUs' })}
                  className="pl-9"
                />
              </div>
              <CustomSelect
                id="kits-status-filter"
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value as StatusFilter)}
                options={[
                  { value: 'all', label: t('kits.filters.all', { defaultValue: 'All' }) },
                  { value: 'ready', label: t('kits.status.ready', { defaultValue: 'Ready' }) },
                  { value: 'no_bom', label: t('kits.status.noBom', { defaultValue: 'No BOM' }) },
                  { value: 'low_stock', label: t('kits.status.lowStock', { defaultValue: 'Low stock' }) },
                  { value: 'incomplete', label: t('kits.status.incomplete', { defaultValue: 'Incomplete' }) },
                ]}
                size="md"
                className="w-36"
              />
            </div>
          </div>

          <div className="divide-y divide-[rgb(var(--color-border-100))]" id="kits-list">
            {kits.length === 0 ? (
              <div className="p-6 text-center">
                <Boxes className="mx-auto h-8 w-8 text-[rgb(var(--color-text-300))]" />
                <p className="mt-3 text-sm font-medium text-[rgb(var(--color-text-800))]">
                  {t('kits.empty.title', { defaultValue: 'No inventory kits yet' })}
                </p>
                <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
                  {t('kits.empty.body', { defaultValue: 'Create a sellable kit, then add its bill of materials.' })}
                </p>
                <Button id="kits-empty-create-button" className="mt-4" onClick={() => setCreateOpen(true)}>
                  {t('kits.actions.createKit', { defaultValue: 'Create kit' })}
                </Button>
              </div>
            ) : visibleKits.length === 0 ? (
              <div className="p-6 text-center text-sm text-[rgb(var(--color-text-500))]">
                {t('kits.empty.noResults', { defaultValue: 'No kits match those filters.' })}
              </div>
            ) : (
              visibleKits.map((kit) => (
                <button
                  key={kit.service_id}
                  id={`kit-row-${kit.service_id}`}
                  type="button"
                  onClick={() => setSelectedKitId(kit.service_id)}
                  className={`w-full p-4 text-left transition-colors hover:bg-[rgb(var(--color-primary-50))] ${
                    selectedKitId === kit.service_id ? 'bg-[rgb(var(--color-primary-50))]' : ''
                  }`}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 rounded-md bg-[rgb(var(--color-border-100))] p-2 text-[rgb(var(--color-primary-600))]">
                      <Boxes className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-semibold text-[rgb(var(--color-text-900))]">{kit.service_name}</span>
                        <StatusBadge status={kit.status} />
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[rgb(var(--color-text-500))]">
                        <span className="font-mono">{kit.sku || t('common.emptyValue', { defaultValue: '—' })}</span>
                        <span>{kit.kit_pricing_mode === 'fixed' ? t('kits.pricing.fixed', { defaultValue: 'Fixed price' }) : t('kits.pricing.sum', { defaultValue: 'Sum of components' })}</span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <span className="rounded-md bg-[rgb(var(--color-border-50))] px-2 py-1 text-[rgb(var(--color-text-600))]">
                          {t('kits.stock.canBuildLabel', { defaultValue: 'Can build' })}: <strong className="text-[rgb(var(--color-text-900))]">{renderBuildable(kit)}</strong>
                        </span>
                        <span className="rounded-md bg-[rgb(var(--color-border-50))] px-2 py-1 text-[rgb(var(--color-text-600))]">
                          {t('kits.bom.componentCount', { defaultValue: '{{count}} components', count: kit.component_count })}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="min-w-0 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]" id="kit-detail">
          {!selectedKitId ? (
            <div className="p-8 text-center text-sm text-[rgb(var(--color-text-500))]">
              {t('kits.detail.pickKit', { defaultValue: 'Select a kit to manage its bill of materials.' })}
            </div>
          ) : detailLoading ? (
            <div className="space-y-3 p-5">
              <div className="h-16 animate-pulse rounded-md bg-[rgb(var(--color-border-100))]" />
              <div className="h-24 animate-pulse rounded-md bg-[rgb(var(--color-border-100))]" />
              <div className="h-32 animate-pulse rounded-md bg-[rgb(var(--color-border-100))]" />
            </div>
          ) : detailError ? (
            <div className="p-5">
              <Alert variant="destructive">
                <AlertTitle>{t('kits.detail.loadFailedTitle', { defaultValue: 'Could not load this kit' })}</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>{detailError}</p>
                  <Button id="kits-detail-retry-button" variant="outline" size="sm" onClick={() => selectedKitId && loadDetail(selectedKitId)}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {t('common.retry', { defaultValue: 'Retry' })}
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          ) : detail ? (
            <div className="space-y-5 p-5">
              <div className="flex flex-col gap-3 border-b border-[rgb(var(--color-border-100))] pb-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="truncate text-base font-semibold text-[rgb(var(--color-text-900))]">{detail.service_name}</h2>
                    <StatusBadge status={detail.status} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[rgb(var(--color-text-500))]">
                    <span>{t('kits.fields.sku', { defaultValue: 'SKU' })}: <span className="font-mono">{detail.sku || t('common.emptyValue', { defaultValue: '—' })}</span></span>
                    <span>{t('kits.fields.unit', { defaultValue: 'Unit' })}: {detail.unit_of_measure || 'kit'}</span>
                    <span>{t('kits.usage.usedOnSalesOrders', { defaultValue: 'Used on sales orders' })}: {detail.sales_order_count}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button id="kit-create-sales-order-link" variant="default" size="sm" asChild>
                    <Link href="/msp/inventory/sales-orders">
                      <ShoppingCart className="mr-2 h-4 w-4" />
                      {t('kits.actions.createSalesOrder', { defaultValue: 'Create sales order' })}
                    </Link>
                  </Button>
                  <Button id="kit-product-settings-link" variant="outline" size="sm" asChild>
                    <Link href="/msp/billing?tab=products">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      {t('kits.actions.productSettings', { defaultValue: 'Open product settings' })}
                    </Link>
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <Metric label={t('kits.stock.canBuildLabel', { defaultValue: 'Can build' })} value={renderBuildable(detail)} />
                <Metric label={t('kits.bom.componentCountShort', { defaultValue: 'Components' })} value={String(detail.component_count)} />
                <Metric label={t('kits.pricing.kitPrice', { defaultValue: 'Kit price' })} value={money(detail.computed_price)} />
                <Metric label={t('kits.pricing.margin', { defaultValue: 'Margin' })} value={detail.margin_percent === null ? money(detail.margin_amount) : `${money(detail.margin_amount)} · ${(detail.margin_percent * 100).toFixed(1)}%`} />
              </div>

              <Panel title={t('kits.bom.title', { defaultValue: 'Bill of materials' })} icon={<Boxes className="h-4 w-4" />}>
                <div className="space-y-4">
                  {detail.components.length === 0 && (
                    <Alert variant="warning" id="kit-empty-bom-warning">
                      <AlertTitle>{t('kits.bom.emptyTitle', { defaultValue: 'Add at least one BOM component' })}</AlertTitle>
                      <AlertDescription>
                        {t('kits.bom.emptyBody', { defaultValue: 'Componentless kits cannot be used on sales orders because there is nothing to allocate or fulfill.' })}
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_120px_auto] lg:items-end" id="kit-add-component-row">
                    <CustomSelect
                      id="kit-component-service"
                      label={t('kits.fields.component', { defaultValue: 'Component' })}
                      required
                      value={componentServiceId}
                      placeholder={t('kits.fields.componentPlaceholder', { defaultValue: 'Select a product' })}
                      options={candidates.map((candidate) => ({
                        value: candidate.service_id,
                        label: candidate.service_name,
                        dropdownHint: [
                          candidate.sku ? candidate.sku : t('common.emptyValue', { defaultValue: '—' }),
                          candidate.track_stock ? `${t('kits.stock.available', { defaultValue: 'Available' })} ${candidate.available}` : t('kits.stock.nonStocked', { defaultValue: 'Non-stocked' }),
                        ].join(' · '),
                      }))}
                      onValueChange={setComponentServiceId}
                    />
                    <Input
                      id="kit-component-quantity"
                      label={t('kits.bom.qtyPerKit', { defaultValue: 'Qty per kit' })}
                      required
                      type="number"
                      min={1}
                      step={1}
                      value={quantity}
                      onChange={(event) => setQuantity(event.target.value)}
                    />
                    <Button id="kit-add-component-button" onClick={handleAddComponent} disabled={savingComponent || !detail}>
                      {savingComponent
                        ? t('common.saving', { defaultValue: 'Saving…' })
                        : selectedComponentAlreadyExists
                          ? t('kits.actions.updateQuantity', { defaultValue: 'Update quantity' })
                          : t('kits.actions.addComponent', { defaultValue: 'Add component' })}
                    </Button>
                  </div>

                  {detail.components.length > 0 && (
                    <div className="overflow-hidden rounded-md border border-[rgb(var(--color-border-100))]" id="kit-components-table">
                      <div className="hidden grid-cols-[minmax(0,1.6fr)_90px_90px_110px_110px_96px] gap-2 border-b border-[rgb(var(--color-border-100))] bg-[rgb(var(--color-border-50))] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))] md:grid">
                        <span>{t('kits.columns.component', { defaultValue: 'Component' })}</span>
                        <span>{t('kits.bom.qtyPerKit', { defaultValue: 'Qty per kit' })}</span>
                        <span>{t('kits.stock.available', { defaultValue: 'Available' })}</span>
                        <span>{t('kits.pricing.unitCost', { defaultValue: 'Unit cost' })}</span>
                        <span>{t('kits.pricing.extCost', { defaultValue: 'Ext. cost' })}</span>
                        <span className="text-right">{t('common.actions', { defaultValue: 'Actions' })}</span>
                      </div>
                      <div className="divide-y divide-[rgb(var(--color-border-100))]">
                        {detail.components.map((component) => (
                          <div key={component.component_service_id} className="grid grid-cols-2 gap-3 px-3 py-3 text-sm md:grid-cols-[minmax(0,1.6fr)_90px_90px_110px_110px_96px] md:items-center md:gap-2 md:py-2">
                            <div className="col-span-2 min-w-0 md:col-span-1">
                              <p className="truncate font-medium text-[rgb(var(--color-text-800))]">{component.service_name}</p>
                              <div className="mt-1 flex flex-wrap gap-1 text-xs text-[rgb(var(--color-text-500))]">
                                <span className="font-mono">{component.sku || t('common.emptyValue', { defaultValue: '—' })}</span>
                                <Badge variant={component.track_stock ? 'info' : 'default-muted'} size="sm">
                                  {component.track_stock ? t('kits.stock.stocked', { defaultValue: 'Stocked' }) : t('kits.stock.nonStocked', { defaultValue: 'Non-stocked' })}
                                </Badge>
                                {component.is_serialized && <Badge variant="secondary" size="sm">{t('kits.stock.serialized', { defaultValue: 'Serialized' })}</Badge>}
                              </div>
                            </div>
                            <div>
                              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))] md:hidden">{t('kits.bom.qtyPerKit', { defaultValue: 'Qty per kit' })}</span>
                              <span className="font-mono text-[rgb(var(--color-text-800))]">{component.quantity}</span>
                            </div>
                            <div>
                              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))] md:hidden">{t('kits.stock.available', { defaultValue: 'Available' })}</span>
                              <span className="font-mono text-[rgb(var(--color-text-800))]">{component.track_stock ? component.available : t('kits.stock.noStockLimitShort', { defaultValue: 'n/a' })}</span>
                            </div>
                            <div>
                              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))] md:hidden">{t('kits.pricing.unitCost', { defaultValue: 'Unit cost' })}</span>
                              <span className="font-mono text-[rgb(var(--color-text-800))]">{money(component.unit_cost)}</span>
                            </div>
                            <div>
                              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))] md:hidden">{t('kits.pricing.extCost', { defaultValue: 'Ext. cost' })}</span>
                              <span className="font-mono text-[rgb(var(--color-text-800))]">{money(component.extended_cost)}</span>
                            </div>
                            <div className="col-span-2 text-right md:col-span-1">
                              <Button id={`remove-component-${component.component_service_id}`} variant="ghost" size="sm" onClick={() => setPendingRemove(component)}>
                                {t('common.remove', { defaultValue: 'Remove' })}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Panel>

              <div className="grid gap-4 lg:grid-cols-2">
                <Panel title={t('kits.pricing.title', { defaultValue: 'Pricing and margin' })} icon={<DollarSign className="h-4 w-4" />}>
                  <div className="space-y-3">
                    <CustomSelect
                      id="kit-pricing-mode"
                      label={t('kits.pricing.mode', { defaultValue: 'Pricing mode' })}
                      value={pricingMode}
                      onValueChange={(value) => setPricingMode(value as 'sum' | 'fixed')}
                      options={[
                        { value: 'sum', label: t('kits.pricing.sum', { defaultValue: 'Sum of components' }) },
                        { value: 'fixed', label: t('kits.pricing.fixed', { defaultValue: 'Fixed price' }) },
                      ]}
                    />
                    <Input
                      id="kit-price"
                      label={t('kits.pricing.salesOrderPrice', { defaultValue: 'Sales-order kit price' })}
                      value={kitPriceInput}
                      inputMode="decimal"
                      onChange={(event) => setKitPriceInput(event.target.value.replace(/[^0-9.]/g, ''))}
                    />
                    {pricingMode === 'fixed' && (
                      <Input
                        id="kit-fixed-price"
                        label={t('kits.pricing.fixedAmount', { defaultValue: 'Fixed kit price' })}
                        value={fixedPriceInput}
                        inputMode="decimal"
                        onChange={(event) => setFixedPriceInput(event.target.value.replace(/[^0-9.]/g, ''))}
                        required
                      />
                    )}
                    <div className="rounded-md bg-[rgb(var(--color-border-50))] p-3 text-sm">
                      <div className="flex justify-between gap-3">
                        <span className="text-[rgb(var(--color-text-500))]">{t('kits.pricing.componentCost', { defaultValue: 'Component cost' })}</span>
                        <span className="font-mono text-[rgb(var(--color-text-800))]">{money(detail.component_cost)}</span>
                      </div>
                      <div className="mt-1 flex justify-between gap-3">
                        <span className="text-[rgb(var(--color-text-500))]">{t('kits.pricing.margin', { defaultValue: 'Margin' })}</span>
                        <span className="font-mono text-[rgb(var(--color-text-800))]">
                          {money(detail.margin_amount)}
                          {detail.margin_percent !== null ? ` · ${(detail.margin_percent * 100).toFixed(1)}%` : ''}
                        </span>
                      </div>
                    </div>
                    <Button id="kit-save-pricing-button" onClick={handleSavePricing} disabled={savingPricing}>
                      {savingPricing ? t('common.saving', { defaultValue: 'Saving…' }) : t('kits.pricing.save', { defaultValue: 'Save pricing' })}
                    </Button>
                  </div>
                </Panel>

                <Panel title={t('kits.stock.title', { defaultValue: 'Stock readiness' })} icon={<CheckCircle2 className="h-4 w-4" />}>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="text-[rgb(var(--color-text-500))]">{t('kits.stock.canBuildLabel', { defaultValue: 'Can build' })}</span>
                      <span className="font-mono font-medium text-[rgb(var(--color-text-900))]">{renderBuildable(detail)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-[rgb(var(--color-text-500))]">{t('kits.stock.stockedComponents', { defaultValue: 'Stocked components' })}</span>
                      <span className="font-mono text-[rgb(var(--color-text-800))]">{detail.stocked_component_count}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-[rgb(var(--color-text-500))]">{t('kits.stock.shortComponents', { defaultValue: 'Short components' })}</span>
                      <span className="font-mono text-[rgb(var(--color-text-800))]">{detail.short_component_count}</span>
                    </div>
                    {detail.short_component_count > 0 && (
                      <Alert variant="warning">
                        <AlertDescription>
                          {t('kits.stock.shortWarning', { defaultValue: 'At least one stocked component cannot cover one complete kit from available stock.' })}
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                </Panel>
              </div>

              <Panel title={t('kits.salesOrder.title', { defaultValue: 'Sales-order behavior' })} icon={<ShoppingCart className="h-4 w-4" />}>
                <div className="grid gap-3 text-sm lg:grid-cols-3">
                  <BehaviorFact label={t('kits.salesOrder.parentLine', { defaultValue: 'Parent kit line' })} value={t('kits.salesOrder.parentLineValue', { defaultValue: 'Priced at {{price}}', price: money(detail.sales_order_behavior.parent_line_price) })} />
                  <BehaviorFact label={t('kits.salesOrder.componentLines', { defaultValue: 'Component lines' })} value={t('kits.salesOrder.componentLinesValue', { defaultValue: 'Explode as child lines' })} />
                  <BehaviorFact label={t('kits.salesOrder.stockEffect', { defaultValue: 'Stock effect' })} value={t('kits.salesOrder.stockEffectValue', { defaultValue: 'Components allocate and fulfill stock' })} />
                </div>
                {detail.components.length > 0 && (
                  <div className="mt-3 rounded-md border border-[rgb(var(--color-border-100))] p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
                      {t('kits.salesOrder.preview', { defaultValue: 'Preview for qty 1' })}
                    </p>
                    <ul className="mt-2 space-y-1.5 text-sm">
                      <li className="flex justify-between gap-3">
                        <span className="truncate text-[rgb(var(--color-text-700))]">{detail.service_name}</span>
                        <span className="font-mono text-[rgb(var(--color-text-900))]">{money(detail.computed_price)}</span>
                      </li>
                      {detail.components.map((component) => (
                        <li key={component.component_service_id} className="flex justify-between gap-3 text-[rgb(var(--color-text-500))]">
                          <span className="truncate">{component.quantity} x {component.service_name}</span>
                          <span className="font-mono">{money(0)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Panel>
            </div>
          ) : null}
        </section>
      </div>

      <Dialog
        id="kit-create-dialog"
        isOpen={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setCreateError(null);
        }}
        title={t('kits.create.title', { defaultValue: 'Create kit' })}
        footer={(
          <div className="flex justify-end gap-2">
            <Button id="kit-create-cancel" variant="outline" onClick={() => setCreateOpen(false)}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button id="kit-create-submit" onClick={handleCreate} disabled={creating || serviceTypes.length === 0}>
              {creating ? t('common.saving', { defaultValue: 'Saving…' }) : t('kits.actions.createKit', { defaultValue: 'Create kit' })}
            </Button>
          </div>
        )}
      >
        <div className="space-y-4">
          {createError && (
            <Alert variant="destructive">
              <AlertDescription>{createError}</AlertDescription>
            </Alert>
          )}
          {serviceTypes.length === 0 && (
            <Alert variant="warning">
              <AlertDescription>
                {t('kits.create.noServiceTypes', { defaultValue: 'Create a product type in Billing before creating a kit.' })}
              </AlertDescription>
            </Alert>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              id="kit-create-name"
              label={t('kits.create.fields.name', { defaultValue: 'Kit name' })}
              value={createDraft.service_name}
              onChange={(event) => setCreateDraft((prev) => ({ ...prev, service_name: event.target.value }))}
              required
            />
            <Input
              id="kit-create-sku"
              label={t('kits.fields.sku', { defaultValue: 'SKU' })}
              value={createDraft.sku}
              onChange={(event) => setCreateDraft((prev) => ({ ...prev, sku: event.target.value }))}
            />
            <CustomSelect
              id="kit-create-product-type"
              label={t('kits.create.fields.productType', { defaultValue: 'Product type' })}
              value={createDraft.custom_service_type_id}
              onValueChange={(value) => setCreateDraft((prev) => ({ ...prev, custom_service_type_id: value }))}
              options={serviceTypes.map((type) => ({ value: type.id, label: type.name }))}
              required
            />
            <Input
              id="kit-create-unit"
              label={t('kits.fields.unit', { defaultValue: 'Unit' })}
              value={createDraft.unit_of_measure}
              onChange={(event) => setCreateDraft((prev) => ({ ...prev, unit_of_measure: event.target.value }))}
            />
            <Input
              id="kit-create-price"
              label={t('kits.pricing.kitPrice', { defaultValue: 'Kit price' })}
              value={createDraft.price}
              inputMode="decimal"
              onChange={(event) => setCreateDraft((prev) => ({ ...prev, price: event.target.value.replace(/[^0-9.]/g, '') }))}
              required
            />
            <Input
              id="kit-create-cost"
              label={t('kits.pricing.kitCostOptional', { defaultValue: 'Kit cost (optional)' })}
              value={createDraft.cost}
              inputMode="decimal"
              onChange={(event) => setCreateDraft((prev) => ({ ...prev, cost: event.target.value.replace(/[^0-9.]/g, '') }))}
            />
            <Input
              id="kit-create-currency"
              label={t('kits.pricing.currency', { defaultValue: 'Currency' })}
              value={createDraft.currency_code}
              maxLength={3}
              onChange={(event) => setCreateDraft((prev) => ({ ...prev, currency_code: event.target.value.toUpperCase() }))}
            />
            <CustomSelect
              id="kit-create-pricing-mode"
              label={t('kits.pricing.mode', { defaultValue: 'Pricing mode' })}
              value={createDraft.kit_pricing_mode}
              onValueChange={(value) => setCreateDraft((prev) => ({ ...prev, kit_pricing_mode: value as 'sum' | 'fixed' }))}
              options={[
                { value: 'sum', label: t('kits.pricing.sum', { defaultValue: 'Sum of components' }) },
                { value: 'fixed', label: t('kits.pricing.fixed', { defaultValue: 'Fixed price' }) },
              ]}
            />
          </div>
        </div>
      </Dialog>

      <ConfirmationDialog
        id="kit-remove-component-confirm"
        isOpen={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        onConfirm={() => {
          if (pendingRemove) return handleRemoveComponent(pendingRemove);
        }}
        title={t('kits.removeTitle', { defaultValue: 'Remove component' })}
        message={
          pendingRemove
            ? t('kits.removeConfirm', { defaultValue: 'Remove {{name}} from this kit?', name: pendingRemove.service_name })
            : ''
        }
        confirmLabel={t('common.remove', { defaultValue: 'Remove' })}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[rgb(var(--color-border-100))] bg-[rgb(var(--color-border-50))] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))]">{label}</p>
      <p className="mt-1 truncate font-mono text-base font-semibold text-[rgb(var(--color-text-900))]">{value}</p>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[rgb(var(--color-border-200))] p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[rgb(var(--color-primary-500))]">{icon}</span>
        <h3 className="text-sm font-semibold text-[rgb(var(--color-text-800))]">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function BehaviorFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[rgb(var(--color-border-50))] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))]">{label}</p>
      <p className="mt-1 text-sm font-medium text-[rgb(var(--color-text-800))]">{value}</p>
    </div>
  );
}
