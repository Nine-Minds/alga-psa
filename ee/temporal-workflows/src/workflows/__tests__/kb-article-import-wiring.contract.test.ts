import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflowSource = readFileSync(resolve(__dirname, '../generic-job-workflow.ts'), 'utf8');
const activitiesSource = readFileSync(resolve(__dirname, '../../activities/job-activities.ts'), 'utf8');

describe('KB article import Temporal wiring', () => {
  it('returns handler totals through the activity and workflow result', () => {
    expect(activitiesSource).toContain('return kbArticleImportHandler(jobId, data as any);');
    expect(workflowSource).toContain('result: result.result');
  });

  it('uses the dedicated two-attempt activity policy without importing jobs into the workflow', () => {
    const policyStart = workflowSource.indexOf('const kbArticleImportActivities = proxyActivities');
    const policyEnd = workflowSource.indexOf('// Define signals', policyStart);
    const policy = workflowSource.slice(policyStart, policyEnd);

    expect(policyStart).toBeGreaterThan(-1);
    expect(policy).toContain('maximumAttempts: 2');
    expect(workflowSource).toContain('jobName === KB_ARTICLE_IMPORT_JOB');
    expect(workflowSource).toContain('? kbArticleImportActivities');
    expect(workflowSource).not.toContain("from '@alga-psa/jobs");
  });
});
