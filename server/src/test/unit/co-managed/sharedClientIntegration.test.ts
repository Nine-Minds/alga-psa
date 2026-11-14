import { describe, expect, it } from 'vitest';
import { SHARED_CLIENT_INTEGRATION } from '@/components/co-managed/CoManagedSharedProviders';

describe('shared project client integration', () => {
  it('does not expose viewer-tenant client records to a shared project', async () => {
    await expect(SHARED_CLIENT_INTEGRATION.getClientById('customer-client')).resolves.toBeNull();
    await expect(SHARED_CLIENT_INTEGRATION.getExistingClientIds(['customer-client', 'other-client'])).resolves.toEqual([]);
  });
});
