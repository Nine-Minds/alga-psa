import React from 'react';

/**
 * Test stub for `@tiptap/react/menus`.
 *
 * The real BubbleMenu/FloatingMenu render their children into a floating element
 * managed by a ProseMirror plugin, which requires a live editor view that jsdom
 * cannot provide. The stub renders children inline so toolbar buttons are
 * queryable in component tests.
 *
 * Component imports of this subpath are not reliably intercepted by an in-file
 * `vi.mock(...)` because the importing modules live in sibling `@alga-psa/*`
 * packages and Vite resolves the subpath from a different module context, so we
 * alias the module to this stub in vitest.config.ts (matching the existing
 * tiptap-collaboration-caret stub pattern).
 */

type MenuProps = {
  children?: React.ReactNode;
  className?: string;
  [key: string]: unknown;
};

function renderInline(testId: string) {
  return function MenuStub({ children, className }: MenuProps) {
    return React.createElement(
      'div',
      { className, 'data-testid': testId },
      children
    );
  };
}

export const BubbleMenu = renderInline('bubble-menu');
export const FloatingMenu = renderInline('floating-menu');

export default { BubbleMenu, FloatingMenu };
