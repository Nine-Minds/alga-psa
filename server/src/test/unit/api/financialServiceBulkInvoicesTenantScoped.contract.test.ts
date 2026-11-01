import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const financialServicePath = resolve(__dirname, '../../../lib/api/services/FinancialService.ts');
const invoiceServicePath = resolve(__dirname, '../../../lib/api/services/InvoiceService.ts');
const financialSource = readFileSync(financialServicePath, 'utf8');
const invoiceSource = readFileSync(invoiceServicePath, 'utf8');

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

/** Body of a top-level class method `  async <name>(` up to the next top-level method. */
function methodBody(source: string, name: string): string {
  const start = source.indexOf(`\n  async ${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.slice(start + 1).search(/\n  (?:async |private |protected |public )/);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

// operation -> [permission the dispatcher checks, InvoiceService method it delegates to]
const EXPECTED_COMMANDS: Record<string, [string, string]> = {
  finalize: ['finalize', 'finalizeInvoice'],
  send: ['send', 'sendInvoice'],
  cancel: ['update', 'voidInvoice'],
};

describe('financial service bulk invoice tenant-scoped query contract', () => {
  const dispatcher = sectionBetween(financialSource, 'async bulkInvoiceOperation', 'async bulkTransactionOperation');
  const commands = sectionBetween(financialSource, 'const BULK_INVOICE_COMMANDS', 'export class FinancialService');

  it('the bulk dispatcher performs no direct invoice table access of its own', () => {
    expect(dispatcher).not.toContain('tenantDb(');
    expect(dispatcher).not.toMatch(/\.table\(/);
    expect(dispatcher).not.toMatch(/\b(?:trx|knex)\(\s*['"`]/);
    expect(dispatcher).not.toMatch(/where\(\{\s*[^}]*tenant\s*[,}]/);
    // Every id goes through the command table, never an inline switch.
    expect(dispatcher).toContain('BULK_INVOICE_COMMANDS[operation.operation]');
    expect(dispatcher).toContain('command.run(invoices, invoiceId');
    expect(dispatcher).toContain('new InvoiceService()');
  });

  it('keeps the coarse and per-command invoice permission gates before any id is touched', () => {
    const coarse = dispatcher.indexOf("await this.validatePermissions('update', 'invoice', context);");
    const perCommand = dispatcher.indexOf("await this.validatePermissions(command.permission, 'invoice', context);");
    const loop = dispatcher.indexOf('for (const invoiceId of operation.invoice_ids)');

    expect(coarse).toBeGreaterThanOrEqual(0);
    expect(perCommand).toBeGreaterThan(coarse);
    expect(loop).toBeGreaterThan(perCommand);
  });

  it('delegates every bulk command to a tenant-scoped InvoiceService engine with its lifecycle permission', () => {
    const declaredOps = [...commands.matchAll(/^  (\w+): \{$/gm)].map((m) => m[1]).sort();
    expect(declaredOps).toEqual(Object.keys(EXPECTED_COMMANDS).sort());

    for (const [op, [permission, method]] of Object.entries(EXPECTED_COMMANDS)) {
      const entry = sectionBetween(commands, `  ${op}: {`, '\n  },');
      expect(entry).toContain(`permission: '${permission}'`);
      expect(entry).toContain(`invoices.${method}(`);
      expect(entry).not.toContain('tenantDb(');
      expect(entry).not.toMatch(/\.table\(/);

      // The delegated engine is where the tenant scoping now lives.
      const engine = methodBody(invoiceSource, method);
      expect(engine).toContain('tenantDb(');
      expect(engine).toContain('context.tenant');
      expect(engine).not.toMatch(/\b(?:trx|knex)\(\s*['"`]invoices['"`]\s*\)/);
    }
  });
});
