/**
 * A8: every process that can write native rows installs the co-managed resolver, fail-open,
 * so a missing/unresolvable co-managed package never stops a worker booting.
 */
import { describe, expect, it } from 'vitest';
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
    expect(source).toContain('installCoManagedWriteAdmission()');
  });

  it('fails open: the install sits inside a try whose catch only reports', () => {
    const at = source.indexOf('installCoManagedWriteAdmission()');
    const tryAt = source.lastIndexOf('try {', at);
    const catchAt = source.indexOf('catch (error)', at);
    expect(tryAt).toBeGreaterThan(-1);
    expect(catchAt).toBeGreaterThan(at);
    const body = source.slice(catchAt, source.indexOf('}', catchAt) + 1);
    expect(body).not.toMatch(/\bthrow\b|process\.exit/);
    expect(body).toContain('Failed to install co-managed write admission');
  });
});

describe('REST error mapping', () => {
  it('maps the refusal codes centrally to 409 / 423', () => {
    const source = fs.readFileSync(path.join(ROOT, 'server/src/lib/api/middleware/apiMiddleware.ts'), 'utf8');
    expect(source).toMatch(/CO_MANAGED_NOT_ACTIVE:\s*409/);
    expect(source).toMatch(/CO_MANAGED_READ_ONLY:\s*423/);
  });
});
