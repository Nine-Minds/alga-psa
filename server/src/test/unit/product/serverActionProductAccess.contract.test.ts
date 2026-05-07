import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '../../../../..');

const guardedFiles = [
  'packages/billing/src/actions/taxRateActions.ts',
  'packages/projects/src/actions/projectTaskExportActions.ts',
  'packages/scheduling/src/actions/timeEntryTicketActions.ts',
  'packages/assets/src/actions/clientLookupActions.ts',
  'server/src/lib/actions/workflow-bundle-v1-actions.ts',
  'packages/surveys/src/actions/survey-actions/surveyMetricsActions.ts',
  'packages/documents/src/actions/shareLinkActions.ts',
  'ee/server/src/lib/actions/extMenuActions.ts',
  'ee/server/src/lib/actions/extensionDomainActions.ts',
  'ee/server/src/lib/actions/installDomainActions.ts',
  'server/src/app/api/chat/v1/execute/route.ts',
  'server/src/app/api/chat/v1/completions/route.ts',
  'server/src/app/api/chat/v1/completions/stream/route.ts',
] as const;

describe('server action product access contract', () => {
  it('uses PSA-only product assertion in representative denied-domain server actions', () => {
    for (const relPath of guardedFiles) {
      const source = readFileSync(join(repoRoot, relPath), 'utf8');
      expect(
        source.includes('assertPsaOnlyTenantAccess') || source.includes('assertTenantProductAccess')
      ).toBe(true);
    }
  });

  it('uses structured ProductAccessError fields in shared product guard', () => {
    const source = readFileSync(join(repoRoot, 'shared/services/productAccessGuard.ts'), 'utf8');
    expect(source).toContain("code = 'PRODUCT_ACCESS_DENIED'");
    expect(source).toContain('status = 403');
    expect(source).toContain("this.name = 'ProductAccessError'");
  });
});
