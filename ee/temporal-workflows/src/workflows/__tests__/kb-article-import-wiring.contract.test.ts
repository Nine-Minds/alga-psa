import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflowSource = readFileSync(resolve(__dirname, '../generic-job-workflow.ts'), 'utf8');
const activitiesSource = readFileSync(resolve(__dirname, '../../activities/job-activities.ts'), 'utf8');
const dialogSource = readFileSync(
  resolve(__dirname, '../../../../../packages/documents/src/components/kb/KBImportDialog.tsx'),
  'utf8',
);

const kbImportPolicy = (): string => {
  const start = workflowSource.indexOf('const kbArticleImportActivities = proxyActivities');
  return workflowSource.slice(start, workflowSource.indexOf('// Define signals', start));
};

describe('KB article import Temporal wiring', () => {
  it('returns handler totals through the activity and workflow result', () => {
    expect(activitiesSource).toContain('return kbArticleImportHandler(jobId, data as any);');
    expect(workflowSource).toContain('result: result.result');
  });

  it('uses the dedicated two-attempt activity policy without importing jobs into the workflow', () => {
    const policy = kbImportPolicy();

    expect(policy).not.toBe('');
    expect(policy).toContain('maximumAttempts: 2');
    expect(workflowSource).toContain('jobName === KB_ARTICLE_IMPORT_JOB');
    expect(workflowSource).toContain('? kbArticleImportActivities');
    expect(workflowSource).not.toContain("from '@alga-psa/jobs");
  });

  // The dialog gives up on its own clock. If it gives up first the user is told
  // the import failed while it is still running, re-imports, and every article
  // lands twice behind a -2 slug -- so its budget has to cover every attempt
  // this policy allows.
  it('lets the import dialog outwait every attempt the retry policy allows', () => {
    const policy = kbImportPolicy();
    const attempts = Number(/maximumAttempts:\s*(\d+)/.exec(policy)?.[1]);
    const attemptMinutes = Number(/startToCloseTimeout:\s*'(\d+)m'/.exec(policy)?.[1]);
    const pollMinutes = Number(
      /POLL_TIMEOUT_MS\s*=\s*(\d+)\s*\*\s*60\s*\*\s*1000/.exec(dialogSource)?.[1],
    );

    expect(attempts).toBeGreaterThan(0);
    expect(attemptMinutes).toBeGreaterThan(0);
    expect(pollMinutes).toBeGreaterThan(0);
    expect(pollMinutes).toBeGreaterThanOrEqual(attempts * attemptMinutes);
  });
});
