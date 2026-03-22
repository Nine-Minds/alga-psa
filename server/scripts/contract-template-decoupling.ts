#!/usr/bin/env tsx

import knex from 'knex';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const knexConfig = require('../knexfile.cjs');

type TenantRecord = { tenant: string };

type ProvenanceAuditRow = {
  client_contract_id: string;
  contract_id: string;
  template_contract_id: string | null;
};

async function auditTenant(knexInstance: ReturnType<typeof knex>, tenant: string) {
  const rows = await knexInstance<ProvenanceAuditRow>('client_contracts')
    .where({ tenant })
    .select('client_contract_id', 'contract_id', 'template_contract_id');

  const missingTemplateProvenance = rows.filter((row) => !row.template_contract_id).length;

  return {
    totalAssignments: rows.length,
    missingTemplateProvenance,
  };
}

async function run() {
  const environment = process.env.NODE_ENV || 'development';
  const knexInstance = knex(knexConfig[environment]);

  try {
    const tenants = await knexInstance<TenantRecord>('tenants').select('tenant');

    console.log(
      `contract-template-decoupling.ts is now audit-only. No data backfill or template/runtime fallback mutation will be performed.`,
    );
    console.log(`Scanning ${tenants.length} tenant(s) for missing template provenance metadata.`);

    for (const record of tenants) {
      const result = await auditTenant(knexInstance, record.tenant);
      console.log(
        `[tenant=${record.tenant}] assignments=${result.totalAssignments} missing_template_contract_id=${result.missingTemplateProvenance}`,
      );
    }
  } catch (error) {
    console.error('Template provenance audit failed:', error);
    process.exitCode = 1;
  } finally {
    await knexInstance.destroy();
  }
}

run();
