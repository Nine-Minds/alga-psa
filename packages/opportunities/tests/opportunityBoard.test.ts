import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relative: string) {
  return fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
}

describe('board drag parity', () => {
  const board = source('../src/components/board/OpportunityBoard.tsx');

  it('accepts a drop on any open stage column, not just Qualified', () => {
    expect(board).toContain("return isOpenStage(column) && column !== dragging.stage;");
    expect(board).not.toContain("column === 'qualified' && dragging.stage === 'identified'");
  });

  it('routes drops through the same declared-stage path as the Evidence ladder', () => {
    expect(board).toContain('onDeclareStage(dragging.opportunity_id, column)');
  });

  it('shows a blocked cursor rather than silently swallowing a drop', () => {
    expect(board).toContain("blocked ? 'cursor-not-allowed opacity-60' : ''");
  });

  it('clears the drag state when a drag is cancelled or dropped outside a column', () => {
    // dragend fires on the source card for drops, Escape, and misses alike.
    expect(board).toContain('onDragEnd={() => {');
    expect(board).toContain('setDragging(null);');
    expect(board).toContain('setDropTarget(null);');
    const card = source('../src/components/board/BoardCard.tsx');
    expect(card).toContain('onDragEnd={onDragEnd ? (e) => onDragEnd(e, item) : undefined}');
  });

  it('renders a money subtotal per column', () => {
    expect(board).toContain('id={`opportunity-board-subtotal-${column}`}');
    expect(board).toContain('current.oneTime += oneTimeCents(item)');
  });
});

describe('hub board wiring', () => {
  const hub = source('../src/components/OpportunitiesHub.tsx');

  it('uses the generic stage declaration action', () => {
    expect(hub).toContain('await declareOpportunityStage(opportunityId, stage);');
    expect(hub).toContain("t('opportunities.toast.stageSet'");
    expect(hub).not.toContain('declareQualified');
  });
});
