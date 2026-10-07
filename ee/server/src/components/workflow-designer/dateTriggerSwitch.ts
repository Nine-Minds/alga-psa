import type { DateTriggerSourceDefinition } from '@alga-psa/workflows/authoring';
import { DEFAULT_STATUS_AGE_PARAMS } from './dateTriggerStatusAge';

/**
 * The date trigger for choosing `source`, keeping the timing fields (time of day, timezone, offset)
 * of the trigger it replaces. Sources without an offset control store offsetDays 0; params exist only
 * for sources that take them, and start from that source's defaults.
 */
export const buildDateTriggerForSource = (
  source: DateTriggerSourceDefinition,
  previous?: Record<string, unknown>,
): Record<string, unknown> => {
  const { params: _previousParams, ...kept } = previous ?? {};
  return {
    localTime: '08:00',
    ...kept,
    type: 'date',
    source: source.id,
    ...(source.usesOffset && typeof kept.offsetDays === 'number' ? {} : { offsetDays: source.usesOffset ? -30 : 0 }),
    ...(source.hasParams ? { params: { ...DEFAULT_STATUS_AGE_PARAMS } } : {}),
  };
};
