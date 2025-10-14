import { Knex } from 'knex';
import { Temporal } from '@js-temporal/polyfill';
import { IClientContractLineCycle } from 'server/src/interfaces/billing.interfaces';
import { IClient } from 'server/src/interfaces/client.interfaces';
import {
  parseISO,
  startOfDay,
  startOfMonth,
  startOfYear,
  getMonth,
  getDate,
  setMonth,
  subWeeks
} from 'date-fns';
import { ISO8601String } from 'server/src/types/types.d';
/**
 * Result type for billing cycle creation.
 */
export type BillingCycleCreationResult = {
  success: boolean;
  error?: 'duplicate' | 'invalid_date' | 'db_error';
  message?: string;
  suggestedDate?: ISO8601String;
};

function getNextCycleDate(currentDate: ISO8601String, billingCycle: string): {
  effectiveDate: string;
  periodStart: string;
  periodEnd: string;
} {
  // Validate input type
  if (typeof currentDate !== 'string') {
    throw new Error(`Invalid date type: Expected string, got ${typeof currentDate}`);
  }

  // Validate that input date is UTC midnight
  const dateObj = parseISO(currentDate);
  if (
    dateObj.getUTCHours() !== 0 ||
    dateObj.getUTCMinutes() !== 0 ||
    dateObj.getUTCSeconds() !== 0 ||
    dateObj.getUTCMilliseconds() !== 0
  ) {
    throw new Error(`Input date must be UTC midnight. Got: ${currentDate}`);
  }

  // Validate ISO8601 format
  if (!currentDate.endsWith('Z')) {
    throw new Error(`Input date must be UTC ISO8601 format ending with Z. Got: ${currentDate}`);
  }

  console.log('getNextCycleDate input:', {
    currentDate,
    billingCycle
  });
  const parsedDate = parseISO(currentDate);
  const effectiveDate = parsedDate.toISOString().split('T')[0] + 'T00:00:00Z';

  console.log('effectiveDate after UTC reset:', effectiveDate);

  const effectivePlain = Temporal.PlainDate.from(effectiveDate.slice(0, 10));
  let periodEndPlain: Temporal.PlainDate;

  switch (billingCycle) {
    case 'weekly':
      periodEndPlain = effectivePlain.add({ days: 7 });
      break;
    case 'bi-weekly':
      periodEndPlain = effectivePlain.add({ days: 14 });
      break;
    case 'monthly':
      periodEndPlain = effectivePlain.add({ months: 1 });
      break;
    case 'quarterly':
      periodEndPlain = effectivePlain.add({ months: 3 });
      break;
    case 'semi-annually':
      periodEndPlain = effectivePlain.add({ months: 6 });
      break;
    case 'annually':
      periodEndPlain = effectivePlain.add({ years: 1 });
      break;
    default:
      periodEndPlain = effectivePlain.add({ months: 1 });
  }

  const periodEnd = `${periodEndPlain.toString()}T00:00:00Z`;

  console.log('Period calculation:', {
    effectiveDate,
    periodEnd,
    billingCycle
  });

  return {
    effectiveDate,
    periodStart: effectiveDate,
    periodEnd
  };
}

