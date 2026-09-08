import { playwrightTests, reconcilePlaywrightExecution } from './playwright-execution-evidence.mjs';
export const teamsDevelopmentFiles = ['e2e-tests/development-tests/teams-profile.spec.ts'];
export const teamsDevelopmentJourneys = [
  'Teams profile recovery and calendar meeting creation preserve saved identities',
  ...[
    '/api/calendar/webhooks/microsoft', '/api/email/webhooks/microsoft',
    '/api/teams/webhooks/recordings', '/api/telephony/webhooks/teams-calls',
  ].map(route => `Microsoft subscription validation echoes the opaque token: ${route}`),
];

export function verifyTeamsDevelopment({ collected, report, root, revision, exitCode }) {
  const result = reconcilePlaywrightExecution({ collected, report, root, revision, exitCode });
  result.suite = 'teams-development-browser';
  result.releaseValidation = false;
  for (const [label, value] of [['collection', collected], ['execution', report]]) {
    const metadata = value?.config?.metadata;
    if (metadata?.sourceRevision !== revision || metadata?.releaseValidation !== false
      || metadata?.requiredServerNodeEnv !== 'development' || metadata?.integrationSurface !== 'teams') {
      result.failures.push(`Invalid ${label} Teams development configuration`);
    }
  }
  const files = new Set(playwrightTests(collected, root).map(test => test.file));
  if (teamsDevelopmentFiles.some(file => !files.has(file))) result.failures.push('Missing mandatory Teams development journey');
  const collectedTests = playwrightTests(collected, root);
  for (const title of teamsDevelopmentJourneys) {
    if (!collectedTests.some(entry => entry.file === teamsDevelopmentFiles[0]
      && entry.projectName === 'enterprise-chromium' && entry.titles.at(-1) === title)) {
      result.failures.push(`Missing mandatory Teams case: ${title}`);
    }
  }
  if (result.failures.length) result.status = 'failed';
  return result;
}
