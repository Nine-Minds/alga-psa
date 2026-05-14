import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('search index source event publishing contracts', () => {
  it('T055 client creation publishes CLIENT_CREATED with tenant and client id', () => {
    const source = readRepoFile('packages/clients/src/actions/clientActions.ts');

    expect(source).toContain("eventType: 'CLIENT_CREATED'");
    expect(source).toContain('payload: buildClientCreatedPayload({');
    expect(source).toContain('clientId: createdClient.client_id');
    expect(source).toContain('ctx: {');
    expect(source).toContain('tenantId: tenant');
    expect(source).toContain('idempotencyKey: `client_created:${createdClient.client_id}`');
  });

  it('T056 client update publishes CLIENT_UPDATED with tenant and client id', () => {
    const source = readRepoFile('packages/clients/src/actions/clientActions.ts');

    expect(source).toContain('const updatedPayload = buildClientUpdatedPayload({');
    expect(source).toContain('clientId,');
    expect(source).toContain("eventType: 'CLIENT_UPDATED'");
    expect(source).toContain('payload: updatedPayload');
    expect(source).toContain('ctx: { tenantId: tenant, occurredAt, actor }');
    expect(source).toContain('idempotencyKey: `client_updated:${clientId}:${occurredAt}`');
  });
});
