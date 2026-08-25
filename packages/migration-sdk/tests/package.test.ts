import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AMP_ENTITY_TABLES, AMP_LIMITS } from '@alga-psa/migration-spec';
import {
  AmpPackageBuilder,
  AmpSqliteReader,
  buildSamplePackage,
  checkProducerConformance,
  sampleEntityRows,
  sampleManifest,
  validateAmpPackage,
} from '../src/index';

const workDir = mkdtempSync(join(tmpdir(), 'amp-sdk-'));
let fileCounter = 0;

function nextPath(): string {
  fileCounter += 1;
  return join(workDir, `package-${fileCounter}.amp`);
}

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('AMP package round trip', () => {
  it('builds a package independently of server code and validates cleanly', () => {
    const path = nextPath();
    const manifest = buildSamplePackage(path);
    expect(manifest.content_sha256).toMatch(/^[0-9a-f]{64}$/);

    const result = validateAmpPackage(path);
    expect(result.diagnostics).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.manifest?.package_id).toBe('amp-sample-package');
    for (const table of AMP_ENTITY_TABLES) {
      expect(result.rowCounts[table]).toBe(1);
    }
  });

  it('reads rows back through the reader seam in deterministic batches', () => {
    const path = nextPath();
    buildSamplePackage(path);
    const reader = new AmpSqliteReader(path);
    try {
      const organizations = reader.allRows('organizations');
      expect(organizations).toHaveLength(1);
      expect(organizations[0].name).toBe('Acme Managed Networks');
      expect([...reader.readRows('tickets', 1)]).toHaveLength(1);
    } finally {
      reader.close();
    }
  });

  it('passes producer conformance for the claimed coverage', () => {
    const path = nextPath();
    buildSamplePackage(path);
    const report = checkProducerConformance(path, {
      expectedCounts: { organizations: 1, tickets: 1, assets: 1 },
    });
    expect(report.countMismatches).toEqual([]);
    expect(report.conformant).toBe(true);
  });
});

describe('AMP builder allowlisting', () => {
  it('rejects non-allowlisted tables', () => {
    const builder = new AmpPackageBuilder(nextPath());
    expect(() =>
      builder.write(sampleManifest(), { evil_table: [{ package_record_id: 'x' }] } as never)
    ).toThrow(/non-allowlisted table/);
  });

  it('rejects non-allowlisted columns', () => {
    const builder = new AmpPackageBuilder(nextPath());
    expect(() =>
      builder.write(sampleManifest(), {
        organizations: [
          {
            package_record_id: 'org-1',
            source_record_id: 's1',
            external_identifier_namespace: 'ns',
            name: 'A',
            sneaky_column: 'x',
          } as never,
        ],
      })
    ).toThrow(/not allowlisted/);
  });
});

