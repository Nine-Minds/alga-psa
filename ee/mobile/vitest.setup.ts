// React Native defines __DEV__ globally; Vitest/node does not.
// Some modules (e.g. logger) use __DEV__ for defaults.
const testGlobals = globalThis as typeof globalThis & {
  __DEV__?: boolean;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

process.env.NODE_ENV = "development";
testGlobals.__DEV__ = true;
testGlobals.IS_REACT_ACT_ENVIRONMENT = true;

// Initialize i18n so useTranslation() returns real translations in tests.
// Dynamic import ensures __DEV__ is set before i18n.ts reads it.
await import("./src/i18n/i18n");
