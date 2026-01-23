export const __emptyShim = true;

export default function emptyShim(): never {
  throw new Error(
    'This module has been aliased to an empty shim for this build (likely because it is Node.js-only or an optional dependency).',
  );
}
export {};
