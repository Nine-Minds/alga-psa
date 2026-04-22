import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../');

const readSource = (relativePath: string) =>
  readFileSync(path.resolve(repoRoot, relativePath), 'utf8');

describe('CE migrated flow kernel contracts', () => {
  it('T028: selected migrated ticket/document/time/project/asset/billing paths use shared builtin kernel entry points', () => {
    const ticketSource = readSource('packages/tickets/src/actions/ticketActions.ts');
    const documentSource = readSource('packages/documents/src/actions/documentActions.ts');
    const timeSource = readSource('packages/scheduling/src/actions/timeEntryDelegationAuth.ts');
    const projectSource = readSource('packages/projects/src/actions/projectActions.ts');
    const assetSource = readSource('packages/assets/src/actions/assetActions.ts');
    const billingSource = readSource('packages/billing/src/actions/quoteActions.ts');

    expect(ticketSource).toContain('BuiltinAuthorizationKernelProvider');
    expect(ticketSource).toContain('createAuthorizationKernel({');

    expect(documentSource).toContain('BuiltinAuthorizationKernelProvider');
    expect(documentSource).toContain('authorizeAndRedactDocuments(');

    expect(timeSource).toContain('BuiltinAuthorizationKernelProvider');
    expect(timeSource).toContain('createAuthorizationKernel({');
    expect(timeSource).toContain('assertCanActOnBehalf(');

    expect(projectSource).toContain('BuiltinAuthorizationKernelProvider');
    expect(projectSource).toContain('createAuthorizationKernel({');

    expect(assetSource).toContain('BuiltinAuthorizationKernelProvider');
    expect(assetSource).toContain('createAuthorizationKernel({');

    expect(billingSource).toContain('BuiltinAuthorizationKernelProvider');
    expect(billingSource).toContain('createAuthorizationKernel({');
  });
});