function getStartOfCurrentCycle(date: ISO8601String, billingCycle: string): {
  effectiveDate: string;
  periodStart: string;
  periodEnd: string;
} {
  // Validate that input date is UTC midnight
  const parsedDate = parseISO(date);
  if (
    parsedDate.getUTCHours() !== 0 ||
    parsedDate.getUTCMinutes() !== 0 ||
    parsedDate.getUTCSeconds() !== 0 ||
    parsedDate.getUTCMilliseconds() !== 0
  ) {
    throw new Error(`Input date must be UTC midnight. Got: ${date}`);
  }

  // Validate ISO8601 format
  if (!date.endsWith('Z')) {
    throw new Error(`Input date must be UTC ISO8601 format ending with Z. Got: ${date}`);
  }

  let cycleStart: ISO8601String;

  // Always ensure parsedDate is a Date object before using date-fns utilities
  let dateObj: Date = parsedDate instanceof Date ? parsedDate : parseISO(String(parsedDate));
  switch (billingCycle) {
    case 'weekly': {
      const startOfWeek = startOfDay(dateObj);
      cycleStart = startOfWeek.toISOString().split('T')[0] + 'T00:00:00Z';
      break;
    }
    case 'bi-weekly': {
      const startOfWeek = startOfDay(dateObj);
      const weekOfMonth = Math.ceil(getDate(startOfWeek) / 7);
      const weeksToSubtract = weekOfMonth % 2 === 0 ? 1 : 0;
      const biWeekStart = subWeeks(startOfWeek, weeksToSubtract);
      cycleStart = biWeekStart.toISOString().split('T')[0] + 'T00:00:00Z';
      break;
    }
    case 'monthly':
      cycleStart = startOfMonth(dateObj).toISOString().split('T')[0] + 'T00:00:00Z';
      break;
    case 'quarterly': {
      const currentQuarter = Math.floor(getMonth(dateObj) / 3);
      const quarterStart = setMonth(dateObj, currentQuarter * 3);
      cycleStart = startOfMonth(quarterStart).toISOString().split('T')[0] + 'T00:00:00Z';
      break;
    }
    case 'semi-annually': {
      const isSecondHalf = getMonth(dateObj) >= 6;
      const semiStart = setMonth(dateObj, isSecondHalf ? 6 : 0);
      cycleStart = startOfMonth(semiStart).toISOString().split('T')[0] + 'T00:00:00Z';
      break;
    }
    case 'annually':
      cycleStart = startOfYear(dateObj).toISOString().split('T')[0] + 'T00:00:00Z';
      break;
    default:
      cycleStart = startOfMonth(dateObj).toISOString().split('T')[0] + 'T00:00:00Z';
  }

  const nextCycle = getNextCycleDate(cycleStart, billingCycle);
  return {
    effectiveDate: String(cycleStart),
    periodStart: String(cycleStart),
    periodEnd: nextCycle.periodEnd
  };
}

