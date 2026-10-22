'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, ReceiptText, TriangleAlert } from 'lucide-react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type {
  ContractBillingTrace,
  ContractBillingTraceField,
  ContractBillingTraceProfile,
  ContractBillingTraceTerms,
  ContractBillingTraceWarning,
} from '@alga-psa/types';

interface BillingTermsSectionProps {
  trace: ContractBillingTrace;
  /** Formats a stored billing frequency key ("monthly") for display. */
  formatFrequency?: (value: string) => string;
  /**
   * `simulation` adds the honesty note: the simulator prices tax from the
   * client-level exemption, so naming a profile must not imply otherwise.
   */
  variant?: 'contract' | 'simulation';
}

const TERMS_LABELS: Record<ContractBillingTraceTerms['value'], string> = {
  net_30: 'Net 30',
  net_15: 'Net 15',
  due_on_receipt: 'Due on receipt',
};

/**
 * Presentational only. Every value arrives resolved from
 * `loadContractBillingTrace`; this component never derives a profile or a
 * terms fallback of its own.
 */
export const BillingTermsSection: React.FC<BillingTermsSectionProps> = ({
  trace,
  formatFrequency = (value) => value,
  variant = 'contract',
}) => {
  const { t } = useTranslation('msp/contracts');
  const [showDetails, setShowDetails] = useState(false);
  const isMixed = trace.profiles.length > 1;

  const termsLabel = (value: ContractBillingTraceTerms['value']) =>
    t(`contractOverview.billing.terms.${value}`, { defaultValue: TERMS_LABELS[value] });

  const termsSourceLabel = (source: ContractBillingTraceTerms['source']) =>
    t(`contractOverview.billing.termsSource.${source}`, {
      defaultValue: {
        profile: 'from the billing profile',
        client: 'from the client',
        default: 'default — no terms are set',
      }[source],
    });

  const profileSourceLabel = (source: ContractBillingTraceProfile['source']) =>
    t(`contractOverview.billing.profileSource.${source}`, {
      defaultValue: {
        client_default: 'client default',
        contract: 'assigned on contract',
        contract_line: 'set on line',
      }[source],
    });

  const valueSourceLabel = (source: ContractBillingTraceField['source']) =>
    t(`contractOverview.billing.valueSource.${source}`, {
      defaultValue: { profile: 'Profile', client: 'Client', contract: 'Contract', default: 'Default' }[source],
    });

  const lineCountLabel = (count: number) =>
    count === 1
      ? t('contractOverview.billing.lineCountOne', { count, defaultValue: '{{count}} line' })
      : t('contractOverview.billing.lineCountOther', { count, defaultValue: '{{count}} lines' });

  const dueSentence = (terms: ContractBillingTraceTerms) =>
    t('contractOverview.billing.dueSentence', {
      invoiceDate: terms.dueDateExample.invoiceDate,
      dueDate: terms.dueDateExample.dueDate,
      terms: termsLabel(terms.value),
      source: termsSourceLabel(terms.source),
      defaultValue: 'A {{invoiceDate}} invoice is due {{dueDate}} — {{terms}} {{source}}',
    });

  const fieldValue = (field: ContractBillingTraceField): string => {
    const none = t('contractOverview.billing.fieldNone', { defaultValue: 'None' });
    switch (field.key) {
      case 'tax_region':
        return t('contractOverview.billing.taxRegionChain', {
          defaultValue: 'Service region, then contract-line location, then client default',
        });
      case 'payment_method':
        return field.value
          ? t(`contractOverview.billing.paymentMethod.${field.value}`, {
              defaultValue: field.value.replace(/_/g, ' '),
            })
          : none;
      case 'tax_exemption':
        return field.value === 'exempt'
          ? t('contractOverview.billing.taxExempt', { defaultValue: 'Tax exempt' })
          : t('contractOverview.billing.taxable', { defaultValue: 'Taxable' });
      case 'template':
        return field.value
          ? t('contractOverview.billing.templateCustom', { defaultValue: 'Custom template' })
          : t('contractOverview.billing.templateDefault', { defaultValue: 'Default template' });
      case 'cadence':
        return field.value
          ? field.value.split(',').map((frequency) => formatFrequency(frequency)).join(', ')
          : none;
      default:
        return field.value ?? none;
    }
  };

  const fieldLabel = (field: ContractBillingTraceField) =>
    field.applied === false
      ? t('contractOverview.billing.fieldLabel.profile_billing_cycle_unapplied', {
          defaultValue: 'Profile billing cycle (not yet applied)',
        })
      : t(`contractOverview.billing.fieldLabel.${field.key}`, { defaultValue: field.label });

  const warningText = (warning: ContractBillingTraceWarning): string => {
    switch (warning.code) {
      case 'inactive_profile':
        return t('contractOverview.billing.warnings.inactiveProfile', {
          name: warning.profileName,
          defaultValue:
            '{{name}} is inactive but still bills this contract. Charges stay on it; they are not moved to the default profile.',
        });
      case 'mixed_profiles':
        return t('contractOverview.billing.warnings.mixedProfiles', {
          count: warning.profileCount,
          defaultValue:
            'This contract bills {{count}} different profiles, so no single profile covers it. Each profile uses its own payment terms.',
        });
      case 'line_override':
        return t('contractOverview.billing.warnings.lineOverride', {
          line: warning.contractLineName ?? warning.contractLineId,
          name: warning.profileName,
          defaultValue: 'Line "{{line}}" bills {{name}} instead of the contract\'s profile.',
        });
    }
  };

  const renderFields = (fields: ContractBillingTraceField[], testIdSuffix = '') => (
    <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,12rem)_1fr_auto] text-sm">
      {fields.map((field) => (
        <React.Fragment key={field.key}>
          <dt className="text-muted-foreground">{fieldLabel(field)}</dt>
          <dd className="text-[rgb(var(--color-text-800))]" data-testid={`billing-field-value-${field.key}${testIdSuffix}`}>
            {fieldValue(field)}
          </dd>
          <dd
            className="text-xs text-muted-foreground"
            data-testid={`billing-field-source-${field.key}${testIdSuffix}`}
          >
            {valueSourceLabel(field.source)}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );

  return (
    <div
      className="rounded-lg border border-[rgb(var(--color-border-200))] p-3 space-y-3"
      data-testid="billing-terms-section"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-[rgb(var(--color-text-700))]">
        <ReceiptText className="h-4 w-4" />
        <span>{t('contractOverview.billing.title', { defaultValue: 'Billing profile & payment terms' })}</span>
        {variant === 'simulation' && (
          <span className="ml-auto text-xs font-normal text-muted-foreground" data-testid="billing-as-of">
            {t('contractOverview.billing.asOf', { date: trace.asOf, defaultValue: 'as of {{date}}' })}
          </span>
        )}
      </div>

      {trace.warnings.length > 0 && (
        <ul className="space-y-1" data-testid="billing-warnings">
          {trace.warnings.map((warning, index) => (
            <li
              key={`${warning.code}-${index}`}
              className="flex items-start gap-2 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-sm"
              data-testid={`billing-warning-${warning.code}`}
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>{warningText(warning)}</span>
            </li>
          ))}
        </ul>
      )}

      <ul className="space-y-2">
        {trace.profiles.map((profile) => (
          <li key={profile.billingProfileId} className="space-y-1" data-testid={`billing-profile-${profile.billingProfileId}`}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                {t('contractOverview.billing.profileLabel', { defaultValue: 'Billing profile' })}
              </span>
              <span className="font-medium text-[rgb(var(--color-text-900))]" data-testid="billing-profile-name">
                {profile.name}
              </span>
              <Badge variant="info" className="text-xs" data-testid="billing-profile-source">
                {profileSourceLabel(profile.source)}
              </Badge>
              {!profile.isActive && (
                <Badge variant="warning" className="text-xs">
                  {t('contractOverview.billing.inactive', { defaultValue: 'Inactive' })}
                </Badge>
              )}
              {isMixed && (
                <span className="text-xs text-muted-foreground">{lineCountLabel(profile.lineCount)}</span>
              )}
            </div>
            {/* With several profiles each states its own terms: one headline
                value would read as if it covered the whole contract. */}
            {isMixed && (
              <div className="pl-2 text-sm text-muted-foreground" data-testid={`billing-profile-terms-${profile.billingProfileId}`}>
                {termsLabel(profile.terms.value)} · {termsSourceLabel(profile.terms.source)}
                <div>{dueSentence(profile.terms)}</div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {!isMixed && (
        <div className="space-y-1 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">
              {t('contractOverview.billing.termsLabel', { defaultValue: 'Payment terms' })}
            </span>
            <span className="font-medium text-[rgb(var(--color-text-900))]" data-testid="billing-terms-value">
              {termsLabel(trace.terms.value)}
            </span>
            <span className="text-xs text-muted-foreground" data-testid="billing-terms-source">
              {termsSourceLabel(trace.terms.source)}
            </span>
          </div>
          <p className="text-muted-foreground" data-testid="billing-due-sentence">
            {dueSentence(trace.terms)}
          </p>
        </div>
      )}

      {variant === 'simulation' && (
        <p className="text-xs text-muted-foreground" data-testid="billing-simulation-note">
          {t('contractOverview.billing.simulationNote', {
            defaultValue:
              'Simulated pricing uses the client-level tax exemption. A profile\'s own exemption is not applied in this simulation.',
          })}
        </p>
      )}

      <div>
        <button
          type="button"
          id="billing-terms-toggle-details"
          onClick={() => setShowDetails((open) => !open)}
          aria-expanded={showDetails}
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
        >
          {showDetails ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {t('contractOverview.billing.detailsToggle', { defaultValue: 'Other billing details' })}
        </button>
        {showDetails && (
          <div className="mt-2 space-y-3" data-testid="billing-details">
            {isMixed
              ? trace.profiles.map((profile) => (
                  <div key={profile.billingProfileId} className="space-y-1">
                    <div className="text-xs font-medium text-[rgb(var(--color-text-700))]">{profile.name}</div>
                    {renderFields(profile.fields, `-${profile.billingProfileId}`)}
                  </div>
                ))
              : renderFields(trace.fields)}
          </div>
        )}
      </div>
    </div>
  );
};

export default BillingTermsSection;
