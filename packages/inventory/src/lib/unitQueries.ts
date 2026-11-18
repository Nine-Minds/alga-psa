import { Knex } from 'knex';
import { IStockMovement, IStockUnit, StockUnitStatus } from '@alga-psa/types';

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function stockUnitsWithNames(trx: Knex.Transaction, tenant: string) {
  return trx('stock_units as su')
    .leftJoin('stock_locations as sl', function () {
      this.on('su.location_id', '=', 'sl.location_id').andOn('su.tenant', '=', 'sl.tenant');
    })
    .leftJoin('clients as c', function () {
      this.on('su.client_id', '=', 'c.client_id').andOn('su.tenant', '=', 'c.tenant');
    })
    .leftJoin('service_catalog as sc', function () {
      this.on('su.service_id', '=', 'sc.service_id').andOn('su.tenant', '=', 'sc.tenant');
    })
    // Who an `allocated` unit is claimed by: a sales order or a project's staging (C6).
    .leftJoin('sales_order_lines as asol', function () {
      this.on('su.allocated_so_line_id', '=', 'asol.so_line_id').andOn('su.tenant', '=', 'asol.tenant');
    })
    .leftJoin('sales_orders as aso', function () {
      this.on('asol.so_id', '=', 'aso.so_id').andOn('asol.tenant', '=', 'aso.tenant');
    })
    .leftJoin('project_staging_lines as apsl', function () {
      this.on('su.allocated_staging_line_id', '=', 'apsl.staging_line_id').andOn('su.tenant', '=', 'apsl.tenant');
    })
    .leftJoin('projects as ap', function () {
      this.on('apsl.project_id', '=', 'ap.project_id').andOn('apsl.tenant', '=', 'ap.tenant');
    })
    .where({ 'su.tenant': tenant })
    .select(
      'su.*',
      'sl.name as location_name',
      'c.client_name',
      'sc.service_name as product_name',
      'aso.so_number as allocated_so_number',
      'ap.project_id as allocated_project_id',
      'ap.project_number as allocated_project_number',
    );
}

export async function queryStockUnits(
  trx: Knex.Transaction,
  tenant: string,
  filter?: { service_id?: string; status?: StockUnitStatus; location_id?: string; client_id?: string },
): Promise<IStockUnit[]> {
  const query = stockUnitsWithNames(trx, tenant);
  if (filter?.service_id) query.andWhere({ 'su.service_id': filter.service_id });
  if (filter?.status) query.andWhere({ 'su.status': filter.status });
  if (filter?.location_id) query.andWhere({ 'su.location_id': filter.location_id });
  if (filter?.client_id) query.andWhere({ 'su.client_id': filter.client_id });
  return (await query.orderBy('su.received_at', 'desc')) as IStockUnit[];
}

export interface FindStockUnitsInput {
  serial?: string;
  mac?: string;
  status?: StockUnitStatus;
  location_id?: string;
  service_id?: string;
  limit?: number;
}

/** Tenant-scoped combined unit search used by non-session callers such as workflows. */
export async function findStockUnits(
  trx: Knex.Transaction,
  tenant: string,
  input: FindStockUnitsInput = {},
): Promise<IStockUnit[]> {
  const query = stockUnitsWithNames(trx, tenant);
  const serial = (input.serial ?? '').trim();
  const mac = (input.mac ?? '').trim();
  if (serial) {
    query.andWhereRaw('su.serial_number ILIKE ? ESCAPE ?', [`%${escapeLike(serial)}%`, '\\']);
  }
  if (mac) {
    query
      .whereNotNull('su.mac_address')
      .andWhereRaw('su.mac_address ILIKE ? ESCAPE ?', [`%${escapeLike(mac)}%`, '\\']);
  }
  if (input.status) query.andWhere({ 'su.status': input.status });
  if (input.location_id) query.andWhere({ 'su.location_id': input.location_id });
  if (input.service_id) query.andWhere({ 'su.service_id': input.service_id });
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 25), 1), 50);
  return (await query.orderBy('su.received_at', 'desc').limit(limit)) as IStockUnit[];
}

export async function queryUnitsBySerial(
  trx: Knex.Transaction,
  tenant: string,
  search: string,
): Promise<IStockUnit[]> {
  const term = (search ?? '').trim();
  if (!term) return [];
  return (await stockUnitsWithNames(trx, tenant)
    .whereRaw('su.serial_number ILIKE ? ESCAPE ?', [`%${escapeLike(term)}%`, '\\'])
    .orderBy('su.received_at', 'desc')) as IStockUnit[];
}

export async function queryUnitsByMac(
  trx: Knex.Transaction,
  tenant: string,
  search: string,
): Promise<IStockUnit[]> {
  const term = (search ?? '').trim();
  if (!term) return [];
  return (await stockUnitsWithNames(trx, tenant)
    .whereNotNull('su.mac_address')
    .whereRaw('su.mac_address ILIKE ? ESCAPE ?', [`%${escapeLike(term)}%`, '\\'])
    .orderBy('su.received_at', 'desc')) as IStockUnit[];
}

export async function queryInStockUnits(
  trx: Knex.Transaction,
  tenant: string,
  input?: { search?: string; page?: number; limit?: number },
): Promise<{ units: IStockUnit[]; total: number }> {
  const term = (input?.search ?? '').trim();
  const limit = Math.min(Math.max(Math.trunc(input?.limit ?? 10), 1), 100);
  const page = Math.max(Math.trunc(input?.page ?? 1), 1);
  const applyFilters = <T extends Knex.QueryBuilder>(query: T): T => {
    query.andWhere({ 'su.status': 'in_stock' });
    if (term) {
      const pattern = `%${escapeLike(term)}%`;
      query.andWhere((builder) => {
        builder.whereRaw('su.serial_number ILIKE ? ESCAPE ?', [pattern, '\\']).orWhereRaw(
          'su.mac_address ILIKE ? ESCAPE ?',
          [pattern, '\\'],
        );
      });
    }
    return query;
  };
  const countRow = await applyFilters(trx('stock_units as su').where({ 'su.tenant': tenant }))
    .count<{ count: string }>('* as count')
    .first();
  const units = (await applyFilters(stockUnitsWithNames(trx, tenant))
    .orderBy('su.serial_number', 'asc')
    .limit(limit)
    .offset((page - 1) * limit)) as IStockUnit[];
  return { units, total: Number(countRow?.count ?? 0) };
}

export async function queryUnitDetail(
  trx: Knex.Transaction,
  tenant: string,
  unitId: string,
): Promise<{ unit: IStockUnit; movements: IStockMovement[] } | null> {
  const unit = (await trx('stock_units').where({ tenant, unit_id: unitId }).first()) as IStockUnit | undefined;
  if (!unit) return null;
  const movements = (await trx('stock_movements')
    .where({ tenant, unit_id: unitId })
    .orderBy('created_at', 'asc')) as IStockMovement[];
  return { unit, movements };
}
