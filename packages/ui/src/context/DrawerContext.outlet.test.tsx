/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DrawerOutlet, DrawerProvider, useDrawer } from './DrawerContext';

function Probe({ onReady }: { onReady: (hasOutlet: () => boolean) => void }) {
  const { hasOutlet } = useDrawer();
  onReady(hasOutlet!);
  return null;
}

describe('DrawerProvider outlet tracking', () => {
  it('reports no outlet when none is mounted, and an outlet once DrawerOutlet mounts and until it unmounts', () => {
    let check: () => boolean = () => false;
    const without = render(<DrawerProvider><Probe onReady={(f) => { check = f; }} /></DrawerProvider>);
    expect(check()).toBe(false);
    without.unmount();

    const withOutlet = render(<DrawerProvider><Probe onReady={(f) => { check = f; }} /><DrawerOutlet /></DrawerProvider>);
    expect(check()).toBe(true);
    withOutlet.unmount();
  });
});
