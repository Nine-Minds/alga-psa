if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react');
  const { afterEach } = await import('vitest');
  afterEach(() => {
    cleanup();
  });

  // jsdom lacks ResizeObserver, which Radix Select/use-size needs to render.
  if (typeof (globalThis as Record<string, unknown>).ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
  }

  // CI runs the affected nx projects in parallel, so a saturated runner can
  // stretch renders past testing-library's 1s default async timeout (waitFor,
  // findBy*) and flake component suites that pass everywhere else. Configure
  // through the react entry point as well: @testing-library/react ships its
  // own nested copy of @testing-library/dom, so configuring only the top-level
  // dom package leaves the copy react actually uses at the 1s default.
  const { configure } = await import('@testing-library/dom');
  configure({ asyncUtilTimeout: 10_000 });
  const { configure: configureReact } = await import('@testing-library/react');
  configureReact({ asyncUtilTimeout: 10_000 });
}
