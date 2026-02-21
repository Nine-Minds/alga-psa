import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

import type {
  EntraClientTenantMappingRow,
  EntraContactLinkRow,
  EntraContactReconciliationQueueRow,
  EntraManagedTenantRow,
  EntraPartnerConnectionRow,
  EntraSyncRunRow,
  EntraSyncRunTenantRow,
  EntraSyncSettingsRow,
} from '@ee/interfaces/entra.interfaces';
import {
  mapEntraClientTenantMappingRow,
  mapEntraContactLinkRow,
  mapEntraContactReconciliationQueueRow,
  mapEntraManagedTenantRow,
  mapEntraPartnerConnectionRow,
  mapEntraSyncRunRow,
  mapEntraSyncRunTenantRow,
  mapEntraSyncSettingsRow,
} from '@ee/lib/integrations/entra/entraRowMappers';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('Entra interfaces and migration schema alignment', () => {
  const migration = readRepoFile('ee/server/migrations/20260220143000_create_entra_phase1_schema.cjs');

  it('maps representative DB rows into all Entra typed row interfaces', () => {
    const partner: EntraPartnerConnectionRow = mapEntraPartnerConnectionRow({
      tenant: 't-1',
      connection_id: 'c-1',
      connection_type: 'direct',
      status: 'connected',
      is_active: true,
      cipp_base_url: null,
      token_secret_ref: null,
      connected_at: null,
      disconnected_at: null,
      last_validated_at: null,
      last_validation_error: {},
      created_by: null,
      updated_by: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    const managed: EntraManagedTenantRow = mapEntraManagedTenantRow({
      tenant: 't-1',
      managed_tenant_id: 'mt-1',
      entra_tenant_id: 'entra-tenant-1',
      display_name: 'Tenant A',
      primary_domain: 'tenant-a.example',
      source_user_count: 5,
      discovered_at: '2026-01-01T00:00:00.000Z',
      last_seen_at: '2026-01-01T00:00:00.000Z',
      metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    const mapping: EntraClientTenantMappingRow = mapEntraClientTenantMappingRow({
      tenant: 't-1',
      mapping_id: 'map-1',
      managed_tenant_id: 'mt-1',
      client_id: 'client-1',
      mapping_state: 'mapped',
      confidence_score: 95,
      is_active: true,
      decided_by: null,
      decided_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    const settings: EntraSyncSettingsRow = mapEntraSyncSettingsRow({
      tenant: 't-1',
      settings_id: 's-1',
      sync_enabled: true,
      sync_interval_minutes: 1440,
      field_sync_config: {},
      user_filter_config: {},
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    const run: EntraSyncRunRow = mapEntraSyncRunRow({
      tenant: 't-1',
      run_id: 'run-1',
      workflow_id: 'wf-1',
      run_type: 'manual',
      status: 'running',
      initiated_by: null,
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: null,
      total_tenants: 1,
      processed_tenants: 0,
      succeeded_tenants: 0,
      failed_tenants: 0,
      summary: {},
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    const runTenant: EntraSyncRunTenantRow = mapEntraSyncRunTenantRow({
      tenant: 't-1',
      run_tenant_id: 'rt-1',
      run_id: 'run-1',
      managed_tenant_id: 'mt-1',
      client_id: 'client-1',
      status: 'queued',
      created_count: 0,
      linked_count: 0,
      updated_count: 0,
      ambiguous_count: 0,
      inactivated_count: 0,
      error_message: null,
      started_at: null,
      completed_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    const link: EntraContactLinkRow = mapEntraContactLinkRow({
      tenant: 't-1',
      link_id: 'l-1',
      contact_name_id: 'contact-1',
      client_id: 'client-1',
      entra_tenant_id: 'entra-tenant-1',
      entra_object_id: 'entra-object-1',
      link_status: 'active',
      is_active: true,
      last_seen_at: null,
      last_synced_at: null,
      metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    const queue: EntraContactReconciliationQueueRow = mapEntraContactReconciliationQueueRow({
      tenant: 't-1',
      queue_item_id: 'q-1',
      managed_tenant_id: 'mt-1',
      client_id: 'client-1',
      entra_tenant_id: 'entra-tenant-1',
      entra_object_id: 'entra-object-1',
      user_principal_name: 'user@example.com',
      display_name: 'Example User',
      email: 'user@example.com',
      candidate_contacts: [],
      status: 'open',
      resolution_action: null,
      resolved_contact_id: null,
      resolved_by: null,
      resolved_at: null,
      payload: {},
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    expect(partner.connection_type).toBe('direct');
    expect(managed.entra_tenant_id).toBe('entra-tenant-1');
    expect(mapping.mapping_state).toBe('mapped');
    expect(settings.sync_interval_minutes).toBe(1440);
    expect(run.status).toBe('running');
    expect(runTenant.status).toBe('queued');
    expect(link.link_status).toBe('active');
    expect(queue.status).toBe('open');
  });

  it('migration includes columns represented by Entra interfaces/mappers', () => {
    const expectedColumns = [
      'connection_type',
      'status',
      'is_active',
      'entra_tenant_id',
      'primary_domain',
      'source_user_count',
      'mapping_state',
      'sync_enabled',
      'sync_interval_minutes',
      'field_sync_config',
      'user_filter_config',
      'run_type',
      'processed_tenants',
      'created_count',
      'linked_count',
      'entra_object_id',
      'link_status',
      'candidate_contacts',
      'resolution_action',
      'payload',
      'entra_sync_source',
      'last_entra_sync_at',
      'entra_user_principal_name',
      'entra_account_enabled',
      'entra_sync_status',
      'entra_sync_status_reason',
    ];

    for (const column of expectedColumns) {
      expect(migration).toContain(`'${column}'`);
    }
  });
});