describe('AMP validator attacks', () => {
  function buildWith(mutate: (path: string) => void): ReturnType<typeof validateAmpPackage> {
    const path = nextPath();
    buildSamplePackage(path);
    mutate(path);
    return validateAmpPackage(path);
  }

  function rawDb(path: string) {
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    return new DatabaseSync(path);
  }

  it('rejects a file that is not SQLite', () => {
    const path = nextPath();
    writeFileSync(path, 'name,external_id\nrouter,1\n');
    const result = validateAmpPackage(path);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain('AMP_NOT_SQLITE');
  });

  it('reports a missing file', () => {
    const result = validateAmpPackage(join(workDir, 'does-not-exist.amp'));
    expect(result.diagnostics.map((d) => d.code)).toEqual(['AMP_FILE_NOT_FOUND']);
  });

  it('rejects a package with an unknown table', () => {
    const result = buildWith((path) => {
      const db = rawDb(path);
      db.exec('CREATE TABLE exfiltration (payload TEXT)');
      db.close();
    });
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain('AMP_UNKNOWN_TABLE');
  });

  it('rejects a package containing a trigger', () => {
    const result = buildWith((path) => {
      const db = rawDb(path);
      db.exec(
        'CREATE TRIGGER evil AFTER INSERT ON organizations BEGIN DELETE FROM organizations; END'
      );
      db.close();
    });
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain('AMP_FORBIDDEN_SQLITE_OBJECT');
  });

  it('rejects a package containing a view', () => {
    const result = buildWith((path) => {
      const db = rawDb(path);
      db.exec('CREATE VIEW spy AS SELECT * FROM organizations');
      db.close();
    });
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain('AMP_FORBIDDEN_SQLITE_OBJECT');
  });

  it('rejects a table whose columns deviate from the spec', () => {
    const result = buildWith((path) => {
      const db = rawDb(path);
      db.exec('ALTER TABLE organizations ADD COLUMN alga_client_id TEXT');
      db.close();
    });
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain('AMP_SCHEMA_MISMATCH');
  });

  it('rejects a giant string value', () => {
    const rows = sampleEntityRows();
    const path = nextPath();
    new AmpPackageBuilder(path).write(sampleManifest(), {
      ...rows,
      tickets: [
        {
          ...(rows.tickets![0] as object),
          description: 'x'.repeat(AMP_LIMITS.textBytes + 1),
        } as never,
      ],
    });
    const result = validateAmpPackage(path);
    expect(result.valid).toBe(false);
    expect(
      result.diagnostics.some((d) => d.code === 'AMP_LIMIT_EXCEEDED' && d.field === 'description')
    ).toBe(true);
  });

  it('rejects deeply nested extension_json', () => {
    const rows = sampleEntityRows();
    const nested = `${'{"a":'.repeat(AMP_LIMITS.extensionJsonDepth + 2)}1${'}'.repeat(AMP_LIMITS.extensionJsonDepth + 2)}`;
    const path = nextPath();
    new AmpPackageBuilder(path).write(sampleManifest(), {
      ...rows,
      organizations: [{ ...(rows.organizations![0] as object), extension_json: nested } as never],
    });
    const result = validateAmpPackage(path);
    expect(result.valid).toBe(false);
    expect(
      result.diagnostics.some((d) => d.code === 'AMP_LIMIT_EXCEEDED' && d.field === 'extension_json')
    ).toBe(true);
  });

  it('rejects an unresolved relationship', () => {
    const rows = sampleEntityRows();
    const path = nextPath();
    new AmpPackageBuilder(path).write(sampleManifest(), {
      ...rows,
      ticket_comments: [
        {
          ...(rows.ticket_comments![0] as object),
          ticket_package_record_id: 'ticket-does-not-exist',
        } as never,
      ],
    });
    const result = validateAmpPackage(path);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain('AMP_INVALID_REFERENCE');
  });

  it('rejects a duplicated package_record_id', () => {
    const result = buildWith((path) => {
      const db = rawDb(path);
      // Bypass the PRIMARY KEY by rebuilding the table without it.
      db.exec(`
        CREATE TABLE organizations_copy AS SELECT * FROM organizations;
        INSERT INTO organizations_copy SELECT * FROM organizations;
        DROP TABLE organizations;
        CREATE TABLE organizations (
          package_record_id TEXT, source_record_id TEXT, external_identifier_namespace TEXT,
          created_at TEXT, updated_at TEXT, extension_json TEXT,
          name TEXT, website TEXT, phone TEXT
        );
        INSERT INTO organizations SELECT * FROM organizations_copy;
        DROP TABLE organizations_copy;
      `);
      db.close();
    });
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain('AMP_DUPLICATE_RECORD_ID');
  });

  it('rejects a tampered content hash', () => {
    const result = buildWith((path) => {
      const db = rawDb(path);
      db.prepare('UPDATE organizations SET name = ?').run('Tampered Name');
      db.close();
    });
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain('AMP_HASH_MISMATCH');
  });

  it('rejects a manifest with more than one row', () => {
    const result = buildWith((path) => {
      const db = rawDb(path);
      db.exec("INSERT INTO amp_manifest SELECT * FROM amp_manifest");
      db.close();
    });
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain('AMP_INVALID_MANIFEST');
  });

  it('rejects an unsupported format version with a reason', () => {
    const path = nextPath();
    new AmpPackageBuilder(path).write(sampleManifest({ format_version: '2.0.0' }), sampleEntityRows());
    const result = validateAmpPackage(path);
    expect(result.valid).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === 'AMP_UNSUPPORTED_VERSION');
    expect(diagnostic?.message).toContain('major version 2');
  });

  it('rejects an invalid timestamp value', () => {
    const rows = sampleEntityRows();
    const path = nextPath();
    new AmpPackageBuilder(path).write(sampleManifest(), {
      ...rows,
      tickets: [{ ...(rows.tickets![0] as object), created_at: '02/10/2026 3:04 PM' } as never],
    });
    const result = validateAmpPackage(path);
    expect(result.valid).toBe(false);
    expect(
      result.diagnostics.some((d) => d.code === 'AMP_INVALID_VALUE' && d.field === 'created_at')
    ).toBe(true);
  });

  it('enforces the package byte limit', () => {
    const path = nextPath();
    buildSamplePackage(path);
    const result = validateAmpPackage(path, { ...AMP_LIMITS, packageBytes: 16 });
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain('AMP_LIMIT_EXCEEDED');
  });

  it('enforces the per-entity row limit', () => {
    const path = nextPath();
    buildSamplePackage(path);
    const result = validateAmpPackage(path, { ...AMP_LIMITS, rowsPerEntity: 0 });
    expect(result.valid).toBe(false);
    expect(
      result.diagnostics.some((d) => d.code === 'AMP_LIMIT_EXCEEDED' && d.table === 'organizations')
    ).toBe(true);
  });
});
