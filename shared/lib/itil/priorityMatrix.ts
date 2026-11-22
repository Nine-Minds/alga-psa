/**
 * The ITIL Impact × Urgency priority matrix.
 *
 * One copy for every caller: ticket create/update, the service-request provider, the ticket
 * form and the shared board field rules. It is deliberately pure — no database, no tenant —
 * so it can be imported from a client component as well as from `shared/workflow`.
 */

/** ITIL Impact levels (1 = widest blast radius, 5 = a single user). */
export enum ItilImpact {
  HIGH = 1,
  MEDIUM_HIGH = 2,
  MEDIUM = 3,
  MEDIUM_LOW = 4,
  LOW = 5,
}

/** ITIL Urgency levels (1 = work cannot continue, 5 = work continues normally). */
export enum ItilUrgency {
  HIGH = 1,
  MEDIUM_HIGH = 2,
  MEDIUM = 3,
  MEDIUM_LOW = 4,
  LOW = 5,
}

/** ITIL priority levels. The tenant's ITIL priority rows carry these in `itil_priority_level`. */
export enum ItilPriorityLevel {
  CRITICAL = 1,
  HIGH = 2,
  MEDIUM = 3,
  LOW = 4,
  PLANNING = 5,
}

const PRIORITY_MATRIX: Record<number, Record<number, number>> = {
  [ItilImpact.HIGH]: {
    [ItilUrgency.HIGH]: ItilPriorityLevel.CRITICAL,
    [ItilUrgency.MEDIUM_HIGH]: ItilPriorityLevel.HIGH,
    [ItilUrgency.MEDIUM]: ItilPriorityLevel.HIGH,
    [ItilUrgency.MEDIUM_LOW]: ItilPriorityLevel.MEDIUM,
    [ItilUrgency.LOW]: ItilPriorityLevel.MEDIUM,
  },
  [ItilImpact.MEDIUM_HIGH]: {
    [ItilUrgency.HIGH]: ItilPriorityLevel.HIGH,
    [ItilUrgency.MEDIUM_HIGH]: ItilPriorityLevel.HIGH,
    [ItilUrgency.MEDIUM]: ItilPriorityLevel.MEDIUM,
    [ItilUrgency.MEDIUM_LOW]: ItilPriorityLevel.MEDIUM,
    [ItilUrgency.LOW]: ItilPriorityLevel.LOW,
  },
  [ItilImpact.MEDIUM]: {
    [ItilUrgency.HIGH]: ItilPriorityLevel.HIGH,
    [ItilUrgency.MEDIUM_HIGH]: ItilPriorityLevel.MEDIUM,
    [ItilUrgency.MEDIUM]: ItilPriorityLevel.MEDIUM,
    [ItilUrgency.MEDIUM_LOW]: ItilPriorityLevel.LOW,
    [ItilUrgency.LOW]: ItilPriorityLevel.LOW,
  },
  [ItilImpact.MEDIUM_LOW]: {
    [ItilUrgency.HIGH]: ItilPriorityLevel.MEDIUM,
    [ItilUrgency.MEDIUM_HIGH]: ItilPriorityLevel.MEDIUM,
    [ItilUrgency.MEDIUM]: ItilPriorityLevel.LOW,
    [ItilUrgency.MEDIUM_LOW]: ItilPriorityLevel.LOW,
    [ItilUrgency.LOW]: ItilPriorityLevel.PLANNING,
  },
  [ItilImpact.LOW]: {
    [ItilUrgency.HIGH]: ItilPriorityLevel.MEDIUM,
    [ItilUrgency.MEDIUM_HIGH]: ItilPriorityLevel.LOW,
    [ItilUrgency.MEDIUM]: ItilPriorityLevel.LOW,
    [ItilUrgency.MEDIUM_LOW]: ItilPriorityLevel.PLANNING,
    [ItilUrgency.LOW]: ItilPriorityLevel.PLANNING,
  },
};

/**
 * The ITIL priority level for an Impact × Urgency pair. Throws on a value outside 1–5:
 * every caller either validates its input or treats the throw as "no assessment".
 */
export function calculateItilPriority(impact: number, urgency: number): number {
  if (!Number.isInteger(impact) || !Number.isInteger(urgency) || impact < 1 || impact > 5 || urgency < 1 || urgency > 5) {
    throw new Error('Impact and urgency must be between 1 and 5');
  }
  return PRIORITY_MATRIX[impact][urgency];
}

/** English fallback labels for the three ITIL scales; the UI translates through `t()`. */
export const ItilLabels = {
  impact: {
    1: 'High',
    2: 'Medium-High',
    3: 'Medium',
    4: 'Medium-Low',
    5: 'Low',
  },
  urgency: {
    1: 'High',
    2: 'Medium-High',
    3: 'Medium',
    4: 'Medium-Low',
    5: 'Low',
  },
  priority: {
    1: 'Critical',
    2: 'High',
    3: 'Medium',
    4: 'Low',
    5: 'Planning',
  },
} as const;
