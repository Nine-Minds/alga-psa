import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createClientSchema, updateClientSchema, clientResponseSchema } from '../../../lib/api/schemas/client';

describe('client properties defaultLocale API contract', () => {
  it('accepts and normalizes locales on create and update', () => {
    expect(createClientSchema.parse({ client_name: 'Locale test', billing_cycle: 'monthly', properties: { defaultLocale: 'fr' } }).properties?.defaultLocale).toBe('fr');
    expect(updateClientSchema.parse({ client_name: 'Locale test', properties: { defaultLocale: 'pt_BR' } }).properties?.defaultLocale).toBe('pt');
  });

  it('rejects unsupported locales and null', () => {
    expect(updateClientSchema.safeParse({ client_name: 'Locale test', properties: { defaultLocale: 'zz_ZZ' } }).success).toBe(false);
    expect(updateClientSchema.safeParse({ client_name: 'Locale test', properties: { defaultLocale: null } }).success).toBe(false);
  });

  it('retains defaultLocale in validated client responses', () => {
    const client = {
      client_id: '11111111-1111-4111-8111-111111111111', client_name: 'Locale test', phone_no: null,
      credit_balance: 0, email: null, url: null, address: null,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', is_inactive: false,
      client_type: null, tax_id_number: null, notes: null, properties: { defaultLocale: 'fr' }, payment_terms: null,
      billing_cycle: 'monthly', credit_limit: null, preferred_payment_method: null, auto_invoice: false,
      invoice_delivery_method: null, region_code: null, is_tax_exempt: false, tax_exemption_certificate: null,
      timezone: null, invoice_template_id: null, billing_contact_id: null, billing_email: null,
      account_manager_id: null, account_manager_full_name: null, logoUrl: null,
      tenant: '22222222-2222-4222-8222-222222222222'
    };
    expect(clientResponseSchema.parse(client).properties?.defaultLocale).toBe('fr');
  });

  it('merges provided properties into the existing JSONB properties', () => {
    const service = readFileSync(resolve(__dirname, '../../../lib/api/services/ClientService.ts'), 'utf8');
    expect(service).toContain('updateData.properties = { ...(before.properties ?? {}), ...data.properties }');
  });
});
