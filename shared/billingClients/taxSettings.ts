import type { Knex } from 'knex';
import { v4 as uuid4 } from 'uuid';
import type { IClientTaxSettings, ITaxRateDetails as ITaxRate, ITaxComponent, TaxSource } from '@alga-psa/types';

export async function getClientTaxSettings(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<IClientTaxSettings | null> {
  const row = await knexOrTrx<IClientTaxSettings>('client_tax_settings')
    .where({ client_id: clientId, tenant })
    .first();
  return row ?? null;
}

export async function updateClientTaxSettings(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  taxSettings: Omit<IClientTaxSettings, 'tenant'>
): Promise<IClientTaxSettings | null> {
  await knexOrTrx<IClientTaxSettings>('client_tax_settings')
    .where({ client_id: clientId, tenant })
    .update({
      is_reverse_charge_applicable: taxSettings.is_reverse_charge_applicable,
      tax_source_override: taxSettings.tax_source_override ?? null
    });

  const updated = await knexOrTrx<IClientTaxSettings>('client_tax_settings')
    .where({ client_id: clientId, tenant })
    .first();

  return updated ?? null;
}

export async function createDefaultTaxSettings(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<IClientTaxSettings> {
  // Get the first active tax rate to use as the default
  const defaultTaxRate = await knexOrTrx<ITaxRate>('tax_rates')
    .where('tenant', tenant)
    .andWhere('is_active', true)
    .orderBy('created_at', 'asc')
    .first();

  if (!defaultTaxRate) {
    throw new Error('No active tax rates found in the system to assign as default.');
  }

  const [taxSettings] = await knexOrTrx<IClientTaxSettings>('client_tax_settings')
    .insert({
      client_id: clientId,
      is_reverse_charge_applicable: false,
      tenant
    })
    .returning('*');

  await knexOrTrx('client_tax_rates').insert({
    client_id: clientId,
    tax_rate_id: defaultTaxRate.tax_rate_id,
    is_default: true,
    location_id: null,
    tenant
  });

  const tax_component_id = uuid4();
  await knexOrTrx<ITaxComponent>('tax_components').insert({
    tax_component_id,
    tax_rate_id: defaultTaxRate.tax_rate_id,
    name: 'Default Tax',
    rate: Math.ceil((defaultTaxRate as any).tax_percentage),
    sequence: 1,
    is_compound: false,
    tenant
  });

  return taxSettings as IClientTaxSettings;
}

export async function getClientTaxExemptStatus(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<{ is_tax_exempt: boolean; tax_exemption_certificate?: string } | null> {
  const row = await knexOrTrx('clients')
    .where({ client_id: clientId, tenant })
    .first()
    .select('is_tax_exempt', 'tax_exemption_certificate');

  if (!row) return null;
  return {
    is_tax_exempt: Boolean((row as any).is_tax_exempt),
    tax_exemption_certificate: (row as any).tax_exemption_certificate ?? ''
  };
}

export async function updateClientTaxExemptStatus(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  isTaxExempt: boolean,
  taxExemptionCertificate?: string
): Promise<{ is_tax_exempt: boolean; tax_exemption_certificate?: string }> {
  const updateData: { is_tax_exempt: boolean; tax_exemption_certificate?: string } = {
    is_tax_exempt: isTaxExempt
  };

  if (taxExemptionCertificate !== undefined) {
    updateData.tax_exemption_certificate = taxExemptionCertificate;
  } else if (!isTaxExempt) {
    updateData.tax_exemption_certificate = '';
  }

  await knexOrTrx('clients').where({ client_id: clientId, tenant }).update(updateData);
  return updateData;
}

export type ClientTaxSourceInfo = {
  taxSource: TaxSource;
  isOverride: boolean;
};

export async function getEffectiveTaxSourceForClient(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<ClientTaxSourceInfo> {
  const clientSettings = await knexOrTrx('client_tax_settings')
    .where({ client_id: clientId, tenant })
    .select('tax_source_override')
    .first();

  if (clientSettings?.tax_source_override) {
    return {
      taxSource: clientSettings.tax_source_override as TaxSource,
      isOverride: true
    };
  }

  const tenantSettings = await knexOrTrx('tenant_settings')
    .where({ tenant })
    .select('default_tax_source', 'allow_external_tax_override')
    .first();

  return {
    taxSource: (tenantSettings?.default_tax_source as TaxSource) || 'internal',
    isOverride: false
  };
}

export async function canClientOverrideTaxSource(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string
): Promise<boolean> {
  const tenantSettings = await knexOrTrx('tenant_settings')
    .where({ tenant })
    .select('allow_external_tax_override')
    .first();

  return Boolean(tenantSettings?.allow_external_tax_override);
}
