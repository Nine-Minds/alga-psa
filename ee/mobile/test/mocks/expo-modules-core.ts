// Minimal mock for expo-modules-core so tests don't crash in Node.
// The real module relies on native ExpoGlobal which is unavailable in vitest.

export class EventEmitter {
  addListener() {
    return { remove: () => undefined };
  }
  removeAllListeners() {}
  emit() {}
}

export const NativeModulesProxy = new Proxy(
  {},
  { get: () => () => undefined },
);

export function requireNativeModule() {
  return new Proxy({}, { get: () => () => undefined });
}

export function requireOptionalNativeModule() {
  return null;
}
