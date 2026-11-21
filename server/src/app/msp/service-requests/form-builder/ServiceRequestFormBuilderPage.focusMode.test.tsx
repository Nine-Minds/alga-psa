// @vitest-environment jsdom
/**
 * Focus mode on Form Studio: the builder opens inside the MSP layout, the toolbar toggle and the
 * saved preference drive the surface, and the palette follows the builder's own width until the
 * author takes charge of it.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const editorData = vi.hoisted(() => ({ load: vi.fn() }));
const preferences = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getUserPreference: vi.fn(),
  setUserPreference: vi.fn(),
}));

vi.mock('../actions', () => ({
  getServiceRequestDefinitionEditorDataAction: editorData.load,
  replaceServiceRequestFormSchemaAction: vi.fn().mockResolvedValue({}),
  validateServiceRequestDefinitionForPublishAction: vi.fn().mockResolvedValue({ errors: [] }),
  publishServiceRequestDefinitionAction: vi.fn().mockResolvedValue({}),
  updateServiceRequestFormBehaviorConfigAction: vi.fn().mockResolvedValue({}),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: (...args: unknown[]) => preferences.getCurrentUser(...args),
  getUserPreference: (...args: unknown[]) => preferences.getUserPreference(...args),
  setUserPreference: (...args: unknown[]) => preferences.setUserPreference(...args),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ definitionId: 'definition-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import ServiceRequestFormBuilderPage from './ServiceRequestFormBuilderPage';

const schema = {
  fields: [
    { key: 'full_name', type: 'short-text', label: 'Full name', required: true },
    { key: 'needs_laptop', type: 'checkbox', label: 'Needs a laptop?' },
  ],
};

function definitionData() {
  return {
    definitionId: 'definition-1',
    basics: { name: 'New employee setup' },
    form: { schema },
    execution: { executionConfig: {}, showAdvancedFormBehaviorConfigPanel: false },
  };
}

/** Drives the width the builder measures: jsdom reports 0 for everything by default. */
let measuredWidth = 1400;
const observers = new Set<{ callback: ResizeObserverCallback; target: Element | null }>();

function setMeasuredWidth(width: number) {
  measuredWidth = width;
  for (const observer of observers) {
    act(() => {
      observer.callback(
        [{ target: observer.target, contentRect: { width } } as unknown as ResizeObserverEntry],
        {} as ResizeObserver
      );
    });
  }
}

function surface(): HTMLElement | null {
  return document.getElementById('service-request-form-builder-surface');
}

function paletteToggle(): HTMLButtonElement {
  return document.getElementById('service-request-form-builder-palette-toggle') as HTMLButtonElement;
}

/** The collapse toggle says what it would do next: "Show palette" means it is collapsed. */
function isPaletteCollapsed(): boolean {
  return paletteToggle().getAttribute('aria-label') === 'Show palette';
}

