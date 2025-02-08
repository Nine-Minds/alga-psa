import { Knex } from 'knex';
import { ICompanyBillingCycle } from '@/interfaces/billing.interfaces';
import { ICompany } from '@/interfaces/company.interfaces';
import { 
  addWeeks, 
  addMonths, 
  parseISO, 
  startOfDay,
  startOfMonth,
  startOfYear,
  getMonth,
  getDate,
  setMonth,
  subWeeks,
  formatISO
} from 'date-fns';
import { ISO8601String } from '@/types/types.d';

function getNextCycleDate(currentDate: ISO8601String, billingCycle: string): {
  effectiveDate: ISO8601String;
  periodStart: ISO8601String;
  periodEnd: ISO8601String;
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
  
  let periodEnd: ISO8601String;
  
  const formatUTCDate = (date: Date): string => {
    return new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0, 0, 0
    )).toISOString();
  };

  switch (billingCycle) {
    case 'weekly':
      periodEnd = formatUTCDate(addWeeks(parseISO(effectiveDate), 1));
      break;
    case 'bi-weekly':
      periodEnd = formatUTCDate(addWeeks(parseISO(effectiveDate), 2));
      break;
    case 'monthly':
      periodEnd = formatUTCDate(addMonths(parseISO(effectiveDate), 1));
      break;
    case 'quarterly':
      periodEnd = formatUTCDate(addMonths(parseISO(effectiveDate), 3));
      break;
    case 'semi-annually':
      periodEnd = formatUTCDate(addMonths(parseISO(effectiveDate), 6));
      break;
    case 'annually':
      periodEnd = formatUTCDate(addMonths(parseISO(effectiveDate), 12));
      break;
    default:
      periodEnd = formatUTCDate(addMonths(parseISO(effectiveDate), 1));
  }

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
  effectiveDate: ISO8601String;
  periodStart: ISO8601String;
  periodEnd: ISO8601String;
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

  switch (billingCycle) {
    case 'weekly': {
      const startOfWeek = startOfDay(parsedDate);
      cycleStart = startOfWeek.toISOString().split('T')[0] + 'T00:00:00Z';
      break;
    }
    case 'bi-weekly': {
      const startOfWeek = startOfDay(parsedDate);
      const weekOfMonth = Math.ceil(getDate(startOfWeek) / 7);
      const weeksToSubtract = weekOfMonth % 2 === 0 ? 1 : 0;
      cycleStart = subWeeks(startOfWeek, weeksToSubtract).toISOString().split('T')[0] + 'T00:00:00Z';
      break;
    }
    case 'monthly':
      cycleStart = startOfMonth(parsedDate).toISOString().split('T')[0] + 'T00:00:00Z';
      break;
    case 'quarterly': {
      const currentQuarter = Math.floor(getMonth(parsedDate) / 3);
      cycleStart = startOfMonth(setMonth(parsedDate, currentQuarter * 3)).toISOString().split('T')[0] + 'T00:00:00Z';
      break;
    }
    case 'semi-annually': {
      const isSecondHalf = getMonth(parsedDate) >= 6;
      cycleStart = startOfMonth(setMonth(parsedDate, isSecondHalf ? 6 : 0)).toISOString().split('T')[0] + 'T00:00:00Z';
      break;
    }
    case 'annually':
      cycleStart = startOfYear(parsedDate).toISOString().split('T')[0] + 'T00:00:00Z';
      break;
    default:
      cycleStart = startOfMonth(parsedDate).toISOString().split('T')[0] + 'T00:00:00Z';
  }

  const nextCycle = getNextCycleDate(cycleStart, billingCycle);
  return {
    effectiveDate: cycleStart,
    periodStart: cycleStart,
    periodEnd: nextCycle.periodEnd
  };
}

