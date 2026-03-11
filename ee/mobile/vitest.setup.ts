// React Native defines __DEV__ globally; Vitest/node does not.
// Some modules (e.g. logger) use __DEV__ for defaults.
const testGlobals = globalThis as typeof globalThis & {
  __DEV__?: boolean;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

testGlobals.__DEV__ = true;
testGlobals.IS_REACT_ACT_ENVIRONMENT = true;
