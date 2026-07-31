import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom environments are reused across test files, so components left mounted
// by one file (Radix focus traps especially) steal focus from the next file's
// tests. RTL auto-cleanup only activates with `globals: true`; run it here.
afterEach(() => {
  cleanup();
});
