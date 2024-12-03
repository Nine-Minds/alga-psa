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
  
  switch (billingCycle) {
    case 'weekly':
      periodEnd = formatISO(addWeeks(parseISO(effectiveDate), 1));
      break;
    case 'bi-weekly':
      periodEnd = formatISO(addWeeks(parseISO(effectiveDate), 2));
      break;
    case 'monthly':
      periodEnd = formatISO(addMonths(parseISO(effectiveDate), 1));
      break;
    case 'quarterly':
      periodEnd = formatISO(addMonths(parseISO(effectiveDate), 3));
      break;
    case 'semi-annually':
      periodEnd = formatISO(addMonths(parseISO(effectiveDate), 6));
      break;
    case 'annually':
      periodEnd = formatISO(addMonths(parseISO(effectiveDate), 12));
      break;
    default:
      periodEnd = formatISO(addMonths(parseISO(effectiveDate), 1));
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
}) {
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

  try {
    await knex('company_billing_cycles').insert(fullCycle);
    console.log(`Created billing cycle for company ${cycle.company_id} from ${fullCycle.period_start_date} to ${fullCycle.period_end_date}`);
  } catch (error) {
    console.error(`Error creating billing cycle: ${error}`);
    throw error;
  }
}

export async function createCompanyBillingCycles(knex: Knex, company: ICompany) {
  const lastCycle = await knex('company_billing_cycles')
    .where({ company_id: company.company_id })
    .orderBy('effective_date', 'desc')
    .first() as ICompanyBillingCycle;

  const now = new Date().toISOString().split('T')[0] + 'T00:00:00Z';
  
  if (!lastCycle) {
    const initialCycle = getStartOfCurrentCycle(now, company.billing_cycle);
    await createBillingCycle(knex, {
      company_id: company.company_id,
      billing_cycle: company.billing_cycle,
      effective_date: initialCycle.effectiveDate,
      tenant: company.tenant
    });
    
    let currentCycle = initialCycle;
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
      await createBillingCycle(knex, {
        company_id: company.company_id,
        billing_cycle: company.billing_cycle,
        effective_date: nextCycle.effectiveDate,
        tenant: company.tenant
      });
      currentCycle = nextCycle;
    }
    return;
  }

  let currentCycle = getNextCycleDate(lastCycle.effective_date, company.billing_cycle);
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
    await createBillingCycle(knex, {
      company_id: company.company_id,
      billing_cycle: company.billing_cycle,
      effective_date: nextCycle.effectiveDate,
      tenant: company.tenant
    });
    currentCycle = nextCycle;
  }
}

export { getNextCycleDate, getStartOfCurrentCycle };
