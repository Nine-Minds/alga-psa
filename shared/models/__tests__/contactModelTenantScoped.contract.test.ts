import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.resolve(__dirname, '../contactModel.ts'), 'utf8');

function sectionBetween(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = startIndex === -1 ? -1 : source.indexOf(end, startIndex + start.length);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error(`Unable to locate contact model section: ${start} -> ${end}`);
  }
  return source.slice(startIndex, endIndex);
}

const createUpdateSection = sectionBetween(
  'static async checkEmailExists',
  'static async getAdditionalEmailAddressesForContact'
);
const hydrationSearchSection = sectionBetween(
  'static async getAdditionalEmailAddressesForContact',
  'static async getCustomEmailTypeUsageCount'
);
const typeDefinitionSection = sectionBetween(
  'static async getCustomEmailTypeUsageCount',
  '\n}'
);

describe('contact model tenant-scoped query contract', () => {
  it('uses the structural tenant-scoped query helper for contact model roots', () => {
    expect(source).toContain("import { createTenantScopedQuery } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedTable(trx: Knex.Transaction, table: string, tenant: string)');
    expect(source).not.toMatch(/\.where\(\{[^}]*tenant[^}]*\}/s);
    expect(source).not.toMatch(/\.where\(['"][^'"]*tenant['"],\s*tenant\)/);
    expect(source).not.toMatch(/\.where\(['"][^'"]*\.tenant['"],\s*tenant\)/);
  });

  it('uses structural tenant scoping for create/update roots', () => {
    expect(createUpdateSection).toContain("tenantScopedTable(trx, 'contacts', tenant)");
    expect(createUpdateSection).toContain("tenantScopedTable(trx, 'clients', tenant)");
    expect(createUpdateSection).toContain("tenantScopedTable(trx, 'contact_additional_email_addresses', tenant)");
    expect(createUpdateSection).toContain("tenantScopedTable(trx, 'contact_phone_numbers', tenant)");
    expect(createUpdateSection).not.toContain("trx('contacts').where");
    expect(createUpdateSection).not.toContain("trx('clients').where");
    expect(createUpdateSection).not.toContain("trx('contact_additional_email_addresses').where");
    expect(createUpdateSection).not.toContain("trx('contact_phone_numbers').where");
  });

  it('uses structural tenant scoping for hydration, lookup, and search roots', () => {
    expect(hydrationSearchSection).toContain("tenantScopedTable(trx, 'contact_additional_email_addresses as cea', tenant)");
    expect(hydrationSearchSection).toContain("tenantScopedTable(trx, 'contact_phone_numbers as cpn', tenant)");
    expect(hydrationSearchSection).toContain("tenantScopedTable(trx, 'contact_email_type_definitions', tenant)");
    expect(hydrationSearchSection).toContain("tenantScopedTable(trx, 'contacts', tenant)");
    expect(hydrationSearchSection).toContain("tenantScopedTable(trx, 'contacts as c', tenant)");
    expect(hydrationSearchSection).not.toContain(".where('cea.tenant', tenant)");
    expect(hydrationSearchSection).not.toContain(".where('cpn.tenant', tenant)");
    expect(hydrationSearchSection).not.toContain(".where('c.tenant', tenant)");
    expect(hydrationSearchSection).not.toContain(".where({ tenant");
  });

  it('uses structural tenant scoping for custom type definition roots', () => {
    expect(typeDefinitionSection).toContain("tenantScopedTable(trx, 'contact_email_type_definitions', tenant)");
    expect(typeDefinitionSection).toContain("tenantScopedTable(trx, 'contact_additional_email_addresses', tenant)");
    expect(typeDefinitionSection).toContain("tenantScopedTable(trx, 'contact_phone_numbers as cpn', tenant)");
    expect(typeDefinitionSection).toContain("tenantScopedTable(trx, 'contact_phone_numbers', tenant)");
    expect(typeDefinitionSection).toContain("tenantScopedTable(trx, 'contact_phone_type_definitions', tenant)");
    expect(typeDefinitionSection).toContain("tenantScopedTable(trx, 'contact_phone_type_definitions as cptd', tenant)");
    expect(typeDefinitionSection).not.toContain(".where('tenant', tenant)");
    expect(typeDefinitionSection).not.toContain(".where('cpn.tenant', tenant)");
    expect(typeDefinitionSection).not.toContain(".where('cptd.tenant', tenant)");
    expect(typeDefinitionSection).not.toContain(".where({ tenant");
  });
});
