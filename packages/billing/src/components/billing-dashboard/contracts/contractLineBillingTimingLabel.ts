import { resolveEffectiveBillingTiming } from '@shared/billingClients/contractLineTimingRule';

type TimingTranslate = (key: string, options?: { defaultValue?: string }) => string;

/**
 * Localized "In Advance" / "In Arrears" label for a contract (template) line,
 * using the effective timing (Hourly/Usage lines are always arrears).
 */
export function getContractLineBillingTimingLabel(
  t: TimingTranslate,
  contractLineType: Parameters<typeof resolveEffectiveBillingTiming>[0],
  billingTiming: Parameters<typeof resolveEffectiveBillingTiming>[1],
): string {
  return resolveEffectiveBillingTiming(contractLineType, billingTiming) === 'advance'
    ? t('billing.timing.advance', { defaultValue: 'In Advance' })
    : t('billing.timing.arrears', { defaultValue: 'In Arrears' });
}
