// Minimal mock for the `expo` package root. SDK 58 moved the native-module
// helpers that the expo-* packages consume out of expo-modules-core and into
// `expo`, so tests need the same stubs under the new entry point.

export class EventEmitter {
  addListener() {
    return { remove: () => undefined };
  }
  removeAllListeners() {}
  emit() {}
}

export class NativeModule extends EventEmitter {}

export class SharedObject extends EventEmitter {}

export class SharedRef extends SharedObject {}

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

export function requireNativeView() {
  return () => null;
}

export class CodedError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class UnavailabilityError extends CodedError {
  constructor(moduleName: string, propertyName: string) {
    super(
      "ERR_UNAVAILABLE",
      `The method or property ${moduleName}.${propertyName} is not available on this platform.`,
    );
  }
}

export const PermissionStatus = {
  DENIED: "denied",
  GRANTED: "granted",
  UNDETERMINED: "undetermined",
} as const;

export function createPermissionHook() {
  return () => [null, async () => null, async () => null] as const;
}

export function isRunningInExpoGo() {
  return false;
}

export const Platform = {
  OS: "ios",
  select: <T,>(specifics: { ios?: T; android?: T; web?: T; default?: T }) =>
    specifics.ios ?? specifics.default,
};

export const uuid = {
  v4: () => "00000000-0000-4000-8000-000000000000",
  v5: () => "00000000-0000-5000-8000-000000000000",
};
