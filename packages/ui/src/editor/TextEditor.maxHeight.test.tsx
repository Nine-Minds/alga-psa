/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// BlockNote needs a real editing surface; the wrapper that sizes it does not.
vi.mock('@blocknote/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCreateBlockNote: () => ({
    document: [],
    onChange: () => () => undefined,
    _tiptapEditor: { view: null },
  }),
  SuggestionMenuController: () => null,
  GridSuggestionMenuController: () => null,
}));
vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: () => <div data-testid="blocknote-view" />,
}));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));
vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : _key),
  }),
}));

import TextEditor from './TextEditor';

afterEach(() => {
  cleanup();
});

const paperOf = () => screen.getByTestId('blocknote-view').parentElement as HTMLElement;

const UNBOUNDED_CLASSES =
  'min-h-[100px] h-full w-full editor-paper border border-[rgb(var(--color-border-200))] rounded-lg p-4 overflow-auto min-w-0';

describe('TextEditor maxHeight', () => {
  it('caps the editing surface and drops h-full so long content scrolls inside', () => {
    render(<TextEditor id="editor" maxHeight="45vh" />);

    const paper = paperOf();
    expect(paper.style.maxHeight).toBe('45vh');
    // h-full would make the surface follow its container instead of the cap.
    expect(paper.classList.contains('h-full')).toBe(false);
    // The cap only works because the surface keeps its own scroller.
    expect(paper.classList.contains('overflow-auto')).toBe(true);
  });

  it('renders exactly as before when maxHeight is omitted', () => {
    render(<TextEditor id="editor" />);

    const paper = paperOf();
    expect(paper.className).toBe(UNBOUNDED_CLASSES);
    expect(paper.style.maxHeight).toBe('');
  });
});
