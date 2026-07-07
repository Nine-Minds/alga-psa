import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Tests run with cwd=server; the wired sources span server/, packages/, and ee/.
const repoRoot = path.resolve(process.cwd(), '..');
const read = (relativePath: string): string =>
  readFileSync(path.resolve(repoRoot, relativePath), 'utf8');

const registerHandlersSource = read('server/src/lib/jobs/registerAllHandlers.ts');
const jobsIndexSource = read('server/src/lib/jobs/index.ts');
const jobActivitiesSource = read('ee/temporal-workflows/src/activities/job-activities.ts');
const maintenanceFanoutSource = read('packages/jobs/src/lib/maintenanceJobFanout.ts');
const setupSchedulesSource = read('ee/temporal-workflows/src/schedules/setupSchedules.ts');
const schedulingAppointmentActionsSource = read(
  'packages/scheduling/src/actions/appointmentRequestManagementActions.ts'
);
const clientPortalAppointmentActionsSource = read(
  'packages/client-portal/src/actions/client-portal-actions/appointmentRequestActions.ts'
);

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start, `missing start marker: ${startMarker}`).toBeGreaterThan(-1);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(end, `missing end marker after start: ${endMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('Teams meeting job wiring', () => {
  it('T037: registerAllHandlers registers teams-meeting-cleanup with maxAttempts 5 and the sweep job', () => {
    expect(registerHandlersSource).toContain(
      "TEAMS_MEETING_CLEANUP_JOB,\n} from '@alga-psa/jobs/handlers/teamsMeetingCleanupHandler';"
    );
    expect(registerHandlersSource).toContain(
      "TEAMS_MEETING_SWEEP_JOB,\n} from '@alga-psa/jobs/handlers/teamsMeetingSweepHandler';"
    );

    const cleanupBlock = sliceBetween(
      registerHandlersSource,
      'name: TEAMS_MEETING_CLEANUP_JOB,',
      'name: TEAMS_MEETING_SWEEP_JOB,'
    );
    expect(cleanupBlock).toContain('await teamsMeetingCleanupHandler(data);');
    expect(cleanupBlock).toContain('maxAttempts: 5,');

    expect(registerHandlersSource).toContain('name: TEAMS_MEETING_SWEEP_JOB,');
    expect(registerHandlersSource).toContain('await teamsMeetingSweepHandler(data);');
  });

  it('T037: jobs index registers both teams meeting handlers on the legacy scheduler inside the EE workflow-edition block', () => {
    // The first `if (isEnterpriseWorkflowEdition()) {` in the handler
    // registration section opens the EE-only block; the CE-only sla-timer
    // registration follows it, so the slice covers exactly that block.
    const eeHandlerBlock = sliceBetween(
      jobsIndexSource,
      'if (isEnterpriseWorkflowEdition()) {',
      "'sla-timer',"
    );
    expect(eeHandlerBlock).toContain('jobScheduler.registerJobHandler<TeamsMeetingCleanupJobData>(');
    expect(eeHandlerBlock).toContain('TEAMS_MEETING_CLEANUP_JOB,');
    expect(eeHandlerBlock).toContain('await teamsMeetingCleanupHandler(job.data);');
    expect(eeHandlerBlock).toContain('jobScheduler.registerJobHandler<TeamsMeetingSweepJobData>(');
    expect(eeHandlerBlock).toContain('TEAMS_MEETING_SWEEP_JOB,');
    expect(eeHandlerBlock).toContain('await teamsMeetingSweepHandler(job.data);');
  });

  it('T037: the temporal worker forwards teams-meeting-cleanup to the server', () => {
    expect(jobActivitiesSource).toContain(
      "registerJobHandlerForActivities('teams-meeting-cleanup', forwardJobToServer('teams-meeting-cleanup'));"
    );
  });

  it('T037: the maintenance fan-out includes the teams meeting sweep', () => {
    expect(maintenanceFanoutSource).toContain(
      "import { teamsMeetingSweepHandler, TEAMS_MEETING_SWEEP_JOB } from './handlers/teamsMeetingSweepHandler';"
    );
    expect(maintenanceFanoutSource).toContain(
      "[TEAMS_MEETING_SWEEP_JOB]: { scope: 'tenant', run: (tenantId) => teamsMeetingSweepHandler({ tenantId }) },"
    );
  });

  it('T037: EE schedule setup includes the 10-minute sweep fan-out schedule', () => {
    expect(setupSchedulesSource).toContain(
      "{ jobName: 'sweep-teams-online-meetings', cron: '*/10 * * * *' }"
    );
  });

  it('T049: scheduleTeamsMeetingArtifactSubscriptionRenewalJob is runner-agnostic (no edition-based early return)', () => {
    const fnBody = sliceBetween(
      jobsIndexSource,
      'export const scheduleTeamsMeetingArtifactSubscriptionRenewalJob = async (',
      'export const scheduleTeamsMeetingSweepJob = async ('
    );
    expect(fnBody).toContain('const runner = await getJobRunnerInstance();');
    expect(fnBody).toContain("if (runner.getRunnerType() === 'temporal') {");
    expect(fnBody).toContain('await runner.scheduleRecurringJob<');
    expect(fnBody).toContain("'renew-teams-meeting-artifact-subscriptions',");
    expect(fnBody).toContain(
      'singletonKey: `renew-teams-meeting-artifact-subscriptions:${tenantId}`'
    );
    // The old edition-gated `if (isEnterpriseWorkflowEdition()) { return null; }`
    // must not decide scheduling: an EE deployment on a pg-boss runner still
    // needs the per-tenant schedule.
    expect(fnBody).not.toContain('if (isEnterpriseWorkflowEdition()) {');
    expect(fnBody).not.toMatch(/isEnterpriseWorkflowEdition\(\)\)\s*\{\s*\n?\s*return null;/);
  });

  it('T049: scheduleTeamsMeetingSweepJob is runner-agnostic (no edition-based early return)', () => {
    const fnBody = sliceBetween(
      jobsIndexSource,
      'export const scheduleTeamsMeetingSweepJob = async (',
      'export const scheduleGoogleGmailWatchRenewalJob = async ('
    );
    expect(fnBody).toContain('const runner = await getJobRunnerInstance();');
    expect(fnBody).toContain("if (runner.getRunnerType() === 'temporal') {");
    expect(fnBody).toContain('await runner.scheduleRecurringJob<');
    expect(fnBody).toContain('TEAMS_MEETING_SWEEP_JOB,');
    expect(fnBody).toContain('singletonKey: `${TEAMS_MEETING_SWEEP_JOB}:${tenantId}`');
    expect(fnBody).not.toContain('if (isEnterpriseWorkflowEdition()) {');
    expect(fnBody).not.toMatch(/isEnterpriseWorkflowEdition\(\)\)\s*\{\s*\n?\s*return null;/);
  });

  it('T047: appointment request actions are typechecked (no @ts-nocheck) and enqueue cleanup via the job runner abstraction', () => {
    const actionSources = [
      schedulingAppointmentActionsSource,
      clientPortalAppointmentActionsSource,
    ];

    for (const source of actionSources) {
      expect(source).not.toContain('@ts-nocheck');
      expect(source).toContain(
        "const { getJobRunner } = await import('@alga-psa/jobs/runner');"
      );
      expect(source).toContain("'teams-meeting-cleanup',");
      expect(source).toContain(
        'singletonKey: `teams-meeting-cleanup:${tenantId}:${meetingId}`'
      );
      // The enqueue path must go through the runner abstraction, never pg-boss.
      expect(source).not.toMatch(/['"]pg-boss['"]/);
      expect(source).not.toContain('PgBoss');
    }
  });
});
