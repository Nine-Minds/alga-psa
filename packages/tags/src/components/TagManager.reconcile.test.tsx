/**
 * @vitest-environment jsdom
 *
 * TagManager shows its parent's `initialTags` as the authoritative tags (an
 * empty list included, and same-length replacements), while an add or remove
 * this TagManager started is still saving survives an incoming refresh.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ITag } from '@alga-psa/types';

const hoisted = vi.hoisted(() => ({
  createTag: vi.fn(),
  deleteTag: vi.fn(),
  getTagMappingUsageCount: vi.fn(),
  getAllTags: vi.fn(async () => []),
  handleError: vi.fn(),
}));

vi.mock('../actions', () => ({
  createTag: hoisted.createTag,
  deleteTag: hoisted.deleteTag,
  getAllTags: hoisted.getAllTags,
  getTagMappingUsageCount: hoisted.getTagMappingUsageCount,
  isTagActionError: (value: unknown) =>
    Boolean(value && typeof value === 'object' && 'actionError' in (value as object)),
}));
vi.mock('../context/TagContext', () => ({ useTags: () => null }));
vi.mock('@alga-psa/ui', () => ({ handleError: hoisted.handleError }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('@alga-psa/ui/components/tags', () => ({
  TagList: ({ tags, onRemoveTag }: { tags: ITag[]; onRemoveTag: (id: string) => void }) => (
    <ul>
      {tags.map(tag => (
        <li key={tag.tag_id} data-testid="chip">
          {tag.tag_text}
          <button type="button" onClick={() => onRemoveTag(tag.tag_id)}>
            remove-{tag.tag_text}
          </button>
        </li>
      ))}
    </ul>
  ),
  TagInput: ({ onAddTag }: { onAddTag: (text: string) => void }) => (
    <button type="button" onClick={() => onAddTag('New')}>add-New</button>
  ),
  TagInputInline: () => null,
}));

import { TagManager } from './TagManager';

const PERMISSIONS = {
  canAddExisting: true,
  canCreateNew: true,
  canEditColors: true,
  canEditText: true,
  canDelete: true,
  canDeleteAll: false,
};

function tag(id: string, text: string): ITag {
  return { tag_id: id, tag_text: text, tagged_id: 'contact-1', tagged_type: 'contact' };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderManager(initialTags: ITag[], onTagsChange = vi.fn()) {
  const view = render(
    <TagManager
      entityId="contact-1"
      entityType="contact"
      initialTags={initialTags}
      onTagsChange={onTagsChange}
      permissions={PERMISSIONS}
    />
  );
  const rerender = (next: ITag[]) =>
    view.rerender(
      <TagManager
        entityId="contact-1"
        entityType="contact"
        initialTags={next}
        onTagsChange={onTagsChange}
        permissions={PERMISSIONS}
      />
    );
  return { rerender, onTagsChange };
}

const chipTexts = () => screen.queryAllByTestId('chip').map(chip => chip.firstChild?.textContent);

describe('TagManager — initialTags reconciliation', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('clears the chip when initialTags goes from [A] to []', () => {
    const { rerender } = renderManager([tag('a', 'A')]);
    expect(chipTexts()).toEqual(['A']);

    rerender([]);

    expect(chipTexts()).toEqual([]);
  });

  it('shows B, not A, when initialTags is replaced at the same length', () => {
    const { rerender } = renderManager([tag('a', 'A')]);

    rerender([tag('b', 'B')]);

    expect(chipTexts()).toEqual(['B']);
  });

  it('keeps local state when the parent re-renders a new array with the same content', async () => {
    hoisted.createTag.mockResolvedValue(tag('n', 'New'));
    const onTagsChange = vi.fn();
    const { rerender } = renderManager([tag('a', 'A')], onTagsChange);

    await act(async () => {
      fireEvent.click(screen.getByText('add-New'));
    });
    expect(chipTexts()).toEqual(['A', 'New']);

    // Parent never folded the add back into its props; it re-renders anyway.
    rerender([{ ...tag('a', 'A') }]);

    expect(chipTexts()).toEqual(['A', 'New']);
    expect(onTagsChange).toHaveBeenCalledTimes(1);
  });

  it('keeps an in-flight add through an initialTags refresh, then settles to the refreshed tags plus the add', async () => {
    const create = deferred<ITag>();
    hoisted.createTag.mockReturnValue(create.promise);
    const onTagsChange = vi.fn();
    const { rerender } = renderManager([tag('a', 'A')], onTagsChange);

    act(() => {
      fireEvent.click(screen.getByText('add-New'));
    });
    expect(chipTexts()).toEqual(['A', 'New']);

    // A refresh lands while createTag is still pending.
    rerender([tag('b', 'B')]);
    expect(chipTexts()).toEqual(['B', 'New']);

    await act(async () => {
      create.resolve(tag('n', 'New'));
      await create.promise;
    });

    expect(chipTexts()).toEqual(['B', 'New']);
    expect(onTagsChange).toHaveBeenLastCalledWith([tag('b', 'B'), tag('n', 'New')]);

    // Nothing pending any more: initialTags is authoritative again, even empty.
    rerender([]);
    expect(chipTexts()).toEqual([]);
  });

  it('keeps an in-flight remove through an initialTags refresh', async () => {
    hoisted.getTagMappingUsageCount.mockResolvedValue({ usageCount: 2, tagText: 'A' });
    const remove = deferred<unknown>();
    hoisted.deleteTag.mockReturnValue(remove.promise);
    const { rerender } = renderManager([tag('a', 'A'), tag('c', 'C')]);

    await act(async () => {
      fireEvent.click(screen.getByText('remove-A'));
    });
    expect(chipTexts()).toEqual(['C']);

    rerender([tag('a', 'A'), tag('c', 'C'), tag('d', 'D')]);
    expect(chipTexts()).toEqual(['C', 'D']);

    await act(async () => {
      remove.resolve({ success: true });
      await remove.promise;
    });
    expect(chipTexts()).toEqual(['C', 'D']);
  });

  it('reverts a failed optimistic add to the authoritative tags', async () => {
    const create = deferred<ITag>();
    hoisted.createTag.mockReturnValue(create.promise);
    const onTagsChange = vi.fn();
    const { rerender } = renderManager([tag('a', 'A')], onTagsChange);

    act(() => {
      fireEvent.click(screen.getByText('add-New'));
    });
    rerender([tag('b', 'B')]);
    expect(chipTexts()).toEqual(['B', 'New']);

    await act(async () => {
      create.reject(new Error('server said no'));
      await create.promise.catch(() => undefined);
    });

    expect(chipTexts()).toEqual(['B']);
    expect(hoisted.handleError).toHaveBeenCalled();
    expect(onTagsChange).not.toHaveBeenCalled();
  });

  it('reverts a remove the server refused (action error) to the authoritative tags', async () => {
    hoisted.getTagMappingUsageCount.mockResolvedValue({ usageCount: 2, tagText: 'A' });
    hoisted.deleteTag.mockResolvedValue({ actionError: 'forbidden' });
    renderManager([tag('a', 'A')]);

    await act(async () => {
      fireEvent.click(screen.getByText('remove-A'));
    });

    expect(chipTexts()).toEqual(['A']);
    expect(hoisted.handleError).toHaveBeenCalledWith({ actionError: 'forbidden' });
  });
});