beforeEach(() => {
  measuredWidth = 1400;
  observers.clear();
  window.localStorage.clear();
  editorData.load.mockResolvedValue(definitionData());
  preferences.getCurrentUser.mockResolvedValue({ user_id: 'user-1' });
  preferences.getUserPreference.mockResolvedValue(null);
  preferences.setUserPreference.mockResolvedValue(undefined);

  vi.stubGlobal(
    'ResizeObserver',
    class {
      private entry: { callback: ResizeObserverCallback; target: Element | null };
      constructor(callback: ResizeObserverCallback) {
        this.entry = { callback, target: null };
      }
      observe(target: Element) {
        this.entry.target = target;
        observers.add(this.entry);
      }
      disconnect() {
        observers.delete(this.entry);
      }
      unobserve() {
        observers.delete(this.entry);
      }
    }
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width: measuredWidth, height: 800, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function renderPage() {
  render(<ServiceRequestFormBuilderPage />);
  await waitFor(() => expect(document.getElementById('service-request-form-builder')).toBeInTheDocument());
}

describe('Form Studio focus mode', () => {
  it('opens in the normal layout when nothing is saved', async () => {
    await renderPage();

    expect(surface()).toHaveAttribute('data-focus-mode', 'off');
    expect(surface()!.className).not.toContain('fixed');
  });

  it('opens focused when the saved preference is true', async () => {
    preferences.getUserPreference.mockResolvedValue(true);
    await renderPage();

    await waitFor(() => expect(surface()).toHaveAttribute('data-focus-mode', 'on'));
    expect(preferences.getUserPreference).toHaveBeenCalledWith(
      'user-1',
      'designer_focus_mode_service_request_form'
    );
  });

  it('enters focus mode from the toolbar toggle and saves the choice', async () => {
    await renderPage();

    const toggle = document.getElementById('service-request-form-builder-focus-toggle')!;
    const publish = document.getElementById('service-request-form-builder-publish')!;
    // Before Publish in the toolbar.
    expect(toggle.compareDocumentPosition(publish) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(toggle);

    expect(surface()).toHaveAttribute('data-focus-mode', 'on');
    await waitFor(() =>
      expect(preferences.setUserPreference).toHaveBeenCalledWith(
        'user-1',
        'designer_focus_mode_service_request_form',
        true
      )
    );
  });

  it('returns to the normal layout on the second click and saves false', async () => {
    preferences.getUserPreference.mockResolvedValue(true);
    await renderPage();
    await waitFor(() => expect(surface()).toHaveAttribute('data-focus-mode', 'on'));

    await userEvent.click(document.getElementById('service-request-form-builder-focus-toggle')!);

    expect(surface()).toHaveAttribute('data-focus-mode', 'off');
    await waitFor(() =>
      expect(preferences.setUserPreference).toHaveBeenCalledWith(
        'user-1',
        'designer_focus_mode_service_request_form',
        false
      )
    );
  });

  it('renders the loading and failed states in the normal layout, preference or not', async () => {
    preferences.getUserPreference.mockResolvedValue(true);
    let resolveLoad: (value: unknown) => void = () => undefined;
    editorData.load.mockReturnValue(new Promise((resolve) => {
      resolveLoad = resolve;
    }));

    render(<ServiceRequestFormBuilderPage />);
    await waitFor(() =>
      expect(document.getElementById('service-request-form-builder-loading')).toBeInTheDocument()
    );
    expect(surface()).toBeNull();

    await act(async () => {
      resolveLoad(null);
    });
    await waitFor(() =>
      expect(document.getElementById('service-request-form-builder-error')).toBeInTheDocument()
    );
    expect(surface()).toBeNull();
  });

  it('keeps the whole toolbar in both modes', async () => {
    await renderPage();

    const toolbarIds = [
      'service-request-form-builder-back',
      'service-request-form-builder-undo',
      'service-request-form-builder-redo',
      'service-request-form-builder-save-status',
      'service-request-form-builder-mode-edit',
      'service-request-form-builder-mode-try',
      'service-request-form-builder-preview-desktop',
      'service-request-form-builder-settings',
      'service-request-form-builder-publish',
    ];
    for (const id of toolbarIds) {
      expect(document.getElementById(id)).toBeInTheDocument();
    }

    await userEvent.click(document.getElementById('service-request-form-builder-focus-toggle')!);

    for (const id of toolbarIds) {
      expect(document.getElementById(id)).toBeInTheDocument();
    }
  });

  it('keeps the form, the selection and the undo step across a toggle', async () => {
    await renderPage();

    await userEvent.click(document.getElementById('service-request-form-canvas-element-full_name')!);
    const label = document.getElementById('service-request-form-builder-label') as HTMLInputElement;
    expect(label).toHaveValue('Full name');
    await userEvent.clear(label);
    await userEvent.type(label, 'Legal name');

    await userEvent.click(document.getElementById('service-request-form-builder-focus-toggle')!);

    expect(surface()).toHaveAttribute('data-focus-mode', 'on');
    expect(document.getElementById('service-request-form-builder-label')).toHaveValue('Legal name');
    expect(document.getElementById('service-request-form-builder-undo')).not.toBeDisabled();
  });
});

describe('Form Studio palette width rule', () => {
  it('collapses the palette while the builder is narrow', async () => {
    measuredWidth = 1000;
    await renderPage();

    await waitFor(() => expect(isPaletteCollapsed()).toBe(true));
  });

  it('expands the palette once the builder is wide enough', async () => {
    measuredWidth = 1000;
    await renderPage();
    await waitFor(() => expect(isPaletteCollapsed()).toBe(true));

    setMeasuredWidth(1400);

    await waitFor(() => expect(isPaletteCollapsed()).toBe(false));
  });

  it('leaves the palette alone once the author has expanded it', async () => {
    measuredWidth = 1000;
    await renderPage();
    await waitFor(() => expect(isPaletteCollapsed()).toBe(true));

    await userEvent.click(paletteToggle());
    expect(isPaletteCollapsed()).toBe(false);

    setMeasuredWidth(1000);

    expect(isPaletteCollapsed()).toBe(false);
  });

  it('leaves a hand-collapsed palette collapsed when focus mode widens the builder', async () => {
    measuredWidth = 1400;
    await renderPage();
    await waitFor(() => expect(isPaletteCollapsed()).toBe(false));

    await userEvent.click(paletteToggle());
    expect(isPaletteCollapsed()).toBe(true);

    await userEvent.click(document.getElementById('service-request-form-builder-focus-toggle')!);
    setMeasuredWidth(1600);

    expect(isPaletteCollapsed()).toBe(true);
  });
});
