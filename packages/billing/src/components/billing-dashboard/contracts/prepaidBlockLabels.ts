import type { PrepaidBlockIssueMode } from '@alga-psa/types';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * What happens to a cadence block's unused hours: "Expire at the end of the period" or
 * "Carry over N periods". One wording for the editor, the panels and both review steps.
 */
export function describeRollover(t: Translate, rolloverPeriods: number): string {
  return rolloverPeriods > 0
    ? t('prepaidBlock.fields.rolloverCarry', { defaultValue: 'Carry over {{count}} periods', count: rolloverPeriods })
    : t('prepaidBlock.fields.rolloverNone', { defaultValue: 'Expire at the end of the period' });
}

export function isCadenceBlock(config: { issue_mode?: PrepaidBlockIssueMode | null }): boolean {
  return config.issue_mode === 'cadence';
}
