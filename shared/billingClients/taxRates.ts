import type { Knex } from 'knex';
import { v4 as uuid4 } from 'uuid';
import type { ITaxRate, ITaxRegion, ISO8601String } from '@alga-psa/types';

function isDateObject(val: unknown): val is Date {
  return Object.prototype.toString.call(val) === '[object Date]';
}

function normalizeDbIsoUtcMidnight(value: unknown): ISO8601String {
  if (typeof value === 'string') {
    return value as ISO8601String;
  }
  if (isDateObject(value)) {
    return value.toISOString() as ISO8601String;
  }
  return String(value) as ISO8601String;
}

export async function validateTaxRateDateRange(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  regionCode: string,
  startDate: ISO8601String,
  endDate: ISO8601String | null,
  excludeTaxRateId?: string
): Promise<void> {
  const query = knexOrTrx('tax_rates')
    .where({
      region_code: regionCode,
      tenant
    })
    .andWhere(function () {
      this.where(function () {
        this.whereNull('end_date').andWhere('start_date', '<', endDate || startDate);
      }).orWhere(function () {
        this.whereNotNull('end_date')
          .andWhere('start_date', '<', endDate || startDate)
          .andWhere('end_date', '>', startDate);
      });
    });

  if (excludeTaxRateId) {
    query.andWhereNot('tax_rate_id', excludeTaxRateId);
  }

  const overlappingRates = await query;
  if (overlappingRates.length > 0) {
    throw new Error(`Tax rate date range overlaps with existing rate(s) in region ${regionCode}`);
  }
}

export async function getTaxRates(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string
): Promise<ITaxRate[]> {
  return knexOrTrx<ITaxRate>('tax_rates').where({ tenant }).select('*');
}

export async function addTaxRate(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  taxRateData: Omit<ITaxRate, 'tax_rate_id'>
): Promise<ITaxRate> {
  if (!taxRateData.region_code) {
    throw new Error('Region is required');
  }

  await validateTaxRateDateRange(
    knexOrTrx,
    tenant,
    taxRateData.region_code,
    normalizeDbIsoUtcMidnight(taxRateData.start_date),
    taxRateData.end_date ? normalizeDbIsoUtcMidnight(taxRateData.end_date) : null
  );

  const tax_rate_id = uuid4();
  const [newTaxRate] = await knexOrTrx('tax_rates')
    .insert({ ...taxRateData, tax_rate_id, tenant })
    .returning('*');
  return newTaxRate as ITaxRate;
}

export async function getActiveTaxRegions(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string
): Promise<Pick<ITaxRegion, 'region_code' | 'region_name'>[]> {
  return knexOrTrx<ITaxRegion>('tax_regions')
    .select('region_code', 'region_name')
    .where('is_active', true)
    .where('tenant', tenant)
    .orderBy('region_name', 'asc');
}

