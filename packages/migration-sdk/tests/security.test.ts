import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSamplePackage, openPackageDatabase } from '../src/index';

/**
 * Runtime security posture of the package-reading seam: an AMP file is
 * untrusted input, opened read-only with extensions disabled. These tests
 * attack the open database handle itself, complementing the validator
 * attack suite in package.test.ts.
 */

let dir: string;
let packagePath: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'amp-security-'));
  packagePath = join(dir, 'sample.amp');
  buildSamplePackage(packagePath);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('package database handle', () => {
  it('rejects writes through the read-only seam', () => {
    const db = openPackageDatabase(packagePath);
    try {
      expect(() =>
        db.exec("INSERT INTO organizations (package_record_id, source_record_id, external_identifier_namespace, name) VALUES ('x', 'x', 'x', 'x')")
      ).toThrow();
      expect(() => db.exec('DELETE FROM organizations')).toThrow();
      expect(() => db.exec('DROP TABLE organizations')).toThrow();
    } finally {
      db.close();
    }
  });

  it('rejects a SQLite extension loading attempt', () => {
    const db = openPackageDatabase(packagePath);
    try {
      expect(() => db.exec("SELECT load_extension('/tmp/evil.so')")).toThrow();
      expect(() =>
        db.prepare("SELECT load_extension('/tmp/evil.so')").get()
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('rejects schema-altering pragmas on the read-only handle', () => {
    const db = openPackageDatabase(packagePath);
    try {
      // journal_mode=wal requires a write; a read-only handle must refuse it.
      const result = db.prepare('PRAGMA journal_mode = wal').get() as
        | { journal_mode?: string }
        | undefined;
      expect(result?.journal_mode ?? 'delete').not.toBe('wal');
    } finally {
      db.close();
    }
  });
});
