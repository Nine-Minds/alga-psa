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
  Wallet,
} from 'lucide-react';
import { CURRENCY_OPTIONS, fromMinorUnits } from '@alga-psa/core';
import { cadencePrepaidBlockPeriodAmounts, draftToInput, minutesToHoursText, prepaidLineSoldAsRate } from '../prepaidBlockConfigDraft';
import { describeRollover } from '../prepaidBlockLabels';
import { parse } from 'date-fns';
import { getClientByIdForBilling } from '@alga-psa/billing/actions/billingClientsActions';
import { getClientBillingProfilesForBilling } from '@alga-psa/billing/actions/billingProfileActions';
import { useClientBillingProfiles } from '@alga-psa/ui/hooks/useClientBillingProfiles';
import { getRecurringAuthoringPreview } from '../recurringAuthoringPreview';
import { FirstInvoiceNotice } from './FirstInvoiceNotice';
import { fixedLineDisplayName } from './firstInvoiceLines';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { meaningfulFixedLines } from '../../../../lib/contractWizardFixedLines';
import {
  fixedLinePeriodCents,
  hasBundleFixedService,
  isUnitFixedService,
  unitFixedServiceAmountCents,
} from '../../../../lib/fixedServiceBasis';
import { isAdvanceTimingAllowedForLineType, resolveEffectiveBillingTiming } from '@shared/billingClients/contractLineTimingRule';
import {
  resolveFixedLinePeriodTotal,
  summarizeRecurringAmounts,
  type RecurringPeriodAmount,
} from '../../../../lib/billing/compute/recurringMemberRate';
import { useProductCatalogRates } from '../../../../hooks/useProductCatalogRates';
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import {
  useBillingFrequencyOptions,
  useFormatBillingFrequency,
  useFormatBillingPeriod,
} from '@alga-psa/billing/hooks/useBillingEnumOptions';

const loadBillingProfiles = (clientId: string) => getClientBillingProfilesForBilling(clientId);

interface ReviewContractStepProps {
  data: ContractWizardData;
}

