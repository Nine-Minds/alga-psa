import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = path.resolve(
  __dirname,
  '../../../../../server/migrations/20260209160000_add_ticket_origin_to_tickets.cjs'
);

function readMigration(): string {
  return fs.readFileSync(migrationPath, 'utf8');
}

describe('ticket_origin migration contract', () => {
  it('T001: migration adds tickets.ticket_origin column successfully in existing DB', () => {
    const migration = readMigration();

    expect(migration).toContain("hasColumn('tickets', 'ticket_origin')");
    expect(migration).toContain("alterTable('tickets'");
    expect(migration).toContain("table.text('ticket_origin')");
  });

  it('T002: newly inserted tickets default ticket_origin to internal when not explicitly provided', () => {
    const migration = readMigration();

    expect(migration).toContain("defaultTo('internal')");
  });

  it('T003: backfill marks tickets with email_metadata as inbound_email', () => {
    const migration = readMigration();

    expect(migration).toContain("SET ticket_origin = 'inbound_email'");
    expect(migration).toContain('email_metadata IS NOT NULL');
  });

  it('T004: backfill marks tickets created by client users as client_portal when no email_metadata', () => {
    const migration = readMigration();

    expect(migration).toContain("SET ticket_origin = 'client_portal'");
    expect(migration).toContain('FROM users u');
    expect(migration).toContain("lower(coalesce(u.user_type, '')) = 'client'");
  });

  it('T005: backfill marks unresolved legacy tickets as internal', () => {
    const migration = readMigration();

    expect(migration).toContain("SET ticket_origin = 'internal'");
    expect(migration).toContain('WHERE ticket_origin IS NULL');
  });
});
