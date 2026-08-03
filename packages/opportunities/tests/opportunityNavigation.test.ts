import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relative: string) {
  return fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
}

describe('pipeline inline value edit', () => {
  const list = source('../src/components/pipeline/PipelineList.tsx');

  it('opens the values dialog instead of navigating away', () => {
    expect(list).toContain('id={`opportunity-pipeline-value-${record.opportunity_id}`}');
    expect(list).toContain('event.stopPropagation();');
    expect(list).toContain('<EditValuesDialog');
  });

  it('refuses inline edits once a quote owns the numbers', () => {
    expect(list).toContain("record.status !== 'open' || record.values_locked_by_quote");
  });
});

describe('staying put when following a client link', () => {
  it('opens the client drawer from the pipeline table when a provider is present', () => {
    const list = source('../src/components/pipeline/PipelineList.tsx');
    expect(list).toContain('clientDrawer.openClientDrawer(record.client_id)');
  });

  it('opens the client drawer from the detail header', () => {
    const detail = source('../src/components/detail/OpportunityDetailView.tsx');
    expect(detail).toContain('clientDrawer.openClientDrawer(detail.client_id)');
  });

  it('opens the client drawer from a board card', () => {
    const card = source('../src/components/board/BoardCard.tsx');
    expect(card).toContain('clientDrawer.openClientDrawer(item.client_id)');
  });

  it('lets the client tab open a deal without leaving the client screen', () => {
    const tab = source('../src/components/ClientOpportunitiesTab.tsx');
    expect(tab).toContain('onOpen?: (opportunityId: string) => void | Promise<void>;');
    expect(tab).toContain('void onOpen(opportunityId);');
  });
});
