/**
 * `@alga-psa/*` imports used by shared source that resolve to TypeScript source
 * only (no dist), so native Node cannot load them from a built runtime. Every
 * bundle that compiles shared source — shared/dist itself and packages that
 * bundle shared/workflow source by relative path, such as
 * ee/packages/workflows — must add these to `noExternal` to inline them.
 *
 * Only list dependency-free modules: an inlined copy must be safe to duplicate.
 * The lifecycle-error contract is matched structurally, not by constructor.
 */
export const SOURCE_ONLY_ALGA_IMPORTS: RegExp[] = [
  /^@alga-psa\/licensing\/lifecycle-error$/,
];
