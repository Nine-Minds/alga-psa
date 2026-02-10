import { describe, expect, it } from 'vitest';
import type { InvoiceDesignerSourceMapEntry } from './assemblyScriptGenerator';
import { linkDiagnosticsToGuiNodes, parseAssemblyScriptDiagnostics } from './diagnostics';

describe('compiler diagnostics mapping', () => {
  it('parses assemblyscript compiler output lines with location metadata', () => {
    const diagnostics = parseAssemblyScriptDiagnostics(`
      ERROR TS2322: Type 'i32' is not assignable to type 'string'. src/generated.ts:77:15
      WARNING AS100: Optional chain is redundant. src/generated.ts:105:3
      info: skipped line
    `);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      line: 77,
      column: 15,
    });
    expect(diagnostics[1]).toMatchObject({
      severity: 'warning',
      line: 105,
      column: 3,
    });
  });

  it('links diagnostics to gui node ids using generated source-map ranges', () => {
    const sourceMap: InvoiceDesignerSourceMapEntry[] = [
      {
        nodeId: 'section-header',
        symbol: 'createNode_section_header',
        startLine: 40,
        endLine: 61,
      },
      {
        nodeId: 'field-invoice-number',
        symbol: 'createNode_field_invoice_number',
        startLine: 63,
        endLine: 72,
      },
    ];

    const diagnostics = parseAssemblyScriptDiagnostics(`
      ERROR TS1005: ';' expected at src/generated.ts:68:9
      ERROR TS2552: Cannot find name 'unknown' at src/generated.ts:5:1
    `);
    const linked = linkDiagnosticsToGuiNodes(diagnostics, sourceMap);

    expect(linked).toHaveLength(2);
    expect(linked[0]).toMatchObject({
      nodeId: 'field-invoice-number',
      symbol: 'createNode_field_invoice_number',
    });
    expect(linked[1]).toMatchObject({
      nodeId: null,
      symbol: null,
    });
  });
});
