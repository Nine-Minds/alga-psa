'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { getContractOverview } from '@alga-psa/billing/actions/contractActions';
import type { IContractOverview, IContractLineOverview } from '@alga-psa/billing/actions/contractActions';
import { Package, Clock, Activity, Coins, Layers3, ChevronDown, ChevronRight } from 'lucide-react';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFormatBillingFrequency, useFormatContractLineType } from '@alga-psa/billing/hooks/useBillingEnumOptions';

interface ContractOverviewProps {
  contractId: string;
  onNavigateToLines?: () => void;
}

const getTypeIcon = (type: 'Fixed' | 'Hourly' | 'Usage') => {
  switch (type) {
    case 'Fixed':
      return <Package className="h-4 w-4 text-blue-600" />;
    case 'Hourly':
      return <Clock className="h-4 w-4 text-emerald-600" />;
    case 'Usage':
      return <Activity className="h-4 w-4 text-orange-600" />;
  }
};

const getTypeBadgeVariant = (type: 'Fixed' | 'Hourly' | 'Usage'): 'info' | 'success' | 'warning' => {
  switch (type) {
    case 'Fixed':
      return 'info';
    case 'Hourly':
      return 'success';
    case 'Usage':
      return 'warning';
  }
};

const ContractLineCard: React.FC<{
  line: IContractLineOverview;
  isExpanded: boolean;
  onToggle: () => void;
  currencyCode: string;
  formatCurrencyCents: (cents: number | null, currencyCode?: string) => string;
  formatFrequencyLabel: (frequency: string) => string;
  formatServiceCountLabel: (count: number) => string;
  formatContractLineType: (value: string) => string;
  includedServicesLabel: string;
  noServicesConfiguredLabel: string;
}> = ({
  line,
  isExpanded,
  onToggle,
  currencyCode,
  formatCurrencyCents,
  formatFrequencyLabel,
  formatServiceCountLabel,
  formatContractLineType,
  includedServicesLabel,
  noServicesConfiguredLabel,
}) => {
  return (
    <div className="border border-[rgb(var(--color-border-200))] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-muted transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          {getTypeIcon(line.contract_line_type)}
          <div>
            <div className="font-medium text-[rgb(var(--color-text-900))]">{line.contract_line_name}</div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant={getTypeBadgeVariant(line.contract_line_type)} className="text-xs">
                {formatContractLineType(line.contract_line_type)}
              </Badge>
              <span>•</span>
              <span>{formatFrequencyLabel(line.billing_frequency)}</span>
              {line.base_rate !== null && line.contract_line_type === 'Fixed' && (
                <>
                  <span>•</span>
                  <span className="font-medium text-[rgb(var(--color-text-700))]">{formatCurrencyCents(line.base_rate, currencyCode)}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {line.services.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {formatServiceCountLabel(line.services.length)}
            </span>
          )}
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {isExpanded && line.services.length > 0 && (
        <div className="border-t border-[rgb(var(--color-border-200))] bg-muted p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{includedServicesLabel}</div>
          <div className="space-y-2">
            {line.services.map((service) => (
              <div
                key={service.service_id}
                className="flex items-center justify-between bg-card rounded border border-[rgb(var(--color-border-100))] px-3 py-2"
              >
                <span className="text-sm text-[rgb(var(--color-text-700))]">{service.service_name}</span>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {service.quantity && service.quantity > 1 && (
                    <span>x{service.quantity}</span>
                  )}
                  {service.custom_rate !== null && (
                    <span className="font-medium text-[rgb(var(--color-text-700))]">
                      {formatCurrencyCents(service.custom_rate, currencyCode)}
                      {line.contract_line_type === 'Hourly' && '/hr'}
                      {line.contract_line_type === 'Usage' && service.unit_of_measure && `/${service.unit_of_measure}`}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isExpanded && line.services.length === 0 && (
        <div className="border-t border-[rgb(var(--color-border-200))] bg-muted p-3">
          <div className="text-sm text-muted-foreground italic">{noServicesConfiguredLabel}</div>
        </div>
      )}
    </div>
  );
};

export const ContractOverview: React.FC<ContractOverviewProps> = ({
  contractId,
  onNavigateToLines
}) => {
  const { t } = useTranslation('msp/contracts');
  const { formatCurrency } = useFormatters();
  const formatBillingFrequency = useFormatBillingFrequency();
  const formatContractLineType = useFormatContractLineType();
  const [overview, setOverview] = useState<IContractOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedLines, setExpandedLines] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadOverview();
  }, [contractId]);

  const loadOverview = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getContractOverview(contractId);
      setOverview(data);
      // Auto-expand all lines if there are 3 or fewer
      if (data.contractLines.length <= 3) {
        setExpandedLines(new Set(data.contractLines.map(l => l.contract_line_id)));
      }
    } catch (err) {
      console.error('Error loading contract overview:', err);
      setError(
        err instanceof Error
          ? err.message
          : t('contractOverview.errors.failedToLoadOverview', { defaultValue: 'Failed to load overview' })
      );
    } finally {
      setIsLoading(false);
    }
  };

  const toggleLine = (lineId: string) => {
    setExpandedLines(prev => {
      const next = new Set(prev);
      if (next.has(lineId)) {
        next.delete(lineId);
      } else {
        next.add(lineId);
      }
      return next;
    });
  };

  const formatCurrencyCents = useCallback((cents: number | null, currencyCode: string = 'USD'): string => {
    if (cents === null) {
      return t('common.moneyPlaceholder', { defaultValue: '—' });
    }
    return formatCurrency(cents / 100, currencyCode, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }, [formatCurrency, t]);
  const formatFrequencyLabel = useCallback((value: string): string => {
    const formatted = formatBillingFrequency(value);
    if (formatted !== value) {
      return formatted;
    }
    return t(`contractOverview.frequency.${value}`, {
      defaultValue: value.replace(/_/g, ' '),
    });
  }, [formatBillingFrequency, t]);
  const formatServiceCountLabel = useCallback((count: number): string => (
    count === 1
      ? t('contractOverview.lines.serviceCountOne', { count, defaultValue: '{{count}} service' })
      : t('contractOverview.lines.serviceCountOther', { count, defaultValue: '{{count}} services' })
  ), [t]);
  const includedServicesLabel = t('contractOverview.lines.includedServices', { defaultValue: 'Included Services' });
  const noServicesConfiguredLabel = t('contractOverview.lines.noServicesConfigured', { defaultValue: 'No services configured' });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="text-center text-muted-foreground">{error}</div>
        </CardContent>
      </Card>
    );
  }

  if (!overview) {
    return null;
  }

  const hasVariableComponents = overview.hasHourlyServices || overview.hasUsageServices;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Layers3 className="h-4 w-4 text-indigo-600" />
          {t('contractOverview.title', { defaultValue: "What's Included" })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Stats */}
        <div className="grid gap-3 sm:grid-cols-3">
          {/* Estimated Value */}
          <div className="bg-success/10 border border-success/30 rounded-lg p-3">
            <div className="flex items-center gap-2 text-sm text-success mb-1">
              <Coins className="h-4 w-4" />
              <span>{t('contractOverview.stats.estimatedMonthlyValue', { defaultValue: 'Est. Monthly Value' })}</span>
            </div>
            <div className="text-xl font-bold text-foreground">
              {overview.totalEstimatedMonthlyValue !== null ? (
                formatCurrencyCents(overview.totalEstimatedMonthlyValue, overview.currencyCode)
              ) : (
                <span className="text-base font-normal text-success">
                  {t('contractOverview.stats.variable', { defaultValue: 'Variable' })}
                </span>
              )}
            </div>
            {hasVariableComponents && overview.totalEstimatedMonthlyValue !== null && (
              <div className="text-xs text-success mt-1">
                {t('contractOverview.stats.variableSuffix', { defaultValue: '+ variable (hourly/usage)' })}
              </div>
            )}
          </div>

          {/* Contract Lines */}
          <div className="bg-muted border border-[rgb(var(--color-border-200))] rounded-lg p-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Layers3 className="h-4 w-4" />
              <span>{t('contractOverview.stats.contractLines', { defaultValue: 'Contract Lines' })}</span>
            </div>
            <div className="text-xl font-bold text-[rgb(var(--color-text-900))]">
              {overview.contractLines.length}
            </div>
            {onNavigateToLines && (
              <button
                type="button"
                onClick={onNavigateToLines}
                className="text-xs text-blue-600 hover:text-blue-800 mt-1"
              >
                {t('contractOverview.stats.viewDetails', { defaultValue: 'View details' })} →
              </button>
            )}
          </div>

          {/* Services */}
          <div className="bg-muted border border-[rgb(var(--color-border-200))] rounded-lg p-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Package className="h-4 w-4" />
              <span>{t('contractOverview.stats.totalServices', { defaultValue: 'Total Services' })}</span>
            </div>
            <div className="text-xl font-bold text-[rgb(var(--color-text-900))]">
              {overview.serviceCount}
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {overview.hasFixedServices && (
                <Badge variant="info" className="text-xs">{formatContractLineType('Fixed')}</Badge>
              )}
              {overview.hasHourlyServices && (
                <Badge variant="success" className="text-xs">{formatContractLineType('Hourly')}</Badge>
              )}
              {overview.hasUsageServices && (
                <Badge variant="warning" className="text-xs">{formatContractLineType('Usage')}</Badge>
              )}
            </div>
          </div>
        </div>

        {/* Contract Lines List */}
        {overview.contractLines.length > 0 ? (
          <div className="space-y-2">
            <div className="text-sm font-medium text-[rgb(var(--color-text-700))] flex items-center justify-between">
              <span>{t('contractOverview.stats.contractLines', { defaultValue: 'Contract Lines' })}</span>
              {overview.contractLines.length > 3 && (
                <button
                  type="button"
                  onClick={() => {
                    if (expandedLines.size === overview.contractLines.length) {
                      setExpandedLines(new Set());
                    } else {
                      setExpandedLines(new Set(overview.contractLines.map(l => l.contract_line_id)));
                    }
                  }}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  {expandedLines.size === overview.contractLines.length
                    ? t('contractOverview.lines.collapseAll', { defaultValue: 'Collapse all' })
                    : t('contractOverview.lines.expandAll', { defaultValue: 'Expand all' })}
                </button>
              )}
            </div>
            <div className="space-y-2">
              {overview.contractLines.map((line) => (
                <ContractLineCard
                  key={line.contract_line_id}
                  line={line}
                  isExpanded={expandedLines.has(line.contract_line_id)}
                  onToggle={() => toggleLine(line.contract_line_id)}
                  currencyCode={overview.currencyCode}
                  formatCurrencyCents={formatCurrencyCents}
                  formatFrequencyLabel={formatFrequencyLabel}
                  formatServiceCountLabel={formatServiceCountLabel}
                  formatContractLineType={formatContractLineType}
                  includedServicesLabel={includedServicesLabel}
                  noServicesConfiguredLabel={noServicesConfiguredLabel}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-6 bg-muted rounded-lg border border-dashed border-[rgb(var(--color-border-300))]">
            <Layers3 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground font-medium">
              {t('contractOverview.lines.noContractLinesYet', { defaultValue: 'No contract lines yet' })}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {t('contractOverview.lines.noContractLinesDescription', {
                defaultValue: "Add contract lines to define what's included in this contract",
              })}
            </p>
            {onNavigateToLines && (
              <button
                type="button"
                onClick={onNavigateToLines}
                className="mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                {t('contractOverview.lines.addContractLines', { defaultValue: 'Add Contract Lines' })} →
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ContractOverview;
