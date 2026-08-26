import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AmpSqliteReader, checkProducerConformance } from '@alga-psa/migration-sdk';
import { listConnectors } from '../src/index';
import { connectwisePsaCsvConnector, connectwisePsaCsvDescriptor } from '../src/connectwise/index';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'connectwise');

const RFC3339_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const EXPECTED_COUNTS = {
  organizations: 3,
  locations: 4,
  contacts: 5,
  tickets: 6,
  ticket_comments: 8,
  assets: 5,
};

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'amp-connectwise-test-'));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('connectwise-psa-csv', () => {
  it('is discoverable through the connector registry', () => {
    const names = listConnectors().map((connector) => connector.descriptor.name);
    expect(names).toContain('connectwise-psa-csv');
  });

  it('documents omissions and prerequisites', () => {
    const omissions = connectwisePsaCsvDescriptor.knownOmissions.join(' ');
    expect(omissions).toMatch(/time entries/i);
    expect(omissions).toMatch(/agreements/i);
    expect(omissions).toMatch(/invoices/i);
    expect(omissions).toMatch(/attachments/i);
    expect(connectwisePsaCsvDescriptor.prerequisites.join(' ')).toMatch(/CSV export/i);
    expect(Object.keys(connectwisePsaCsvDescriptor.entityCoverage).sort()).toEqual(
      Object.keys(EXPECTED_COUNTS).sort()
    );
  });

  it('produces a conformant package from a directory of CSV exports', async () => {
    const outputPath = join(workDir, 'connectwise.amp');
    const { manifest, rowCounts } = await connectwisePsaCsvConnector.produce({
      inputDir: fixturesDir,
      outputPath,
      namespace: 'fixture.example',
    });

    expect(rowCounts).toEqual(EXPECTED_COUNTS);
    expect(manifest.producer_name).toBe('connectwise-psa-csv');
    expect(manifest.source_system).toBe('connectwise-psa');
    expect(manifest.created_at).toMatch(RFC3339_SECONDS);

    const report = checkProducerConformance(outputPath, { expectedCounts: EXPECTED_COUNTS });
    expect(report.validation.diagnostics).toEqual([]);
    expect(report.countMismatches).toEqual([]);
    expect(report.conformant).toBe(true);

    const reader = new AmpSqliteReader(outputPath);
    try {
      const organizations = reader.allRows('organizations');
      const northwind = organizations.find(
        (row) => row.package_record_id === 'organizations-101'
      );
      expect(northwind?.name).toBe('Northwind Dental');
      expect(northwind?.external_identifier_namespace).toBe('connectwise:fixture.example');

      const tickets = reader.allRows('tickets');
      const bootTicket = tickets.find((row) => row.package_record_id === 'tickets-401');
      expect(bootTicket).toMatchObject({
        status_name: 'New',
        priority_name: 'High',
        category_name: 'Service Desk',
        organization_package_record_id: 'organizations-101',
        requester_package_record_id: 'contacts-301',
      });
      expect(bootTicket?.created_at).toBe('2026-01-05T09:30:00Z');
      expect(bootTicket?.updated_at).toBe('2026-01-05T10:15:00Z');

      const onboarding = tickets.find((row) => row.package_record_id === 'tickets-404');
      expect(onboarding?.closed_at).toBe('2026-01-14T16:30:00Z');
      const posTicket = tickets.find((row) => row.package_record_id === 'tickets-405');
      expect(posTicket?.priority_name).toBe('Priority 1');

      const comments = reader.allRows('ticket_comments');
      const internalNote = comments.find(
        (row) => row.package_record_id === 'ticket_comments-502'
      );
      expect(internalNote).toMatchObject({
        ticket_package_record_id: 'tickets-401',
        is_internal: 1,
      });
      const publicNote = comments.find(
        (row) => row.package_record_id === 'ticket_comments-501'
      );
      expect(publicNote).toMatchObject({
        is_internal: 0,
        author_package_record_id: 'contacts-301',
      });
      const numericFlagNote = comments.find(
        (row) => row.package_record_id === 'ticket_comments-504'
      );
      expect(numericFlagNote?.is_internal).toBe(1);

      const assets = reader.allRows('assets');
      const workstation = assets.find((row) => row.package_record_id === 'assets-601');
      expect(workstation).toMatchObject({
        purchase_date: '2023-03-15',
        organization_package_record_id: 'organizations-101',
        asset_type_name: 'Workstation',
      });
      const nas = assets.find((row) => row.package_record_id === 'assets-604');
      expect(nas?.purchase_date).toBe('2024-05-06');

      const locations = reader.allRows('locations');
      const roastery = locations.find((row) => row.package_record_id === 'locations-204');
      expect(roastery?.organization_package_record_id).toBe('organizations-103');
    } finally {
      reader.close();
    }
  });

  it('fails fast when a required export file is missing', async () => {
    await expect(
      connectwisePsaCsvConnector.produce({
        inputDir: workDir,
        outputPath: join(workDir, 'never.amp'),
        namespace: 'fixture.example',
      })
    ).rejects.toThrow(/missing required file/);
  });
});
