import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readControllerSource(): string {
  const filePath = path.resolve(__dirname, '../../../lib/api/controllers/ApiQuoteController.ts');
  return fs.readFileSync(filePath, 'utf8');
}

describe('Quote controller authorization parity contract', () => {
  it('T037: applies quote parent-read narrowing before quote-scoped reads and mutations', () => {
    const source = readControllerSource();

    expect(source).toContain('private async assertQuoteReadAllowed(');
    expect(source).toContain("resource: 'billing'");
    expect(source).toContain('const quote = await this.assertQuoteReadAllowed(apiRequest, id);');
    expect(source).toContain('await this.assertQuoteReadAllowed(apiRequest, id, knex);');
    expect(source).toContain('await this.assertQuoteReadAllowed(apiRequest, quoteId, knex);');
    expect(source).toContain('const existingQuote = await this.assertQuoteReadAllowed(apiRequest, id, knex);');
    expect(source).toContain('await this.assertQuoteApproveAllowed(apiRequest, existingQuote as Record<string, any>);');
    expect(source).toContain('update() {');
    expect(source).toContain('delete() {');
  });
});
