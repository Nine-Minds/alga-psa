import type { DateTriggerSourceDefinition } from './dateTriggerSourceDefinitions';

/** Params a new `ticket.status_age` trigger starts with (the designer's controls and Attach (new workflow)). */
export const DEFAULT_STATUS_AGE_PARAMS = {
  statusName: '',
  boardId: null as string | null,
  days: 7,
  repeatEveryDays: null as number | null,
  requireNoActivity: false,
};

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
