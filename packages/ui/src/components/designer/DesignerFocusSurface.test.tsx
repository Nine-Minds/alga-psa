/* @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import {
  DESIGNER_FOCUS_SURFACE_FOCUSED_CLASSES,
  DesignerFocusSurface,
  useDesignerFocusState,
} from './DesignerFocusSurface';
import { DesignerFocusToggle } from './DesignerFocusToggle';
import * as designerKit from './index';

const SURFACE_ID = 'designer-focus-surface';

function surface(): HTMLElement {
  return document.getElementById(SURFACE_ID) as HTMLElement;
}

/** A host that owns the focused flag, as a real designer page does through its preference. */
function Host({
  initialFocused = false,
  focusable,
  onFocusedChange,
  children,
}: {
  initialFocused?: boolean;
  focusable?: boolean;
  onFocusedChange?: (focused: boolean) => void;
  children?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(initialFocused);
  return (
    <DesignerFocusSurface
      id={SURFACE_ID}
      focused={focused}
      onFocusedChange={(next) => {
        onFocusedChange?.(next);
        setFocused(next);
      }}
      focusable={focusable}
      className="host-class"
      focusedClassName="host-focused-class"
    >
      <DesignerFocusToggle id="designer-focus-toggle" />
      {children}
    </DesignerFocusSurface>
  );
}

/** Keeps local state and counts its mounts, so a remount is visible to a test. */
let childMountCount = 0;
function StatefulChild() {
  const [value, setValue] = useState('');
  React.useEffect(() => {
    childMountCount += 1;
  }, []);
  return (
    <input
      id="stateful-child-input"
      aria-label="child input"
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}

function StateProbe() {
  const { isFocused, toggle } = useDesignerFocusState();
  return (
    <div>
      <span data-testid="probe-state">{isFocused ? 'focused' : 'not-focused'}</span>
      <button id="probe-toggle" type="button" onClick={toggle}>
        probe toggle
      </button>
    </div>
  );
}

describe('DesignerFocusSurface', () => {
  it('renders from its focused prop and reports the opposite value', async () => {
    const onFocusedChange = vi.fn();
    render(
      <DesignerFocusSurface
        id={SURFACE_ID}
        focused={false}
        onFocusedChange={onFocusedChange}
        className="host-class"
      >
        <DesignerFocusToggle id="designer-focus-toggle" />
      </DesignerFocusSurface>
    );

    expect(surface()).toHaveAttribute('data-focus-mode', 'off');
    await userEvent.click(screen.getByRole('button', { name: /focus mode/i }));
    expect(onFocusedChange).toHaveBeenCalledWith(true);
    // Controlled: the surface itself did not move.
    expect(surface()).toHaveAttribute('data-focus-mode', 'off');
  });

  it('reports the opposite value from a focused surface', async () => {
    const onFocusedChange = vi.fn();
    render(
      <DesignerFocusSurface id={SURFACE_ID} focused onFocusedChange={onFocusedChange}>
        <DesignerFocusToggle id="designer-focus-toggle" />
      </DesignerFocusSurface>
    );

    await userEvent.click(screen.getByRole('button', { name: /exit focus mode/i }));
    expect(onFocusedChange).toHaveBeenCalledWith(false);
  });

  it('holds no storage of its own and never reaches for the preference layer', () => {
    const directory = path.resolve(__dirname);
    for (const file of ['DesignerFocusSurface.tsx', 'DesignerFocusToggle.tsx']) {
      const source = readFileSync(path.join(directory, file), 'utf8');
      expect(source).not.toContain('user-composition');
      expect(source).not.toContain('localStorage');
    }
  });

  it('carries its id, the host className and data-focus-mode="off" when unfocused', () => {
    render(<Host />);

    expect(surface()).toHaveAttribute('data-focus-mode', 'off');
    expect(surface().className).toBe('host-class');
    expect(surface().className).not.toContain('fixed');
  });

  it('becomes a fixed full-window layer with the host focused class when focused', () => {
    render(<Host initialFocused />);

    expect(surface()).toHaveAttribute('data-focus-mode', 'on');
    expect(surface().className).toContain('fixed');
    expect(surface().className).toContain('inset-0');
    expect(surface().className).toContain('z-40');
    expect(surface().className).toContain('host-focused-class');
  });

  it('uses z-40 and a theme token background, with no hard-coded palette class', () => {
    expect(DESIGNER_FOCUS_SURFACE_FOCUSED_CLASSES).toContain('z-40');
    expect(DESIGNER_FOCUS_SURFACE_FOCUSED_CLASSES).toContain('bg-[rgb(var(--color-background))]');
    expect(DESIGNER_FOCUS_SURFACE_FOCUSED_CLASSES).not.toMatch(/\b(?:slate|gray|zinc|neutral|white|black)-/);
  });

  it('keeps its children mounted, and their state, across two toggles', async () => {
    childMountCount = 0;
    render(
      <Host>
        <StatefulChild />
      </Host>
    );

    await userEvent.type(screen.getByLabelText('child input'), 'kept');
    const node = surface();

    await userEvent.click(screen.getByRole('button', { name: /focus mode/i }));
    expect(surface()).toHaveAttribute('data-focus-mode', 'on');
    await userEvent.click(screen.getByRole('button', { name: /exit focus mode/i }));
    expect(surface()).toHaveAttribute('data-focus-mode', 'off');

    expect(screen.getByLabelText('child input')).toHaveValue('kept');
    expect(childMountCount).toBe(1);
    // The same DOM node in both modes: only its classes changed.
    expect(surface()).toBe(node);
  });

  it('exposes its state and toggle to descendants', async () => {
    render(
      <Host>
        <StateProbe />
      </Host>
    );

    expect(screen.getByTestId('probe-state')).toHaveTextContent('not-focused');
    await userEvent.click(screen.getByRole('button', { name: 'probe toggle' }));
    expect(screen.getByTestId('probe-state')).toHaveTextContent('focused');
  });

  it('reports not focused with a no-op toggle outside any surface', async () => {
    render(<StateProbe />);

    expect(screen.getByTestId('probe-state')).toHaveTextContent('not-focused');
    await userEvent.click(screen.getByRole('button', { name: 'probe toggle' }));
    expect(screen.getByTestId('probe-state')).toHaveTextContent('not-focused');
  });

  it('stays in the normal layout and offers nothing when it is not focusable', async () => {
    render(
      <Host initialFocused focusable={false}>
        <StateProbe />
      </Host>
    );

    // The saved preference says focused, but this view has no designer in it.
    expect(surface()).toHaveAttribute('data-focus-mode', 'off');
    expect(surface().className).toBe('host-class');
    expect(document.getElementById('designer-focus-toggle')).toBeNull();

    expect(screen.getByTestId('probe-state')).toHaveTextContent('not-focused');
    await userEvent.click(screen.getByRole('button', { name: 'probe toggle' }));
    expect(screen.getByTestId('probe-state')).toHaveTextContent('not-focused');
  });
});

describe('DesignerFocusToggle', () => {
  it('shows the enter label and aria-pressed="false" when unfocused', () => {
    render(<Host />);

    const toggle = document.getElementById('designer-focus-toggle') as HTMLButtonElement;
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAttribute('aria-label', 'Focus mode');
  });

  it('focuses the surface on click and then shows the exit label', async () => {
    render(<Host />);

    await userEvent.click(document.getElementById('designer-focus-toggle') as HTMLButtonElement);

    const toggle = document.getElementById('designer-focus-toggle') as HTMLButtonElement;
    expect(surface()).toHaveAttribute('data-focus-mode', 'on');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAttribute('aria-label', 'Exit focus mode');
  });

  it('renders nothing outside a surface', () => {
    render(<DesignerFocusToggle id="designer-focus-toggle" />);

    expect(document.getElementById('designer-focus-toggle')).toBeNull();
  });
});

describe('designer kit exports', () => {
  it('exports the surface, the toggle and the state hook', () => {
    expect(designerKit.DesignerFocusSurface).toBe(DesignerFocusSurface);
    expect(designerKit.DesignerFocusToggle).toBe(DesignerFocusToggle);
    expect(designerKit.useDesignerFocusState).toBe(useDesignerFocusState);
  });
});
