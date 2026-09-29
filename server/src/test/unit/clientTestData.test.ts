import { afterEach, describe, expect, it, vi } from 'vitest';
import { faker } from '@faker-js/faker';
import { createClientTestData, createMultipleClients } from '../e2e/utils/clientTestData';

afterEach(() => vi.restoreAllMocks());

describe('client API fixture names', () => {
  it('creates distinct clients even when Faker repeats a company name', () => {
    vi.spyOn(faker.company, 'name').mockReturnValue("O'Kon and Sons");
    const clients = createMultipleClients(3);
    expect(new Set(clients.map(client => client.client_name)).size).toBe(3);
    expect(clients.every(client => client.client_name.includes("O'Kon and Sons"))).toBe(true);
  });

  it('preserves explicit names for duplicate-name and filtering scenarios', () => {
    expect(createClientTestData({ client_name: 'Explicit client' }).client_name).toBe('Explicit client');
  });
});
