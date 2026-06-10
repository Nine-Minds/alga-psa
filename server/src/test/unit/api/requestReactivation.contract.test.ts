import path from 'node:path';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('request-reactivation route contract', () => {
  const sharedRoute = readRepoFile('server/src/app/api/billing/request-reactivation/route.ts');
  const eeRoute = readRepoFile('ee/server/src/app/api/billing/request-reactivation/route.ts');
  const ceRoute = readRepoFile('packages/ee/src/app/api/billing/request-reactivation/route.ts');

  it('T010: rejects missing or invalid HMAC signatures before lookup work', () => {
    expect(eeRoute).toContain("req.headers.get('x-webhook-signature')");
    expect(eeRoute).toContain("req.headers.get('x-timestamp')");
    expect(eeRoute).toContain("crypto\n    .createHmac('sha256', secret)\n    .update(payload)\n    .digest('hex')");
    expect(eeRoute).toContain("return NextResponse.json(\n        { error: 'Unauthorized' },\n        { status: 401 },\n      );");
    expect(eeRoute.indexOf('if (!verifyWebhookSignature')).toBeLessThan(eeRoute.indexOf('resolveTenantAndAdminEmailByEmail(email, knex)'));
  });

  it('T011/T012/T013/T065: returns anti-enumeration success and never includes admin email in responses', () => {
    expect(eeRoute).toContain('return NextResponse.json({ success: true });');
    expect(eeRoute).toContain('if (!tenant)');
    expect(eeRoute).toContain('if (!pendingDeletion?.reactivatable)');
    const responseLines = eeRoute
      .split('\n')
      .filter((line) => line.includes('NextResponse.json'));
    expect(responseLines.join('\n')).not.toContain('billingAdmin.email');
    expect(eeRoute).not.toContain('adminEmail:');
  });

  it('T064/T077: sends only to the canonical reactivation contact email and embeds a durable token link', () => {
    expect(eeRoute).toContain('resolveReactivationContactEmail(tenant.tenantId, knex)');
    expect(eeRoute).toContain('createTenantReactivationToken({');
    expect(eeRoute).toContain('buildReactivationCheckoutUrl(reactivationToken.token)');
    expect(eeRoute).toContain('to: billingAdmin.email');
  });

  it('T071: route path resolves through @enterprise with a CE no-op stub', () => {
    // The shim must export the handler DIRECTLY (delegating to EE), not re-export it:
    // Next's webpack production build doesn't register re-exported route handlers.
    expect(sharedRoute).toContain("from '@enterprise/app/api/billing/request-reactivation/route'");
    expect(sharedRoute).toMatch(/export async function POST/);
    expect(sharedRoute).toContain("export const runtime = 'nodejs'");
    expect(sharedRoute).toContain("export const dynamic = 'force-dynamic'");
    expect(ceRoute).not.toContain('pending_tenant_deletions');
    expect(ceRoute).toContain('return NextResponse.json({ success: true });');
  });
});
