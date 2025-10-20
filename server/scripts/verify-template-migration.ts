#!/usr/bin/env tsx

import knexFactory, { Knex } from 'knex';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

type CountRow = { count: string | number }; // number when using sqlite, string in postgres

const require = createRequire(import.meta.url);

const knexfilePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../knexfile.cjs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const knexConfig = require(knexfilePath);

const environment = process.env.NODE_ENV || 'development';
const db = knexFactory(knexConfig[environment]);

type TenantRecord = { tenant: string };

type SummaryMismatch = {
  entity: 'templates' | 'template_lines' | 'template_services' | 'template_configs';
  tenant: string;
  legacy: number;
  separated: number;
};

type TemplateDiff = {
  tenant: string;
  contract_id: string;
  template_id?: string;
  contract_name: string | null;
  template_name?: string | null;
};

async function countQuery(query: Knex.QueryBuilder): Promise<number> {
  const result = await query.clone().count<{ count: string | number }>('* as count');
  const raw = result[0]?.count ?? 0;
  return typeof raw === 'string' ? Number(raw) : raw;
}

async function summarizeTenant(tenant: string): Promise<SummaryMismatch[]> {
  const mismatches: SummaryMismatch[] = [];

  const legacyTemplateCount = await countQuery(
    db('contracts').where({ tenant, is_template: true })
  );
  const newTemplateCount = await countQuery(db('contract_templates').where({ tenant }));
  if (legacyTemplateCount !== newTemplateCount) {
    mismatches.push({
      entity: 'templates',
      tenant,
      legacy: legacyTemplateCount,
      separated: newTemplateCount,
    });
  }

  const legacyLineCount = await countQuery(
    db('contract_line_mappings as map')
      .join('contracts as c', function joinTemplates() {
        this.on('map.contract_id', '=', 'c.contract_id').andOn('map.tenant', '=', 'c.tenant');
      })
      .where({ 'map.tenant': tenant, 'c.is_template': true })
  );
  const newLineCount = await countQuery(
    db('contract_template_line_mappings').where({ tenant })
  );
  if (legacyLineCount !== newLineCount) {
    mismatches.push({
      entity: 'template_lines',
      tenant,
      legacy: legacyLineCount,
      separated: newLineCount,
    });
  }

  const legacyServiceCount = await countQuery(
    db('contract_line_services as svc')
      .join('contract_line_mappings as map', function joinMappings() {
        this.on('svc.contract_line_id', '=', 'map.contract_line_id').andOn(
          'svc.tenant',
          '=',
          'map.tenant'
        );
      })
      .join('contracts as c', function joinTemplates() {
        this.on('map.contract_id', '=', 'c.contract_id').andOn('map.tenant', '=', 'c.tenant');
      })
      .where({ 'svc.tenant': tenant, 'c.is_template': true })
  );

  const newServiceCount = await countQuery(
    db('contract_template_line_services as svc')
      .join('contract_template_line_mappings as map', function joinMappings() {
        this.on('svc.template_line_id', '=', 'map.template_line_id').andOn(
          'svc.tenant',
          '=',
          'map.tenant'
        );
      })
      .where({ 'svc.tenant': tenant })
  );

  if (legacyServiceCount !== newServiceCount) {
    mismatches.push({
      entity: 'template_services',
      tenant,
      legacy: legacyServiceCount,
      separated: newServiceCount,
    });
  }

  const legacyConfigCount = await countQuery(
    db('contract_line_service_configuration as cfg')
      .join('contract_line_mappings as map', function joinMappings() {
        this.on('cfg.contract_line_id', '=', 'map.contract_line_id').andOn(
          'cfg.tenant',
          '=',
          'map.tenant'
        );
      })
      .join('contracts as c', function joinTemplates() {
        this.on('map.contract_id', '=', 'c.contract_id').andOn('map.tenant', '=', 'c.tenant');
      })
      .where({ 'cfg.tenant': tenant, 'c.is_template': true })
  );

  const newConfigCount = await countQuery(
    db('contract_template_line_service_configuration as cfg')
      .join('contract_template_line_mappings as map', function joinMappings() {
        this.on('cfg.template_line_id', '=', 'map.template_line_id').andOn(
          'cfg.tenant',
          '=',
          'map.tenant'
        );
      })
      .where({ 'cfg.tenant': tenant })
  );

  if (legacyConfigCount !== newConfigCount) {
    mismatches.push({
      entity: 'template_configs',
      tenant,
      legacy: legacyConfigCount,
      separated: newConfigCount,
    });
  }

  return mismatches;
}

async function collectNameDifferences(tenant: string): Promise<TemplateDiff[]> {
  const diffs: TemplateDiff[] = [];

  const legacyTemplates = await db('contracts')
    .where({ tenant, is_template: true })
    .select('contract_id', 'contract_name');

  const templateMap = new Map(
    legacyTemplates.map((tpl) => [tpl.contract_id, tpl.contract_name ?? null])
  );

  const newTemplates = await db('contract_templates')
    .where({ tenant })
    .select('template_id', 'template_name');

  for (const legacy of legacyTemplates) {
    const match = newTemplates.find((tpl) => tpl.template_id === legacy.contract_id);
    if (!match) {
      diffs.push({
        tenant,
        contract_id: legacy.contract_id,
        contract_name: legacy.contract_name ?? null,
        template_name: null,
      });
    } else if ((match.template_name ?? null) !== (legacy.contract_name ?? null)) {
      diffs.push({
        tenant,
        contract_id: legacy.contract_id,
        template_id: match.template_id,
        contract_name: legacy.contract_name ?? null,
        template_name: match.template_name ?? null,
      });
    }
  }

  for (const tpl of newTemplates) {
    if (!templateMap.has(tpl.template_id)) {
      diffs.push({
        tenant,
        contract_id: tpl.template_id,
        contract_name: null,
        template_name: tpl.template_name ?? null,
      });
    }
  }

  return diffs;
}

async function main() {
  try {
    const tenants = await db<TenantRecord>('tenants').select('tenant');
    if (tenants.length === 0) {
      console.log('No tenants found – nothing to compare.');
      return;
    }

    const allMismatches: SummaryMismatch[] = [];
    const allNameDiffs: TemplateDiff[] = [];

    for (const { tenant } of tenants) {
      const mismatches = await summarizeTenant(tenant);
      const diffs = await collectNameDifferences(tenant);

      allMismatches.push(...mismatches);
      allNameDiffs.push(...diffs);
    }

    if (allMismatches.length === 0 && allNameDiffs.length === 0) {
      console.log('✅ Template data parity check passed.');
      return;
    }

    console.log('⚠️  Template data discrepancies detected.');

    if (allMismatches.length > 0) {
      console.log('\nCount mismatches:');
      for (const mismatch of allMismatches) {
        console.log(
          ` - Tenant ${mismatch.tenant} :: ${mismatch.entity} legacy=${mismatch.legacy} new=${mismatch.separated}`
        );
      }
    }

    if (allNameDiffs.length > 0) {
      console.log('\nTemplate name/ID parity issues:');
      for (const diff of allNameDiffs) {
        console.log(
          ` - Tenant ${diff.tenant} :: legacy(${diff.contract_id})=${diff.contract_name ?? '∅'} vs new(${diff.template_id ?? diff.contract_id})=${diff.template_name ?? '∅'}`
        );
      }
    }

    process.exitCode = 1;
  } catch (error) {
    console.error('Template validation script failed:', error);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

void main();
