import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { AMP_ENTITY_TABLES, AMP_LIMITS } from '@alga-psa/migration-spec';
import { canonicalAttachmentsSha256 } from '../src/builder';
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

  it('packages attachment bytes by digest and validates their owner and canonical index', () => {
    const path = nextPath();
    const blob = Buffer.from('customer document bytes');
    const blobPath = join(workDir, 'attachment.bin');
    writeFileSync(blobPath, blob);
    const sha256 = createHash('sha256').update(blob).digest('hex');
    const rows = sampleEntityRows();
    rows.attachments = [{
      package_record_id: 'attachment-1', entity_type: 'assets',
      entity_package_record_id: String(rows.assets![0].package_record_id),
      sha256, size: blob.length, media_type: 'application/octet-stream', file_name: '../../source-name.bin',
    }];
    new AmpPackageBuilder(path).write(sampleManifest(), rows, [{ sha256, size: blob.length, filePath: blobPath }]);
    expect(validateAmpPackage(path).valid).toBe(true);
    const reader = new AmpSqliteReader(path);
    try {
      expect(readFileSync(reader.attachmentPath(sha256)!)).toEqual(blob);
    } finally { reader.close(); }
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

  const testRequire = createRequire(import.meta.url);

  interface RawSqlite {
    DatabaseSync: new (path: string) => {
      exec(sql: string): void;
      prepare(sql: string): { run(...params: unknown[]): unknown };
      close(): void;
    };
  }

  function rawDb(path: string) {
    const { DatabaseSync } = testRequire('node:sqlite') as RawSqlite;
    const zip = new AdmZip(path);
    const databasePath = join(workDir, `mutation-${++fileCounter}.sqlite`);
    writeFileSync(databasePath, zip.readFile('data.sqlite')!);
    const db = new DatabaseSync(databasePath);
    return {
      exec: (sql: string) => db.exec(sql),
      prepare: (sql: string) => db.prepare(sql),
      close: () => {
        db.close();
        zip.updateFile('data.sqlite', readFileSync(databasePath));
        zip.writeZip(path);
        unlinkSync(databasePath);
      },
    };
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

  it('rejects unsafe ZIP entries before using their paths', () => {
    const path = nextPath();
    buildSamplePackage(path);
    const zip = new AdmZip(path);
    zip.addFile('../outside', Buffer.from('must not be extracted'));
    zip.writeZip(path);
    expect(validateAmpPackage(path).valid).toBe(false);
  });

  it('rejects attachment bytes whose content no longer matches the indexed digest', () => {
    const path = nextPath(), blobPath = join(workDir, 'tamper-source.bin');
    const bytes = Buffer.from('verified attachment'), sha256 = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(blobPath, bytes);
    const rows = sampleEntityRows();
    rows.attachments = [{ package_record_id: 'attachment-tamper', entity_type: 'assets', entity_package_record_id: 'asset-fw-1', sha256, size: bytes.length }];
    new AmpPackageBuilder(path).write(sampleManifest(), rows, [{ sha256, size: bytes.length, filePath: blobPath }]);
    const zip = new AdmZip(path);
    zip.updateFile(`attachments/${sha256.slice(0, 2)}/${sha256}`, Buffer.from('tampered'));
    zip.writeZip(path);
    expect(validateAmpPackage(path).valid).toBe(false);
  });

  it('rejects an indexed attachment size mismatch even when the canonical index hash is recomputed', () => {
    const path = nextPath(), blobPath = join(workDir, 'size-source.bin');
    const bytes = Buffer.from('size must match actual bytes'), sha256 = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(blobPath, bytes);
    const rows = sampleEntityRows();
    rows.attachments = [{ package_record_id: 'attachment-size', entity_type: 'assets', entity_package_record_id: 'asset-fw-1', sha256, size: bytes.length }];
    new AmpPackageBuilder(path).write(sampleManifest(), rows, [{ sha256, size: bytes.length, filePath: blobPath }]);
    const db = rawDb(path);
    db.prepare('UPDATE attachments SET size = ? WHERE package_record_id = ?').run(bytes.length + 1, 'attachment-size');
    db.prepare('UPDATE amp_manifest SET attachments_sha256 = ?').run(canonicalAttachmentsSha256([{ sha256, size: bytes.length + 1 }]));
    db.close();
    const result = validateAmpPackage(path);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('size does not match'))).toBe(true);
  });

  it('rejects a builder attachment index whose size differs from supplied bytes', () => {
    const path = nextPath(), blobPath = join(workDir, 'builder-size-source.bin');
    const bytes = Buffer.from('builder checks indexed sizes'), sha256 = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(blobPath, bytes);
    const rows = sampleEntityRows();
    rows.attachments = [{ package_record_id: 'attachment-size-builder', entity_type: 'assets', entity_package_record_id: 'asset-fw-1', sha256, size: bytes.length + 1 }];
    expect(() => new AmpPackageBuilder(path).write(sampleManifest(), rows, [{ sha256, size: bytes.length, filePath: blobPath }])).toThrow(/index and ZIP content/);
  });

  it('permits anonymous exclusion records for omitted private entities', () => {
    const path = nextPath();
    const rows = sampleEntityRows();
    rows.exclusions = [{ package_record_id: 'private-comment-1', entity_type: null, entity_package_record_id: null, reason: 'msp_private', detail: 'One private comment omitted without identifying it.' }];
    new AmpPackageBuilder(path).write(sampleManifest(), rows);
    expect(validateAmpPackage(path).valid).toBe(true);
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

  it('rejects invalid and duplicate custom field values', () => {
    const path = nextPath();
    const rows = sampleEntityRows();
    new AmpPackageBuilder(path).write(sampleManifest(), {
      ...rows,
      custom_field_values: [
        { package_record_id: 'cf-1', entity_type: 'assets', entity_package_record_id: String((rows.assets![0] as any).package_record_id), field_name: 'RAM', value_json: 'not-json' },
        { package_record_id: 'cf-2', entity_type: 'assets', entity_package_record_id: String((rows.assets![0] as any).package_record_id), field_name: 'RAM', value_json: '"16"' },
        { package_record_id: 'cf-3', entity_type: 'assets', entity_package_record_id: String((rows.assets![0] as any).package_record_id), field_name: 'Nested', value_json: `${'{"a":'.repeat(AMP_LIMITS.extensionJsonDepth + 2)}1${'}'.repeat(AMP_LIMITS.extensionJsonDepth + 2)}` },
      ],
    });
    const result = validateAmpPackage(path);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'AMP_INVALID_VALUE').length).toBeGreaterThanOrEqual(3);
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
    new AmpPackageBuilder(path).write(sampleManifest({ format_version: '3.0.0' }), sampleEntityRows());
    const result = validateAmpPackage(path);
    expect(result.valid).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.code === 'AMP_UNSUPPORTED_VERSION');
    expect(diagnostic?.message).toContain('major version 3');
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

describe('AMP products and vendor_products entities', () => {
  const baseIds = {
    source_record_id: 's',
    external_identifier_namespace: 'ns',
  };

  function build(rows: Record<string, unknown[]>): ReturnType<typeof validateAmpPackage> {
    const path = nextPath();
    new AmpPackageBuilder(path).write(sampleManifest(), rows as never);
    return validateAmpPackage(path);
  }

  it('includes both tables in the entity allowlist and validates the sample', () => {
    expect(AMP_ENTITY_TABLES).toContain('products');
    expect(AMP_ENTITY_TABLES).toContain('vendor_products');
    const path = nextPath();
    buildSamplePackage(path);
    const result = validateAmpPackage(path);
    expect(result.diagnostics).toEqual([]);
    expect(result.rowCounts.products).toBe(1);
    expect(result.rowCounts.vendor_products).toBe(1);
  });

  it('rejects extra columns on products', () => {
    const builder = new AmpPackageBuilder(nextPath());
    expect(() =>
      builder.write(sampleManifest(), {
        products: [{ package_record_id: 'p', ...baseIds, name: 'x', surprise: 1 } as never],
      })
    ).toThrow(/not allowlisted/);
  });

  it('rejects a products table with a missing column', () => {
    const path = nextPath();
    buildSamplePackage(path);
    const zip = new AdmZip(path);
    const databasePath = join(workDir, `mutation-${++fileCounter}.sqlite`);
    writeFileSync(databasePath, zip.readFile('data.sqlite')!);
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
      DatabaseSync: new (p: string) => { exec(sql: string): void; close(): void };
    };
    const db = new DatabaseSync(databasePath);
    db.exec('ALTER TABLE vendor_products DROP COLUMN lead_time_days');
    db.close();
    zip.updateFile('data.sqlite', readFileSync(databasePath));
    zip.writeZip(path);
    unlinkSync(databasePath);
    const result = validateAmpPackage(path);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'AMP_SCHEMA_MISMATCH' && d.table === 'vendor_products')).toBe(true);
  });

  it('requires a product name and a vendor name', () => {
    const result = build({
      products: [{ package_record_id: 'p', ...baseIds, name: '' }],
      vendor_products: [{ package_record_id: 'v', ...baseIds, product_sku: 'A', vendor_name: '' }],
    });
    const fields = result.diagnostics.map((d) => `${d.table}.${d.field}`);
    expect(fields).toContain('products.name');
    expect(fields).toContain('vendor_products.vendor_name');
  });

  it('rejects negative, fractional and out-of-range numeric values', () => {
    const result = build({
      products: [
        { package_record_id: 'p', ...baseIds, name: 'x', price_minor: -1, cost_minor: 1.5, is_active: 2 },
      ],
      vendor_products: [
        { package_record_id: 'v', ...baseIds, product_sku: 'A', vendor_name: 'V', unit_cost_minor: -5, lead_time_days: 99999, is_preferred: 7 },
      ],
    });
    const fields = result.diagnostics.map((d) => `${d.table}.${d.field}`);
    for (const expected of [
      'products.price_minor',
      'products.cost_minor',
      'products.is_active',
      'vendor_products.unit_cost_minor',
      'vendor_products.lead_time_days',
      'vendor_products.is_preferred',
    ]) {
      expect(fields).toContain(expected);
    }
  });

  it('rejects malformed currency codes', () => {
    const result = build({
      products: [{ package_record_id: 'p', ...baseIds, name: 'x', price_minor: 1, price_currency: 'usd' }],
    });
    expect(result.diagnostics.some((d) => d.field === 'price_currency')).toBe(true);
  });

  it('requires a product reference or product_sku on vendor_products', () => {
    const result = build({
      vendor_products: [{ package_record_id: 'v', ...baseIds, vendor_name: 'V' }],
    });
    expect(result.diagnostics.some((d) => d.table === 'vendor_products' && d.field === 'product_package_record_id')).toBe(true);
  });

  it('accepts product_sku alone and rejects a dangling product reference', () => {
    expect(
      build({ vendor_products: [{ package_record_id: 'v', ...baseIds, product_sku: 'A', vendor_name: 'V' }] }).diagnostics
    ).toEqual([]);
    const dangling = build({
      vendor_products: [{ package_record_id: 'v', ...baseIds, product_package_record_id: 'nope', vendor_name: 'V' }],
    });
    expect(dangling.diagnostics.some((d) => d.code === 'AMP_INVALID_REFERENCE')).toBe(true);
  });
});
