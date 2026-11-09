// @vitest-environment jsdom
import React, { StrictMode, createContext, useContext } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DrawerOutlet, DrawerProvider, useDrawer } from './DrawerContext';
import { KeyboardShortcutsProvider } from '../keyboard-shortcuts';
import { useRegisterDismissGuard } from '../components/DismissGuard';

type DrawerCommands = ReturnType<typeof useDrawer>;
const FeatureContext = createContext('shell');

function FeatureDetails({ label }: { label: string }) {
  return <h1>{label}: {useContext(FeatureContext)}</h1>;
}

function Capture({ onReady }: { onReady: (drawer: DrawerCommands) => void }) {
  onReady(useDrawer());
  return null;
}

function Route({ name, capture }: { name: string; capture?: (drawer: DrawerCommands) => void }) {
  return (
    <DrawerProvider>
      <FeatureContext value={name}>
        {capture && <Capture onReady={capture} />}
        <DrawerOutlet />
      </FeatureContext>
    </DrawerProvider>
  );
}

describe('drawer scope ownership', () => {
  it('handles keyboard history and dismissal once through the owning outlet', async () => {
    let ancestor!: DrawerCommands;
    const onClose = vi.fn();
    await act(async () => {
      render(
        <KeyboardShortcutsProvider platform="other">
          <DrawerProvider>
            <Capture onReady={drawer => { ancestor = drawer; }} />
            <Route name="workspace" />
            <DrawerOutlet />
          </DrawerProvider>
        </KeyboardShortcutsProvider>,
      );
    });
    // The registered panel shortcuts are inert while no drawer owns the panel scope.
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    fireEvent.keyDown(document, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true });
    expect(screen.queryByRole('heading', { name: 'First: workspace' })).toBeNull();

    act(() => ancestor.openDrawer(<FeatureDetails label="First" />));
    act(() => ancestor.openDrawer(<FeatureDetails label="Second" />, undefined, onClose));
    expect(screen.getAllByRole('button', { name: 'Close drawer' })).toHaveLength(1);

    fireEvent.keyDown(document, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true });
    expect(screen.getByRole('heading', { name: 'First: workspace' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'ArrowRight', code: 'ArrowRight', altKey: true });
    expect(screen.getByRole('heading', { name: 'Second: workspace' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Second: workspace' })).toBeNull());
    expect(onClose).toHaveBeenCalledTimes(1);
    // Closing releases panel scope; an additional Escape must not close anything else.
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the owned drawer open until its unsaved changes are discarded', async () => {
    let ancestor!: DrawerCommands;
    const onClose = vi.fn();
    function DirtyDetails() {
      useRegisterDismissGuard(true);
      return <h1>Unsaved details</h1>;
    }
    render(
      <DrawerProvider>
        <Capture onReady={drawer => { ancestor = drawer; }} />
        <Route name="workspace" />
        <DrawerOutlet />
      </DrawerProvider>,
    );
    act(() => ancestor.openDrawer(<DirtyDetails />, undefined, onClose));
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
    expect(await screen.findByText('Discard unsaved changes?')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Unsaved details', hidden: true })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Unsaved details' })).toBeNull());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('applies batched opens and history commands to their queued owner', () => {
    let ancestor!: DrawerCommands;
    render(
      <DrawerProvider>
        <Capture onReady={drawer => { ancestor = drawer; }} />
        <Route name="workspace" />
      </DrawerProvider>,
    );

    act(() => {
      ancestor.openDrawer(<FeatureDetails label="Closed" />);
      ancestor.closeDrawer();
    });
    expect(screen.queryByRole('heading', { name: 'Closed: workspace' })).toBeNull();
    act(() => {
      ancestor.openDrawer(<FeatureDetails label="First" />);
      ancestor.openDrawer(<FeatureDetails label="Second" />);
      ancestor.goBack();
    });
    expect(screen.getByRole('heading', { name: 'First: workspace' })).toBeTruthy();
  });

  it('keeps ancestor history, replacement, and close commands bound to the visible drawer', () => {
    let ancestor!: DrawerCommands;
    let route!: DrawerCommands;
    render(
      <StrictMode>
        <DrawerProvider>
          <Capture onReady={drawer => { ancestor = drawer; }} />
          <Route name="workspace" capture={drawer => { route = drawer; }} />
          <DrawerOutlet />
        </DrawerProvider>
      </StrictMode>,
    );
    // Shell callers such as the stopwatch retain these callbacks before opening.
    const commands = ancestor;
    const onClose = vi.fn();
    expect(commands.hasOutlet?.()).toBe(true);
    act(() => commands.openDrawer(<FeatureDetails label="First" />));
    act(() => commands.openDrawer(<FeatureDetails label="Second" />));
    expect(screen.getByRole('heading', { name: 'Second: workspace' })).toBeTruthy();
    expect(ancestor.canGoBack).toBe(true);
    expect(route.history).toHaveLength(2);

    act(() => commands.goBack());
    expect(screen.getByRole('heading', { name: 'First: workspace' })).toBeTruthy();
    act(() => commands.goForward());
    expect(screen.getByRole('heading', { name: 'Second: workspace' })).toBeTruthy();
    act(() => commands.replaceDrawer(<FeatureDetails label="Replacement" />));
    expect(screen.getByRole('heading', { name: 'Replacement: workspace' })).toBeTruthy();
    expect(ancestor.canGoBack).toBe(false);
    act(() => commands.openDrawer(<FeatureDetails label="Final" />, undefined, onClose));
    expect(screen.getAllByRole('button', { name: 'Close drawer' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(ancestor.history).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Final: workspace' })).toBeNull();
  });

  it('does not restore departed sibling scopes when overlapping routes unmount out of order', () => {
    let ancestor!: DrawerCommands;
    let firstCommands!: DrawerCommands;
    function App({ first, second }: { first: boolean; second: boolean }) {
      return (
        <DrawerProvider>
          <Capture onReady={drawer => { ancestor = drawer; }} />
          {first && <Route key="first" name="first" capture={drawer => { firstCommands = drawer; }} />}
          {second && <Route key="second" name="second" />}
          <DrawerOutlet />
        </DrawerProvider>
      );
    }
    const view = render(<App first second={false} />);
    act(() => ancestor.openDrawer(<FeatureDetails label="Details" />));
    expect(screen.getByRole('heading', { name: 'Details: first' })).toBeTruthy();

    view.rerender(<App first second />);
    act(() => ancestor.openDrawer(<FeatureDetails label="Details" />));
    expect(screen.getByRole('heading', { name: 'Details: second' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Details: first' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Close drawer' })).toHaveLength(1);
    act(() => firstCommands.closeDrawer());
    expect(screen.getByRole('heading', { name: 'Details: second' })).toBeTruthy();

    view.rerender(<App first={false} second />);
    expect(screen.getByRole('heading', { name: 'Details: second' })).toBeTruthy();
    view.rerender(<App first={false} second={false} />);
    expect(ancestor.history).toHaveLength(0);
    act(() => ancestor.openDrawer(<FeatureDetails label="Returned" />));
    expect(screen.getByRole('heading', { name: 'Returned: shell' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
    expect(screen.queryByRole('heading', { name: 'Returned: shell' })).toBeNull();
  });

  it('ignores callbacks retained by a removed route instead of changing the next drawer', () => {
    let ancestor!: DrawerCommands;
    let route!: DrawerCommands;
    function App({ showRoute }: { showRoute: boolean }) {
      return (
        <DrawerProvider>
          <Capture onReady={drawer => { ancestor = drawer; }} />
          {showRoute && <Route name="workspace" capture={drawer => { route = drawer; }} />}
          <DrawerOutlet />
        </DrawerProvider>
      );
    }
    const view = render(<App showRoute />);
    const departed = route;
    act(() => route.openDrawer(<FeatureDetails label="Old" />));
    view.rerender(<App showRoute={false} />);
    expect(screen.queryByRole('heading', { name: 'Old: workspace' })).toBeNull();
    expect(departed.hasOutlet?.()).toBe(false);
    act(() => ancestor.openDrawer(<FeatureDetails label="Current" />));
    act(() => {
      departed.closeDrawer();
      departed.replaceDrawer(<FeatureDetails label="Stale" />);
      departed.openDrawer(<FeatureDetails label="Stale" />);
    });
    expect(screen.getByRole('heading', { name: 'Current: shell' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Stale: workspace' })).toBeNull();
  });
});
