// Empty shim module for optional/native packages not used in this deployment
// This is used by Turbopack resolveAlias to avoid bundling or resolving them.
export default {} as any;
export const noop = () => {};
