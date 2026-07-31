import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

describe('marketing worker registration contract', () => {
  it('exports the fan-out workflow from both production workflow indexes', () => {
    expect(source('../workflows/index.ts')).toContain(
      "export * from './marketing-fanout-workflow.js';",
    );
    expect(source('../workflows/non-authored-index.ts')).toContain(
      "export * from './marketing-fanout-workflow.js';",
    );
    expect(source('../workflows/marketing-fanout-workflow.ts')).toContain(
      'export async function marketingFanoutWorkflow',
    );
  });

  it('exports both marketing activities from both production activity indexes', () => {
    expect(source('../activities/index.ts')).toContain(
      'export * from "./marketing-activities";',
    );
    expect(source('../activities/non-authored-index.ts')).toContain(
      "export * from './marketing-activities';",
    );

    const activitySource = source('../activities/marketing-activities.ts');
    expect(activitySource).toContain('export async function listMarketingTenantIds');
    expect(activitySource).toContain('export async function runMarketingJobForTenant');
  });
});
