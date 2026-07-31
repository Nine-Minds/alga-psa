import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo root, resolved from this file (server/src/test/unit) so the test works
// regardless of the cwd vitest is launched from.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

describe('workflow event catalog migration coverage', () => {
  it('includes catalog rows for every event in event-proposals.md', async () => {
    const proposalsPath = path.join(
      repoRoot,
      'ee',
      'docs',
      'plans',
      '2025-12-28-workflow-event-catalog',
      'event-proposals.md'
    );
    const migrationPath = path.join(
      repoRoot,
      'server',
      'migrations',
      '20260123150000_upsert_domain_workflow_event_catalog_v2.cjs'
    );

    const proposals = await fs.readFile(proposalsPath, 'utf8');
    const migration = await fs.readFile(migrationPath, 'utf8');

    const proposedEventTypes = new Set<string>();
    for (const match of proposals.matchAll(/`([A-Z0-9_]+)`\s+—/g)) {
      proposedEventTypes.add(match[1]);
    }
    expect(proposedEventTypes.size).toBeGreaterThan(0);

    const migrationEventTypes = new Set<string>();
    for (const match of migration.matchAll(/event_type:\s*'([A-Z0-9_]+)'/g)) {
      migrationEventTypes.add(match[1]);
    }
    expect(migrationEventTypes.size).toBeGreaterThan(0);

    for (const eventType of proposedEventTypes) {
      expect(migrationEventTypes.has(eventType)).toBe(true);
    }

    // Sanity check: migration computes payload_schema_ref from event_type for
    // every catalog row and writes it in the upsert (raw SQL form, Citus-safe).
    expect(migration.includes('toPayloadSchemaRef(e.event_type)')).toBe(true);
    expect(migration.includes('payload_schema_ref = EXCLUDED.payload_schema_ref')).toBe(true);
  });
});

