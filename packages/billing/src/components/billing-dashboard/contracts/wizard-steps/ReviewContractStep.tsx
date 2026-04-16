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
import { parse } from 'date-fns';
import { getClientByIdForBilling } from '@alga-psa/billing/actions/billingClientsActions';
import { getRecurringAuthoringPreview } from '../recurringAuthoringPreview';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  useBillingFrequencyOptions,
  useFormatBillingFrequency,
} from '@alga-psa/billing/hooks/useBillingEnumOptions';

interface ReviewContractStepProps {
  data: ContractWizardData;
}

export function ReviewContractStep({ data }: ReviewContractStepProps) {
  const { t } = useTranslation('msp/contracts');
  const { formatCurrency } = useFormatters();
  const billingFrequencyOptions = useBillingFrequencyOptions();
  const formatBillingFrequency = useFormatBillingFrequency();
  const [clientName, setClientName] = useState<string>(
    t('wizardReview.fallback.notSelected', { defaultValue: 'Not selected' })
  );

  useEffect(() => {
    const loadClientName = async () => {
      if (!data.client_id) {
        setClientName(t('wizardReview.fallback.notSelected', { defaultValue: 'Not selected' }));
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
  }, [data.client_id, t]);

  const currencyCode = data.currency_code || 'USD';
  const recurringPreview = getRecurringAuthoringPreview({
    cadenceOwner: data.cadence_owner,
    billingTiming: data.billing_timing,
    billingFrequency: data.fixed_billing_frequency ?? data.billing_frequency,
    enableProration: data.enable_proration,
  }, t);

  const formatMinorCurrency = (minorUnits: number | null | undefined) => {
    const amount = minorUnits == null ? 0 : minorUnits;
    return formatCurrency(amount / 100, currencyCode, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
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
    const formattedValue = included.toLocaleString(undefined, { maximumFractionDigits: 2 });

    const includedLabel =
      mode === 'hours'
        ? t('wizardReview.bucket.includedHours', {
            count: included,
            formattedValue,
            defaultValue: '{{formattedValue}} hours',
          })
        : t('wizardReview.bucket.includedUnits', {
            count: included,
            formattedValue,
            unitLabel:
              unitLabel ||
              t('wizardReview.common.unitsFallback', {
                defaultValue: 'units',
              }),
            defaultValue: '{{formattedValue}} {{unitLabel}}',
          });

    const overageUnit =
      mode === 'hours'
        ? t('wizardReview.common.hourSingular', { defaultValue: 'hour' })
        : unitLabel ||
          t('wizardReview.common.unitSingular', {
            defaultValue: 'unit',
          });

    const overageLabel =
      overlay.overage_rate != null
        ? t('wizardReview.bucket.overageLabel', {
            rate: formatMinorCurrency(overlay.overage_rate),
            unit: overageUnit,
            defaultValue: '{{rate}}/{{unit}} overage',
          })
        : null;

    const rolloverLabel = overlay.allow_rollover
      ? t('wizardReview.bucket.rolloverEnabled', { defaultValue: 'rollover enabled' })
      : t('wizardReview.bucket.rolloverDisabled', { defaultValue: 'no rollover' });

    return overageLabel
      ? t('wizardReview.bucket.summaryWithOverage', {
          included: includedLabel,
          overage: overageLabel,
          rollover: rolloverLabel,
          defaultValue: '{{included}}, {{overage}}, {{rollover}}',
        })
      : t('wizardReview.bucket.summaryWithoutOverage', {
          included: includedLabel,
          rollover: rolloverLabel,
          defaultValue: '{{included}}, {{rollover}}',
        });
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
    if (!dateString) {
      return t('wizardReview.fallback.notApplicable', { defaultValue: 'N/A' });
    }
    const local = parseLocalYMD(dateString) ?? new Date(dateString);
    return local.toLocaleDateString();
  };

  const calculateTotalMonthly = () => data.fixed_base_rate ?? 0;

  const hasFixedServices = data.fixed_services.length > 0;
  const hasProducts = data.product_services.length > 0;
  const hasHourlyServices = data.hourly_services.length > 0;
  const hasUsageServices = !!(data.usage_services && data.usage_services.length > 0);

  const recurringCadenceOwnerLabel =
    data.cadence_owner === 'contract'
      ? t('wizardReview.recurring.cadenceOwner.contractAnniversary', {
          defaultValue: 'Contract anniversary',
        })
      : t('wizardReview.recurring.cadenceOwner.clientBillingSchedule', {
          defaultValue: 'Client billing schedule',
        });

  const recurringFirstInvoiceSummary =
    data.cadence_owner === 'contract'
      ? data.billing_timing === 'advance'
        ? t('wizardReview.recurring.firstInvoice.contract.advance', {
            defaultValue:
              'First invoice: bill on the contract anniversary window that opens the first covered service period.',
          })
        : t('wizardReview.recurring.firstInvoice.contract.arrears', {
            defaultValue:
              'First invoice: bill on the next contract anniversary window after the first covered service period closes.',
          })
      : data.billing_timing === 'advance'
        ? t('wizardReview.recurring.firstInvoice.client.advance', {
            defaultValue:
              'First invoice: bill on the first client billing schedule window covering the service period.',
          })
        : t('wizardReview.recurring.firstInvoice.client.arrears', {
            defaultValue:
              'First invoice: bill on the next client billing schedule window after the first covered service period closes.',
          });

  const recurringPartialPeriodSummary = data.enable_proration
    ? t('wizardReview.recurring.partialPeriod.enabled', {
        defaultValue:
          'Partial periods adjust the recurring fee to the covered portion of the service period.',
      })
    : t('wizardReview.recurring.partialPeriod.disabled', {
        defaultValue:
          'Partial periods keep the full recurring fee even when contract dates land inside a service period.',
      });

  const recurringMaterializedSummary =
    data.cadence_owner === 'contract'
      ? t('wizardReview.recurring.materialized.summary.contract', {
          defaultValue:
            'If you save this recurring line, future periods would materialize on an anniversary-style preview anchored to the 8th before invoice generation.',
        })
      : t('wizardReview.recurring.materialized.summary.client', {
          defaultValue:
            'If you save this recurring line, future periods would materialize on the client billing schedule preview before invoice generation.',
        });

  const recurringMaterializedHeading = t('wizardReview.recurring.materialized.heading', {
    defaultValue: 'Illustrative future materialized periods',
  });

  const billingFrequencyLabel =
    billingFrequencyOptions.find((opt) => opt.value === data.billing_frequency)?.label ||
    formatBillingFrequency(data.billing_frequency) ||
    data.billing_frequency ||
    t('wizardReview.fallback.notSpecified', { defaultValue: 'Not specified' });

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">
          {t('wizardReview.heading', { defaultValue: 'Review Contract' })}
        </h3>
        <p className="text-sm text-[rgb(var(--color-text-500))]">
          {t('wizardReview.description', {
            defaultValue:
              'Review all contract details before creating. You can still edit after creation if needed.',
          })}
        </p>
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="h-5 w-5 text-[rgb(var(--color-secondary-500))]" />
          <h4 className="font-semibold">
            {t('wizardReview.sections.contractBasics', { defaultValue: 'Contract Basics' })}
          </h4>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex items-start gap-2">
            <Building2 className="h-4 w-4 mt-0.5 text-[rgb(var(--color-text-300))]" />
            <div>
              <p className="text-[rgb(var(--color-text-500))]">
                {t('wizardReview.fields.client', { defaultValue: 'Client' })}
              </p>
              <p className="font-medium">
                {clientName || t('wizardReview.fallback.notSelected', { defaultValue: 'Not selected' })}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <FileText className="h-4 w-4 mt-0.5 text-[rgb(var(--color-text-300))]" />
            <div>
              <p className="text-[rgb(var(--color-text-500))]">
                {t('wizardReview.fields.contractName', { defaultValue: 'Contract Name' })}
              </p>
              <p className="font-medium">
                {data.contract_name ||
                  t('wizardReview.fallback.notSpecified', { defaultValue: 'Not specified' })}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Repeat className="h-4 w-4 mt-0.5 text-[rgb(var(--color-text-300))]" />
            <div>
              <p className="text-[rgb(var(--color-text-500))]">
                {t('wizardReview.fields.billingFrequency', { defaultValue: 'Billing Frequency' })}
              </p>
              <p className="font-medium">{billingFrequencyLabel}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Coins className="h-4 w-4 mt-0.5 text-[rgb(var(--color-text-300))]" />
            <div>
              <p className="text-[rgb(var(--color-text-500))]">
                {t('wizardReview.fields.currency', { defaultValue: 'Currency' })}
              </p>
              <p className="font-medium">
                {CURRENCY_OPTIONS.find((opt) => opt.value === data.currency_code)?.label ||
                  data.currency_code ||
                  t('wizardReview.fallback.notSpecified', { defaultValue: 'Not specified' })}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Calendar className="h-4 w-4 mt-0.5 text-[rgb(var(--color-text-300))]" />
            <div>
              <p className="text-[rgb(var(--color-text-500))]">
                {t('wizardReview.fields.startDate', { defaultValue: 'Start Date' })}
              </p>
              <p className="font-medium">{formatDate(data.start_date)}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Calendar className="h-4 w-4 mt-0.5 text-[rgb(var(--color-text-300))]" />
            <div>
              <p className="text-[rgb(var(--color-text-500))]">
                {t('wizardReview.fields.endDate', { defaultValue: 'End Date' })}
              </p>
              <p className="font-medium">
                {data.end_date
                  ? formatDate(data.end_date)
                  : t('wizardReview.fallback.ongoing', { defaultValue: 'Ongoing' })}
              </p>
            </div>
          </div>
          {data.renewal_mode && (
            <div className="flex items-start gap-2">
              <Repeat className="h-4 w-4 mt-0.5 text-[rgb(var(--color-text-300))]" />
              <div>
                <p className="text-[rgb(var(--color-text-500))]">
                  {t('wizardReview.fields.renewalMode', { defaultValue: 'Renewal Mode' })}
                </p>
                <p className="font-medium">
                  {data.renewal_mode === 'none'
                    ? t('wizardReview.renewalMode.none', { defaultValue: 'No Renewal' })
                    : data.renewal_mode === 'manual'
                      ? t('wizardReview.renewalMode.manual', { defaultValue: 'Manual Renewal' })
                      : t('wizardReview.renewalMode.auto', { defaultValue: 'Auto Renew' })}
                </p>
              </div>
            </div>
          )}
          {data.renewal_mode && data.renewal_mode !== 'none' && data.notice_period_days !== undefined && (
            <div className="flex items-start gap-2">
              <Clock className="h-4 w-4 mt-0.5 text-[rgb(var(--color-text-300))]" />
              <div>
                <p className="text-[rgb(var(--color-text-500))]">
                  {t('wizardReview.fields.noticePeriod', { defaultValue: 'Notice Period' })}
                </p>
                <p className="font-medium">
                  {data.notice_period_days === 1
                    ? t('wizardReview.noticePeriod.one', {
                        count: data.notice_period_days,
                        defaultValue: '{{count}} day',
                      })
                    : t('wizardReview.noticePeriod.other', {
                        count: data.notice_period_days,
                        defaultValue: '{{count}} days',
                      })}
                </p>
              </div>
            </div>
          )}
          {data.renewal_mode === 'auto' && data.renewal_term_months !== undefined && (
            <div className="flex items-start gap-2">
              <Calendar className="h-4 w-4 mt-0.5 text-[rgb(var(--color-text-300))]" />
              <div>
                <p className="text-[rgb(var(--color-text-500))]">
                  {t('wizardReview.fields.renewalTerm', { defaultValue: 'Renewal Term' })}
                </p>
                <p className="font-medium">
                  {data.renewal_term_months === 1
                    ? t('wizardReview.renewalTerm.one', {
                        count: data.renewal_term_months,
                        defaultValue: '{{count}} month',
                      })
                    : t('wizardReview.renewalTerm.other', {
                        count: data.renewal_term_months,
                        defaultValue: '{{count}} months',
                      })}
                </p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {(data.po_required || data.po_number || data.po_amount) && (
        <Card className="p-4 bg-[rgb(var(--color-accent-50))] border border-[rgb(var(--color-accent-200))]">
          <div className="flex items-center gap-2 mb-2">
            <FileCheck className="h-5 w-5 text-[rgb(var(--color-accent-700))]" />
            <h4 className="font-semibold text-[rgb(var(--color-accent-800))]">
              {t('wizardReview.po.title', { defaultValue: 'Purchase Order Requirements' })}
            </h4>
          </div>
          <div className="space-y-1 text-sm text-[rgb(var(--color-accent-800))]">
            <p>
              <strong>{t('wizardReview.po.requiredLabel', { defaultValue: 'PO Required:' })}</strong>{' '}
              {data.po_required
                ? t('wizardReview.common.yes', { defaultValue: 'Yes' })
                : t('wizardReview.common.no', { defaultValue: 'No' })}
            </p>
            {data.po_number && (
              <p>
                <strong>{t('wizardReview.po.numberLabel', { defaultValue: 'PO Number:' })}</strong>{' '}
                {data.po_number}
              </p>
            )}
            {data.po_amount !== undefined && (
              <p>
                <strong>{t('wizardReview.po.amountLabel', { defaultValue: 'PO Amount:' })}</strong>{' '}
                {formatMinorCurrency(data.po_amount)}
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
              <h4 className="font-semibold">
                {t('wizardReview.sections.fixedFeeServices', { defaultValue: 'Fixed Fee Services' })}
              </h4>
            </div>
            <Badge
              variant="default"
              className="bg-[rgb(var(--badge-success-bg))] text-[rgb(var(--badge-success-text))] border border-[rgb(var(--badge-success-border))]"
            >
              {data.fixed_services.length === 1
                ? t('wizardReview.fixed.badgeCount.one', {
                    count: data.fixed_services.length,
                    defaultValue: '{{count}} service',
                  })
                : t('wizardReview.fixed.badgeCount.other', {
                    count: data.fixed_services.length,
                    defaultValue: '{{count}} services',
                  })}
            </Badge>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-[rgb(var(--color-text-300))]" />
              <span className="font-medium">
                {t('wizardReview.fixed.monthlyBaseRate', { defaultValue: 'Monthly Base Rate:' })}
              </span>
              <span>{formatMinorCurrency(data.fixed_base_rate)}</span>
            </div>
            <ul className="list-disc list-inside space-y-1 ml-2">
              {data.fixed_services.map((service, idx) => (
                <li key={idx} className="space-y-1">
                  <span className="font-medium">
                    {t('wizardReview.common.serviceQuantityRow', {
                      serviceName: service.service_name || service.service_id,
                      quantity: service.quantity,
                      defaultValue: '{{serviceName}} (Qty: {{quantity}})',
                    })}
                  </span>
                  {formatBucketSummary(service.bucket_overlay, 'hours') && (
                    <p className="text-xs text-[rgb(var(--color-secondary-600))] pl-4">
                      {t('wizardReview.common.bucketLabel', { defaultValue: 'Bucket:' })}{' '}
                      {formatBucketSummary(service.bucket_overlay, 'hours')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <div className="pt-2 border-t space-y-1">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[rgb(var(--color-status-success))]" />
                <p className="text-[rgb(var(--color-text-500))]">
                  {t('wizardReview.fixed.partialPeriodAdjustment', {
                    defaultValue: 'Partial-Period Adjustment:',
                  })}{' '}
                  {data.enable_proration
                    ? t('wizardReview.common.enabled', { defaultValue: 'Enabled' })
                    : t('wizardReview.common.disabled', { defaultValue: 'Disabled' })}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-[rgb(var(--color-status-success))] mt-0.5" />
                <div className="text-[rgb(var(--color-text-500))] space-y-1">
                  <p>
                    <strong>{t('wizardReview.recurring.cadenceOwner.label', { defaultValue: 'Cadence owner:' })}</strong>{' '}
                    {recurringCadenceOwnerLabel}
                  </p>
                  <p>{recurringFirstInvoiceSummary}</p>
                  <p>{recurringPartialPeriodSummary}</p>
                  <p className="font-medium">{recurringMaterializedHeading}</p>
                  <p>{recurringMaterializedSummary}</p>
                  <ul className="list-disc pl-5 space-y-1">
                    {recurringPreview.materializedPeriods.map((period) => (
                      <li key={`${period.servicePeriodLabel}:${period.invoiceWindowLabel}`}>
                        <span>
                          <strong>
                            {t('wizardReview.recurring.materialized.serviceLabel', {
                              defaultValue: 'Service:',
                            })}
                          </strong>{' '}
                          {period.servicePeriodLabel}
                        </span>
                        <span className="block">
                          <strong>
                            {t('wizardReview.recurring.materialized.invoiceWindowLabel', {
                              defaultValue: 'Invoice window:',
                            })}
                          </strong>{' '}
                          {period.invoiceWindowLabel}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              {data.fixed_billing_frequency && data.fixed_billing_frequency !== data.billing_frequency && (
                <div className="flex items-center gap-2">
                  <Repeat className="h-4 w-4 text-[rgb(var(--color-text-300))]" />
                  <p className="text-[rgb(var(--color-text-500))]">
                    <strong>
                      {t('wizardReview.common.billingFrequencyOverrideLabel', {
                        defaultValue: 'Billing Frequency Override:',
                      })}
                    </strong>{' '}
                    {formatBillingFrequency(data.fixed_billing_frequency) || data.fixed_billing_frequency}
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
              <h4 className="font-semibold">
                {t('wizardReview.sections.products', { defaultValue: 'Products' })}
              </h4>
            </div>
            <Badge
              variant="default"
              className="bg-[rgb(var(--color-primary-100))] text-[rgb(var(--color-primary-800))]"
            >
              {data.product_services.length === 1
                ? t('wizardReview.products.badgeCount.one', {
                    count: data.product_services.length,
                    defaultValue: '{{count}} product',
                  })
                : t('wizardReview.products.badgeCount.other', {
                    count: data.product_services.length,
                    defaultValue: '{{count}} products',
                  })}
            </Badge>
          </div>
          <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
            {data.product_services.map((product, idx) => (
              <li key={idx}>
                <span className="font-medium">
                  {t('wizardReview.common.serviceQuantityRow', {
                    serviceName: product.service_name || product.service_id,
                    quantity: product.quantity,
                    defaultValue: '{{serviceName}} (Qty: {{quantity}})',
                  })}
                </span>
                {product.custom_rate !== undefined ? (
                  <span className="text-xs text-muted-foreground">
                    {' '}
                    {t('wizardReview.products.overrideRate', {
                      rate: formatMinorCurrency(product.custom_rate),
                      currencyCode: data.currency_code || currencyCode,
                      defaultValue: '- override {{rate}}/{{currencyCode}}',
                    })}
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
              <h4 className="font-semibold">
                {t('wizardReview.sections.hourlyServices', { defaultValue: 'Hourly Services' })}
              </h4>
            </div>
            <Badge
              variant="default"
              className="bg-[rgb(var(--color-primary-100))] text-[rgb(var(--color-primary-800))]"
            >
              {data.hourly_services.length === 1
                ? t('wizardReview.hourly.badgeCount.one', {
                    count: data.hourly_services.length,
                    defaultValue: '{{count}} service',
                  })
                : t('wizardReview.hourly.badgeCount.other', {
                    count: data.hourly_services.length,
                    defaultValue: '{{count}} services',
                  })}
            </Badge>
          </div>
          <div className="space-y-2 text-sm">
            <div>
              <p className="text-[rgb(var(--color-text-500))] mb-1">
                {t('wizardReview.hourly.servicesAndRates', { defaultValue: 'Services and Rates' })}
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                {data.hourly_services.map((service, idx) => (
                  <li key={idx} className="space-y-1">
                    <span className="font-medium">
                      {t('wizardReview.hourly.serviceRateRow', {
                        serviceName: service.service_name || service.service_id,
                        rate: formatMinorCurrency(service.hourly_rate),
                        defaultValue: '{{serviceName}} - {{rate}}/hour',
                      })}
                    </span>
                    {formatBucketSummary(service.bucket_overlay, 'hours') && (
                      <p className="text-xs text-[rgb(var(--color-secondary-600))] pl-4">
                        {t('wizardReview.common.bucketLabel', { defaultValue: 'Bucket:' })}{' '}
                        {formatBucketSummary(service.bucket_overlay, 'hours')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            {(data.minimum_billable_time ||
              data.round_up_to_nearest ||
              (data.hourly_billing_frequency &&
                data.hourly_billing_frequency !== data.billing_frequency)) && (
              <div className="pt-2 border-t space-y-1">
                {data.minimum_billable_time && (
                  <p className="text-[rgb(var(--color-text-500))]">
                    <strong>{t('wizardReview.hourly.minimumTimeLabel', { defaultValue: 'Minimum Time:' })}</strong>{' '}
                    {t('wizardReview.hourly.minutesValue', {
                      count: data.minimum_billable_time,
                      defaultValue: '{{count}} minutes',
                    })}
                  </p>
                )}
                {data.round_up_to_nearest && (
                  <p className="text-[rgb(var(--color-text-500))]">
                    <strong>{t('wizardReview.hourly.roundUpLabel', { defaultValue: 'Round Up:' })}</strong>{' '}
                    {t('wizardReview.hourly.minutesValue', {
                      count: data.round_up_to_nearest,
                      defaultValue: '{{count}} minutes',
                    })}
                  </p>
                )}
                {data.hourly_billing_frequency &&
                  data.hourly_billing_frequency !== data.billing_frequency && (
                    <div className="flex items-center gap-2">
                      <Repeat className="h-4 w-4 text-[rgb(var(--color-text-300))]" />
                      <p className="text-[rgb(var(--color-text-500))]">
                        <strong>
                          {t('wizardReview.common.billingFrequencyOverrideLabel', {
                            defaultValue: 'Billing Frequency Override:',
                          })}
                        </strong>{' '}
                        {formatBillingFrequency(data.hourly_billing_frequency) ||
                          data.hourly_billing_frequency}
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
              <h4 className="font-semibold">
                {t('wizardReview.sections.usageBasedServices', { defaultValue: 'Usage-Based Services' })}
              </h4>
            </div>
            <Badge
              variant="default"
              className="bg-[rgb(var(--badge-info-bg))] text-[rgb(var(--badge-info-text))] border border-[rgb(var(--badge-info-border))]"
            >
              {(data.usage_services?.length ?? 0) === 1
                ? t('wizardReview.usage.badgeCount.one', {
                    count: data.usage_services?.length ?? 0,
                    defaultValue: '{{count}} service',
                  })
                : t('wizardReview.usage.badgeCount.other', {
                    count: data.usage_services?.length ?? 0,
                    defaultValue: '{{count}} services',
                  })}
            </Badge>
          </div>
          <div className="space-y-2 text-sm">
            <ul className="list-disc list-inside space-y-1 ml-2">
              {(data.usage_services || []).map((service, idx) => (
                <li key={idx} className="space-y-1">
                  <span className="font-medium">
                    {t('wizardReview.usage.serviceRateRow', {
                      serviceName: service.service_name || service.service_id,
                      rate: formatMinorCurrency(service.unit_rate),
                      unit:
                        service.unit_of_measure ||
                        t('wizardReview.common.unitSingular', {
                          defaultValue: 'unit',
                        }),
                      defaultValue: '{{serviceName}} - {{rate}}/{{unit}}',
                    })}
                  </span>
                  {formatBucketSummary(service.bucket_overlay, 'usage', service.unit_of_measure) && (
                    <p className="text-xs text-[rgb(var(--color-secondary-600))] pl-4">
                      {t('wizardReview.common.bucketLabel', { defaultValue: 'Bucket:' })}{' '}
                      {formatBucketSummary(service.bucket_overlay, 'usage', service.unit_of_measure)}
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
                    <strong>
                      {t('wizardReview.common.billingFrequencyOverrideLabel', {
                        defaultValue: 'Billing Frequency Override:',
                      })}
                    </strong>{' '}
                    {formatBillingFrequency(data.usage_billing_frequency) || data.usage_billing_frequency}
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
            <h4 className="font-semibold text-lg mb-1">
              {t('wizardReview.total.title', { defaultValue: 'Estimated Monthly Total' })}
            </h4>
            <p className="text-sm text-[rgb(var(--color-text-500))]">
              {t('wizardReview.total.description', {
                defaultValue:
                  'Fixed charges only. Hourly and usage services bill separately based on actual usage.',
              })}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-[rgb(var(--color-primary-800))]">
              {formatMinorCurrency(calculateTotalMonthly())}
            </p>
            <p className="text-xs text-[rgb(var(--color-text-500))]">
              {t('wizardReview.total.perMonth', { defaultValue: 'per month' })}
            </p>
          </div>
        </div>
      </Card>

      <div className="p-4 bg-[rgb(var(--color-accent-50))] border border-[rgb(var(--color-accent-200))] rounded-md">
        <p className="text-sm text-[rgb(var(--color-accent-800))]">
          <strong>{t('wizardReview.finalChecklist.title', { defaultValue: 'Before you finish:' })}</strong>
        </p>
        <ul className="text-sm text-[rgb(var(--color-accent-800))] list-disc list-inside space-y-1 mt-2 ml-2">
          <li>
            {t('wizardReview.finalChecklist.itemRates', {
              defaultValue: 'Double-check all rates, quantities, and buckets',
            })}
          </li>
          <li>
            {t('wizardReview.finalChecklist.itemPo', {
              defaultValue: 'Confirm PO requirements (if any)',
            })}
          </li>
          <li>
            {t('wizardReview.finalChecklist.itemDates', {
              defaultValue: 'Verify the start and end dates',
            })}
          </li>
          <li>
            {t('wizardReview.finalChecklist.itemEditLater', {
              defaultValue: 'Remember: you can edit the contract later if needed',
            })}
          </li>
        </ul>
      </div>
    </div>
  );
}
