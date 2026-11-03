import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');

describe('where is carried by every list surface', () => {
  it('container writes and parses the v1 URL form', () => {
    const src = read('../components/TicketingDashboardContainer.tsx');
    expect(src).toContain("encodeTicketWhere(filters.where)");
    expect(src).toContain("decodeTicketWhere(params.get('where'))");
    expect(src).toContain('where: filters.where');
  });
  it('dashboard prev/next query and export / select-all / smart-search scope include where', () => {
    const src = read('../components/TicketingDashboard.tsx');
    expect(src).toContain('encodeTicketWhere(f.where)');
    const exportBlock = src.slice(src.indexOf('const exportFilters = useMemo'), src.indexOf('const smartSearchFilters'));
    expect(exportBlock).toContain('where: selectedWhere');
    expect(exportBlock).toContain('selectedWhere,');
    // select-all and smart search both derive from exportFilters.
    expect(src).toContain('{ ...exportFilters, searchQuery: \'\' }');
  });
  it('SSR page parses where and passes it to the first fetch', () => {
    const src = readFileSync(resolve(__dirname, '../../../../server/src/app/msp/tickets/page.tsx'), 'utf8');
    expect(src).toContain('decodeTicketWhere(params.where)');
    expect(src).toContain('where: initialFilters.where');
  });
  it('the dead server ticket schema is gone', () => {
    expect(() => readFileSync(resolve(__dirname, '../../../../server/src/lib/schemas/ticket.schema.ts'))).toThrow();
  });
});
