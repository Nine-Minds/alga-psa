import { beforeAll, describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { executeWasmTemplate } from 'server/src/lib/invoice-renderer/wasm-executor';
import type { LayoutElement, WasmInvoiceViewModel } from 'server/src/lib/invoice-renderer/types';

function collectText(layout: LayoutElement): string[] {
  const texts: string[] = [];
  const visit = (node: any) => {
    if (!node) return;
    if (node.type === 'Text' && typeof node.content === 'string') {
      texts.push(node.content);
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  visit(layout);
  return texts;
}

describe('Standard invoice template PO header', () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const serverRoot = path.resolve(testDir, '../../../..');
  const repoRoot = path.resolve(serverRoot, '..');
  const templateDir = path.resolve(serverRoot, 'src', 'invoice-templates', 'assemblyscript');
  const wasmPath = path.resolve(
    repoRoot,
    'dist',
    'server',
    'src',
    'invoice-templates',
    'standard',
    'standard-default.wasm'
  );

  beforeAll(() => {
    const result = spawnSync('npm', ['run', 'build:standard'], {
      cwd: templateDir,
      encoding: 'utf-8',
      env: process.env,
    });
    if (result.status !== 0) {
      throw new Error(`Failed to build standard templates: ${result.stderr || result.stdout}`);
    }
    if (!fs.existsSync(wasmPath)) {
      throw new Error(`Expected compiled template wasm at ${wasmPath}`);
    }
  }, 180_000);

  it('T010: default template renders PO number in header only when invoice has po_number', async () => {
    const wasmBuffer = fs.readFileSync(wasmPath);

    const base: Omit<WasmInvoiceViewModel, 'poNumber'> = {
      invoiceNumber: 'INV-PO',
      issueDate: '2025-01-01',
      dueDate: '2025-02-01',
      currencyCode: 'USD',
      customer: { name: 'Alpha Co', address: '1 Test St' },
      tenantClient: { name: 'Tenant', address: 'Tenant Address', logoUrl: null },
      items: [
        { id: '1', description: 'Service', quantity: 1, unitPrice: 100, total: 100 },
      ],
      subtotal: 100,
      tax: 0,
      total: 100,
    };

    const withPoLayout = await executeWasmTemplate({ ...base, poNumber: 'PO-XYZ' }, wasmBuffer);
    const withPoText = collectText(withPoLayout).join('\n');
    expect(withPoText).toMatch(/PO/i);
    expect(withPoText).toMatch(/PO-XYZ/);

    const withoutPoLayout = await executeWasmTemplate({ ...base, poNumber: null }, wasmBuffer);
    const withoutPoText = collectText(withoutPoLayout).join('\n');
    expect(withoutPoText).not.toMatch(/PO-XYZ/);
    expect(withoutPoText).not.toMatch(/PO\s*[:#]/i);
  });
});
