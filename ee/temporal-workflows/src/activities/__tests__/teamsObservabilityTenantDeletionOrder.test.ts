import { describe, it } from 'vitest';
import { expectTenantDeletion } from '../../test-utils/tenant-deletion-harness';

describe('teams observability tenant deletion ordering', () => {
  it('deletes Teams observability and profile bindings before their parents, preserving another tenant', async () => {
    await expectTenantDeletion([
      ['teams_notification_deliveries', 'teams_integrations'],
      ['teams_audit_events', 'teams_integrations'],
      ['teams_conversation_references', 'teams_integrations'],
      ['teams_integrations', 'microsoft_profiles'],
      ['microsoft_profile_consumer_bindings', 'microsoft_profiles'],
      ['microsoft_profiles', 'tenants'],
    ]);
  });
});
