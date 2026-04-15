'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { BucketOverlayInput, TemplateWizardData } from '../TemplateWizard';
import { Badge } from '@alga-psa/ui/components/Badge';
import { getRecurringAuthoringPreview } from '../../recurringAuthoringPreview';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFormatBillingFrequency } from '@alga-psa/billing/hooks/useBillingEnumOptions';

interface TemplateReviewContractStepProps {
  data: TemplateWizardData;
  updateData: (data: Partial<TemplateWizardData>) => void;
}

export function TemplateReviewContractStep({
  data,
}: TemplateReviewContractStepProps) {
  const { t } = useTranslation('msp/contracts');
  const formatBillingFrequency = useFormatBillingFrequency();

  const recurringPreview = getRecurringAuthoringPreview({
    cadenceOwner: data.cadence_owner,
    billingTiming: data.billing_timing,
    billingFrequency: data.billing_frequency,
    enableProration: data.enable_proration,
  });

  const formatBucketSummary = (
    overlay?: BucketOverlayInput | null,
    mode: 'hours' | 'usage' = 'hours',
    unitOfMeasure?: string
  ): string | null => {
    if (!overlay) return null;

    const segments: string[] = [];
    if (overlay.total_minutes != null) {
      if (mode === 'hours') {
        segments.push(
          t('templateReview.bucket.hoursIncluded', {
            value: (overlay.total_minutes / 60).toFixed(2),
            defaultValue: '{{value}} hours included',
          })
        );
      } else {
        segments.push(
          t('templateReview.bucket.unitsIncluded', {
            value: overlay.total_minutes,
            unit:
              unitOfMeasure ||
              t('templateReview.bucket.unitsFallback', {
                defaultValue: 'units',
              }),
            defaultValue: '{{value}} {{unit}} included',
          })
        );
      }
    }

    if (overlay.overage_rate != null) {
      const unitLabel =
        mode === 'hours'
          ? t('templateReview.bucket.hourSingular', { defaultValue: 'hour' })
          : unitOfMeasure ||
            t('templateReview.bucket.unitSingular', {
              defaultValue: 'unit',
            });
      segments.push(
        t('templateReview.bucket.overage', {
          amount: (overlay.overage_rate / 100).toFixed(2),
          unit: unitLabel,
          defaultValue: 'Overage ${{amount}}/{{unit}}',
        })
      );
    }

    if (overlay.allow_rollover) {
      segments.push(t('templateReview.bucket.rolloverEnabled', { defaultValue: 'Rollover enabled' }));
    }

    if (overlay.billing_period) {
      segments.push(
        t('templateReview.bucket.period', {
          period: overlay.billing_period,
          defaultValue: 'Period: {{period}}',
        })
      );
    }

    return segments.length > 0 ? segments.join(' • ') : null;
  };

  const fixedServices = data.fixed_services;
  const productServices = data.product_services;
  const hourlyServices = data.hourly_services;
  const usageServices = data.usage_services ?? [];
  const formattedBillingFrequency = data.billing_frequency
    ? formatBillingFrequency(data.billing_frequency)
    : t('templateReview.fallback.none', { defaultValue: '—' });

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">
        {t('templateReview.heading', { defaultValue: 'Review Template' })}
      </h3>
      <p className="text-sm text-[rgb(var(--color-text-500))]">
        {t('templateReview.description', {
          defaultValue:
            "Confirm the template contents. Rates are determined by each service's pricing in the client's currency when a contract is created from this template.",
        })}
      </p>

      <div className="max-h-[420px] overflow-y-auto pr-2 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('templateReview.sections.basics', { defaultValue: 'Template Basics' })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-[rgb(var(--color-text-500))]">
                {t('templateReview.fields.templateName', { defaultValue: 'Template Name' })}
              </span>
              <span className="font-medium text-[rgb(var(--color-text-900))]">
                {data.contract_name || t('templateReview.fallback.none', { defaultValue: '—' })}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[rgb(var(--color-text-500))]">
                {t('templateReview.fields.billingFrequency', { defaultValue: 'Billing Frequency' })}
              </span>
              <span className="font-medium text-[rgb(var(--color-text-900))]">{formattedBillingFrequency}</span>
            </div>
            <div>
              <span className="text-[rgb(var(--color-text-500))] block mb-1">
                {t('templateReview.fields.internalNotes', { defaultValue: 'Internal Notes' })}
              </span>
              <p className="text-[rgb(var(--color-text-900))]">
                {data.description?.trim()
                  ? data.description
                  : t('templateReview.fallback.noNotes', { defaultValue: 'No notes added.' })}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {t('templateReview.sections.fixedFeeServices', { defaultValue: 'Fixed Fee Services' })}
              <Badge variant="outline">{fixedServices.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {fixedServices.length === 0 ? (
              <p className="text-xs text-[rgb(var(--color-text-500))]">
                {t('templateReview.empty.fixed', { defaultValue: 'No fixed fee services selected.' })}
              </p>
            ) : (
              <>
                <div className="text-xs text-[rgb(var(--color-text-500))] flex flex-wrap gap-3 mb-2 pb-2 border-b border-[rgb(var(--color-border-200))]">
                  <span>
                    {t('templateReview.fixed.cadenceOwnerLabel', { defaultValue: 'Cadence owner:' })}{' '}
                    {data.cadence_owner === 'contract'
                      ? t('templateReview.fixed.cadenceOwner.contract', {
                          defaultValue: 'Contract anniversary',
                        })
                      : t('templateReview.fixed.cadenceOwner.client', {
                          defaultValue: 'Client billing schedule',
                        })}
                  </span>
                  <span>
                    {t('templateReview.fixed.billingTimingLabel', { defaultValue: 'Billing timing:' })}{' '}
                    {data.billing_timing === 'advance'
                      ? t('templateReview.fixed.billingTiming.advance', { defaultValue: 'Advance' })
                      : t('templateReview.fixed.billingTiming.arrears', { defaultValue: 'Arrears' })}
                  </span>
                  <span>
                    {t('templateReview.fixed.partialPeriodLabel', {
                      defaultValue: 'Partial-period adjustment:',
                    })}{' '}
                    {data.enable_proration
                      ? t('templateReview.common.enabled', { defaultValue: 'Enabled' })
                      : t('templateReview.common.disabled', { defaultValue: 'Disabled' })}
                  </span>
                </div>
                <div className="text-xs text-[rgb(var(--color-text-500))] space-y-1">
                  <p>{recurringPreview.cadenceOwnerSummary}</p>
                  <p>{recurringPreview.firstInvoiceSummary}</p>
                  <p>{recurringPreview.partialPeriodSummary}</p>
                  <p className="font-medium">{recurringPreview.materializedPeriodsHeading}</p>
                  <p>{recurringPreview.materializedPeriodsSummary}</p>
                  <ul className="list-disc pl-5 space-y-1">
                    {recurringPreview.materializedPeriods.map((period) => (
                      <li key={`${period.servicePeriodLabel}:${period.invoiceWindowLabel}`}>
                        <span>
                          <strong>{t('templateReview.fixed.serviceLabel', { defaultValue: 'Service:' })}</strong>{' '}
                          {period.servicePeriodLabel}
                        </span>
                        <span className="block">
                          <strong>
                            {t('templateReview.fixed.invoiceWindowLabel', { defaultValue: 'Invoice window:' })}
                          </strong>{' '}
                          {period.invoiceWindowLabel}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                {fixedServices.map((service, index) => (
                  <div
                    key={`${service.service_id}-${index}`}
                    className="border border-[rgb(var(--color-border-200))] rounded-md p-3 bg-[rgb(var(--color-border-50))]"
                  >
                    <p className="font-medium text-[rgb(var(--color-text-900))]">
                      {service.service_name ||
                        t('templateReview.fallback.unnamedService', { defaultValue: 'Unnamed Service' })}
                    </p>
                    <div className="text-xs text-[rgb(var(--color-text-500))] mt-1">
                      {t('templateReview.common.quantity', { defaultValue: 'Quantity:' })}{' '}
                      {service.quantity ?? 1}
                    </div>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {t('templateReview.sections.products', { defaultValue: 'Products' })}
              <Badge variant="outline">{productServices.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {productServices.length === 0 ? (
              <p className="text-xs text-[rgb(var(--color-text-500))]">
                {t('templateReview.empty.products', { defaultValue: 'No products selected.' })}
              </p>
            ) : (
              productServices.map((product, index) => (
                <div
                  key={`${product.service_id}-${index}`}
                  className="border border-[rgb(var(--color-border-200))] rounded-md p-3 bg-[rgb(var(--color-border-50))]"
                >
                  <p className="font-medium text-[rgb(var(--color-text-900))]">
                    {product.service_name ||
                      t('templateReview.fallback.unnamedProduct', { defaultValue: 'Unnamed Product' })}
                  </p>
                  <div className="text-xs text-[rgb(var(--color-text-500))] mt-1">
                    {t('templateReview.common.quantity', { defaultValue: 'Quantity:' })}{' '}
                    {product.quantity ?? 1}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {t('templateReview.sections.hourlyServices', { defaultValue: 'Hourly Services' })}
              <Badge variant="outline">{hourlyServices.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {hourlyServices.length === 0 ? (
              <p className="text-xs text-[rgb(var(--color-text-500))]">
                {t('templateReview.empty.hourly', { defaultValue: 'No hourly services selected.' })}
              </p>
            ) : (
              <>
                {(data.minimum_billable_time || data.round_up_to_nearest) && (
                  <div className="text-xs text-[rgb(var(--color-text-500))] flex flex-wrap gap-3 mb-2 pb-2 border-b border-[rgb(var(--color-border-200))]">
                    {data.minimum_billable_time ? (
                      <span>
                        {t('templateReview.hourly.minimumBillableTimeLabel', {
                          defaultValue: 'Minimum billable time:',
                        })}{' '}
                        {t('templateReview.hourly.minutes', {
                          count: data.minimum_billable_time,
                          defaultValue: '{{count}} minutes',
                        })}
                      </span>
                    ) : null}
                    {data.round_up_to_nearest ? (
                      <span>
                        {t('templateReview.hourly.roundUpLabel', { defaultValue: 'Round up:' })}{' '}
                        {t('templateReview.hourly.minutes', {
                          count: data.round_up_to_nearest,
                          defaultValue: '{{count}} minutes',
                        })}
                      </span>
                    ) : null}
                  </div>
                )}
                {hourlyServices.map((service, index) => (
                  <div
                    key={`${service.service_id}-${index}`}
                    className="border border-[rgb(var(--color-border-200))] rounded-md p-3 bg-[rgb(var(--color-border-50))]"
                  >
                    <p className="font-medium text-[rgb(var(--color-text-900))]">
                      {service.service_name ||
                        t('templateReview.fallback.unnamedService', { defaultValue: 'Unnamed Service' })}
                    </p>
                    {formatBucketSummary(service.bucket_overlay, 'hours') && (
                      <div className="text-xs text-[rgb(var(--color-text-500))] mt-1">
                        {t('templateReview.common.bucket', { defaultValue: 'Bucket:' })}{' '}
                        {formatBucketSummary(service.bucket_overlay, 'hours')}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {t('templateReview.sections.usageBasedServices', { defaultValue: 'Usage-Based Services' })}
              <Badge variant="outline">{usageServices.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {usageServices.length === 0 ? (
              <p className="text-xs text-[rgb(var(--color-text-500))]">
                {t('templateReview.empty.usage', { defaultValue: 'No usage-based services selected.' })}
              </p>
            ) : (
              usageServices.map((service, index) => (
                <div
                  key={`${service.service_id}-${index}`}
                  className="border border-[rgb(var(--color-border-200))] rounded-md p-3 bg-[rgb(var(--color-border-50))]"
                >
                  <p className="font-medium text-[rgb(var(--color-text-900))]">
                    {service.service_name ||
                      t('templateReview.fallback.unnamedService', { defaultValue: 'Unnamed Service' })}
                  </p>
                  {service.unit_of_measure && (
                    <div className="text-xs text-[rgb(var(--color-text-500))] mt-1">
                      {t('templateReview.usage.unitLabel', { defaultValue: 'Unit:' })}{' '}
                      {service.unit_of_measure}
                    </div>
                  )}
                  {formatBucketSummary(service.bucket_overlay, 'usage', service.unit_of_measure) && (
                    <div className="text-xs text-[rgb(var(--color-text-500))] mt-1">
                      {t('templateReview.common.bucket', { defaultValue: 'Bucket:' })}{' '}
                      {formatBucketSummary(service.bucket_overlay, 'usage', service.unit_of_measure)}
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