async function createBillingCycle(
  knex: Knex,
  cycle: Partial<IClientContractLineCycle> & { effective_date: ISO8601String }
): Promise<BillingCycleCreationResult> {
  // Validate that input date is UTC midnight
  const dateObj = parseISO(cycle.effective_date);
  if (
    dateObj.getUTCHours() !== 0 ||
    dateObj.getUTCMinutes() !== 0 ||
    dateObj.getUTCSeconds() !== 0 ||
    dateObj.getUTCMilliseconds() !== 0
  ) {
    throw new Error(`Input date must be UTC midnight. Got: ${cycle.effective_date}`);
  }

  // Validate ISO8601 format
  if (!cycle.effective_date.endsWith('Z')) {
    throw new Error(`Input date must be UTC ISO8601 format ending with Z. Got: ${cycle.effective_date}`);
  }

  const cycleDates = getNextCycleDate(cycle.effective_date, cycle.billing_cycle!);

  const fullCycle: Partial<IClientContractLineCycle> = {
    ...cycle,
    period_start_date: cycleDates.periodStart,
    period_end_date: cycleDates.periodEnd
  };

  // Check for existing cycle
  const existingCycle = await knex('client_billing_cycles')
    .where({
      client_id: cycle.client_id,
      effective_date: cycle.effective_date,
      tenant: cycle.tenant
    })
    .first()
    .select('period_end_date');

  if (existingCycle) {
    // Duplicate detected: return user-friendly error and suggest next available date
    // Ensure period_end_date is a string before parsing
    const endDateString = isDateObject(existingCycle.period_end_date)
      ? existingCycle.period_end_date.toISOString()
      : String(existingCycle.period_end_date);
    let nextDate = parseISO(endDateString);
    nextDate.setDate(nextDate.getDate() + 1); // Start from day after period ends
    console.log('[createBillingCycle] Incremented nextDate:', nextDate, 'type:', typeof nextDate, 'instanceof Date:', nextDate instanceof Date);
    let found = false;
    const maxAttempts = 30; // Limit search to 30 days to prevent infinite loop
    let attempts = 0;
    let nextDateStr = nextDate.toISOString().split('T')[0] + 'T00:00:00Z';

    while (!found && attempts < maxAttempts) {
      const nextDateStr = new Date(Date.UTC(
        nextDate.getUTCFullYear(),
        nextDate.getUTCMonth(),
        nextDate.getUTCDate(),
        0, 0, 0
      )).toISOString(); // Ensure UTC format ending with Z

      const conflictingCycle = await knex('client_billing_cycles')
        .where({
          client_id: cycle.client_id,
          effective_date: nextDateStr,
          tenant: cycle.tenant
        })
        .first();

      if (!conflictingCycle) {
        found = true;
        break;
      }

      // Move to next day
      nextDate.setDate(nextDate.getDate() + 1);
      nextDate.setDate(nextDate.getDate() + 1);
      attempts++;
    }

    const userMessage = 'A billing period for this date already exists. Please select a different date.';

    if (found) {
      return {
        success: false,
        error: 'duplicate',
        message: userMessage,
        suggestedDate: nextDateStr
      };
    }

    // If we couldn't find a date within maxAttempts, suggest the next day after maxAttempts
    const suggestedDate = new Date(existingCycle.period_end_date);
    suggestedDate.setDate(suggestedDate.getDate() + maxAttempts + 1);
    return {
      success: false,
      error: 'duplicate',
      message: userMessage,
      suggestedDate: suggestedDate.toISOString().split('T')[0] + 'T00:00:00Z'
    };
  }

  try {
    await knex('client_billing_cycles').insert(fullCycle);
    console.log(`Created billing cycle for client ${cycle.client_id} from ${fullCycle.period_start_date} to ${fullCycle.period_end_date}`);
    return { success: true };
  } catch (error: unknown) {
    if (error instanceof Error && 'constraint' in error && error.constraint === 'client_billing_cycles_client_id_effective_date_unique') {
      // Handle race condition - another cycle was created between our check and insert
      const nextDate = new Date(cycle.effective_date);
      nextDate.setDate(nextDate.getDate() + 1);
      return {
        success: false,
        error: 'duplicate',
        message: 'A billing period for this date already exists. Please select a different date.',
        suggestedDate: nextDate.toISOString().split('T')[0] + 'T00:00:00Z'
      };
    }
    console.error(`Error creating billing cycle:`, error);
    throw error;
  }
}

/**
 * Type guard to check if a value is a Date object.
 */
function isDateObject(val: unknown): val is Date {
  return Object.prototype.toString.call(val) === '[object Date]';
}

