import type { ContractWizardFixedLine } from '@alga-psa/types';
import { resolveEffectiveBillingTiming } from '@shared/billingClients/contractLineTimingRule';
import type { ContractWizardData } from '../ContractWizard';
import { meaningfulFixedLines } from '../../../../lib/contractWizardFixedLines';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** A wizard line whose first invoice falls on a date the wizard can state. */
export interface FirstInvoiceLine {
  key: string;
  name: string;
  billingTiming: 'arrears' | 'advance';
  billingFrequency: string;
}

/** Lines sharing timing and frequency first invoice on the same date, so they share one sentence. */
export interface FirstInvoiceGroup {
  key: string;
  names: string[];
  billingTiming: 'arrears' | 'advance';
  billingFrequency: string;
}

/** The heading a fixed line carries on the review step (its own name, else a numbered fallback). */
export function fixedLineDisplayName(
  line: ContractWizardFixedLine,
  index: number,
  lineCount: number,
  t: Translate,
): string {
  return (
    line.contract_line_name?.trim() ||
    (lineCount > 1
      ? t('wizardReview.sections.fixedFeeServicesNumbered', {
          defaultValue: 'Fixed Fee Services ({{number}})',
          number: index + 1,
        })
      : t('wizardReview.sections.fixedFeeServices', { defaultValue: 'Fixed Fee Services' }))
  );
}

/**
 * Every line that invoices on a recurring schedule: each fixed line and the
 * products line. Hourly and usage lines invoice from recorded work, so they have
 * no first-invoice date to state. Timing is resolved through the shared rule so
 * the notice matches what creation stores.
 */
export function firstInvoiceLines(data: ContractWizardData, t: Translate): FirstInvoiceLine[] {
  const fixedLines = meaningfulFixedLines(data.fixed_lines);
  const lines: FirstInvoiceLine[] = fixedLines.map((line, index) => ({
    key: line.line_key,
    name: fixedLineDisplayName(line, index, fixedLines.length, t),
    billingTiming: resolveEffectiveBillingTiming('Fixed', line.billing_timing ?? data.billing_timing),
    billingFrequency: line.billing_frequency ?? data.billing_frequency,
  }));

  if (data.product_services.length > 0) {
    lines.push({
      key: 'products',
      name: t('wizardReview.sections.products', { defaultValue: 'Products' }),
      billingTiming: resolveEffectiveBillingTiming('Product', data.product_billing_timing ?? data.billing_timing),
      billingFrequency: data.billing_frequency,
    });
  }

  return lines;
}

/** True when the contract has at least one line with a first-invoice date to state. */
export function hasFirstInvoiceLines(data: ContractWizardData): boolean {
  return meaningfulFixedLines(data.fixed_lines).length > 0 || data.product_services.length > 0;
}

/** Groups lines by timing and frequency, keeping first-seen order. */
export function groupFirstInvoiceLines(lines: readonly FirstInvoiceLine[]): FirstInvoiceGroup[] {
  const groups = new Map<string, FirstInvoiceGroup>();
  for (const line of lines) {
    const key = `${line.billingTiming}|${line.billingFrequency}`;
    const group = groups.get(key);
    if (group) {
      group.names.push(line.name);
    } else {
      groups.set(key, {
        key,
        names: [line.name],
        billingTiming: line.billingTiming,
        billingFrequency: line.billingFrequency,
      });
    }
  }
  return [...groups.values()];
}
