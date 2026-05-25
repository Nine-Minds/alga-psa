import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('teams observability tenant deletion ordering', () => {
  const source = readRepoFile('ee/temporal-workflows/src/activities/tenant-deletion-activities.ts');

  it('lists Teams observability tables before teams_integrations', () => {
    const idempotencyIndex = source.indexOf("'teams_notification_delivery_idempotency'");
    const deliveriesIndex = source.indexOf("'teams_notification_deliveries'");
    const auditIndex = source.indexOf("'teams_audit_events'");
    const conversationsIndex = source.indexOf("'teams_conversation_references'");
    const integrationIndex = source.indexOf("'teams_integrations'");

    expect(idempotencyIndex).toBeGreaterThan(-1);
    expect(deliveriesIndex).toBeGreaterThan(-1);
    expect(auditIndex).toBeGreaterThan(-1);
    expect(conversationsIndex).toBeGreaterThan(-1);
    expect(integrationIndex).toBeGreaterThan(-1);

    expect(idempotencyIndex).toBeLessThan(integrationIndex);
    expect(deliveriesIndex).toBeLessThan(integrationIndex);
    expect(auditIndex).toBeLessThan(integrationIndex);
    expect(conversationsIndex).toBeLessThan(integrationIndex);
  });

  it('documents the Microsoft profile and Teams observability dependency block', () => {
    expect(source).toContain('Microsoft profile and Teams observability bindings');
    expect(source).toContain("'microsoft_profile_consumer_bindings'");
    expect(source).toContain("'microsoft_profiles'");
  });
});
