// React Native defines __DEV__ globally; Vitest/node does not.
// Some modules (e.g. logger) use __DEV__ for defaults.
(globalThis as any).__DEV__ = true;

