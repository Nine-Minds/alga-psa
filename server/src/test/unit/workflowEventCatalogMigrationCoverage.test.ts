import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('workflow event catalog migration coverage', () => {
  it('includes catalog rows for every event in event-proposals.md', async () => {
    const proposalsPath = path.join(
      process.cwd(),
      'ee',
      'docs',
      'plans',
      '2025-12-28-workflow-event-catalog',
      'event-proposals.md'
    );
    const migrationPath = path.join(
      process.cwd(),
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

    // Sanity check: migration computes payload_schema_ref from event_type.
    expect(migration.includes('toPayloadSchemaRef')).toBe(true);
    expect(migration.includes('payload_schema_ref: toPayloadSchemaRef(e.event_type)')).toBe(true);
  });
});

