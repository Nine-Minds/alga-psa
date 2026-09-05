if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react');
  const { afterEach } = await import('vitest');
  afterEach(() => {
    cleanup();
  });

  // jsdom implements neither; components call both on selection changes.
  if (typeof (globalThis as Record<string, unknown>).ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }

  // Match the clients package: parallel CI runners can stretch renders past
  // testing-library's 1s default async timeout.
  const { configure } = await import('@testing-library/dom');
  configure({ asyncUtilTimeout: 10_000 });
  const { configure: configureReact } = await import('@testing-library/react');
  configureReact({ asyncUtilTimeout: 10_000 });
}
