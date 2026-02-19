'use client';

import { useEffect, useState } from 'react';
import { BucketOverlayInput, ContractWizardData } from '../ContractWizard';
import { Card } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import {
  Building2,
  FileText,
  Calendar,
  Coins,
  Clock,
  Package,
  Activity,
  CheckCircle2,
  FileCheck,
  Repeat,
} from 'lucide-react';
import { CURRENCY_OPTIONS } from '@alga-psa/core';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import { parse } from 'date-fns';
import { BILLING_FREQUENCY_OPTIONS, BILLING_FREQUENCY_DISPLAY } from '@alga-psa/billing/constants/billing';
import { getClientByIdForBilling } from '@alga-psa/billing/actions/billingClientsActions';

interface ReviewContractStepProps {
  data: ContractWizardData;
}

export function ReviewContractStep({ data }: ReviewContractStepProps) {
  const [clientName, setClientName] = useState<string>('Not selected');

  useEffect(() => {
    const loadClientName = async () => {
      if (!data.client_id) {
        setClientName('Not selected');
        return;
      }

      try {
        const client = await getClientByIdForBilling(data.client_id);
        setClientName(client?.client_name || data.client_id);
      } catch (error) {
        console.error('Error loading client name:', error);
        setClientName(data.client_id);
      }
    };

    void loadClientName();
  }, [data.client_id]);

  const currencyCode = data.currency_code || 'USD';

  const formatCurrency = (minorUnits: number | null | undefined) => {
    if (minorUnits == null) {
      return formatCurrencyFromMinorUnits(0, 'en-US', currencyCode);
    }
    return formatCurrencyFromMinorUnits(minorUnits, 'en-US', currencyCode);
  };

  const formatBucketSummary = (
    overlay: BucketOverlayInput | null | undefined,
    mode: 'hours' | 'usage',
    unitLabel?: string
  ): string | null => {
    if (!overlay || overlay.total_minutes == null) {
      return null;
    }

    const included = mode === 'hours' ? overlay.total_minutes / 60 : overlay.total_minutes;
    const formattedIncluded =
      mode === 'hours'
        ? `${included.toLocaleString(undefined, { maximumFractionDigits: 2 })} hours`
        : `${included.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unitLabel || 'units'}`;

    const overage =
      overlay.overage_rate != null
        ? `${formatCurrency(overlay.overage_rate)}/${mode === 'hours' ? 'hour' : unitLabel || 'unit'}`
        : null;

    const rollover = overlay.allow_rollover ? 'rollover enabled' : 'no rollover';

    return `${formattedIncluded}${overage ? `, ${overage} overage` : ''}, ${rollover}`;
  };

  const parseLocalYMD = (ymd: string): Date | null => {
    try {
      const d = parse(ymd, 'yyyy-MM-dd', new Date());
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return 'N/A';
    const local = parseLocalYMD(dateString) ?? new Date(dateString);
    return local.toLocaleDateString();
  };

  const calculateTotalMonthly = () => data.fixed_base_rate ?? 0;

  const hasFixedServices = data.fixed_services.length > 0;
  const hasProducts = data.product_services.length > 0;
  const hasHourlyServices = data.hourly_services.length > 0;
  const hasUsageServices = !!(data.usage_services && data.usage_services.length > 0);

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Review Contract</h3>
        <p className="text-sm text-[rgb(var(--color-text-500))]">
          Review all contract details before creating. You can still edit after creation if needed.
        </p>
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="h-5 w-5 text-[rgb(var(--color-secondary-500))]" />
          <h4 className="font-semibold">Contract Basics</h4>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex items-start gap-2">
            <Building2 className="h-4 w-4 mt-0.5 text-[rgb(var(--color-text-300))]" />
            <div>
              <p className="text-[rgb(var(--color-text-500))]">Client</p>
              <p className="font-medium">{clientName || 'Not selected'}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <FileText className="h-4 w-4 mt-0.5 text-[rgb(var(--color-text-300))]" />
            <div>
              <p className="text-[rgb(var(--color-text-500))]">Contract Name</p>
              <p className="font-medium">{data.contract_name || 'Not specified'}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Repeat className="h-4 w-4 mt-0.5 text-[rgb(var(--color-text-300))]" />
            <div>
              <p className="text-[rgb(var(--color-text-500))]">Billing Frequency</p>
              <p className="font-medium">
                {BILLING_FREQUENCY_OPTIONS.find((opt) => opt.value === data.billing_frequency)?.label ||
                  data.billing_frequency ||
                  'Not specified'}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Coins className="h-4 w-4 mt-0.5 text-[rgb(var(--color-text-300))]" />
            <div>
              <p className="text-[rgb(var(--color-text-500))]">Currency</p>
              <p className="font-medium">
                {CURRENCY_OPTIONS.find((opt) => opt.value === data.currency_code)?.label ||
                  data.currency_code ||
                  'Not specified'}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Calendar className="h-4 w-4 mt-0.5 text-[rgb(var(--color-text-300))]" />
            <div>
              <p className="text-[rgb(var(--color-text-500))]">Start Date</p>
              <p className="font-medium">{formatDate(data.start_date)}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Calendar className="h-4 w-4 mt-0.5 text-[rgb(var(--color-text-300))]" />
            <div>
              <p className="text-[rgb(var(--color-text-500))]">End Date</p>
              <p className="font-medium">{data.end_date ? formatDate(data.end_date) : 'Ongoing'}</p>
            </div>
          </div>
        </div>
      </Card>

      {(data.po_required || data.po_number || data.po_amount) && (
        <Card className="p-4 bg-[rgb(var(--color-accent-50))] border border-[rgb(var(--color-accent-200))]">
          <div className="flex items-center gap-2 mb-2">
            <FileCheck className="h-5 w-5 text-[rgb(var(--color-accent-700))]" />
            <h4 className="font-semibold text-[rgb(var(--color-accent-800))]">Purchase Order Requirements</h4>
          </div>
          <div className="space-y-1 text-sm text-[rgb(var(--color-accent-800))]">
            <p>
              <strong>PO Required:</strong> {data.po_required ? 'Yes' : 'No'}
            </p>
            {data.po_number && (
              <p>
                <strong>PO Number:</strong> {data.po_number}
              </p>
            )}
            {data.po_amount !== undefined && (
              <p>
                <strong>PO Amount:</strong> {formatCurrency(data.po_amount)}
              </p>
            )}
          </div>
        </Card>
      )}

      {hasFixedServices && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-[rgb(var(--color-status-success))]" />
              <h4 className="font-semibold">Fixed Fee Services</h4>
            </div>
            <Badge variant="default" className="bg-[rgb(var(--badge-success-bg))] text-[rgb(var(--badge-success-text))] border border-[rgb(var(--badge-success-border))]">
              {data.fixed_services.length} services
            </Badge>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-[rgb(var(--color-text-300))]" />
              <span className="font-medium">Monthly Base Rate:</span>
              <span>{formatCurrency(data.fixed_base_rate)}</span>
            </div>
            <ul className="list-disc list-inside space-y-1 ml-2">
              {data.fixed_services.map((service, idx) => (
                <li key={idx} className="space-y-1">
                  <span className="font-medium">
                    {service.service_name || service.service_id} (Qty: {service.quantity})
                  </span>
                  {formatBucketSummary(service.bucket_overlay, 'hours') && (
                    <p className="text-xs text-[rgb(var(--color-secondary-600))] pl-4">
                      Bucket: {formatBucketSummary(service.bucket_overlay, 'hours')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <div className="pt-2 border-t space-y-1">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[rgb(var(--color-status-success))]" />
                <p className="text-[rgb(var(--color-text-500))]">
                  Proration: {data.enable_proration ? 'Enabled' : 'Disabled'}
                </p>
              </div>
              {data.fixed_billing_frequency && data.fixed_billing_frequency !== data.billing_frequency && (
                <div className="flex items-center gap-2">
                  <Repeat className="h-4 w-4 text-[rgb(var(--color-text-300))]" />
                  <p className="text-[rgb(var(--color-text-500))]">
                    <strong>Billing Frequency Override:</strong> {BILLING_FREQUENCY_DISPLAY[data.fixed_billing_frequency] || data.fixed_billing_frequency}
                  </p>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {hasProducts && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-[rgb(var(--color-primary-500))]" />
              <h4 className="font-semibold">Products</h4>
            </div>
            <Badge variant="default" className="bg-[rgb(var(--color-primary-100))] text-[rgb(var(--color-primary-800))]">
              {data.product_services.length} products
            </Badge>
          </div>
          <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
            {data.product_services.map((product, idx) => (
              <li key={idx}>
                <span className="font-medium">
                  {product.service_name || product.service_id} (Qty: {product.quantity})
                </span>
                {product.custom_rate !== undefined ? (
                  <span className="text-xs text-muted-foreground">
                    {' '}
                    — override {formatCurrency(product.custom_rate)}/{data.currency_code}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {hasHourlyServices && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-[rgb(var(--color-primary-500))]" />
              <h4 className="font-semibold">Hourly Services</h4>
            </div>
            <Badge variant="default" className="bg-[rgb(var(--color-primary-100))] text-[rgb(var(--color-primary-800))]">
              {data.hourly_services.length} services
            </Badge>
          </div>
          <div className="space-y-2 text-sm">
            <div>
              <p className="text-[rgb(var(--color-text-500))] mb-1">Services & Rates</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                {data.hourly_services.map((service, idx) => (
                  <li key={idx} className="space-y-1">
                    <span className="font-medium">
                      {service.service_name || service.service_id} -{' '}
                      {formatCurrency(service.hourly_rate)}/hour
                    </span>
                    {formatBucketSummary(service.bucket_overlay, 'hours') && (
                      <p className="text-xs text-[rgb(var(--color-secondary-600))] pl-4">
                        Bucket: {formatBucketSummary(service.bucket_overlay, 'hours')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            {(data.minimum_billable_time || data.round_up_to_nearest || (data.hourly_billing_frequency && data.hourly_billing_frequency !== data.billing_frequency)) && (
              <div className="pt-2 border-t space-y-1">
                {data.minimum_billable_time && (
                  <p className="text-[rgb(var(--color-text-500))]">
                    <strong>Minimum Time:</strong> {data.minimum_billable_time} minutes
                  </p>
                )}
                {data.round_up_to_nearest && (
                  <p className="text-[rgb(var(--color-text-500))]">
                    <strong>Round Up:</strong> {data.round_up_to_nearest} minutes
                  </p>
                )}
                {data.hourly_billing_frequency && data.hourly_billing_frequency !== data.billing_frequency && (
                  <div className="flex items-center gap-2">
                    <Repeat className="h-4 w-4 text-[rgb(var(--color-text-300))]" />
                    <p className="text-[rgb(var(--color-text-500))]">
                      <strong>Billing Frequency Override:</strong> {BILLING_FREQUENCY_DISPLAY[data.hourly_billing_frequency] || data.hourly_billing_frequency}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      {hasUsageServices && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-[rgb(var(--badge-info-text))]" />
              <h4 className="font-semibold">Usage-Based Services</h4>
            </div>
            <Badge variant="default" className="bg-[rgb(var(--badge-info-bg))] text-[rgb(var(--badge-info-text))] border border-[rgb(var(--badge-info-border))]">
              {data.usage_services?.length ?? 0} services
            </Badge>
          </div>
          <div className="space-y-2 text-sm">
            <ul className="list-disc list-inside space-y-1 ml-2">
              {(data.usage_services || []).map((service, idx) => (
                <li key={idx} className="space-y-1">
                  <span className="font-medium">
                    {service.service_name || service.service_id} -{' '}
                    {formatCurrency(service.unit_rate)}/{service.unit_of_measure || 'unit'}
                  </span>
                  {formatBucketSummary(service.bucket_overlay, 'usage', service.unit_of_measure) && (
                    <p className="text-xs text-[rgb(var(--color-secondary-600))] pl-4">
                      Bucket: {formatBucketSummary(service.bucket_overlay, 'usage', service.unit_of_measure)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {data.usage_billing_frequency && data.usage_billing_frequency !== data.billing_frequency && (
              <div className="pt-2 border-t">
                <div className="flex items-center gap-2">
                  <Repeat className="h-4 w-4 text-[rgb(var(--color-text-300))]" />
                  <p className="text-[rgb(var(--color-text-500))]">
                    <strong>Billing Frequency Override:</strong> {BILLING_FREQUENCY_DISPLAY[data.usage_billing_frequency] || data.usage_billing_frequency}
                  </p>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      <Card className="p-4 bg-gradient-to-r from-[rgb(var(--color-secondary-50))] to-[rgb(var(--color-primary-50))] border-2 border-[rgb(var(--color-secondary-200))]">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-semibold text-lg mb-1">Estimated Monthly Total</h4>
            <p className="text-sm text-[rgb(var(--color-text-500))]">
              Fixed charges only. Hourly and usage services bill separately based on actual usage.
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-[rgb(var(--color-primary-800))]">{formatCurrency(calculateTotalMonthly())}</p>
            <p className="text-xs text-[rgb(var(--color-text-500))]">per month</p>
          </div>
        </div>
      </Card>

      <div className="p-4 bg-[rgb(var(--color-accent-50))] border border-[rgb(var(--color-accent-200))] rounded-md">
        <p className="text-sm text-[rgb(var(--color-accent-800))]">
          <strong>Before you finish:</strong>
        </p>
        <ul className="text-sm text-[rgb(var(--color-accent-800))] list-disc list-inside space-y-1 mt-2 ml-2">
          <li>Double-check all rates, quantities, and buckets</li>
          <li>Confirm PO requirements (if any)</li>
          <li>Verify the start and end dates</li>
          <li>Remember: you can edit the contract later if needed</li>
        </ul>
      </div>
    </div>
  );
}
