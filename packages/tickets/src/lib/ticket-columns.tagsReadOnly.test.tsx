/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ITag } from '@alga-psa/types';
import { createTicketColumns } from './ticket-columns';

// The real TagManager and TagList render; only their server actions and the tag
// context (which needs a provider) are stood in for.
vi.mock('../../../tags/src/actions', () => ({
  createTag: vi.fn(),
  deleteTag: vi.fn(),
  getAllTags: vi.fn().mockResolvedValue([]),
  getTagMappingUsageCount: vi.fn(),
  isTagActionError: () => false,
}));

vi.mock('../../../tags/src/context/TagContext', () => ({
  useTags: () => ({
    tags: [],
    refetchTags: vi.fn(),
    getPermissions: async () => ({
      canAddExisting: true, canCreateNew: true, canEditColors: true,
      canEditText: true, canDelete: true, canDeleteAll: true,
    }),
  }),
}));

vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

const tags: ITag[] = [
  { tag_id: 'mapping-1', tenant: 'tenant-1', tag_text: 'Escalated', tagged_id: 'ticket-1', tagged_type: 'ticket' },
];

function renderTitle(tagsReadOnly: boolean | undefined) {
  const columns = createTicketColumns({
    categories: [],
    boards: [],
    displaySettings: { list: { columnVisibility: { tags: true } } },
    onTicketClick: () => {},
    ticketTagsRef: { current: { 'ticket-1': tags } },
    onTagsChange: vi.fn(),
    ...(tagsReadOnly === undefined ? {} : { tagsReadOnly }),
    t: (_key: string, fallback: string) => fallback,
  } as any);
  const title = columns.find((column: any) => column.dataIndex === 'title') as any;
  expect(title).toBeTruthy();
  const record = { ticket_id: 'ticket-1', ticket_number: 'T-1', title: 'Printer offline' };
  return render(<>{title.render(record.title, record)}</>);
}

const mutationControls = (container: HTMLElement) => ({
  add: container.querySelectorAll('#tag-add-button, [id$="-input-button"]').length,
  remove: screen.queryAllByTitle('Remove tag').length,
  edit: Array.from(container.querySelectorAll('span[title="Escalated"] button'))
    .filter((button) => button.getAttribute('title') !== 'Remove tag').length,
});

describe('ticket list inline tags', () => {
  it('shows the tags with no add, remove or edit control when the viewer cannot update tickets', async () => {
    const { container } = renderTitle(true);
    expect(await screen.findByText('Escalated')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mutationControls(container)).toEqual({ add: 0, remove: 0, edit: 0 });
  });

  it('keeps add, remove and edit for a viewer who can update tickets', async () => {
    const { container } = renderTitle(undefined);
    expect(await screen.findByText('Escalated')).toBeInTheDocument();
    await waitFor(() => expect(mutationControls(container).add).toBeGreaterThan(0));
    expect(mutationControls(container)).toMatchObject({ remove: 1, edit: 1 });
  });
});
