import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(__dirname, './client-tickets.ts'),
  'utf8',
);

describe('createClientTicket asset linking contract', () => {
  it('schema accepts an optional asset_id (UUID)', () => {
    expect(source).toMatch(/asset_id:\s*z\.string\(\)\.uuid\(\)\.optional\(\)/);
  });

  it('reads asset_id from FormData when validating', () => {
    expect(source).toMatch(/asset_id:\s*data\.get\(['"]asset_id['"]\)/);
  });

  it('verifies the asset belongs to the requesting client before linking', () => {
    expect(source).toMatch(/where\(\{[^}]*client_id:\s*visibility\.clientId/);
    expect(source).toMatch(/Selected asset does not belong to this client/);
  });

  it('inserts an asset_associations row with relationship_type "affected"', () => {
    expect(source).toContain("trx('asset_associations').insert");
    expect(source).toMatch(/relationship_type:\s*['"]affected['"]/);
    expect(source).toMatch(/entity_type:\s*['"]ticket['"]/);
  });
});
