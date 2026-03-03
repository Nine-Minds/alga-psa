// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

(globalThis as unknown as { React?: typeof React }).React = React;

const { EditorToolbar } = await import('@alga-psa/documents/components/EditorToolbar');

describe('EditorToolbar', () => {
  let chain: Record<string, any>;
  let editor: Record<string, any>;

  beforeEach(() => {
    chain = {
      focus: vi.fn(() => chain),
      toggleBold: vi.fn(() => chain),
      toggleItalic: vi.fn(() => chain),
      toggleUnderline: vi.fn(() => chain),
      toggleStrike: vi.fn(() => chain),
      toggleCode: vi.fn(() => chain),
      toggleHeading: vi.fn(() => chain),
      toggleBulletList: vi.fn(() => chain),
      toggleOrderedList: vi.fn(() => chain),
      toggleBlockquote: vi.fn(() => chain),
      extendMarkRange: vi.fn(() => chain),
      unsetLink: vi.fn(() => chain),
      setLink: vi.fn(() => chain),
      run: vi.fn(),
    };

    editor = {
      chain: vi.fn(() => chain),
      isActive: vi.fn(() => false),
      getAttributes: vi.fn(() => ({ href: '' })),
      registerPlugin: vi.fn(),
      unregisterPlugin: vi.fn(),
    };
  });

  it('renders the bubble menu toolbar container', () => {
    const { getByTitle } = render(<EditorToolbar editor={editor as any} />);
    expect(getByTitle('Bold (Ctrl+B)')).toBeTruthy();
  });

  it('wires inline formatting buttons to editor commands', () => {
    const { getByTitle } = render(<EditorToolbar editor={editor as any} />);

    fireEvent.click(getByTitle('Bold (Ctrl+B)'));
    fireEvent.click(getByTitle('Italic (Ctrl+I)'));
    fireEvent.click(getByTitle('Underline (Ctrl+U)'));
    fireEvent.click(getByTitle('Strikethrough'));
    fireEvent.click(getByTitle('Code'));

    expect(chain.toggleBold).toHaveBeenCalled();
    expect(chain.toggleItalic).toHaveBeenCalled();
    expect(chain.toggleUnderline).toHaveBeenCalled();
    expect(chain.toggleStrike).toHaveBeenCalled();
    expect(chain.toggleCode).toHaveBeenCalled();
    expect(chain.run).toHaveBeenCalled();
  });

  it('wires block formatting buttons to editor commands', () => {
    const { getByTitle } = render(<EditorToolbar editor={editor as any} />);

    fireEvent.click(getByTitle('Heading 1'));
    fireEvent.click(getByTitle('Heading 2'));
    fireEvent.click(getByTitle('Bullet List'));
    fireEvent.click(getByTitle('Ordered List'));
    fireEvent.click(getByTitle('Quote'));

    expect(chain.toggleHeading).toHaveBeenCalledWith({ level: 1 });
    expect(chain.toggleHeading).toHaveBeenCalledWith({ level: 2 });
    expect(chain.toggleBulletList).toHaveBeenCalled();
    expect(chain.toggleOrderedList).toHaveBeenCalled();
    expect(chain.toggleBlockquote).toHaveBeenCalled();
    expect(chain.run).toHaveBeenCalled();
  });

  it('wires the link button to setLink with prompt input', () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('https://example.com');
    editor.getAttributes = vi.fn(() => ({ href: '' }));

    const { getByTitle } = render(<EditorToolbar editor={editor as any} />);
    fireEvent.click(getByTitle('Link'));

    expect(chain.extendMarkRange).toHaveBeenCalledWith('link');
    expect(chain.setLink).toHaveBeenCalledWith({ href: 'https://example.com' });
    expect(chain.run).toHaveBeenCalled();

    promptSpy.mockRestore();
  });
});
