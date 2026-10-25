import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * C4 hard constraint, enforced statically: custody and intake never import the inventory or billing
 * packages (so they cannot reach stock or money code), and never reference the tables they must not write.
 */
const ROOT = path.resolve(__dirname, '../../../..');
const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });

const SOURCES = [
  ...files(path.join(ROOT, 'packages/assets/src/lib/custody')),
  path.join(ROOT, 'packages/assets/src/actions/assetCustodyActions.ts'),
  path.join(ROOT, 'packages/assets/src/lib/schemas/assetCustody.schema.ts'),
  path.join(ROOT, 'packages/assets/src/lib/ticketLinkedAssetLabels.ts'),
  path.join(ROOT, 'packages/msp-composition/src/tickets/receiveEquipmentActions.ts'),
  path.join(ROOT, 'server/src/lib/api/controllers/ApiAssetCustodyController.ts'),
];
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('equipment custody static guards', () => {
  it('finds the sources it guards', () => {
    expect(SOURCES.length).toBeGreaterThan(10);
    for (const f of SOURCES) expect(fs.existsSync(f), f).toBe(true);
  });

  it('never imports @alga-psa/inventory, @alga-psa/billing or inventory receive.ts', () => {
    for (const f of SOURCES) {
      const code = strip(fs.readFileSync(f, 'utf8'));
      expect(code, f).not.toMatch(/from\s+['"]@alga-psa\/(inventory|billing)(\/[^'"]*)?['"]/);
      expect(code, f).not.toMatch(/import\(\s*['"]@alga-psa\/(inventory|billing)/);
      expect(code, f).not.toMatch(/inventory\/src\/lib\/receive/);
    }
  });

  it('never names the stock, money or time tables or the asset stock/service links', () => {
    const forbidden = /\b(stock_units|stock_movements|stock_levels|product_inventory_settings|invoice_charges|time_entries)\b|['"]invoices['"]|stock_unit_id|\bservice_id\b/;
    for (const f of SOURCES) {
      // The label seam reads nothing of these; the guard is the same for it.
      expect(strip(fs.readFileSync(f, 'utf8')), f).not.toMatch(forbidden);
    }
  });

  it('never calls createAssetAssociation (intake links the ticket itself)', () => {
    for (const f of SOURCES) expect(strip(fs.readFileSync(f, 'utf8')), f).not.toMatch(/createAssetAssociation/);
  });

  it('intake creates the asset without requiring custom attributes', () => {
    const code = strip(fs.readFileSync(path.join(ROOT, 'packages/assets/src/lib/custody/receiveEquipment.ts'), 'utf8'));
    expect(code).toMatch(/createAssetInTransaction\([\s\S]*?\}\s*as any,\s*\{\s*requireCustomAttributes:\s*false\s*\}\)/);
  });
});
