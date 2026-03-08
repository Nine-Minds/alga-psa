/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('ticket category consumer wiring contract', () => {
  it('T043: TicketInfo wires add-new category to QuickAddCategory with the effective board id', () => {
    const source = read('../TicketInfo.tsx');

    expect(source).toContain('onAddNew={() => setIsQuickAddCategoryOpen(true)}');
    expect(source).toContain('isOpen={isQuickAddCategoryOpen}');
    expect(source).toContain('preselectedBoardId={effectiveBoardId || undefined}');
    expect(source).toContain("handlePendingChange('category_id', newCategory.category_id);");
  });

  it('T045: TicketDetails inherits the add-new category flow through TicketInfo with ticket category context', () => {
    const ticketInfoSource = read('../TicketInfo.tsx');
    const ticketDetailsSource = read('../TicketDetails.tsx');

    expect(ticketInfoSource).toContain('preselectedBoardId={effectiveBoardId || undefined}');
    expect(ticketDetailsSource).toContain('<TicketInfo');
    expect(ticketDetailsSource).toContain('ticket={ticket}');
    expect(ticketDetailsSource).toContain('initialCategories={initialCategories}');
  });
});
