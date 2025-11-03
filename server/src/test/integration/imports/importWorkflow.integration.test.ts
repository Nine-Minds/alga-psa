import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { TestContext } from 'server/test-utils/testContext';
import { ImportRegistry } from '@/lib/imports/ImportRegistry';
import { registerDefaultImporters } from '@/lib/imports/registerDefaultImporters';
import { ImportManager } from '@/lib/imports/ImportManager';
import { getAssetFieldDefinitions } from '@/lib/imports/assetFieldDefinitions';
import { DuplicateDetector } from '@/lib/imports/DuplicateDetector';
import { NableExportImporter } from '@/lib/imports/NableExportImporter';
import type { ParsedRecord } from '@/types/imports.types';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 240_000;

describe('Asset import integration', () => {
  let ctx: TestContext;
  const assetType = 'workstation';
  let clientId: string;
  let getConnectionSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: [
        'external_entity_mappings',
        'import_job_items',
        'import_jobs',
        'import_sources',
        'assets',
        'asset_types',
        'companies'
      ]
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
    ImportRegistry.getInstance().clear();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();

    const dbModule = await import('server/src/lib/db/db');
    getConnectionSpy = vi.spyOn(dbModule, 'getConnection').mockResolvedValue(ctx.db);

    await ctx.db.raw("SELECT set_config('app.current_tenant', ?, false)", [ctx.tenantId]);

    clientId = ctx.clientId;
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    if (getConnectionSpy) {
      getConnectionSpy.mockRestore();
      getConnectionSpy = null;
    }
    ImportRegistry.getInstance().clear();
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  async function insertAsset(overrides: {
    assetId?: string;
    assetTag?: string;
    serialNumber?: string | null;
    name?: string;
    status?: string;
    attributes?: Record<string, unknown>;
    assetType?: string;
  }): Promise<string> {
    const assetId = overrides.assetId ?? uuidv4();
    const now = new Date().toISOString();

    await ctx.db('assets').insert({
      tenant: ctx.tenantId,
      asset_id: assetId,
      asset_type: overrides.assetType ?? assetType,
      client_id: clientId,
      asset_tag: overrides.assetTag ?? `TAG-${assetId.slice(0, 6)}`,
      serial_number: overrides.serialNumber ?? null,
      name: overrides.name ?? 'Imported Asset',
      status: overrides.status ?? 'active',
      attributes: overrides.attributes ?? {},
      created_at: now,
      updated_at: now
    });

    return assetId;
  }

  function createRegistry(): ImportRegistry {
    const registry = ImportRegistry.getInstance();
    registry.clear();
    registerDefaultImporters(registry);
    return registry;
  }

  it('registers default CSV/RMM importers in the database', async () => {
    const registry = createRegistry();
    const manager = new ImportManager(registry);

    const sources = await manager.getAvailableSources(ctx.tenantId);

    expect(sources.map((source) => source.sourceType).sort()).toEqual([
      'connectwise_rmm_export',
      'csv_upload',
      'datto_rmm_export',
      'n-able_export'
    ]);

    const nableSource = sources.find((source) => source.sourceType === 'n-able_export');
    expect(nableSource?.fieldMapping?.['Device Name']?.target).toBe('name');
    expect(nableSource?.fieldMapping?.['Device Name']?.required).toBe(true);
    expect(nableSource?.duplicateDetectionFields).toEqual([
      'serial_number',
      'asset_tag',
      'mac_address',
      'hostname'
    ]);
    expect(
      (nableSource?.metadata?.duplicateDetectionStrategy as { exactFields: string[] } | undefined)?.exactFields
    ).toEqual(['serial_number', 'asset_tag', 'mac_address', 'hostname']);

    const connectWiseSource = sources.find((source) => source.sourceType === 'connectwise_rmm_export');
    expect(connectWiseSource?.fieldMapping?.['Computer Name']?.target).toBe('name');
    expect(
      (connectWiseSource?.metadata?.duplicateDetectionStrategy as { allowMultipleMatches?: boolean } | undefined)
        ?.allowMultipleMatches
    ).toBe(true);

    const persisted = await ctx
      .db('import_sources')
      .where({ tenant: ctx.tenantId })
      .select('source_type', 'metadata', 'field_mapping')
      .orderBy('source_type');

    expect(persisted).toHaveLength(4);
    expect(
      persisted
        .find((row) => row.source_type === 'n-able_export')
        ?.field_mapping?.['Device Name']?.target
    ).toBe('name');
  });

  it('generates preview summaries with validation and duplicate detection for N-able exports', async () => {
    const registry = createRegistry();
    const manager = new ImportManager(registry);

    const sources = await manager.getAvailableSources(ctx.tenantId);
    const nableSource = sources.find((source) => source.sourceType === 'n-able_export');
    expect(nableSource).toBeDefined();

    const importer = registry.get('n-able_export') as NableExportImporter;
    const fieldMapping = importer.getDefaultFieldMapping();

    const csv = [
      'Device Name,Device Type,Device ID,Serial Number,MAC Address,IP Address',
      'Aurora-WS-01,Workstation,UID-001,SN-UNIQUE,AA-BB-CC-DD-EE-11,192.168.10.2',
      'Existing Device,Workstation,UID-002,SERIAL-DUP,AA-BB-CC-DD-EE-22,10.0.0.5',
      ',Server,UID-003,SN-ERR,AA-BB-CC-DD-EE-33,not-an-ip'
    ].join('\n');

    const records = await importer.parse(Buffer.from(csv, 'utf8'));

    expect(records[0].metadata?.vendor).toBe('n-able');
    expect(records[0].externalId).toBe('UID-001');

    const duplicateAssetId = await insertAsset({
      name: 'Existing Device',
      serialNumber: 'SERIAL-DUP',
      assetTag: 'TAG-DUP',
      attributes: { mac_address: 'AA:BB:CC:DD:EE:22' }
    });

    const job = await manager.initiateImport(ctx.tenantId, nableSource!.id, {
      createdBy: ctx.userId,
      file: {
        fileName: 'devices.csv',
        originalName: 'devices.csv',
        size: csv.length,
        mimeType: 'text/csv'
      },
      totalRows: records.length
    });

    const duplicateStrategy = importer.getDuplicateDetectionStrategy();
    expect(duplicateStrategy).toBeDefined();

    const preview = await manager.preparePreview({
      tenantId: ctx.tenantId,
      importJobId: job.import_job_id,
      records,
      fieldDefinitions: getAssetFieldDefinitions(),
      fieldMapping,
      duplicateDetector: new DuplicateDetector(ctx.tenantId, duplicateStrategy!)
    });

    expect(preview.summary.totalRows).toBe(3);
    expect(preview.summary.duplicateRows).toBe(1);
    expect(preview.summary.errorRows).toBe(1);
    expect(preview.summary.validRows).toBe(1);

    const duplicateRow = preview.preview.rows.find((row) => row.duplicate?.isDuplicate);
    expect(duplicateRow?.duplicate?.matchedAssetId).toBe(duplicateAssetId);
    expect(['serial_number', 'asset_tag', 'mac_address', 'hostname']).toContain(
      duplicateRow?.duplicate?.matchType
    );

    const errorRow = preview.preview.rows.find((row) => (row.validationErrors?.length ?? 0) > 0);
    expect(errorRow?.validationErrors?.some((error) => error.field === 'name')).toBe(true);
    expect(errorRow?.validationErrors?.some((error) => error.field === 'ip_address')).toBe(true);

    expect(preview.preview.rows.every((row) => !!row.externalHash)).toBe(true);

    const persistedJob = await ctx
      .db('import_jobs')
      .where({ tenant: ctx.tenantId, import_job_id: job.import_job_id })
      .first();

    expect(persistedJob?.status).toBe('preview');
    expect(persistedJob?.duplicate_rows).toBe(1);
    expect(persistedJob?.error_rows).toBe(1);
    expect(persistedJob?.preview_data.summary.validRows).toBe(1);
    expect(persistedJob?.preview_data.summary.duplicateRows).toBe(1);
  });

  it('detects duplicates via MAC normalization and fuzzy hostname matches', async () => {
    const assetId = await insertAsset({
      name: 'Office Laptop 01',
      serialNumber: 'SER-001',
      assetTag: 'TAG-001',
      attributes: { mac_address: 'AA:BB:CC:DD:EE:FF' }
    });

    const detector = new DuplicateDetector(ctx.tenantId, {
      exactFields: ['mac_address'],
      fuzzyFields: ['name'],
      fuzzyThreshold: 0.8
    });

    const macMatch = await detector.check({
      rowNumber: 1,
      raw: {
        name: 'Office Laptop 01',
        mac_address: 'aa-bb-cc-dd-ee-ff'
      },
      normalized: {
        name: 'Office Laptop 01',
        mac_address: 'aa-bb-cc-dd-ee-ff'
      }
    } satisfies ParsedRecord);

    expect(macMatch.isDuplicate).toBe(true);
    expect(macMatch.matchType).toBe('mac_address');
    expect(macMatch.matchedAssetId).toBe(assetId);

    const fuzzyMatch = await detector.check({
      rowNumber: 2,
      raw: {
        name: 'office-laptop 01',
        mac_address: 'aa-bb-cc-dd-ee-00'
      },
      normalized: {
        name: 'office-laptop 01',
        mac_address: 'aa-bb-cc-dd-ee-00'
      }
    } satisfies ParsedRecord);

    expect(fuzzyMatch.isDuplicate).toBe(true);
    expect(fuzzyMatch.matchType).toBe('fuzzy:name');
    expect(fuzzyMatch.matchedAssetId).toBe(assetId);
    expect(fuzzyMatch.confidence).toBeGreaterThan(0.8);
  });
});
