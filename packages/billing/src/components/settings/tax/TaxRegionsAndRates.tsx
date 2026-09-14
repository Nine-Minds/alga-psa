'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Layers,
  MapPin,
  MoreVertical,
  PlusCircle,
  Settings,
} from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@alga-psa/ui/components/Card';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Badge } from '@alga-psa/ui/components/Badge';
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
import { SearchInput } from '@alga-psa/ui/components/SearchInput';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { DeleteEntityDialog } from '@alga-psa/ui';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  handleError,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { ColumnDefinition, DeletionValidationResult, ITaxRate, ITaxRegion } from '@alga-psa/types';
import { toPlainDate } from '@alga-psa/core';
import { preCheckDeletion } from '@alga-psa/auth/lib/preCheckDeletion';
import { getTaxRates, deleteTaxRate, setDefaultTaxRate, DeleteTaxRateResult } from '../../../actions/taxRateActions';
import { getTaxRegions, updateTaxRegion } from '../../../actions/taxSettingsActions';
import {
  formatTaxPercentage,
  RegionRateSummary,
  summarizeRatesByRegion,
  taxRateStatusOn,
  TaxRateStatus,
} from '../../../lib/taxRateApplicability';
import { TaxRateDetailPanel } from '../../billing-dashboard/TaxRateDetailPanel';
import { TaxRegionDialog } from './TaxRegionDialog';
import { TaxRateDialog } from './TaxRateDialog';

interface RegionRow extends ITaxRegion {
  summary: RegionRateSummary | undefined;
  /** Denormalized for column sorting; null sorts regions with no current rate together. */
  effectivePercentage: number | null;
}

type RegionRef = Pick<ITaxRegion, 'region_code' | 'region_name'>;

const PAGE_SIZE = 25;

const rateStatusBadge: Record<TaxRateStatus, 'success' | 'info' | 'warning' | 'default-muted'> = {
  current: 'success',
  scheduled: 'info',
  expired: 'warning',
  inactive: 'default-muted',
};

interface TaxRegionsAndRatesProps {
  /**
   * Revision bumped by the shared parent when tenant tax settings change
   * elsewhere (e.g. TaxSourceSettings switching tax source). When it changes,
   * this component refetches so the rate list — including the default
   * indicator — reflects the latest persisted state.
   */
  settingsRevision?: number;
  /**
   * Notifies the shared parent that this component changed tax state (set
   * default, create, edit or delete a rate) so its sibling tax components
   * re-evaluate their own state.
   */
  onSettingsChanged?: () => void;
}

/**
 * One table for tax regions with each region's rates inline: the region row shows
 * what an invoice would be taxed at today, expanding it lists the rates behind that
 * number. Rates are always created inside a region, so there is no region picker.
 */