export function ReviewContractStep({ data }: ReviewContractStepProps) {
  const { t } = useTranslation('msp/contracts');
  const { formatCurrency, formatNumber, formatDate: formatDateInLocale } = useFormatters();
  const billingFrequencyOptions = useBillingFrequencyOptions();
  const formatBillingFrequency = useFormatBillingFrequency();
  const formatBillingPeriod = useFormatBillingPeriod();
  const notSelectedLabel = t('wizardReview.fallback.notSelected', { defaultValue: 'Not selected' });
  // `client_id` is the single canonical identity for the chosen client;
  // `clientName` only ever holds a resolved display value. It is empty while the
  // lookup is in flight (the id is shown instead) and never the "Not selected"
  // fallback, which is reserved for the genuinely unselected state.
  const [clientName, setClientName] = useState<string>(() =>
    data.client_id ? '' : notSelectedLabel
  );

  useEffect(() => {
    if (!data.client_id) {
      setClientName(notSelectedLabel);
      return;
    }

    let cancelled = false;
    setClientName('');

    const loadClientName = async () => {
      try {
        const client = await getClientByIdForBilling(data.client_id);
        if (cancelled) return;
        if (isActionMessageError(client) || isActionPermissionError(client)) {
          setClientName(data.client_id);
          return;
        }
        setClientName(client?.client_name || data.client_id);
      } catch (error) {
        if (cancelled) return;
        console.error('Error loading client name:', error);
        setClientName(data.client_id);
      }
    };

    void loadClientName();
    return () => {
      cancelled = true;
    };
  }, [data.client_id, notSelectedLabel]);

  // Mirrors the picker on the basics step: silent for a single-profile client,
  // and for a segmented one it states where the contract will bill — the pick
  // or the client default it falls back to.
  const { profiles: billingProfiles, isSegmented: isProfileSegmented } = useClientBillingProfiles(
    data.client_id || null,
    loadBillingProfiles,
  );
  const selectedBillingProfileName = data.billing_profile_id
    ? billingProfiles.find((profile) => profile.billing_profile_id === data.billing_profile_id)?.name
    : null;

  const currencyCode = data.currency_code || 'USD';
  const fixedLines = meaningfulFixedLines(data.fixed_lines);
  const previewForLine = (line: (typeof fixedLines)[number]) =>
    getRecurringAuthoringPreview({
      cadenceOwner: data.cadence_owner,
      billingTiming: line.billing_timing ?? data.billing_timing,
      billingFrequency: line.billing_frequency ?? data.billing_frequency,
      enableProration: line.enable_proration,
    }, t);

  // Same resolver the server uses. Hourly/usage lines are always arrears (never "inherited");
  // others show where the value came from when the line has no timing of its own.
  const reviewTimingLabel = (lineType: string, ownTiming: 'arrears' | 'advance' | undefined) => {
    const effective = resolveEffectiveBillingTiming(lineType, ownTiming ?? data.billing_timing);
    const inherited = ownTiming === undefined && isAdvanceTimingAllowedForLineType(lineType);
    if (effective === 'advance') {
      return inherited
        ? t('wizardReview.billingTiming.advanceInherited', { defaultValue: 'In advance (contract default)' })
        : t('wizardReview.billingTiming.advance', { defaultValue: 'In advance' });
    }
    return inherited
      ? t('wizardReview.billingTiming.arrearsInherited', { defaultValue: 'In arrears (contract default)' })
      : t('wizardReview.billingTiming.arrears', { defaultValue: 'In arrears' });
  };

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
    // toLocaleString(undefined, …) is the browser's locale, not the app's.
    const formattedValue = formatNumber(included, { maximumFractionDigits: 2 });

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

  // LEVERAGE: pattern ymd-local-format — same parse-local-YMD-then-format as useFormatYmd (@alga-psa/ui/lib/i18n/useFormatYmd); not swapped in here because this one falls back to new Date(str) and N/A
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
    return formatDateInLocale(local);
  };

  // Products are priced through the same shared (contract currency, service id)
  // lookup the Products step uses, so the two steps cannot disagree — whether
  // the product was just picked, resumed from a saved draft, or the contract
  // currency changed after it was picked.
  const { rates: productCatalogRates } = useProductCatalogRates(
    currencyCode,
    data.product_services.map((product) => product.service_id),
  );

  // Per line: unit members bill quantity × unit rate; the base rate is the
  // bundle total and counts only when an allocation member exists. Each line
  // contributes one billing period's amount on its own billing frequency; the
  // shared summary groups them by cadence and derives the monthly equivalent
  // with the same per-line normalization the stored value and the engine use.
  // Products are priced by the shared resolver (the invoice engine's rate
  // chain: product override, then the contract-currency catalog price, then
  // the legacy default rate) — never a parallel copy of the rule here.
  // A cadence Prepaid Block line adds its block fee per period (billed in advance) on the line's
  // frequency, the same one the submission gives it.
  const recurringSummary = summarizeRecurringAmounts([
    ...fixedLines.map(
      (line): RecurringPeriodAmount => ({
        periodCents: fixedLinePeriodCents(line),
        frequency: line.billing_frequency ?? data.billing_frequency,
      }),
    ),
    ...cadencePrepaidBlockPeriodAmounts(
      data.prepaid_block_drafts ?? [],
      data.hourly_billing_frequency ?? data.billing_frequency,
    ),
    // Products carry the contract cadence and are valued as one line, like the engine.
    {
      periodCents:
        resolveFixedLinePeriodTotal({
          custom_rate: null,
          members: data.product_services
            .filter((product) => product.service_id)
            .map((product) => ({
              item_kind: 'product',
              quantity: product.quantity,
              configuration_custom_rate: product.custom_rate,
              price_rate: productCatalogRates[product.service_id]?.currency_rate ?? null,
              default_rate: productCatalogRates[product.service_id]?.default_rate ?? null,
            })),
        }) ?? 0,
      frequency: data.billing_frequency,
    },
  ]);
  const isMixedFrequency = recurringSummary.groups.length > 1;
  const headlineFrequency = recurringSummary.singleFrequency ?? 'monthly';
  const perFrequencyText = (periodCents: number, frequency: string) =>
    t('wizardReview.total.perFrequency', {
      defaultValue: '{{amount}} {{period}}',
      amount: formatMinorCurrency(periodCents),
      period: formatBillingPeriod(frequency),
    });
  const monthlyEquivalentText = t('wizardReview.total.perMonthEquivalent', {
    defaultValue: 'about {{amount}} a month',
    amount: formatMinorCurrency(recurringSummary.monthlyCents),
  });

  const hasFixedServices = fixedLines.length > 0;
  const hasProducts = data.product_services.length > 0;
  const hasHourlyServices = data.hourly_services.length > 0;
  const prepaidBlockLines = (data.prepaid_block_drafts ?? []).filter((line) =>
    line.services.some((service) => service.service_id),
  );
  const hasUsageServices = !!(data.usage_services && data.usage_services.length > 0);

  const recurringCadenceOwnerLabel =
    data.cadence_owner === 'contract'
      ? t('wizardReview.recurring.cadenceOwner.contractAnniversary', {
          defaultValue: 'Contract anniversary',
        })
      : t('wizardReview.recurring.cadenceOwner.clientBillingSchedule', {
          defaultValue: 'Client billing schedule',
        });

  const partialPeriodSummaryFor = (enableProration: boolean) => enableProration
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
                {clientName || data.client_id || notSelectedLabel}
              </p>
            </div>
          </div>
          {isProfileSegmented && (
            <div className="flex items-start gap-2">
              <Wallet className="h-4 w-4 mt-0.5 text-[rgb(var(--color-text-300))]" />
              <div>
                <p className="text-[rgb(var(--color-text-500))]">
                  {t('wizardReview.fields.billingProfile', { defaultValue: 'Billing Profile' })}
                </p>
                <p className="font-medium">
                  {selectedBillingProfileName ||
                    t('wizardReview.billingProfile.clientDefault', {
                      defaultValue: "The client's default profile",
                    })}
                </p>
              </div>
            </div>
          )}
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

      {fixedLines.map((line, lineIndex) => {
        const recurringPreview = previewForLine(line);
        const lineServices = line.services;
        return (
        <Card key={line.line_key} id={`review-fixed-line-${lineIndex}`} className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-[rgb(var(--color-status-success))]" />
              <h4 className="font-semibold">
                {fixedLineDisplayName(line, lineIndex, fixedLines.length, t)}
              </h4>
            </div>
            <Badge
              variant="default"
              className="bg-[rgb(var(--badge-success-bg))] text-[rgb(var(--badge-success-text))] border border-[rgb(var(--badge-success-border))]"
            >
              {lineServices.length === 1
                ? t('wizardReview.fixed.badgeCount.one', {
                    count: lineServices.length,
                    defaultValue: '{{count}} service',
                  })
                : t('wizardReview.fixed.badgeCount.other', {
                    count: lineServices.length,
                    defaultValue: '{{count}} services',
                  })}
            </Badge>
          </div>
          <div className="space-y-2 text-sm">
            {(hasBundleFixedService(lineServices) || lineServices.length === 0) && (
              <div className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-[rgb(var(--color-text-300))]" />
                <span className="font-medium">
                  {t('wizardReview.fixed.monthlyBaseRate', { defaultValue: 'Monthly Base Rate:' })}
                </span>
                <span>{formatMinorCurrency(line.base_rate)}</span>
              </div>
            )}
            <ul className="list-disc list-inside space-y-1 ml-2">
              {lineServices.map((service, idx) => (
                <li key={idx} className="space-y-1">
                  <span className="font-medium">
                    {isUnitFixedService(service)
                      ? t('wizardReview.fixed.recurringUnitRow', {
                          serviceName: service.service_name || service.service_id,
                          quantity: service.quantity,
                          rate: formatMinorCurrency(service.unit_rate),
                          amount: formatMinorCurrency(
                            unitFixedServiceAmountCents(service.quantity, service.unit_rate ?? 0),
                          ),
                          defaultValue: '{{serviceName}}: {{quantity}} × {{rate}} = {{amount}}',
                        })
                      : t('wizardReview.common.serviceQuantityRow', {
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
                  {line.enable_proration
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
                  <p>
                    <strong>{t('wizardReview.billingTiming.label', { defaultValue: 'Billing timing:' })}</strong>{' '}
                    {reviewTimingLabel('Fixed', line.billing_timing)}
                  </p>
                  <FirstInvoiceNotice
                    id={lineIndex === 0 ? "contract-wizard-review-first-invoice" : `contract-wizard-review-first-invoice-${lineIndex}`}
                    cadenceOwner={data.cadence_owner}
                    billingTiming={line.billing_timing ?? data.billing_timing}
                    billingFrequency={line.billing_frequency ?? data.billing_frequency}
                    startDate={data.start_date}
                    clientId={data.client_id}
                    className="space-y-1"
                  />
                  <p>{partialPeriodSummaryFor(line.enable_proration)}</p>
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
              {line.billing_frequency && line.billing_frequency !== data.billing_frequency && (
                <div className="flex items-center gap-2">
                  <Repeat className="h-4 w-4 text-[rgb(var(--color-text-300))]" />
                  <p className="text-[rgb(var(--color-text-500))]">
                    <strong>
                      {t('wizardReview.common.billingFrequencyOverrideLabel', {
                        defaultValue: 'Billing Frequency Override:',
                      })}
                    </strong>{' '}
                    {formatBillingFrequency(line.billing_frequency) || line.billing_frequency}
                  </p>
                </div>
              )}
            </div>
          </div>
        </Card>
        );
      })}

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
              className="chip-primary"
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
          <p className="text-sm text-[rgb(var(--color-text-500))] mt-3" id="contract-wizard-review-products-timing">
            <strong>{t('wizardReview.billingTiming.label', { defaultValue: 'Billing timing:' })}</strong>{' '}
            {reviewTimingLabel('Product', data.product_billing_timing)}
          </p>
          <FirstInvoiceNotice
            id="contract-wizard-review-products-first-invoice"
            cadenceOwner={data.cadence_owner}
            billingTiming={resolveEffectiveBillingTiming('Product', data.product_billing_timing ?? data.billing_timing)}
            billingFrequency={data.billing_frequency}
            startDate={data.start_date}
            clientId={data.client_id}
            className="space-y-1 text-sm text-[rgb(var(--color-text-500))] mt-2"
          />
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
              className="chip-primary"
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
            <p id="contract-wizard-review-hourly-timing" className="text-[rgb(var(--color-text-500))]">
              <strong>{t('wizardReview.billingTiming.label', { defaultValue: 'Billing timing:' })}</strong>{' '}
              {reviewTimingLabel('Hourly', undefined)}
            </p>
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

      {prepaidBlockLines.length > 0 && (
        <Card className="p-4" id="wizard-review-prepaid-blocks">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-[rgb(var(--color-primary-500))]" />
              <h4 className="font-semibold">
                {t('wizardReview.sections.prepaidBlocks', { defaultValue: 'Prepaid Block Lines' })}
              </h4>
            </div>
            <Badge variant="default" className="chip-primary">
              {t('wizardReview.prepaid.badgeCount', {
                count: prepaidBlockLines.length,
                defaultValue: '{{count}} lines',
              })}
            </Badge>
          </div>
          <ul className="space-y-3 text-sm">
            {prepaidBlockLines.map((line, idx) => {
              const parsed = draftToInput(line.block, prepaidLineSoldAsRate(line));
              const config = 'input' in parsed ? parsed.input : null;
              const overageRateMinor = prepaidLineSoldAsRate(line);
              return (
                <li key={idx} id={`wizard-review-prepaid-block-${idx}`} className="space-y-1">
                  <p className="font-medium">
                    {line.name?.trim() ||
                      t('wizardPrepaidBlock.lineNamePlaceholder', { defaultValue: 'Prepaid Block' })}
                  </p>
                  <ul className="list-disc list-inside ml-2">
                    {line.services
                      .filter((service) => service.service_id)
                      .map((service) => (
                        <li key={service.service_id}>
                          {t('wizardReview.hourly.serviceRateRow', {
                            serviceName: service.service_name || service.service_id,
                            rate: formatCurrency(fromMinorUnits(service.hourly_rate ?? 0, undefined, currencyCode), currencyCode),
                            defaultValue: '{{serviceName}} - {{rate}}/hour',
                          })}
                        </li>
                      ))}
                  </ul>
                  {config && config.issue_mode === 'cadence' ? (
                    <p id={`wizard-review-prepaid-block-${idx}-summary`} className="text-[rgb(var(--color-text-500))]">
                      {t('wizardReview.prepaid.cadenceSummary', {
                        hours: minutesToHoursText(config.block_minutes),
                        price: formatCurrency(fromMinorUnits(config.block_price, undefined, currencyCode), currencyCode),
                        defaultValue: '{{hours}} h every billing period for {{price}}',
                      })}
                      {`, ${describeRollover(t, config.rollover_periods ?? 0)}`}
                      {overageRateMinor !== undefined
                        ? `, ${t('wizardReview.prepaid.overageRate', {
                            rate: formatCurrency(fromMinorUnits(overageRateMinor, undefined, currencyCode), currencyCode),
                            defaultValue: 'overage {{rate}}/h',
                          })}`
                        : ''}
                    </p>
                  ) : config ? (
                    <p className="text-[rgb(var(--color-text-500))]">
                      {t('wizardReview.prepaid.blockSummary', {
                        hours: minutesToHoursText(config.block_minutes),
                        price: formatCurrency(fromMinorUnits(config.block_price, undefined, currencyCode), currencyCode),
                        defaultValue: '{{hours}} hours for {{price}}',
                      })}
                      {config.expiry_months
                        ? ` - ${t('wizardReview.prepaid.expiresAfter', {
                            count: config.expiry_months,
                            defaultValue: 'expires after {{count}} months',
                          })}`
                        : ` - ${t('wizardReview.prepaid.neverExpires', { defaultValue: 'never expires' })}`}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
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
            <p id="contract-wizard-review-usage-timing" className="text-[rgb(var(--color-text-500))]">
              <strong>{t('wizardReview.billingTiming.label', { defaultValue: 'Billing timing:' })}</strong>{' '}
              {reviewTimingLabel('Usage', undefined)}
            </p>
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
              {isMixedFrequency
                ? t('wizardReview.total.mixedFrequencyTitle', { defaultValue: 'Estimated Total by Billing Frequency' })
                : headlineFrequency === 'monthly'
                  ? t('wizardReview.total.title', { defaultValue: 'Estimated Monthly Total' })
                  : t('wizardReview.total.titleCadence', { defaultValue: 'Estimated Total' })}
            </h4>
            <p className="text-sm text-[rgb(var(--color-text-500))]">
              {t('wizardReview.total.description', {
                defaultValue:
                  'Products and fixed charges are included in this total. Hourly and usage services are billed on actuals.',
              })}
            </p>
          </div>
          <div className="text-right">
            {isMixedFrequency ? (
              <>
                {recurringSummary.groups.map((group) => (
                  <p
                    key={group.frequency}
                    data-testid={`review-total-row-${group.frequency}`}
                    className="text-lg font-semibold text-[rgb(var(--color-primary-800))]"
                  >
                    {perFrequencyText(group.periodCents, group.frequency)}
                  </p>
                ))}
                <p id="review-total-monthly-equivalent" className="text-xs text-[rgb(var(--color-text-500))]">
                  {monthlyEquivalentText}
                </p>
              </>
            ) : (
              <>
                <p
                  id="review-total-headline"
                  className="text-3xl font-bold text-[rgb(var(--color-primary-800))]"
                >
                  {formatMinorCurrency(recurringSummary.singleFrequencyPeriodCents ?? 0)}
                </p>
                <p className="text-xs text-[rgb(var(--color-text-500))]">
                  {formatBillingPeriod(headlineFrequency)}
                </p>
                {headlineFrequency !== 'monthly' && (
                  <p id="review-total-monthly-equivalent" className="text-xs text-[rgb(var(--color-text-500))]">
                    {monthlyEquivalentText}
                  </p>
                )}
              </>
            )}
            {data.recurring_baseline && (
              <p id="review-saved-draft-value" className="text-xs text-[rgb(var(--color-text-500))]">
                {/* A stored monthly value: under a monthly headline the cadence is already
                    stated; under any other headline it must say "per month" itself. */}
                {isMixedFrequency || headlineFrequency !== 'monthly'
                  ? t('wizardReview.total.savedDraftValueMonthly', {
                      defaultValue: 'Saved draft value: {{amount}} per month',
                      amount: formatMinorCurrency(data.recurring_baseline.monthly_cents),
                    })
                  : t('wizardReview.total.savedDraftValue', {
                      defaultValue: 'Saved draft value: {{amount}}',
                      amount: formatMinorCurrency(data.recurring_baseline.monthly_cents),
                    })}
              </p>
            )}
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
