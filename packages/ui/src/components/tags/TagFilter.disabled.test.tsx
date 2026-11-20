// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o?: any) => o?.defaultValue ?? _k }),
}));

import { TagFilter } from './TagFilter';

const tags = [{ tag_id: 't1', tag_text: 'vip', tagged_type: 'ticket', tagged_id: '', tenant: 'x' }] as any[];

describe('TagFilter disabled', () => {
  it('renders an inert trigger that does not open', () => {
    render(<TagFilter tags={tags} selectedTags={[]} onToggleTag={vi.fn()} onClearTags={vi.fn()} triggerLabel="Loading…" disabled />);
    const trigger = screen.getByRole('button', { name: /Loading…/ }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    fireEvent.click(trigger);
    expect(screen.queryByPlaceholderText('Filter by tags...')).toBeNull();
  });

  it('is enabled by default and opens', () => {
    render(<TagFilter tags={tags} selectedTags={[]} onToggleTag={vi.fn()} onClearTags={vi.fn()} triggerLabel="Tags" />);
    const trigger = screen.getByRole('button', { name: /Tags/ }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);
    fireEvent.click(trigger);
    expect(screen.getByPlaceholderText('Filter by tags...')).toBeTruthy();
  });
});
