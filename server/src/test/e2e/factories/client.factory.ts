/**
 * Client Factory for E2E Tests
 * Creates client test data with realistic values
 */

import { faker } from '@faker-js/faker';

interface ClientInput {
  tenant: string;
  client_name?: string;
  client_type?: 'client' | 'individual';
  email?: string;
  phone?: string;
  is_inactive?: boolean;
  url?: string;
  createLocation?: boolean;
}

export async function clientFactory(db: any, input: ClientInput) {
  const client = {
    client_id: faker.string.uuid(),
    tenant: input.tenant,
    client_name: input.client_name || faker.company.name(),
    client_type: input.client_type || 'client',
    url: input.url || faker.internet.url(),
    is_inactive: input.is_inactive !== undefined ? input.is_inactive : false,
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    credit_balance: 0,
    created_at: new Date(),
    updated_at: new Date()
  };

  const result = await db('clients')
    .insert({
      client_id: client.client_id,
      tenant: client.tenant,
      client_name: client.client_name,
      client_type: client.client_type,
      url: client.url,
      is_inactive: client.is_inactive,
      billing_cycle: client.billing_cycle,
      is_tax_exempt: client.is_tax_exempt,
      credit_balance: client.credit_balance,
      created_at: client.created_at,
      updated_at: client.updated_at
    })
    .returning('*');

  const createdClient = result[0];

  // Create a default location if email or phone is provided or if explicitly requested
  if (input.createLocation !== false && (input.email || input.phone)) {
    await db('client_addresses').insert({
      address_id: faker.string.uuid(),
      client_id: createdClient.client_id,
      tenant: input.tenant,
      address_name: 'Main Office',
      address_line1: faker.location.streetAddress(),
      city: faker.location.city(),
      state_province: faker.location.state({ abbreviated: true }),
      postal_code: faker.location.zipCode(),
      country_code: 'US',
      country_name: 'United States',
      email: input.email || faker.internet.email().toLowerCase(),
      phone: input.phone || faker.phone.number(),
      is_default: true,
      is_billing_address: true,
      is_shipping_address: true,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date()
    });
  }

  return createdClient;
}

// Backward compatibility alias
export const clientFactory = clientFactory;