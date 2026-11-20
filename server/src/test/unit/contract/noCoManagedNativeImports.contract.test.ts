import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(__dirname, '../../../../..');

function grep(pattern: string, paths: string[]): string[] {
  try {
    return execFileSync('git', ['grep', '--untracked', '-n', '-E', pattern, '--', ...paths], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch (error: any) {
    if (error.status === 1) return [];
    throw error;
  }
}

// L1a registers its six tables in the manifest and the deletion order. A bare table-name literal is
// registration data, not coupling; a manifest registration line may also carry its `client_id` ownership
// (required by tenantLifecycleLists), or the parent chain through which its rows reach a client: the seat
// arrangement tables reach theirs through `co_managed_seat_arrangements` (S39). Either is a declaration
// inside the registration itself. Any other mention (imports, product probes, logic) still fails.
const OWNERSHIP_HOP = String.raw`\{ column: '[a-z_]+', table: '[a-z_]+'(, enforced: false)? \}`;
const OWNERSHIP_CHAIN = String.raw`\[${OWNERSHIP_HOP}(, ${OWNERSHIP_HOP})*\]`;
const OWNERSHIP = [
  String.raw`\{ by: 'column', column: 'client_id'(, enforced: false)? \}`,
  String.raw`\{ by: 'parent', chain: ${OWNERSHIP_CHAIN} \}`,
  String.raw`\{ by: 'alternatives', parents: \[${OWNERSHIP_CHAIN}(, ${OWNERSHIP_CHAIN})+\] \}`,
].join('|');
const TABLE_REGISTRATION = new RegExp(
  String.raw`^[^:]+:\d+:\s*(\{ table: )?'co_manage(d|ment)_[a-z_]+'(, deletion: 'ordered'(, clientKeyed: (${OWNERSHIP}))? \},?|,)\s*$`);
const isTableRegistration = (line: string) => TABLE_REGISTRATION.test(line);

// The Temporal worker's provisioning slice is co-managed by definition: it runs the sponsor's
// reserved operation. Exactly these files are carved out (kebab-case co-managed-* files plus the
// integration harness); shared worker files such as tenant-operations stay free of the product.
function workerCarveOuts(): string[] {
  return [
    ':!ee/temporal-workflows/src/activities/co-managed-*.ts',
    ':!ee/temporal-workflows/src/db/co-managed-*.ts',
    ':!ee/temporal-workflows/src/workflows/co-managed-*.ts',
    ':!ee/temporal-workflows/src/__tests__/integration/**',
  ];
}

describe('native files stay free of co-managed coupling', () => {
  // Test files assert the absence; registry defaults and manifest must not mention it.
  const native = [
    'packages/db/src',
    'packages/tickets/src/lib',
    'packages/jobs/src',
    'packages/event-schemas/src',
    'packages/types/src/constants',
    'shared/workflow/runtime',
    'ee/temporal-workflows/src',
  ];
  const excluding = [':!**/*.test.ts', ':!**/*.contract.test.ts', ...workerCarveOuts()];

  it('imports nothing from @alga-psa/co-managed', () => {
    expect(grep('@alga-psa/co-managed', [...native, ...excluding])).toEqual([]);
  });

  it('probes neither product_code nor co_manag in registry defaults or the manifest', () => {
    const files = [
      'packages/db/src/lib/tenantTableManifest.ts',
      'packages/tickets/src/lib/ticketLifecycleHooks.ts',
      'packages/tickets/src/lib/commentEventRegistry.ts',
      'packages/tickets/src/lib/scheduledCommentAdmission.ts',
      'packages/jobs/src/lib/jobDescriptors.ts',
      'shared/workflow/runtime/registries/workflowTicketMutationRegistry.ts',
      'shared/workflow/runtime/registries/workflowConversationRegistry.ts',
    ];
    expect(grep('product_code|co_manag|co-manag', files).filter(line => !isTableRegistration(line))).toEqual([]);
  });

  it('keeps co-managed out of the temporal deletion workflow', () => {
    expect(grep('co_manag', ['ee/temporal-workflows', ':!**/*.test.ts', ...workerCarveOuts()]).filter(line => !isTableRegistration(line))).toEqual([]);
  });
});
