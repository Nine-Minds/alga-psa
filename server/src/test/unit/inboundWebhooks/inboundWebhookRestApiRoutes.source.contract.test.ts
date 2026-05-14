import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const routeFiles = [
  'server/src/app/api/v1/inbound-webhooks/route.ts',
  'server/src/app/api/v1/inbound-webhooks/[id]/route.ts',
  'server/src/app/api/v1/inbound-webhooks/[id]/rotate-secret/route.ts',
  'server/src/app/api/v1/inbound-webhooks/[id]/test/route.ts',
  'server/src/app/api/v1/inbound-webhooks/[id]/capture-sample/route.ts',
  'server/src/app/api/v1/inbound-webhooks/[id]/deliveries/route.ts',
  'server/src/app/api/v1/inbound-webhooks/[id]/deliveries/[deliveryId]/route.ts',
  'server/src/app/api/v1/inbound-webhooks/[id]/deliveries/[deliveryId]/replay/route.ts',
  'server/src/app/api/v1/inbound-webhooks/actions/route.ts',
];

describe('inbound webhook REST API route source contracts', () => {
  it('keeps REST routes on server actions for tenant scoping instead of direct data access', () => {
    for (const routeFile of routeFiles) {
      const source = readFileSync(join(process.cwd(), '..', routeFile), 'utf8');

      expect(source, routeFile).toContain('@/lib/actions/inboundWebhookActions');
      expect(source, routeFile).not.toMatch(/from ['"]@alga-psa\/db['"]/);
      expect(source, routeFile).not.toMatch(/from ['"][^'"]*\/db['"]/);
      expect(source, routeFile).not.toContain('createTenantKnex');
      expect(source, routeFile).not.toContain('withAuth');
      expect(source, routeFile).not.toContain('hasPermission');
    }
  });
});
