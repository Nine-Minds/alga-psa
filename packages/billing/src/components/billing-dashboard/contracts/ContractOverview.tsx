'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { getContractOverview } from '@alga-psa/billing/actions/contractActions';
import type { IContractOverview, IContractLineOverview } from '@alga-psa/billing/actions/contractActions';
import { Package, Clock, Activity, Coins, Layers3, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@alga-psa/ui/lib/utils';

interface ContractOverviewProps {
  contractId: string;
  onNavigateToLines?: () => void;
}

const formatCurrency = (cents: number | null, currencyCode: string = 'USD'): string => {
  if (cents === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2
  }).format(cents / 100);
};

const formatFrequency = (frequency: string): string => {
  const map: Record<string, string> = {
    'weekly': 'Weekly',
    'monthly': 'Monthly',
    'quarterly': 'Quarterly',
    'semi-annually': 'Semi-Annually',
    'semi_annually': 'Semi-Annually',
    'annually': 'Annually'
  };
  return map[frequency] || frequency;
};

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
}> = ({ line, isExpanded, onToggle, currencyCode }) => {
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
                {line.contract_line_type}
              </Badge>
              <span>•</span>
              <span>{formatFrequency(line.billing_frequency)}</span>
              {line.base_rate !== null && line.contract_line_type === 'Fixed' && (
                <>
                  <span>•</span>
                  <span className="font-medium text-[rgb(var(--color-text-700))]">{formatCurrency(line.base_rate, currencyCode)}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {line.services.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {line.services.length} service{line.services.length !== 1 ? 's' : ''}
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
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Included Services</div>
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
                      {formatCurrency(service.custom_rate, currencyCode)}
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
          <div className="text-sm text-muted-foreground italic">No services configured</div>
        </div>
      )}
    </div>
  );
};

export const ContractOverview: React.FC<ContractOverviewProps> = ({
  contractId,
  onNavigateToLines
}) => {
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
      setError(err instanceof Error ? err.message : 'Failed to load overview');
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
          What's Included
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Stats */}
        <div className="grid gap-3 sm:grid-cols-3">
          {/* Estimated Value */}
          <div className="bg-success/10 border border-success/30 rounded-lg p-3">
            <div className="flex items-center gap-2 text-sm text-success mb-1">
              <Coins className="h-4 w-4" />
              <span>Est. Monthly Value</span>
            </div>
            <div className="text-xl font-bold text-foreground">
              {overview.totalEstimatedMonthlyValue !== null ? (
                formatCurrency(overview.totalEstimatedMonthlyValue, overview.currencyCode)
              ) : (
                <span className="text-base font-normal text-success">Variable</span>
              )}
            </div>
            {hasVariableComponents && overview.totalEstimatedMonthlyValue !== null && (
              <div className="text-xs text-success mt-1">
                + variable (hourly/usage)
              </div>
            )}
          </div>

          {/* Contract Lines */}
          <div className="bg-muted border border-[rgb(var(--color-border-200))] rounded-lg p-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Layers3 className="h-4 w-4" />
              <span>Contract Lines</span>
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
                View details →
              </button>
            )}
          </div>

          {/* Services */}
          <div className="bg-muted border border-[rgb(var(--color-border-200))] rounded-lg p-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Package className="h-4 w-4" />
              <span>Total Services</span>
            </div>
            <div className="text-xl font-bold text-[rgb(var(--color-text-900))]">
              {overview.serviceCount}
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {overview.hasFixedServices && (
                <Badge variant="info" className="text-xs">Fixed</Badge>
              )}
              {overview.hasHourlyServices && (
                <Badge variant="success" className="text-xs">Hourly</Badge>
              )}
              {overview.hasUsageServices && (
                <Badge variant="warning" className="text-xs">Usage</Badge>
              )}
            </div>
          </div>
        </div>

        {/* Contract Lines List */}
        {overview.contractLines.length > 0 ? (
          <div className="space-y-2">
            <div className="text-sm font-medium text-[rgb(var(--color-text-700))] flex items-center justify-between">
              <span>Contract Lines</span>
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
                  {expandedLines.size === overview.contractLines.length ? 'Collapse all' : 'Expand all'}
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
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-6 bg-muted rounded-lg border border-dashed border-[rgb(var(--color-border-300))]">
            <Layers3 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground font-medium">No contract lines yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Add contract lines to define what's included in this contract
            </p>
            {onNavigateToLines && (
              <button
                type="button"
                onClick={onNavigateToLines}
                className="mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                Add Contract Lines →
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ContractOverview;
