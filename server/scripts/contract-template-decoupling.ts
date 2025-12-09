#!/usr/bin/env tsx

import knex, { Knex } from 'knex';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { cloneTemplateContractLine } from '../src/lib/billing/utils/templateClone';

const require = createRequire(import.meta.url);
const knexConfig = require('../knexfile.cjs');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type ClientContractRow = {
  client_contract_id: string;
  contract_id: string;
  template_contract_id: string | null;
  tenant: string;
};

type ClientContractLineRow = {
  client_contract_line_id: string;
  client_contract_id: string | null;
  contract_line_id: string;
  template_contract_line_id: string | null;
  custom_rate: number | string | null;
  start_date: string | null;
  tenant: string;
};

async function migrateTenant(trx: Knex.Transaction, tenant: string) {
  const clientContracts = await trx<ClientContractRow>('client_contracts')
    .where({ tenant })
    .select('client_contract_id', 'contract_id', 'template_contract_id', 'tenant');

  if (clientContracts.length === 0) {
    return;
  }

  const contractMap = new Map<string, ClientContractRow>();
  for (const contract of clientContracts) {
    contractMap.set(contract.client_contract_id, contract);
    if (!contract.template_contract_id && contract.contract_id) {
      await trx('client_contracts')
        .where({ tenant, client_contract_id: contract.client_contract_id })
        .update({
          template_contract_id: contract.contract_id,
          updated_at: trx.fn.now()
        });
    }
  }

  const assignments = await trx<ClientContractLineRow>('client_contract_lines')
    .where({ tenant })
    .select(
      'client_contract_line_id',
      'client_contract_id',
      'contract_line_id',
      'template_contract_line_id',
      'custom_rate',
      'start_date',
      'tenant'
    );

  for (const assignment of assignments) {
    const templateContractLineId = assignment.contract_line_id;
    if (!templateContractLineId) {
      continue;
    }

    if (!assignment.template_contract_line_id) {
      await trx('client_contract_lines')
        .where({
          tenant,
          client_contract_line_id: assignment.client_contract_line_id
        })
        .update({
          template_contract_line_id: templateContractLineId,
          updated_at: trx.fn.now()
        });
    }

    const clientContract =
      assignment.client_contract_id != null
        ? contractMap.get(assignment.client_contract_id)
        : undefined;

    const templateContractId = clientContract?.template_contract_id ?? clientContract?.contract_id ?? null;

    // Use contract_line_id (which is the actual contract_lines record)
    // not client_contract_line_id (which was the deprecated mapping table)
    await cloneTemplateContractLine(trx, {
      tenant,
      templateContractLineId,
      contractLineId: assignment.contract_line_id,
      templateContractId,
      overrideRate: assignment.custom_rate != null ? Number(assignment.custom_rate) : null,
      effectiveDate: assignment.start_date
    });
  }
}

async function run() {
  const environment = process.env.NODE_ENV || 'development';
  const knexInstance = knex(knexConfig[environment]);

  try {
    const tenants = await knexInstance('tenants').select('tenant');

    console.log(`Found ${tenants.length} tenants – starting template decoupling migration`);

    for (const record of tenants) {
      const tenantId = record.tenant;
      console.log(`\nProcessing tenant ${tenantId}`);

      await knexInstance.transaction(async (trx) => {
        await migrateTenant(trx, tenantId);
      });

      console.log(`Tenant ${tenantId} migration completed`);
    }

    console.log('\nContract template decoupling data migration complete.');
  } catch (error) {
    console.error('Data migration failed:', error);
    process.exitCode = 1;
  } finally {
    await knexInstance.destroy();
  }
}

run();