export async function createClientContractLineCycles(
  knex: Knex,
  client: IClient,
  options: { manual?: boolean; effectiveDate?: string } = {}
): Promise<BillingCycleCreationResult> {
  console.log('Starting billing cycle creation for client:', {
    client_id: client.client_id,
    billing_cycle: client.billing_cycle
  });

  const lastCycle = await knex('client_billing_cycles')
    .where({
      client_id: client.client_id,
      tenant: client.tenant
    })
    .orderBy('effective_date', 'desc')
    .first()
    .select('effective_date') as IClientContractLineCycle;

  const now = new Date().toISOString().split('T')[0] + 'T00:00:00Z';

  if (!lastCycle) {
    console.log('No existing cycles found - creating initial cycle');
    const initialCycle = options.effectiveDate ?
      getStartOfCurrentCycle(options.effectiveDate, client.billing_cycle) :
      getStartOfCurrentCycle(now, client.billing_cycle);
    console.log('Initial cycle details:', initialCycle);
    console.log('Creating initial billing cycle');
    const result = await createBillingCycle(knex, {
      client_id: client.client_id,
      billing_cycle: client.billing_cycle,
      effective_date: initialCycle.effectiveDate,
      tenant: client.tenant
    });

    if (!result.success) {
      return result;
    }

    console.log('Initial billing cycle created successfully');

    let currentCycle = initialCycle;
    let iterations = 0;
    const MAX_ITERATIONS = 100; // Safety limit

    console.log('Starting cycle creation loop');
    while (parseISO(currentCycle.periodEnd) < parseISO(now) && iterations < MAX_ITERATIONS) {
      console.log(`Creating cycle ${iterations + 1} of ${MAX_ITERATIONS}`);
      const nextCycle = getNextCycleDate(currentCycle.periodEnd, client.billing_cycle);
      const previousEnd = currentCycle.periodEnd;

      if (parseISO(nextCycle.periodEnd) <= parseISO(previousEnd)) {
        const error = new Error('Period end date not advancing properly: '+ JSON.stringify({
          previousEnd,
          nextEnd: nextCycle.periodEnd,
          billingCycle: client.billing_cycle
        }));
        console.error(error);
        throw error;
      }

      iterations++;
      console.log('Creating billing cycle:', {
        effective_date: nextCycle.effectiveDate,
        period_end: nextCycle.periodEnd
      });
      const result = await createBillingCycle(knex, {
        client_id: client.client_id,
        billing_cycle: client.billing_cycle,
        effective_date: nextCycle.effectiveDate,
        tenant: client.tenant
      });

      if (!result.success) {
        return result;
      }

      console.log('Billing cycle created successfully');
      currentCycle = nextCycle;
    }
    console.log('Completed initial cycle creation');
    return { success: true };
  }

  const effectiveDate: unknown = lastCycle.effective_date;
  // Ensure effectiveDate is a string (normalize if Date object)
  let normalizedEffectiveDate: string;
  if (typeof effectiveDate === 'string') {
    normalizedEffectiveDate = effectiveDate;
  } else if (isDateObject(effectiveDate)) {
    normalizedEffectiveDate = effectiveDate.toISOString();
  } else if (effectiveDate !== undefined && effectiveDate !== null) {
    normalizedEffectiveDate = String(effectiveDate);
  } else {
    throw new Error('Invalid effectiveDate: value is undefined or null');
  }
  let currentCycle = getNextCycleDate(normalizedEffectiveDate, client.billing_cycle);

  if (options.manual) {
    // In manual mode, use the same logic as automatic mode
    const result = await createBillingCycle(knex, {
      client_id: client.client_id,
      billing_cycle: client.billing_cycle,
      effective_date: currentCycle.effectiveDate,
      tenant: client.tenant
    });

    if (!result.success) {
      return result;
    }

    // Update current cycle and continue checking
    currentCycle = getNextCycleDate(currentCycle.periodEnd, client.billing_cycle);
    return { success: true };
  }

  // In automatic mode, backfill cycles up to current date
  let iterations = 0;
  const MAX_ITERATIONS = 100; // Safety limit

  while (parseISO(currentCycle.periodEnd) < parseISO(now) && iterations < MAX_ITERATIONS) {
    const nextCycle = getNextCycleDate(currentCycle.periodEnd, client.billing_cycle);
    const previousEnd = currentCycle.periodEnd;

    if (parseISO(nextCycle.periodEnd) <= parseISO(previousEnd)) {
      const error = new Error('Period end date not advancing properly: '+ JSON.stringify({
        previousEnd,
        nextEnd: nextCycle.periodEnd,
        billingCycle: client.billing_cycle
      }));
      console.error(error);
      throw error;
    }

    iterations++;
    const result = await createBillingCycle(knex, {
      client_id: client.client_id,
      billing_cycle: client.billing_cycle,
      effective_date: nextCycle.effectiveDate,
      tenant: client.tenant
    });

    if (!result.success) {
      return result;
    }

    currentCycle = nextCycle;
  }

  return { success: true };
}

export { getNextCycleDate, getStartOfCurrentCycle };
