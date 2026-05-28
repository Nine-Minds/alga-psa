declare module 'alga:extension/logging' {
  export function logInfo(message: string): void;
  export function logWarn(message: string): void;
  export function logError(message: string): void;
}

declare module 'alga:extension/ui-proxy' {
  export function callRoute(route: string, payload?: Uint8Array | null): Promise<Uint8Array>;
}

declare module 'alga:extension/context' {
  export function getContext(): unknown;
}
