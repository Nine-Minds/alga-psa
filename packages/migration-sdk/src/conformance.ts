import {
  AMP_FORMAT_VERSION,
  type AmpPackageRows,
  type AmpManifest,
} from '@alga-psa/migration-spec';
import { AmpPackageBuilder, type AmpManifestInput } from './builder';
import { validateAmpPackage, type AmpValidationResult } from './validator';

/**
 * Conformance helpers shared by SDK tests, connector test suites, and the
 * CLI. A producer is conformant when the packages it emits validate cleanly
 * and carry the canonical records it claims to cover.
 */

export function sampleManifest(overrides: Partial<AmpManifestInput> = {}): AmpManifestInput {
  return {
    format_version: AMP_FORMAT_VERSION,
    package_id: 'amp-sample-package',
    created_at: '2026-08-25T00:00:00Z',
    producer_name: 'amp-conformance',
    producer_version: '1.0.0',
    source_system: 'fixture',
    source_instance_id: 'fixture-instance',
    export_started_at: '2026-08-25T00:00:00Z',
    export_completed_at: '2026-08-25T00:00:01Z',
    ...overrides,
  };
}

/**
 * A dependency-complete sample covering every v1 entity group and both
 * auxiliary record kinds. Fixture producers and tests build packages from it.
 */
export function sampleEntityRows(): AmpPackageRows {
  return {
    organizations: [
      {
        package_record_id: 'org-acme',
        source_record_id: 'src-org-1',
        external_identifier_namespace: 'fixture:instance-1',
        name: 'Acme Managed Networks',
        website: 'https://acme.example',
        phone: '+1-555-0100',
        created_at: '2020-05-01T12:00:00Z',
        updated_at: '2026-01-01T09:30:00Z',
      },
    ],
    locations: [
      {
        package_record_id: 'loc-acme-hq',
        source_record_id: 'src-loc-1',
        external_identifier_namespace: 'fixture:instance-1',
        organization_package_record_id: 'org-acme',
        name: 'Headquarters',
        address_line1: '100 Main Street',
        city: 'Springfield',
        region: 'IL',
        postal_code: '62701',
        country_code: 'US',
      },
    ],
    contacts: [
      {
        package_record_id: 'contact-jane',
        source_record_id: 'src-contact-1',
        external_identifier_namespace: 'fixture:instance-1',
        organization_package_record_id: 'org-acme',
        location_package_record_id: 'loc-acme-hq',
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane.doe@acme.example',
        title: 'IT Manager',
      },
    ],
    tickets: [
      {
        package_record_id: 'ticket-1001',
        source_record_id: 'src-ticket-1',
        external_identifier_namespace: 'fixture:instance-1',
        organization_package_record_id: 'org-acme',
        requester_package_record_id: 'contact-jane',
        title: 'VPN drops every afternoon',
        description: 'Users report VPN disconnects around 3pm daily.',
        status_name: 'Open',
        priority_name: 'High',
        category_name: 'Network',
        created_at: '2026-02-10T15:04:05Z',
      },
    ],
    ticket_comments: [
      {
        package_record_id: 'comment-1',
        source_record_id: 'src-comment-1',
        external_identifier_namespace: 'fixture:instance-1',
        ticket_package_record_id: 'ticket-1001',
        author_package_record_id: 'contact-jane',
        body: 'It happened again today at 3:10pm.',
        is_internal: 0,
        created_at: '2026-02-11T15:12:00Z',
      },
    ],
    assets: [
      {
        package_record_id: 'asset-fw-1',
        source_record_id: 'src-asset-1',
        external_identifier_namespace: 'fixture:instance-1',
        organization_package_record_id: 'org-acme',
        location_package_record_id: 'loc-acme-hq',
        name: 'Edge Firewall',
        asset_type_name: 'Firewall',
        serial_number: 'FW-0001',
        manufacturer: 'Fortinet',
        model: 'FortiGate 60F',
        purchase_date: '2023-08-15',
      },
    ],
    external_identifiers: [
      {
        package_record_id: 'ext-1',
        entity_type: 'organizations',
        entity_package_record_id: 'org-acme',
        namespace: 'legacy-crm',
        value: 'ACME-001',
      },
    ],
    custom_field_values: [
      {
        package_record_id: 'cfv-1',
        entity_type: 'tickets',
        entity_package_record_id: 'ticket-1001',
        field_name: 'sla_tier',
        value_json: '"gold"',
      },
    ],
    package_diagnostics: [
      {
        package_record_id: 'diag-1',
        severity: 'info',
        code: 'FIXTURE',
        message: 'Sample package produced by amp-conformance.',
      },
    ],
  };
}

/** Build the canonical sample package at `path` and return its manifest. */
export function buildSamplePackage(
  path: string,
  manifestOverrides: Partial<AmpManifestInput> = {},
  rows: AmpPackageRows = sampleEntityRows()
): AmpManifest {
  return new AmpPackageBuilder(path).write(sampleManifest(manifestOverrides), rows);
}

export interface ConformanceExpectation {
  /** Entity tables the producer claims to cover, with expected row counts. */
  expectedCounts: Partial<Record<string, number>>;
}

export interface ConformanceReport {
  conformant: boolean;
  validation: AmpValidationResult;
  countMismatches: string[];
}

/** Validate a produced package and check its claimed entity coverage. */
export function checkProducerConformance(
  path: string,
  expectation: ConformanceExpectation
): ConformanceReport {
  const validation = validateAmpPackage(path);
  const countMismatches: string[] = [];
  for (const [table, expected] of Object.entries(expectation.expectedCounts)) {
    const actual = validation.rowCounts[table as keyof typeof validation.rowCounts] ?? 0;
    if (actual !== expected) {
      countMismatches.push(`${table}: expected ${expected} rows, found ${actual}`);
    }
  }
  return {
    conformant: validation.valid && countMismatches.length === 0,
    validation,
    countMismatches,
  };
}
