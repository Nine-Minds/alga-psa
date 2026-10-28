/**
 * A8: every process that can write native rows installs the co-managed resolver, fail-open,
 * so a missing/unresolvable co-managed package never stops a worker booting.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../../..');
const BOOTSTRAPS = [
  'server/src/instrumentation.ts',
  'services/email-service/src/index.ts',
  'services/workflow-worker/src/index.ts',
  'ee/temporal-workflows/src/worker.ts',
];

describe.each(BOOTSTRAPS)('%s', (file) => {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');

  it('installs the co-managed write-admission resolver', () => {
    expect(source).toContain("import('@alga-psa/licensing/co-managed-write-admission')");
    expect(source).toMatch(/installCoManagedWriteAdmission\(/);
  });

  it('fails open: the install sits inside a try whose catch only reports', () => {
    const at = source.indexOf('installCoManagedWriteAdmission(');
    const tryAt = source.lastIndexOf('try {', at);
    const catchAt = source.indexOf('catch (error)', at);
    expect(tryAt).toBeGreaterThan(-1);
    expect(catchAt).toBeGreaterThan(at);
    const body = source.slice(catchAt, source.indexOf('}', catchAt) + 1);
    expect(body).not.toMatch(/\bthrow\b|process\.exit/);
    expect(body).toContain('Failed to install co-managed write admission');
  });
});

describe('REST error mapping (real handleApiError)', () => {
  it.each([
    ['read_only', 423, 'CO_MANAGED_READ_ONLY'],
    ['terminated', 423, 'CO_MANAGED_READ_ONLY'],
    ['pending_acceptance', 409, 'CO_MANAGED_NOT_ACTIVE'],
  ] as const)('a thrown CoManagedLifecycleError (%s) becomes HTTP %i / %s', async (state, status, code) => {
    const { handleApiError } = await import('server/src/lib/api/middleware/apiMiddleware');
    const { CoManagedLifecycleError } = await import('@alga-psa/licensing/lib/co-managed-lifecycle-error');
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = handleApiError(new CoManagedLifecycleError({ state, canWrite: false, graceEndsAt: null }));
      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body.error.code).toBe(code);
    } finally {
      quiet.mockRestore();
    }
  });
});
