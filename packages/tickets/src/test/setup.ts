import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// The native ticket data source resolves each server action with a lazy import() when a mounted section first
// calls it. A file's last render can leave such a load in flight; settle it while the worker is still alive so its
// outcome (and any error a component logs) is not delivered after teardown ("Closing rpc while onUserConsoleLog
// was pending").
afterAll(async () => {
  await vi.dynamicImportSettled();
});
