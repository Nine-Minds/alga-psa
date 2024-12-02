import { Knex } from 'knex';
import { ICompanyBillingCycle, BillingCycleType } from '@/interfaces/billing.interfaces';
import { ICompany } from '@/interfaces/company.interfaces';
import { addWeeks, addMonths, parseISO } from 'date-fns';
import { ISO8601String } from '@/types/types.d';

function getNextCycleDate(currentDate: Date, billingCycle: string): { 
  effectiveDate: Date;
  periodStart: Date;
  periodEnd: Date;
} {
  const effectiveDate = new Date(currentDate);
  effectiveDate.setHours(0, 0, 0, 0);
  
  let periodEnd: Date;
  
  switch (billingCycle) {
    case 'weekly':
      periodEnd = addWeeks(effectiveDate, 1);
      break;
    case 'bi-weekly':
      periodEnd = addWeeks(effectiveDate, 2);
      break;
    case 'monthly':
      periodEnd = addMonths(effectiveDate, 1);
      break;
    case 'quarterly':
      periodEnd = addMonths(effectiveDate, 3);
      break;
    case 'semi-annually':
      periodEnd = addMonths(effectiveDate, 6);
      break;
    case 'annually':
      periodEnd = addMonths(effectiveDate, 12);
      break;
    default:
      periodEnd = addMonths(effectiveDate, 1);
  }

  // No subtraction of milliseconds - end date is exclusive
  return {
    effectiveDate,
    periodStart: effectiveDate,
    periodEnd
  };
}

function getStartOfCurrentCycle(date: Date, billingCycle: string): {
  effectiveDate: Date;
  periodStart: Date;
  periodEnd: Date;
} {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  let cycleStart: Date;

  switch (billingCycle) {
    case 'weekly': {
      const day = startOfDay.getDay();
      cycleStart = new Date(startOfDay.setDate(startOfDay.getDate() - day));
      break;
    }
    case 'bi-weekly': {
      const day = startOfDay.getDay();
      const date = startOfDay.getDate();
      const weekStart = new Date(startOfDay.setDate(date - day));
      const weekOfMonth = Math.ceil(weekStart.getDate() / 7);
      const weeksToSubtract = weekOfMonth % 2 === 0 ? 1 : 0;
      cycleStart = new Date(weekStart.setDate(weekStart.getDate() - (7 * weeksToSubtract)));
      break;
    }
    case 'monthly':
      cycleStart = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);
      break;
    case 'quarterly': {
      const currentQuarter = Math.floor(startOfDay.getMonth() / 3);
      cycleStart = new Date(startOfDay.getFullYear(), currentQuarter * 3, 1);
      break;
    }
    case 'semi-annually': {
      const isSecondHalf = startOfDay.getMonth() >= 6;
      cycleStart = new Date(startOfDay.getFullYear(), isSecondHalf ? 6 : 0, 1);
      break;
    }
    case 'annually':
      cycleStart = new Date(startOfDay.getFullYear(), 0, 1);
      break;
    default:
      cycleStart = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);
  }

  const nextCycle = getNextCycleDate(cycleStart, billingCycle);
  return {
    effectiveDate: cycleStart,
    periodStart: cycleStart,
    periodEnd: nextCycle.periodEnd // This is exclusive - equals start of next period
  };
}

async function createBillingCycle(knex: Knex, cycle: Partial<ICompanyBillingCycle> & { 
  effective_date: ISO8601String 
}) {
  const cycleDates = getNextCycleDate(new Date(cycle.effective_date), cycle.billing_cycle!);
  
  const fullCycle: Partial<ICompanyBillingCycle> = {
    ...cycle,
    period_start_date: cycleDates.periodStart.toISOString(),
    period_end_date: cycleDates.periodEnd.toISOString()
  };

  try {
    await knex('company_billing_cycles').insert(fullCycle);
    console.log(`Created billing cycle for company ${cycle.company_id} from ${fullCycle.period_start_date} to ${fullCycle.period_end_date}`);
  } catch (error) {
    console.error(`Error creating billing cycle: ${error}`);
  }
}

export async function createCompanyBillingCycles(knex: Knex, company: ICompany) {
  const lastCycle = await knex('company_billing_cycles')
    .where({ company_id: company.company_id })
    .orderBy('effective_date', 'desc')
    .first() as ICompanyBillingCycle;

  const now = new Date();
  
  if (!lastCycle) {
    const initialCycle = getStartOfCurrentCycle(now, company.billing_cycle);
    await createBillingCycle(knex, {
      company_id: company.company_id,
      billing_cycle: company.billing_cycle,
      effective_date: initialCycle.effectiveDate.toISOString(),
      tenant: company.tenant
    });
    
    let currentDate = initialCycle.effectiveDate;
    while (currentDate < now) {
      const nextCycle = getNextCycleDate(currentDate, company.billing_cycle);
      currentDate = nextCycle.effectiveDate;
      if (currentDate <= now) {
        await createBillingCycle(knex, {
          company_id: company.company_id,
          billing_cycle: company.billing_cycle,
          effective_date: currentDate.toISOString(),
          tenant: company.tenant
        });
      }
    }
    return;
  }

  let currentDate = parseISO(lastCycle.effective_date);
  while (currentDate < now) {
    const nextCycle = getNextCycleDate(currentDate, company.billing_cycle);
    currentDate = nextCycle.effectiveDate;
    if (currentDate <= now) {
      await createBillingCycle(knex, {
        company_id: company.company_id,
        billing_cycle: company.billing_cycle,
        effective_date: currentDate.toISOString(),
        tenant: company.tenant
      });
    }
  }
}

export { getNextCycleDate, getStartOfCurrentCycle };