async function createBillingCycle(knex: Knex, cycle: Partial<ICompanyBillingCycle> & { 
  effective_date: ISO8601String 
}): Promise<{
  success: boolean;
  suggestedDate?: ISO8601String;
}> {
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
  
  const fullCycle: Partial<ICompanyBillingCycle> = {
    ...cycle,
    period_start_date: cycleDates.periodStart,
    period_end_date: cycleDates.periodEnd
  };

  // Check for existing cycle
  const existingCycle = await knex('company_billing_cycles')
    .where({
      company_id: cycle.company_id,
      effective_date: cycle.effective_date,
      tenant: cycle.tenant
    })
    .first()
    .select('period_end_date');

  if (existingCycle) {
    // Find next available date starting from period_end_date + 1 day
    let nextDate = parseISO(existingCycle.period_end_date);
    nextDate.setDate(nextDate.getDate() + 1); // Start from day after period ends
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
      
      const conflictingCycle = await knex('company_billing_cycles')
        .where({
          company_id: cycle.company_id,
          effective_date: nextDateStr,
          tenant: cycle.tenant
        })
        .first();
      
      if (!conflictingCycle) {
        // Found an available date - break out of loop
        found = true;
        break;
      }
      
      // Move to next day
      nextDate.setDate(nextDate.getDate() + 1);
      attempts++;
    }

    if (found) {
      // Use existing creation logic with the found date
      return await createBillingCycle(knex, {
        company_id: cycle.company_id,
        billing_cycle: cycle.billing_cycle,
        effective_date: nextDateStr,
        tenant: cycle.tenant
      });
    }

    // If we couldn't find a date within maxAttempts, suggest the next day after maxAttempts
    const suggestedDate = new Date(existingCycle.period_end_date);
    suggestedDate.setDate(suggestedDate.getDate() + maxAttempts + 1);
    return {
      success: false,
      suggestedDate: suggestedDate.toISOString().split('T')[0] + 'T00:00:00Z'
    };
  }

  try {
    await knex('company_billing_cycles').insert(fullCycle);
    console.log(`Created billing cycle for company ${cycle.company_id} from ${fullCycle.period_start_date} to ${fullCycle.period_end_date}`);
    return { success: true };
  } catch (error: unknown) {
    if (error instanceof Error && 'constraint' in error && error.constraint === 'company_billing_cycles_company_id_effective_date_unique') {
      // Handle race condition - another cycle was created between our check and insert
      const nextDate = new Date(cycle.effective_date);
      nextDate.setDate(nextDate.getDate() + 1);
      return {
        success: false,
        suggestedDate: nextDate.toISOString().split('T')[0] + 'T00:00:00Z'
      };
    }
    console.error(`Error creating billing cycle:`, error);
    throw error;
  }
}

export async function createCompanyBillingCycles(
  knex: Knex,
  company: ICompany,
  options: { manual?: boolean; effectiveDate?: string } = {}
) {
  console.log('Starting billing cycle creation for company:', {
    company_id: company.company_id,
    billing_cycle: company.billing_cycle
  });

  const lastCycle = await knex('company_billing_cycles')
    .where({ company_id: company.company_id })
    .orderBy('effective_date', 'desc')
    .first()
    .select('effective_date') as ICompanyBillingCycle;

  const now = new Date().toISOString().split('T')[0] + 'T00:00:00Z';
  
  if (!lastCycle) {
    console.log('No existing cycles found - creating initial cycle');
    const initialCycle = options.effectiveDate ?
      getStartOfCurrentCycle(options.effectiveDate, company.billing_cycle) :
      getStartOfCurrentCycle(now, company.billing_cycle);
    console.log('Initial cycle details:', initialCycle);
    console.log('Creating initial billing cycle');
    const result = await createBillingCycle(knex, {
      company_id: company.company_id,
      billing_cycle: company.billing_cycle,
      effective_date: initialCycle.effectiveDate,
      tenant: company.tenant
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
      const nextCycle = getNextCycleDate(currentCycle.periodEnd, company.billing_cycle);
      const previousEnd = currentCycle.periodEnd;
      
      if (parseISO(nextCycle.periodEnd) <= parseISO(previousEnd)) {
        const error = new Error('Period end date not advancing properly: '+ JSON.stringify({
          previousEnd,
          nextEnd: nextCycle.periodEnd,
          billingCycle: company.billing_cycle
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
        company_id: company.company_id,
        billing_cycle: company.billing_cycle,
        effective_date: nextCycle.effectiveDate,
        tenant: company.tenant
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

  const effectiveDate = lastCycle.effective_date;
  let currentCycle = getNextCycleDate(effectiveDate, company.billing_cycle);
  
  if (options.manual) {
    // In manual mode, use the same logic as automatic mode
    const result = await createBillingCycle(knex, {
      company_id: company.company_id,
      billing_cycle: company.billing_cycle,
      effective_date: currentCycle.effectiveDate,
      tenant: company.tenant
    });

    if (!result.success) {
      return result;
    }

    // Update current cycle and continue checking
    currentCycle = getNextCycleDate(currentCycle.periodEnd, company.billing_cycle);
    return { success: true };
  }

  // In automatic mode, backfill cycles up to current date
  let iterations = 0;
  const MAX_ITERATIONS = 100; // Safety limit
  
  while (parseISO(currentCycle.periodEnd) < parseISO(now) && iterations < MAX_ITERATIONS) {
    const nextCycle = getNextCycleDate(currentCycle.periodEnd, company.billing_cycle);
    const previousEnd = currentCycle.periodEnd;
    
    if (parseISO(nextCycle.periodEnd) <= parseISO(previousEnd)) {
      const error = new Error('Period end date not advancing properly: '+ JSON.stringify({
        previousEnd,
        nextEnd: nextCycle.periodEnd,
        billingCycle: company.billing_cycle
      }));
      console.error(error);
      throw error;
    }
    
    iterations++;
    const result = await createBillingCycle(knex, {
      company_id: company.company_id,
      billing_cycle: company.billing_cycle,
      effective_date: nextCycle.effectiveDate,
      tenant: company.tenant
    });

    if (!result.success) {
      return result;
    }

    currentCycle = nextCycle;
  }

  return { success: true };
}

export { getNextCycleDate, getStartOfCurrentCycle };
