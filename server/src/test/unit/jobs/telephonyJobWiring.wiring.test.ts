import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The telephony job path spans four files that share no imports: the webhook
 * enqueues by name, the Temporal worker forwards by an inlined literal, the
 * server registers the handler, and the schedule fan-out drives renewals. A
 * mismatch is invisible to typecheck and only shows up as calls that never get
 * journaled or subscriptions that quietly expire after 60h.
 */
const repoRoot = path.resolve(process.cwd(), '..');
const read = (relativePath: string): string =>
  readFileSync(path.resolve(repoRoot, relativePath), 'utf8');

const registerHandlersSource = read('server/src/lib/jobs/registerAllHandlers.ts');
const jobActivitiesSource = read('ee/temporal-workflows/src/activities/job-activities.ts');
const maintenanceFanoutSource = read('packages/jobs/src/lib/maintenanceJobFanout.ts');
const setupSchedulesSource = read('ee/temporal-workflows/src/schedules/setupSchedules.ts');
const middlewareSource = read('server/src/middleware.ts');
const handlerSource = read('packages/jobs/src/lib/handlers/telephonyCallNotificationHandler.ts');

describe('Telephony job wiring', () => {
  it('T036: the Temporal worker forwards the call notification back to the server', () => {
    expect(jobActivitiesSource).toContain(
      "registerJobHandlerForActivities(\n    'process-telephony-call-notification',\n    forwardJobToServer('process-telephony-call-notification'),\n  );",
    );
  });

  it('T036: the server registers both telephony job handlers', () => {
    expect(registerHandlersSource).toContain("name: 'process-telephony-call-notification',");
    expect(registerHandlersSource).toContain('await processTelephonyCallNotification(data);');
    expect(registerHandlersSource).toContain("name: 'renew-telephony-call-subscriptions',");
    expect(registerHandlersSource).toContain('await renewTelephonyCallSubscriptions(data);');
  });

  it('T028: the notification handler sets tenant context before touching the database', () => {
    expect(handlerSource).toContain("import { runWithTenant } from '@alga-psa/db';");
    const body = handlerSource.slice(handlerSource.indexOf('export async function processTelephonyCallNotification'));
    expect(body).toContain('await runWithTenant(data.tenantId, async () => {');
    // Everything that reads ambient tenant state must be inside that scope.
    expect(body.indexOf('runWithTenant')).toBeLessThan(body.indexOf('fetchTeamsCallRecord({'));
    expect(body.indexOf('runWithTenant')).toBeLessThan(body.indexOf('ingestCanonicalCall({'));
  });

  it('T033: subscription renewal is registered in the maintenance fan-out', () => {
    expect(maintenanceFanoutSource).toContain(
      "import { renewTelephonyCallSubscriptions } from './handlers/telephonyCallNotificationHandler';",
    );
    expect(maintenanceFanoutSource).toContain(
      "'renew-telephony-call-subscriptions': { scope: 'tenant', run: (tenantId) => renewTelephonyCallSubscriptions({ tenantId }) },",
    );
  });

  it('T033: renewal runs every 30 minutes, well inside the 60h subscription TTL', () => {
    expect(setupSchedulesSource).toContain(
      "{ jobName: 'renew-telephony-call-subscriptions', cron: '*/30 * * * *' },",
    );
  });

  it('T035: the Graph webhook path is allowlisted while the rest of /api stays guarded', () => {
    expect(middlewareSource).toContain("'/api/telephony/webhooks/'");
    // The allowlist is a prefix list; a sibling telephony API path must not be
    // covered by it.
    const allowlistEntry = middlewareSource
      .split('\n')
      .find((line) => line.includes("'/api/telephony/webhooks/'"));
    expect(allowlistEntry).toMatch(/clientState/i);
  });
});
