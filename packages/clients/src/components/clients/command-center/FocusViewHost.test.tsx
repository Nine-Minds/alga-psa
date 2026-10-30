/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FocusViewHost from './FocusViewHost';
import { useFocusViewNavigation } from './FocusViewNavigation';

vi.mock('@alga-psa/ui/components/Drawer', () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (isOpen ? <div>{children}</div> : null),
}));

const t = (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key);

function OpenSibling() {
  const navigation = useFocusViewNavigation();
  return (
    <button type="button" onClick={() => navigation?.openView('assets')}>
      {navigation?.hasView('assets') ? 'has-assets' : 'no-assets'}
    </button>
  );
}

describe('FocusViewHost navigation context', () => {
  it('lets hosted content open a sibling view through the host', () => {
    const onSelectTab = vi.fn();
    render(
      <FocusViewHost
        idPrefix="cc"
        tabs={[
          { id: 'software', label: 'Software', content: <OpenSibling /> },
          { id: 'assets', label: 'Assets', content: <div /> },
        ]}
        activeTabId="software"
        onSelectTab={onSelectTab}
        onClose={vi.fn()}
        t={t}
      />,
    );
    fireEvent.click(screen.getByText('has-assets'));
    expect(onSelectTab).toHaveBeenCalledWith('assets');
  });

  it('reports a missing sibling view', () => {
    render(
      <FocusViewHost
        idPrefix="cc"
        tabs={[{ id: 'software', label: 'Software', content: <OpenSibling /> }]}
        activeTabId="software"
        onSelectTab={vi.fn()}
        onClose={vi.fn()}
        t={t}
      />,
    );
    expect(screen.getByText('no-assets')).toBeInTheDocument();
  });
});
