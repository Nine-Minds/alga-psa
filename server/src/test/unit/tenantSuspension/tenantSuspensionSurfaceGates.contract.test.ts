import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');
const read = (relativePath: string) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('tenant suspension surface gates', () => {
  it('T026: Tactical RMM webhook acks and drops for suspended tenants', () => {
    const source = read('server/src/app/api/webhooks/tacticalrmm/route.ts');
    expect(source).toContain('await isTenantSuspended(knex, tenant)');
    expect(source).toContain("reason: 'tenant_suspended' }, { status: 200 })");
  });

  it('T027: NinjaOne webhook acks and drops for suspended tenants after resolution', () => {
    const source = read('ee/server/src/lib/integrations/ninjaone/webhooks/webhookHandler.ts');
    const resolveIdx = source.indexOf('const { tenantId, integration, mapping } = context;');
    const gateIdx = source.indexOf('isTenantSuspended(knex, tenantId)');
    const eventIdx = source.indexOf("eventType: 'RMM_WEBHOOK_RECEIVED'");

    expect(resolveIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeGreaterThan(resolveIdx);
    expect(gateIdx).toBeLessThan(eventIdx);
  });

  it('T028: LevelIO webhook acks and drops for suspended tenants', () => {
    const source = read('ee/server/src/app/api/webhooks/levelio/route.ts');
    expect(source).toContain('await isTenantSuspended(knex, tenant)');
    expect(source).toContain("reason: 'tenant_suspended' }, { status: 200 })");
  });

  it('T030/T032: workflow-worker skips suspended tenants before ingesting events, fail-open', () => {
    const source = read('services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts');
    const gateIdx = source.indexOf('await isTenantSuspended(knex, event.tenant)');
    const idempotencyIdx = source.indexOf('Duplicate event ignored');

    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(idempotencyIdx);
    expect(source.indexOf('launchPublishedWorkflowRun(', gateIdx)).toBeGreaterThan(gateIdx);
    expect(source).toContain("event: 'workflow_event_tenant_suspended'");
  });

  it('T036: server API key validation variants gate on owner-inactive and tenant-suspended', () => {
    const source = read('server/src/lib/services/apiKeyServiceForApi.ts');
    expect(source.match(/getKeyGateReason\(/g)!.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain("'user_inactive' | 'client_owner' | 'tenant_suspended'");
    expect(source).toContain('isTenantSuspended(knex, tenant)');
  });

  it('T037: validate-api-key route delegates to the gated ApiKeyService', () => {
    const route = read('server/src/app/api/auth/validate-api-key/route.ts');
    expect(route).toContain('ApiKeyService.validateApiKey');

    const service = read('packages/auth/src/services/apiKeyService.ts');
    expect(service).toContain('getKeyGateReason');
    expect(service).toContain('isTenantSuspended(knex, tenant)');
  });

  it('T038: booking route rejects suspended tenants with neutral copy before persisting', () => {
    const source = read('server/src/app/api/public/appointment-request/route.ts');
    const gateIdx = source.indexOf('if (tenant.suspended_at)');
    const persistIdx = source.indexOf('appointment_requests');

    expect(source).toContain("'tenant', 'client_name', 'suspended_at'");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(persistIdx);
    expect(source).toContain('Booking is temporarily unavailable');
    expect(source).toContain('status: 503');
  });

  it('T040: marketing capture resolver answers suspended tenants with the generic 404 path', () => {
    const source = read('server/src/lib/marketing/publicEndpoints.ts');
    const gateIdx = source.indexOf('if (tenant.suspended_at)');
    const flagIdx = source.indexOf('isFeatureFlagEnabled(MARKETING_MODULE_FLAG');

    expect(source).toContain(".first('tenant', 'suspended_at')");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(flagIdx);
  });

  it('T041: calendar webhook processor skips suspended tenants in all three entry points', () => {
    const source = read('ee/packages/calendar/src/lib/services/calendar/CalendarWebhookProcessor.ts');
    expect(source.match(/isProviderTenantSuspended\(provider\)/g)).toHaveLength(3);
    expect(source).toContain('isTenantSuspended(await getAdminConnection(), provider.tenant)');
  });

  it('T042/T044: tenant email sends are gated; SystemEmailService is not', () => {
    const tenantEmail = read('packages/email/src/TenantEmailService.ts');
    const gateIdx = tenantEmail.indexOf('isTenantSuspended(suspensionKnex, this.tenantId)');
    const rateLimitIdx = tenantEmail.indexOf('await this.checkRateLimits(params)');

    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(rateLimitIdx);
    expect(tenantEmail).toContain("event: 'email_dropped_tenant_suspended'");

    const systemEmail = read('packages/email/src/system/SystemEmailService.ts');
    expect(systemEmail).not.toContain('isTenantSuspended');
  });
});
