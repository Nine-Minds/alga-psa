import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function tableStatements(source: string, tableCall: string): string[] {
  const statements: string[] = [];
  let searchFrom = 0;

  while (searchFrom < source.length) {
    const start = source.indexOf(tableCall, searchFrom);
    if (start === -1) {
      break;
    }

    const end = source.indexOf(';\n', start);
    statements.push(source.slice(start, end === -1 ? source.length : end + 1));
    searchFrom = start + tableCall.length;
  }

  return statements;
}

function firstKnexOperation(statement: string): string | null {
  return statement.match(/\.(where|insert|update|delete|first|returning)\b/)?.[1] ?? null;
}

describe('inbound webhook tenant scoping source contracts', () => {
  it('T190: all inbound webhook config queries include tenant in WHERE clauses', () => {
    const actionSource = readSource('server/src/lib/actions/inboundWebhookActions.ts');
    const lookupSource = readSource('server/src/lib/inboundWebhooks/configLookup.ts');
    const statements = [
      ...tableStatements(actionSource, "knex<InboundWebhookRow>('inbound_webhooks')"),
      ...tableStatements(lookupSource, "knex<InboundWebhookConfigLookupRow>('inbound_webhooks')"),
    ];

    expect(statements.length).toBeGreaterThan(10);

    for (const statement of statements) {
      const firstOperation = firstKnexOperation(statement);

      if (firstOperation === 'insert') {
        expect(statement).toMatch(/\.insert\(\{\s*tenant,/);
        continue;
      }

      expect(statement).toMatch(/\.where\(\{\s*tenant(?:[\s,}])/);
    }
  });

  it('T191: all inbound delivery queries include tenant in WHERE clauses', () => {
    const actionSource = readSource('server/src/lib/actions/inboundWebhookActions.ts');
    const persistenceSource = readSource('server/src/lib/inboundWebhooks/deliveryPersistence.ts');
    const idempotencySource = readSource('server/src/lib/inboundWebhooks/idempotency.ts');
    const statements = [
      ...tableStatements(actionSource, "knex<InboundWebhookDeliveryRow>('inbound_webhook_deliveries')"),
      ...tableStatements(actionSource, "knex('inbound_webhook_deliveries')"),
      ...tableStatements(persistenceSource, "knex('inbound_webhook_deliveries')"),
      ...tableStatements(idempotencySource, "args.knex('inbound_webhook_deliveries')"),
    ];

    expect(statements.length).toBeGreaterThan(5);
    expect(actionSource).toContain("query.where('tenant', tenant);");

    for (const statement of statements) {
      const firstOperation = firstKnexOperation(statement);

      if (firstOperation === 'insert') {
        expect(statement).toMatch(/\.insert\(\{\s*tenant: input\.tenant,/);
        continue;
      }

      if (!statement.includes('.where(')) {
        expect(statement).toMatch(/\.(count|orderBy)(?:<[^>]+>)?\(/);
        continue;
      }

      expect(statement).toMatch(/\.where\(\{\s*tenant(?::\s*(?:input|args)\.tenant|[\s,}])/);
    }
  });
});