export function TaxRegionsAndRates({
  settingsRevision = 0,
  onSettingsChanged,
}: TaxRegionsAndRatesProps) {
  const { t } = useTranslation('msp/billing-settings');
  // Rate rows reuse the strings the rate dialog already owns; they live in the
  // service-catalog namespace rather than billing-settings.
  const { t: tCatalog } = useTranslation('msp/service-catalog');
  const { formatDate } = useFormatters();
  const today = useMemo(() => Temporal.Now.plainDateISO(), []);
  // Rates carry calendar dates; format them in the app locale so they read the
  // same way the date picker parses them.
  const formatRateDate = (value: string) => formatDate(toPlainDate(value).toString());

  const [regions, setRegions] = useState<ITaxRegion[]>([]);
  const [rates, setRates] = useState<ITaxRate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(() => new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [isToggling, setIsToggling] = useState(false);

  const [regionDialog, setRegionDialog] = useState<{ open: boolean; region: ITaxRegion | null }>({ open: false, region: null });
  const [rateDialog, setRateDialog] = useState<{ region: RegionRef; rate: ITaxRate | null } | null>(null);
  const [viewingRate, setViewingRate] = useState<ITaxRate | null>(null);
  const [rateToDelete, setRateToDelete] = useState<ITaxRate | null>(null);
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async (showLoading: boolean) => {
    if (showLoading) {
      setIsLoading(true);
    }
    try {
      const [regionResult, rateResult] = await Promise.all([getTaxRegions(), getTaxRates()]);
      if (isActionMessageError(regionResult) || isActionPermissionError(regionResult)) {
        setLoadError(getErrorMessage(regionResult));
        return;
      }
      if (isActionMessageError(rateResult) || isActionPermissionError(rateResult)) {
        setLoadError(getErrorMessage(rateResult));
        return;
      }
      setRegions(regionResult);
      setRates(rateResult);
      setLoadError(null);
    } catch (error) {
      console.error('Failed to load tax regions and rates:', error);
      setLoadError(t('tax.regions.errors.load', { defaultValue: 'Failed to load tax regions.' }));
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }, [t]);

  useEffect(() => {
    void load(true);
  }, [load]);

  const refresh = useCallback(() => load(false), [load]);

  // Refetch when a sibling tax component changes shared state. The default
  // indicator is part of the fetched rate list, so this keeps it from going
  // stale against a sibling-driven change.
  const lastSettingsRevisionRef = useRef(settingsRevision);
  useEffect(() => {
    if (lastSettingsRevisionRef.current === settingsRevision) {
      return;
    }
    lastSettingsRevisionRef.current = settingsRevision;
    void refresh();
  }, [settingsRevision, refresh]);

  const handleSetDefaultTaxRate = async (rate: ITaxRate) => {
    try {
      const result = await setDefaultTaxRate(rate.tax_rate_id);
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        handleError(result, getErrorMessage(result));
        return;
      }
      await refresh();
      onSettingsChanged?.();
    } catch (error) {
      console.error('Failed to set default tax rate:', error);
      handleError(error, tCatalog('taxRates.errors.setDefault', {
        defaultValue: 'Failed to set default tax rate',
      }));
    }
  };

  const rows = useMemo<RegionRow[]>(() => {
    const byRegion = summarizeRatesByRegion(rates, today);
    return regions.map((region) => {
      const summary = byRegion.get(region.region_code);
      return { ...region, summary, effectivePercentage: summary?.effectivePercentage ?? null };
    });
  }, [regions, rates, today]);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return rows;
    }
    return rows.filter((row) =>
      row.region_name.toLowerCase().includes(needle) || row.region_code.toLowerCase().includes(needle));
  }, [rows, query]);

  const toggleExpanded = (regionCode: string) => {
    setExpandedCodes((current) => {
      const next = new Set(current);
      if (next.has(regionCode)) {
        next.delete(regionCode);
      } else {
        next.add(regionCode);
      }
      return next;
    });
  };

  const handleToggleActive = async (region: ITaxRegion) => {
    const nextActive = !region.is_active;
    setIsToggling(true);
    try {
      const result = await updateTaxRegion(region.region_code, { is_active: nextActive });
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        handleError(result, getErrorMessage(result));
        return;
      }
      toast.success(nextActive
        ? t('tax.regions.toast.activated', { name: region.region_name, defaultValue: 'Tax region {{name}} activated successfully.' })
        : t('tax.regions.toast.deactivated', { name: region.region_name, defaultValue: 'Tax region {{name}} deactivated successfully.' }));
      await refresh();
    } catch (error) {
      console.error('Failed to update tax region active state:', error);
      handleError(error, nextActive
        ? t('tax.regions.errors.activate', { defaultValue: 'Failed to activate tax region.' })
        : t('tax.regions.errors.deactivate', { defaultValue: 'Failed to deactivate tax region.' }));
    } finally {
      setIsToggling(false);
    }
  };

  const requestDelete = (rate: ITaxRate) => {
    setRateToDelete(rate);
    setDeleteValidation(null);
    setIsDeleteValidating(true);
    void preCheckDeletion('tax_rate', rate.tax_rate_id)
      .then(setDeleteValidation)
      .catch((error: unknown) => {
        console.error('Failed to validate tax rate deletion:', error);
        setDeleteValidation({
          canDelete: false,
          code: 'VALIDATION_FAILED',
          message: t('tax.regions.rates.errors.validateDeletion', {
            defaultValue: 'Failed to validate deletion. Please try again.',
          }),
          dependencies: [],
          alternatives: [],
        });
      })
      .finally(() => setIsDeleteValidating(false));
  };

  const resetDelete = () => {
    setRateToDelete(null);
    setDeleteValidation(null);
    setIsDeleteValidating(false);
    setIsDeleting(false);
  };

  const confirmDelete = async () => {
    if (!rateToDelete) {
      return;
    }
    setIsDeleting(true);
    try {
      const result: DeleteTaxRateResult = await deleteTaxRate(rateToDelete.tax_rate_id);
      if (!result.success) {
        setDeleteValidation(result);
        return;
      }
      resetDelete();
      await refresh();
      onSettingsChanged?.();
    } catch (error) {
      console.error('Error confirming tax rate deletion:', error);
      handleError(error, t('tax.regions.rates.errors.delete', { defaultValue: 'Failed to delete tax rate.' }));
    } finally {
      setIsDeleting(false);
    }
  };

  const regionNameFor = (regionCode: string) =>
    regions.find((region) => region.region_code === regionCode)?.region_name ?? regionCode;

  const renderCurrentRate = (row: RegionRow) => {
    const summary = row.summary;
    if (!summary || summary.rates.length === 0) {
      return (
        <Badge variant="warning" id={`tax-region-current-rate-${row.region_code}`}>
          {t('tax.regions.rateSummary.noRates', { defaultValue: 'No rate' })}
        </Badge>
      );
    }
    if (summary.effectivePercentage === null) {
      return (
        <Badge variant="warning" id={`tax-region-current-rate-${row.region_code}`}>
          {t('tax.regions.rateSummary.noCurrentRate', { defaultValue: 'No current rate' })}
        </Badge>
      );
    }
    const combined = summary.applicable.length > 1;
    return (
      <span className="inline-flex items-center gap-1.5" id={`tax-region-current-rate-${row.region_code}`}>
        <span className="font-medium tabular-nums">{formatTaxPercentage(summary.effectivePercentage)}</span>
        {combined && (
          <Tooltip content={t('tax.regions.rateSummary.combinedHint', {
            count: summary.applicable.length,
            defaultValue: '{{count}} active rates apply today and are added together on invoices.',
          })}>
            <span className="inline-flex items-center gap-1 text-xs text-[rgb(var(--badge-warning-text))]">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              {t('tax.regions.rateSummary.combined', {
                count: summary.applicable.length,
                defaultValue: '{{count}} combined',
              })}
            </span>
          </Tooltip>
        )}
      </span>
    );
  };

  const columns: ColumnDefinition<RegionRow>[] = [
    {
      title: '',
      dataIndex: 'region_code',
      width: '3%',
      render: (_, row) => {
        const expanded = expandedCodes.has(row.region_code);
        return (
          <span className="text-muted-foreground" aria-label={expanded
            ? t('tax.regions.a11y.collapse', { defaultValue: 'Hide rates' })
            : t('tax.regions.a11y.expand', { defaultValue: 'Show rates' })}>
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
        );
      },
    },
    {
      title: t('tax.regions.columns.region', { defaultValue: 'Region' }),
      dataIndex: 'region_name',
      render: (_, row) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{row.region_name}</span>
            {!row.is_active && (
              <Badge variant="warning" size="sm">
                {t('common.statuses.inactive', { defaultValue: 'Inactive' })}
              </Badge>
            )}
          </div>
          {row.region_code !== row.region_name && (
            <div className="truncate text-xs text-muted-foreground">{row.region_code}</div>
          )}
        </div>
      ),
    },
    {
      title: t('tax.regions.columns.currentRate', { defaultValue: 'Current rate' }),
      dataIndex: 'effectivePercentage',
      width: '22%',
      render: (_, row) => renderCurrentRate(row),
    },
    {
      title: t('tax.regions.columns.rates', { defaultValue: 'Rates' }),
      dataIndex: 'summary',
      width: '10%',
      render: (_, row) => <span className="tabular-nums">{row.summary?.rates.length ?? 0}</span>,
    },
    {
      title: t('common.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'actions',
      width: '6%',
      render: (_, region) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              id={`tax-region-actions-menu-${region.region_code}`}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              disabled={isToggling}
            >
              <span className="sr-only">{t('common.a11y.openMenu', { defaultValue: 'Open menu' })}</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={`add-tax-rate-menu-item-${region.region_code}`}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                setRateDialog({ region, rate: null });
              }}
            >
              {t('tax.regions.rates.actions.add', { defaultValue: 'Add rate' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`edit-tax-region-menu-item-${region.region_code}`}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                setRegionDialog({ open: true, region });
              }}
            >
              {t('tax.regions.actions.edit', { defaultValue: 'Edit' })}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              id={`${region.is_active ? 'deactivate' : 'activate'}-tax-region-menu-item-${region.region_code}`}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                void handleToggleActive(region);
              }}
              disabled={isToggling}
            >
              {region.is_active
                ? t('tax.regions.actions.deactivate', { defaultValue: 'Deactivate' })
                : t('tax.regions.actions.activate', { defaultValue: 'Activate' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const renderRatesPanel = (row: RegionRow) => {
    if (!expandedCodes.has(row.region_code)) {
      return null;
    }
    const regionRates = [...(row.summary?.rates ?? [])].sort((a, b) =>
      Temporal.PlainDate.compare(toPlainDate(b.start_date), toPlainDate(a.start_date)));
    const addButton = (
      <Button
        id={`add-tax-rate-button-${row.region_code}`}
        size="sm"
        variant="outline"
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          setRateDialog({ region: row, rate: null });
        }}
      >
        <PlusCircle className="mr-2 h-4 w-4" />
        {t('tax.regions.rates.actions.add', { defaultValue: 'Add rate' })}
      </Button>
    );

    if (regionRates.length === 0) {
      return (
        <div className="flex flex-wrap items-center justify-between gap-3" id={`tax-region-rates-${row.region_code}`}>
          <p className="text-sm text-[rgb(var(--badge-warning-text))]">
            {t('tax.regions.rates.empty', {
              defaultValue: 'This region has no rates. Invoices taxed here will fail until one is added.',
            })}
          </p>
          {addButton}
        </div>
      );
    }

    return (
      <div className="space-y-3" id={`tax-region-rates-${row.region_code}`}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-1 pr-3 font-medium">{t('tax.regions.rates.columns.rate', { defaultValue: 'Rate' })}</th>
              <th className="py-1 pr-3 font-medium">{t('tax.regions.rates.columns.description', { defaultValue: 'Description' })}</th>
              <th className="py-1 pr-3 font-medium">{t('tax.regions.rates.columns.effective', { defaultValue: 'Effective' })}</th>
              <th className="py-1 pr-3 font-medium">{t('common.columns.status', { defaultValue: 'Status' })}</th>
              <th className="py-1 pr-3 font-medium">{tCatalog('taxRates.table.default', { defaultValue: 'Default' })}</th>
              <th className="py-1 font-medium"><span className="sr-only">{t('common.columns.actions', { defaultValue: 'Actions' })}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgb(var(--color-border-200)/0.7)]">
            {regionRates.map((rate) => {
              const status = taxRateStatusOn(rate, today);
              return (
                <tr
                  key={rate.tax_rate_id}
                  id={`tax-rate-row-${rate.tax_rate_id}`}
                  className="cursor-pointer hover:bg-[rgb(var(--color-border-50)/0.82)]"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRateDialog({ region: row, rate });
                  }}
                >
                  <td className="py-2 pr-3 font-medium tabular-nums">{formatTaxPercentage(rate.tax_percentage)}</td>
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-2">
                      {rate.description || <span className="text-muted-foreground">&mdash;</span>}
                      {rate.is_composite && (
                        <Badge variant="outline" size="sm">
                          <Layers className="mr-1 h-3 w-3" />
                          {t('tax.regions.rates.composite', { defaultValue: 'Composite' })}
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {rate.end_date
                      ? t('tax.regions.rates.effectiveRange', {
                          start: formatRateDate(rate.start_date),
                          end: formatRateDate(rate.end_date),
                          defaultValue: '{{start}} to {{end}}',
                        })
                      : t('tax.regions.rates.effectiveFrom', {
                          start: formatRateDate(rate.start_date),
                          defaultValue: '{{start}} onward',
                        })}
                  </td>
                  <td className="py-2 pr-3">
                    <Badge variant={rateStatusBadge[status]} size="sm">
                      {t(`tax.regions.rates.status.${status}`, {
                        defaultValue: status.charAt(0).toUpperCase() + status.slice(1),
                      })}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3">
                    {rate.is_default && (
                      <Badge variant="primary" size="sm" id={`tax-rate-default-badge-${rate.tax_rate_id}`}>
                        {tCatalog('taxRates.table.defaultBadge', { defaultValue: 'Default' })}
                      </Badge>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          id={`tax-rate-actions-menu-${rate.tax_rate_id}`}
                          onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        >
                          <span className="sr-only">{t('common.a11y.openMenu', { defaultValue: 'Open menu' })}</span>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          id={`set-default-tax-rate-${rate.tax_rate_id}`}
                          disabled={rate.is_default || !rate.is_active}
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            void handleSetDefaultTaxRate(rate);
                          }}
                        >
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          {tCatalog('taxRates.actions.setDefault', { defaultValue: 'Set as default' })}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          id={`edit-tax-rate-${rate.tax_rate_id}`}
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            setRateDialog({ region: row, rate });
                          }}
                        >
                          {t('tax.regions.rates.actions.edit', { defaultValue: 'Edit' })}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          id={`view-tax-rate-details-${rate.tax_rate_id}`}
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            setViewingRate(rate);
                          }}
                        >
                          <Settings className="mr-2 h-4 w-4" />
                          {t('tax.regions.rates.actions.advanced', { defaultValue: 'Advanced settings' })}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          id={`delete-tax-rate-${rate.tax_rate_id}`}
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            requestDelete(rate);
                          }}
                        >
                          {t('tax.regions.rates.actions.delete', { defaultValue: 'Delete' })}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex justify-end">{addButton}</div>
      </div>
    );
  };

  if (viewingRate) {
    return (
      <TaxRateDetailPanel
        taxRate={viewingRate}
        onBack={() => {
          setViewingRate(null);
          void refresh();
        }}
      />
    );
  }

  const addRegionButton = (
    <Button id="add-tax-region-button" size="sm" onClick={() => setRegionDialog({ open: true, region: null })}>
      <PlusCircle className="mr-2 h-4 w-4" />
      {t('tax.regions.actions.add', { defaultValue: 'Add Tax Region' })}
    </Button>
  );

  return (
    <Card id="tax-regions-and-rates-card">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle>{t('tax.regions.title', { defaultValue: 'Tax Regions and Rates' })}</CardTitle>
          {regions.length > 0 && addRegionButton}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError && (
          <Alert variant="destructive">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}
        {isLoading ? (
          <LoadingIndicator
            layout="stacked"
            className="py-10 text-muted-foreground"
            spinnerProps={{ size: 'md' }}
            text={t('tax.regions.loading', { defaultValue: 'Loading regions...' })}
          />
        ) : regions.length === 0 ? (
          <EmptyState
            icon={<MapPin className="h-6 w-6" />}
            title={t('tax.regions.empty.title', { defaultValue: 'No tax regions yet' })}
            description={t('tax.regions.empty.description', {
              defaultValue: 'Add a region for each place you charge tax, then give it a rate.',
            })}
            action={addRegionButton}
          />
        ) : (
          <>
            <SearchInput
              id="tax-regions-search"
              className="max-w-sm"
              placeholder={t('tax.regions.search.placeholder', { defaultValue: 'Search regions' })}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCurrentPage(1);
              }}
              onClear={() => {
                setQuery('');
                setCurrentPage(1);
              }}
            />
            {visibleRows.length === 0 ? (
              <EmptyState
                title={t('tax.regions.empty.noMatch', {
                  query: query.trim(),
                  defaultValue: 'No regions match "{{query}}"',
                })}
                className="py-8"
              />
            ) : (
              <DataTable
                id="tax-regions-table"
                columns={columns}
                data={visibleRows}
                onRowClick={(row) => toggleExpanded(row.region_code)}
                expandedRowRender={renderRatesPanel}
                pagination={true}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                pageSize={pageSize}
                onItemsPerPageChange={(size) => {
                  setPageSize(size);
                  setCurrentPage(1);
                }}
              />
            )}
          </>
        )}
      </CardContent>

      <TaxRegionDialog
        isOpen={regionDialog.open}
        region={regionDialog.region}
        onClose={() => setRegionDialog({ open: false, region: null })}
        onSaved={(saved) => {
          setRegionDialog({ open: false, region: null });
          setExpandedCodes((current) => new Set(current).add(saved.region_code));
          void refresh();
        }}
      />

      {rateDialog && (
        <TaxRateDialog
          isOpen={true}
          region={rateDialog.region}
          rate={rateDialog.rate}
          onClose={() => setRateDialog(null)}
          onSaved={() => {
            setRateDialog(null);
            void refresh();
            onSettingsChanged?.();
          }}
        />
      )}

      <DeleteEntityDialog
        id="delete-tax-rate-dialog"
        isOpen={rateToDelete !== null}
        onClose={resetDelete}
        onConfirmDelete={confirmDelete}
        entityName={rateToDelete
          ? t('tax.regions.rates.deleteEntity', {
              region: regionNameFor(rateToDelete.region_code),
              rate: formatTaxPercentage(rateToDelete.tax_percentage),
              defaultValue: 'the {{rate}} rate for {{region}}',
            })
          : ''}
        validationResult={deleteValidation}
        isValidating={isDeleteValidating}
        isDeleting={isDeleting}
      />
    </Card>
  );
}
