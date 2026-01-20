import type { Knex } from 'knex';
import type { IContractLine, IContractLineService } from '@alga-psa/types';

async function findTemplateLine(trx: Knex | Knex.Transaction, tenant: string, contractLineId: string) {
  return trx('contract_template_lines').where({ tenant, template_line_id: contractLineId }).first();
}

function mapTemplateServiceRow(row: any): IContractLineService {
  return {
    tenant: row.tenant,
    contract_line_id: row.template_line_id,
    service_id: row.service_id,
    quantity: row.quantity != null ? Number(row.quantity) : undefined,
    custom_rate: row.custom_rate != null ? Number(row.custom_rate) : undefined,
  };
}

export async function getContractLines(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string
): Promise<IContractLine[]> {
  const rows = await knexOrTrx<IContractLine>('contract_lines')
    .where({ tenant })
    .select('*')
    .orderBy('contract_line_name', 'asc');

  return rows.map((row) => ({
    ...row,
    billing_timing: (row.billing_timing ?? 'arrears') as 'arrears' | 'advance',
  }));
}

export async function getContractLineServices(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  contractLineId: string
): Promise<IContractLineService[]> {
  const templateLine = await findTemplateLine(knexOrTrx, tenant, contractLineId);
  if (templateLine) {
    const services = await knexOrTrx('contract_template_line_services')
      .where({ template_line_id: contractLineId, tenant })
      .select('*');
    return services.map(mapTemplateServiceRow);
  }

  const services = await knexOrTrx('contract_line_services')
    .where({ contract_line_id: contractLineId, tenant })
    .select('*');

  return services as IContractLineService[];
}

